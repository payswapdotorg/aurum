/**
 * Control-request operations (W006 app layer): pause / resume / cancel.
 *
 * Control semantics (the authority law applies): a control request operates
 * on the SESSION and the platform submission — it never touches semantic
 * state. Control-request FAILURES (unsupported control, transport rejection)
 * return typed errors and leave the in-flight session untouched: the control
 * failed, not the execution. A control that races a terminal settlement
 * applies the racing settlement (exactly-once) and fails the control typed
 * (lifecycle-illegal) — the settlement is never rewritten to satisfy the
 * control.
 */
import type {
  AurumSubmissionTicket,
  AurumTransportControlOutcome,
} from "@zcode/shared/aurum-boundary";
import {
  err,
  executionControlUnsupported,
  executionInterrupted,
  executionInvariant,
  executionLifecycleIllegal,
  type ExecutionError,
  type Result,
} from "../domain/errors.js";
import type { ExecutionRequestId, ExecutionScope } from "../domain/ids.js";
import { buildExecutionSettlement } from "../domain/envelope.js";
import type { ExecutionSettlement } from "../domain/envelope.js";
import { withSessionState } from "../domain/session.js";
import type { ExecutionSession } from "../domain/session.js";
import type { ExecutionEnvironment } from "../domain/ports.js";
import { isExecutionSessionState } from "../domain/lifecycle.js";
import { mapBoundaryRejection, settlementContextOf } from "./settlement.js";
import {
  appendEvent,
  applyPlatformEnvelope,
  applySettlement,
  reissueTicket,
  type GatewayCoreDeps,
  type SettlementApplication,
} from "./gateway-support.js";

/** Fetches the platform envelope and settles the session from it. */
export async function settleFromPlatform(
  deps: GatewayCoreDeps,
  session: ExecutionSession,
  environment: ExecutionEnvironment,
): Promise<SettlementApplication> {
  if (session.submissionTicket === undefined) {
    throw executionInvariant("settleFromPlatform called without a ticket");
  }
  const envelope = await environment.transport.awaitCompletion(
    reissueTicket(session.submissionTicket),
  );
  const applied = applyPlatformEnvelope(deps, session, envelope);
  if (!applied.ok) throw applied.error;
  return applied.value;
}

/** Applies a local cancel settlement (no platform round-trip). */
export function settleCancelled(
  deps: GatewayCoreDeps,
  session: ExecutionSession,
): Result<SettlementApplication, ExecutionError> {
  const settlement = buildExecutionSettlement(settlementContextOf(session), {
    status: "cancelled",
    settledAt: deps.clock.now(),
  });
  return applySettlement(deps, session, settlement);
}

/**
 * Drives one pause/resume control request through the pausable extension:
 * applied → semantic state transition (journaled); already-terminal → the
 * racing settlement is fetched/applied and the control fails typed;
 * rejection → typed error, session untouched.
 */
async function controlTransition(
  deps: GatewayCoreDeps,
  session: ExecutionSession,
  environment: ExecutionEnvironment,
  control: (ticket: AurumSubmissionTicket) => Promise<AurumTransportControlOutcome>,
  journalKind: "execution-paused" | "execution-resumed",
  controlName: "pause" | "resume",
): Promise<Result<ExecutionSession, ExecutionError>> {
  if (session.submissionTicket === undefined) {
    return err(executionInterrupted(session.requestId as string));
  }
  const ticket = reissueTicket(session.submissionTicket);
  let outcome: AurumTransportControlOutcome;
  try {
    outcome = await control(ticket);
  } catch (error) {
    const mapped = mapBoundaryRejection(error);
    const event = appendEvent(
      deps,
      session.tenantId,
      session.requestId,
      "failure-recorded",
      `${controlName} transport failure: ${mapped.message}`,
    );
    if (!event.ok) return event;
    return err(mapped);
  }
  if (outcome.outcome === "applied") {
    const state = outcome.state;
    if (
      !isExecutionSessionState(state) ||
      state === "settled" ||
      state === "cancelled" ||
      state === "failed"
    ) {
      return err(
        executionInvariant(`${controlName} applied reported terminal/unknown state "${state}"`),
      );
    }
    const transitioned = withSessionState(session, state, deps.clock.now());
    if (!transitioned.ok) return transitioned;
    const stored = deps.sessions.putSession(transitioned.value);
    if (!stored.ok) return stored;
    const event = appendEvent(deps, session.tenantId, session.requestId, journalKind);
    if (!event.ok) return event;
    return stored;
  }
  // already-terminal: the platform finished while the control was racing —
  // apply the settlement, then fail the control typed (never rewrite it).
  try {
    await settleFromPlatform(deps, session, environment);
  } catch (error) {
    return err(mapBoundaryRejection(error));
  }
  return err(
    executionLifecycleIllegal(session.state, controlName === "pause" ? "paused" : "running"),
  );
}

