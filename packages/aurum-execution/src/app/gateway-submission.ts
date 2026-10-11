/**
 * Submission + await operations (W006 app layer).
 *
 * `submitExecutionOperation`: validates the request (typed refusal, nothing
 * accepted), applies idempotent duplicate delivery (same request id → same
 * session/settlement, journal duplicate-suppressed, never a second platform
 * submission), resolves the environment (semantic selection + fail-closed
 * wiring gate + W001 seam handle), persists the pending session (write-ahead
 * — the crash window recovery owns), submits through the boundary transport
 * port with the derived idempotency key, records the acknowledgement and
 * journals every step. Transport failures settle the session failed and
 * return the ORIGINAL typed error (authority law).
 *
 * `awaitSettledOperation`: terminal sessions return their settlement
 * (idempotent); in-flight sessions await the platform envelope and settle
 * from it EXACTLY ONCE. Wait-level failures: caller aborts leave the session
 * re-awaitable (typed await-aborted); deadline/transport failures settle the
 * session failed for durability and return typed errors. Platform-reported
 * failed envelopes resolve as ok(settlement with status "failed") — the
 * execution's own normalized outcome.
 */
import {
  err,
  executionInterrupted,
  executionValidationError,
  ok,
  type ExecutionError,
  type Result,
} from "../domain/errors.js";
import type { ExecutionScope } from "../domain/ids.js";
import type { ExecutionSettlement } from "../domain/envelope.js";
import {
  createPendingSession,
  executionRequestIssues,
  withAcknowledgement,
  withEnvironmentSelected,
  withSessionState,
  type ExecutionRequest,
  type ExecutionSession,
} from "../domain/session.js";
import { submissionKeyOf } from "../domain/recovery.js";
import { mapBoundaryRejection } from "./settlement.js";
import {
  appendEvent,
  applyPlatformEnvelope,
  failSession,
  reissueTicket,
  resolveEnvironment,
  resolveEnvironmentForSession,
  submitFailure,
  type AwaitSettledOptions,
  type GatewayCoreDeps,
} from "./gateway-support.js";

/** Result of accepting an execution request. */
export interface ExecutionSubmissionOutcome {
  readonly session: ExecutionSession;
  /** True when an existing request id was re-delivered (idempotent). */
  readonly replay: boolean;
  /** Present when the re-delivered session was already terminal. */
  readonly settlement?: ExecutionSettlement;
}

export async function submitExecutionOperation(
  deps: GatewayCoreDeps,
  scope: ExecutionScope,
  request: ExecutionRequest,
): Promise<Result<ExecutionSubmissionOutcome, ExecutionError>> {
  const issues = executionRequestIssues(request);
  if (issues.length > 0) {
    return err(executionValidationError(issues));
  }
  const existing = deps.sessions.getSession(scope.tenantId, request.requestId);
  if (existing.ok) {
    const suppressed = appendEvent(
      deps,
      scope.tenantId,
      request.requestId,
      "duplicate-suppressed",
      `state=${existing.value.state}`,
    );
    if (!suppressed.ok) return suppressed;
    return ok({
      session: existing.value,
      replay: true,
      ...(existing.value.settlement === undefined ? {} : { settlement: existing.value.settlement }),
    });
  }
  const resolved = resolveEnvironment(deps, {
    environmentClass: request.environmentClass,
    ...(request.variant === undefined ? {} : { variant: request.variant }),
  });
  if (!resolved.ok) {
    const admission = appendEvent(
      deps,
      scope.tenantId,
      request.requestId,
      "failure-recorded",
      `admission refusal: ${resolved.error.message}`,
    );
    if (!admission.ok) return admission;
    return err(resolved.error);
  }
  const session = withEnvironmentSelected(
    createPendingSession(scope.tenantId, request, {
      now: deps.clock.now(),
      submissionKey: submissionKeyOf(scope.tenantId, request.requestId),
    }),
    {
      environmentId: resolved.value.environment.descriptor.environmentId,
      capabilityId: resolved.value.capabilityId,
      environmentVariant: resolved.value.environment.descriptor.variant,
    },
    deps.clock.now(),
  );
  const stored = deps.sessions.putSession(session);
  if (!stored.ok) return stored;
  const accepted = appendEvent(
    deps,
    scope.tenantId,
    request.requestId,
    "request-accepted",
    `environment=${resolved.value.capabilityId}`,
  );
  if (!accepted.ok) return accepted;
  const selected = appendEvent(
    deps,
    scope.tenantId,
    request.requestId,
    "environment-selected",
    `class=${request.environmentClass}`,
  );
  if (!selected.ok) return selected;

  let ack;
  try {
    ack = await resolved.value.environment.transport.submit({
      capability: resolved.value.handle,
      payload: request.payload,
      payloadMediaType: request.payloadMediaType,
      submissionKey: session.submissionKey,
      ...(request.deadlineEpochMs === undefined
        ? {}
        : { deadlineEpochMs: request.deadlineEpochMs }),
    });
  } catch (error) {
    return submitFailure(deps, stored.value, mapBoundaryRejection(error));
  }
  const acknowledged = deps.sessions.putSession(
    withAcknowledgement(stored.value, { ticket: ack.ticket, replay: ack.replay }, deps.clock.now()),
  );
  if (!acknowledged.ok) return acknowledged;
  const journaled = appendEvent(
    deps,
    scope.tenantId,
    request.requestId,
    "submission-acknowledged",
    `replay=${ack.replay}`,
  );
  if (!journaled.ok) return journaled;
  if (ack.state === "running") {
    const running = withSessionState(acknowledged.value, "running", deps.clock.now());
    if (running.ok) {
      const put = deps.sessions.putSession(running.value);
      if (!put.ok) return put;
      const started = appendEvent(deps, scope.tenantId, request.requestId, "execution-started");
      if (!started.ok) return started;
      return ok({ session: put.value, replay: false });
    }
  }
  return ok({ session: acknowledged.value, replay: false });
}

export async function awaitSettledOperation(
  deps: GatewayCoreDeps,
  scope: ExecutionScope,
  requestId: Parameters<typeof submitExecutionOperation>[2]["requestId"],
  options: AwaitSettledOptions | undefined,
): Promise<Result<ExecutionSettlement, ExecutionError>> {
  const found = deps.sessions.getSession(scope.tenantId, requestId);
  if (!found.ok) return found;
  const session = found.value;
  if (session.settlement !== undefined) {
    return ok(session.settlement);
  }
  if (session.submissionTicket === undefined) {
    return err(executionInterrupted(session.requestId as string));
  }
  const resolved = resolveEnvironmentForSession(deps, session);
  if (!resolved.ok) return resolved;
  const ticket = reissueTicket(session.submissionTicket);
  let envelope;
  try {
    envelope = await resolved.value.environment.transport.awaitCompletion(ticket, options);
  } catch (error) {
    const mapped = mapBoundaryRejection(error);
    if (mapped.code === "execution/await-aborted") return err(mapped);
    const event = appendEvent(
      deps,
      scope.tenantId,
      requestId,
      "failure-recorded",
      `await failure: ${mapped.message}`,
    );
    if (!event.ok) return event;
    if (mapped.code === "execution/timeout" || mapped.code === "execution/interrupted") {
      const applied = failSession(
        deps,
        session,
        mapped.code === "execution/timeout" ? "deadline-exceeded" : "interrupted",
        mapped.message,
      );
      if (!applied.ok) return applied;
    }
    return err(mapped);
  }
  const applied = applyPlatformEnvelope(deps, session, envelope);
  if (!applied.ok) return applied;
  return ok(applied.value.settlement);
}
