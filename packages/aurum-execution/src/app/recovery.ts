/**
 * The recovery path (W006 app layer): resume-after-interruption with
 * EXACTLY-ONCE semantic settlement.
 *
 * `runRecovery` scans the tenant's non-terminal sessions and re-drives each
 * through its crash-window route (domain/recovery.ts):
 * - no ticket stored → re-SUBMIT with the session's idempotency submission
 *   key; the platform contract dedups by that key (same ticket, `replay`),
 *   so the work never executes twice;
 * - ticket stored → re-AWAIT the ticket.
 * Settlement then goes through `applySettlement`: an identical duplicate is
 * suppressed, never rewritten — the same request id settles exactly once.
 */
import type { AurumSubmissionTicket } from "@zcode/shared/aurum-boundary";
import type { ExecutionError } from "../domain/errors.js";
import type { Result } from "../domain/errors.js";
import type { ExecutionTerminalState } from "../domain/lifecycle.js";
import type { ExecutionRequestId, ExecutionScope, ExecutionTenantId } from "../domain/ids.js";
import type { ExecutionSession } from "../domain/session.js";
import { withAcknowledgement } from "../domain/session.js";
import { interruptedSessionsOf, recoveryRouteOf } from "../domain/recovery.js";
import { mapBoundaryRejection } from "./settlement.js";
import {
  appendEvent,
  applyPlatformEnvelope,
  failSession,
  type GatewayCoreDeps,
  type SettlementApplication,
  resolveEnvironmentForSession,
} from "./gateway-support.js";

/** Per-request recovery outcome. */
export type RecoveryOutcomeKind = "settled" | "failed" | "cancelled" | "already-settled";

export interface RecoveryOutcome {
  readonly requestId: ExecutionRequestId;
  readonly outcome: RecoveryOutcomeKind;
  readonly finalState: ExecutionTerminalState;
}

export interface RecoveryReport {
  readonly tenantId: ExecutionTenantId;
  readonly examined: number;
  readonly settled: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly alreadySettled: number;
  readonly outcomes: readonly RecoveryOutcome[];
}

type RecoverableFailureKind =
  | "interrupted"
  | "not-wired"
  | "transport-failed"
  | "deadline-exceeded";

/** Re-brands a session-stored opaque ticket string for a platform call. */
function reissueTicket(ticket: string): AurumSubmissionTicket {
  return ticket as AurumSubmissionTicket;
}

/** Runs the recovery pass for one tenant (sequential, request order). */
export async function runRecovery(
  deps: GatewayCoreDeps,
  scope: ExecutionScope,
): Promise<Result<RecoveryReport, ExecutionError>> {
  const interrupted = interruptedSessionsOf(deps.sessions.listSessions(scope.tenantId));
  const outcomes: RecoveryOutcome[] = [];
  let settled = 0;
  let failed = 0;
  let cancelled = 0;
  let alreadySettled = 0;

  for (const session of interrupted) {
    const recovered = await recoverOne(deps, session);
    if (!recovered.ok) return recovered;
    const application = recovered.value;
    outcomes.push({
      requestId: application.settlement.requestId,
      outcome: application.firstSettlement ? application.settlement.status : "already-settled",
      finalState: application.settlement.status,
    });
    if (!application.firstSettlement) {
      alreadySettled += 1;
      continue;
    }
    switch (application.settlement.status) {
      case "settled":
        settled += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "cancelled":
        cancelled += 1;
        break;
    }
  }

  return {
    ok: true,
    value: {
      tenantId: scope.tenantId,
      examined: interrupted.length,
      settled,
      failed,
      cancelled,
      alreadySettled,
      outcomes,
    },
  };
}

async function recoverOne(
  deps: GatewayCoreDeps,
  session: ExecutionSession,
): Promise<Result<SettlementApplication, ExecutionError>> {
  const route = recoveryRouteOf(session);
  const opened = appendEvent(
    deps,
    session.tenantId,
    session.requestId,
    "recovery-opened",
    `state=${session.state} route=${route.route}`,
  );
  if (!opened.ok) return opened;

  const resolved = resolveEnvironmentForSession(deps, session);
  if (!resolved.ok) {
    return settledFailure(deps, session, "interrupted", {
      message: `environment unresolved during recovery: ${resolved.error.message}`,
    });
  }
  const environment = resolved.value.environment;
  if (!environment.descriptor.wired) {
    return settledFailure(deps, session, "not-wired", {
      message: `environment ${session.capabilityId ?? "?"} is no longer wired`,
    });
  }

  let current = session;
  if (route.route === "resubmit") {
    let ack;
    try {
      ack = await environment.transport.submit({
        capability: resolved.value.handle,
        payload: session.payload,
        payloadMediaType: session.payloadMediaType,
        submissionKey: route.submissionKey,
        ...(session.deadlineEpochMs === undefined
          ? {}
          : { deadlineEpochMs: session.deadlineEpochMs }),
      });
    } catch (error) {
      return settledFailure(deps, session, "transport-failed", {
        message: `recovery resubmit failed: ${String(error)}`,
        retryable: true,
      });
    }
    const acknowledged = deps.sessions.putSession(
      withAcknowledgement(
        current,
        { ticket: ack.ticket, replay: ack.replay },
        deps.clock.now(),
      ),
    );
    if (!acknowledged.ok) return acknowledged;
    current = acknowledged.value;
    const journaled = appendEvent(
      deps,
      session.tenantId,
      session.requestId,
      "submission-acknowledged",
      `recovery resubmit replay=${ack.replay}`,
    );
    if (!journaled.ok) return journaled;
  }

  const ticket = current.submissionTicket ?? route.ticket;
  if (ticket === null) {
    return settledFailure(deps, session, "interrupted", {
      message: "no platform ticket after recovery resubmit",
    });
  }
  try {
    const envelope = await environment.transport.awaitCompletion(reissueTicket(ticket));
    const applied = applyPlatformEnvelope(deps, current, envelope);
    if (applied.ok && applied.value.firstSettlement) {
      const event = appendEvent(
        deps,
        session.tenantId,
        session.requestId,
        "recovery-settled",
        `route=${route.route} status=${applied.value.settlement.status}`,
      );
      if (!event.ok) return event;
    }
    return applied;
  } catch (error) {
    const mapped = mapBoundaryRejection(error);
    return settledFailure(deps, session, failureKindOf(mapped), {
      message: `recovery await failed: ${mapped.message}`,
      retryable: true,
    });
  }
}

function settledFailure(
  deps: GatewayCoreDeps,
  session: ExecutionSession,
  kind: RecoverableFailureKind,
  options: { message: string; retryable?: boolean },
): Result<SettlementApplication, ExecutionError> {
  const recorded = appendEvent(
    deps,
    session.tenantId,
    session.requestId,
    "failure-recorded",
    `recovery: ${options.message}`,
  );
  if (!recorded.ok) return recorded;
  return failSession(deps, session, kind, options.message, {
    retryable: options.retryable,
  });
}

function failureKindOf(
  error: ExecutionError,
): "deadline-exceeded" | "interrupted" | "transport-failed" {
  switch (error.code) {
    case "execution/timeout":
      return "deadline-exceeded";
    case "execution/interrupted":
      return "interrupted";
    default:
      return "transport-failed";
  }
}