/** The full pause or resume operation for one execution. */
export async function controlRequest(
  deps: GatewayCoreDeps,
  scope: ExecutionScope,
  requestId: ExecutionRequestId,
  controlName: "pause" | "resume",
): Promise<Result<ExecutionSession, ExecutionError>> {
  const found = deps.sessions.getSession(scope.tenantId, requestId);
  if (!found.ok) return found;
  const session = found.value;
  if (session.settlement !== undefined) {
    return err(executionLifecycleIllegal(session.state, controlName === "pause" ? "paused" : "running"));
  }
  if (controlName === "resume" && session.state !== "paused") {
    return err(executionLifecycleIllegal(session.state, "running"));
  }
  const resolved = deps.environments.resolveByCapabilityId(session.capabilityId ?? "");
  if (!resolved.ok) return resolved;
  const environment = resolved.value;
  const control = environment.descriptor.control;
  const supported = controlName === "pause" ? control.pausable : control.resumable;
  if (!supported || environment.pausable === undefined) {
    const refusal = appendEvent(
      deps,
      scope.tenantId,
      requestId,
      "failure-recorded",
      `${controlName} unsupported by environment`,
    );
    if (!refusal.ok) return refusal;
    return err(executionControlUnsupported(controlName));
  }
  return controlTransition(
    deps,
    session,
    environment,
    controlName === "pause" ? environment.pausable.pause : environment.pausable.resume,
    controlName === "pause" ? "execution-paused" : "execution-resumed",
    controlName,
  );
}

/** The full cancel operation for one execution (idempotent for cancelled). */
export async function cancelRequest(
  deps: GatewayCoreDeps,
  scope: ExecutionScope,
  requestId: ExecutionRequestId,
): Promise<Result<ExecutionSettlement, ExecutionError>> {
  const found = deps.sessions.getSession(scope.tenantId, requestId);
  if (!found.ok) return found;
  const session = found.value;
  if (session.settlement !== undefined) {
    if (session.state === "cancelled") {
      const suppressed = appendEvent(
        deps,
        scope.tenantId,
        requestId,
        "duplicate-suppressed",
        "cancel of already-cancelled execution",
      );
      if (!suppressed.ok) return suppressed;
      return { ok: true, value: session.settlement };
    }
    return err(executionLifecycleIllegal(session.state, "cancelled"));
  }
  const cancelRequested = appendEvent(deps, scope.tenantId, requestId, "cancel-requested");
  if (!cancelRequested.ok) return cancelRequested;
  if (session.submissionTicket === undefined) {
    // Never acknowledged: nothing is executing under our ticket — cancel
    // locally (a later recovery resubmit would dedup via the submission key,
    // and a settlement already exists to stop it from running again).
    const applied = settleCancelled(deps, session);
    if (!applied.ok) return applied;
    return { ok: true, value: applied.value.settlement };
  }
  const resolved = deps.environments.resolveByCapabilityId(session.capabilityId ?? "");
  if (!resolved.ok) return resolved;
  const environment = resolved.value;
  if (!environment.descriptor.control.cancellable) {
    const refusal = appendEvent(
      deps,
      scope.tenantId,
      requestId,
      "failure-recorded",
      "cancel unsupported by environment",
    );
    if (!refusal.ok) return refusal;
    return err(executionControlUnsupported("cancel"));
  }
  const ticket = reissueTicket(session.submissionTicket);
  try {
    const outcome = await environment.transport.cancel(ticket);
    if (outcome.outcome === "applied") {
      if (outcome.state !== "cancelled") {
        const applied = await settleFromPlatform(deps, session, environment);
        return { ok: true, value: applied.settlement };
      }
      const applied = settleCancelled(deps, session);
      if (!applied.ok) return applied;
      return { ok: true, value: applied.value.settlement };
    }
    // already-terminal: fetch + apply the racing settlement.
    const applied = await settleFromPlatform(deps, session, environment);
    if (applied.settlement.status === "cancelled") {
      return { ok: true, value: applied.settlement };
    }
    return err(executionLifecycleIllegal(session.state, "cancelled"));
  } catch (error) {
    const mapped = mapBoundaryRejection(error);
    const event = appendEvent(
      deps,
      scope.tenantId,
      requestId,
      "failure-recorded",
      `cancel transport failure: ${mapped.message}`,
    );
    if (!event.ok) return event;
    return err(mapped);
  }
}
