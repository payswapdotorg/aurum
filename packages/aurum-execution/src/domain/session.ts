/**
 * The execution session record + pure lifecycle operations (W006 domain).
 *
 * A session is the SEMANTIC unit of execution: it is created when the gateway
 * accepts a request citing domain authority, carries the idempotency key
 * (request id), tracks the platform submission (opaque ticket + capability
 * id), and settles EXACTLY ONCE — a duplicate settlement carrying an
 * identical envelope is suppressed (idempotent), a divergent one is refused
 * as an invariant violation. Recovery (recovery.ts) re-drives non-terminal
 * sessions through the same transitions.
 *
 * All operations are pure functions returning NEW frozen values; stores
 * (adapters) persist them. No IO, no clocks — `now` is always caller-supplied
 * epoch milliseconds.
 */
import type { AuthorityCitation, ModelOccupancy } from "./authority.js";
import { authorityCitationIssues, modelOccupancyIssues } from "./authority.js";
import type { ExecutionCostLine, ExecutionFailureDetail, ExecutionSettlement } from "./envelope.js";
import type { ExecutionRequestId, ExecutionTenantId } from "./ids.js";
import type { ExecutionSessionState, ExecutionTerminalState } from "./lifecycle.js";
import { executionTransitionLegal } from "./lifecycle.js";
import { err, ok, type Result } from "./errors.js";
import {
  executionInvariant,
  executionLifecycleIllegal,
  executionValidationError,
} from "./errors.js";
import type { ValidationIssue } from "./issues.js";
import { isExecutionEnvironmentClass } from "./vocabulary.js";
import type { ExecutionEnvironmentClass } from "./vocabulary.js";

/** An execution request as accepted by the Agent Gateway. */
export interface ExecutionRequest {
  /** Idempotency key: one request id settles exactly once per tenant. */
  readonly requestId: ExecutionRequestId;
  /** Domain authority citation (action id and/or audit ref). */
  readonly authority: AuthorityCitation;
  /** Required execution-environment class. */
  readonly environmentClass: ExecutionEnvironmentClass;
  /** Optional variant narrowing within the class. */
  readonly variant?: string;
  /** Opaque work payload; encoding is adapter-defined. */
  readonly payload: string;
  /** Opaque payload media-type label (e.g. "application/json"). */
  readonly payloadMediaType: string;
  /** Model binding occupancy (opaque provider-plane reference), if bound. */
  readonly occupancy?: ModelOccupancy;
  /** Wall-clock completion deadline in epoch milliseconds, if bounded. */
  readonly deadlineEpochMs?: number;
}

/** Validates a request in isolation; empty array when valid. */
export function executionRequestIssues(
  request: unknown,
  fieldPrefix = "request",
): ValidationIssue[] {
  if (!request || typeof request !== "object") {
    return [{ field: fieldPrefix, problem: "is required" }];
  }
  const record = request as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const requestId = record["requestId"];
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    issues.push({ field: `${fieldPrefix}.requestId`, problem: "must be a non-empty string" });
  }
  issues.push(...authorityCitationIssues(record["authority"], `${fieldPrefix}.authority`));
  if (!isExecutionEnvironmentClass(record["environmentClass"])) {
    issues.push({
      field: `${fieldPrefix}.environmentClass`,
      problem: "must be one of local/browser/computer/workflow/remote/sandbox",
    });
  }
  if (record["variant"] !== undefined) {
    if (typeof record["variant"] !== "string" || record["variant"].length > 100) {
      issues.push({
        field: `${fieldPrefix}.variant`,
        problem: "must be a string of at most 100 characters",
      });
    }
  }
  const payload = record["payload"];
  if (typeof payload !== "string" || payload.length === 0 || payload.length > 2_000_000) {
    issues.push({
      field: `${fieldPrefix}.payload`,
      problem: "must be a non-empty string of at most 2,000,000 characters",
    });
  }
  const mediaType = record["payloadMediaType"];
  if (typeof mediaType !== "string" || mediaType.trim().length === 0 || mediaType.length > 100) {
    issues.push({
      field: `${fieldPrefix}.payloadMediaType`,
      problem: "must be a non-empty string of at most 100 characters",
    });
  }
  issues.push(...modelOccupancyIssues(record["occupancy"], `${fieldPrefix}.occupancy`));
  const deadline = record["deadlineEpochMs"];
  if (deadline !== undefined) {
    if (typeof deadline !== "number" || !Number.isFinite(deadline) || deadline <= 0) {
      issues.push({
        field: `${fieldPrefix}.deadlineEpochMs`,
        problem: "must be a finite positive epoch-milliseconds number",
      });
    }
  }
  return issues;
}

/** The execution session: runtime projection state owned by this package. */
export interface ExecutionSession {
  readonly tenantId: ExecutionTenantId;
  readonly requestId: ExecutionRequestId;
  readonly authority: AuthorityCitation;
  readonly environmentClass: ExecutionEnvironmentClass;
  readonly variant?: string;
  /** Set when an environment was selected. */
  readonly environmentId?: string;
  /** Boundary capability id (persist this, never the seam handle). */
  readonly capabilityId?: string;
  /** Opaque platform ticket, set once the submission is acknowledged. */
  readonly submissionTicket?: string;
  /** Idempotency key submitted to the platform (derived per tenant+request). */
  readonly submissionKey: string;
  readonly occupancy?: ModelOccupancy;
  readonly payload: string;
  readonly payloadMediaType: string;
  readonly deadlineEpochMs?: number;
  readonly state: ExecutionSessionState;
  /** Present iff terminal; immutable once set. */
  readonly settlement?: ExecutionSettlement;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SessionDeps {
  readonly now: number;
  readonly submissionKey: string;
}

/** Creates the pending session for an accepted request. */
export function createPendingSession(
  tenantId: ExecutionTenantId,
  request: ExecutionRequest,
  deps: SessionDeps,
): ExecutionSession {
  return {
    tenantId,
    requestId: request.requestId,
    authority: request.authority,
    environmentClass: request.environmentClass,
    submissionKey: deps.submissionKey,
    payload: request.payload,
    payloadMediaType: request.payloadMediaType,
    state: "pending",
    createdAt: deps.now,
    updatedAt: deps.now,
    ...(request.variant === undefined ? {} : { variant: request.variant }),
    ...(request.occupancy === undefined ? {} : { occupancy: request.occupancy }),
    ...(request.deadlineEpochMs === undefined ? {} : { deadlineEpochMs: request.deadlineEpochMs }),
  };
}

/** Records environment selection (still pending). */
export function withEnvironmentSelected(
  session: ExecutionSession,
  selection: { environmentId: string; capabilityId: string },
  now: number,
): ExecutionSession {
  return {
    ...session,
    environmentId: selection.environmentId,
    capabilityId: selection.capabilityId,
    updatedAt: now,
  };
}

/** Records the platform acknowledgement (ticket; still pending). */
export function withAcknowledgement(
  session: ExecutionSession,
  ack: { ticket: string; replay: boolean },
  now: number,
): ExecutionSession {
  return { ...session, submissionTicket: ack.ticket, updatedAt: now };
}

/** Applies a legal non-terminal state transition (pending/running/paused). */
export function withSessionState(
  session: ExecutionSession,
  to: ExecutionSessionState,
  now: number,
): Result<ExecutionSession> {
  if (session.state === to) return ok(session);
  if (!executionTransitionLegal(session.state, to)) {
    return err(executionLifecycleIllegal(session.state, to));
  }
  return ok({ ...session, state: to, updatedAt: now });
}

/**
 * Settles a session EXACTLY ONCE.
 * - non-terminal session: applies the settlement's terminal state + envelope.
 * - terminal session + IDENTICAL settlement: ok with `firstSettlement: false`
 *   (idempotent duplicate delivery — the exactly-once recovery guarantee).
 * - terminal session + DIVERGENT settlement: invariant error (never rewrite
 *   a settlement).
 */
export function settleSession(
  session: ExecutionSession,
  settlement: ExecutionSettlement,
  now: number,
): Result<{ session: ExecutionSession; firstSettlement: boolean }> {
  if (settlement.requestId !== session.requestId) {
    return err(executionInvariant("settlement requestId does not match the session"));
  }
  if (settlement.tenantId !== session.tenantId) {
    return err(executionInvariant("settlement tenant does not match the session"));
  }
  if (session.settlement !== undefined) {
    if (identicalSettlement(session.settlement, settlement)) {
      return ok({ session, firstSettlement: false });
    }
    return err(
      executionInvariant(
        `session ${session.requestId} already settled ${session.state}; refusing divergent re-settlement`,
      ),
    );
  }
  const status = settlement.status;
  if (!executionTransitionLegal(session.state, status)) {
    return err(executionLifecycleIllegal(session.state, status));
  }
  return ok({
    session: { ...session, state: status, settlement, updatedAt: now },
    firstSettlement: true,
  });
}

/** Terminal states a session may currently be in, narrowed. */
export function terminalStateOf(session: ExecutionSession): ExecutionTerminalState | null {
  switch (session.state) {
    case "settled":
    case "cancelled":
    case "failed":
      return session.state;
    default:
      return null;
  }
}

/** Deep structural identity for settlement idempotency (stable builders). */
function identicalSettlement(a: ExecutionSettlement, b: ExecutionSettlement): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Cost summary for projections (unit → total quantity). */
export function totalCostOf(settlement: ExecutionSettlement): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of settlement.cost ?? []) {
    totals.set(line.unit, (totals.get(line.unit) ?? 0) + line.quantity);
  }
  return totals;
}

/** Failure detail accessor (present iff failed). */
export function failureOf(settlement: ExecutionSettlement): ExecutionFailureDetail | null {
  return settlement.status === "failed" ? (settlement.failure ?? null) : null;
}

/** Re-export for consumers composing over session types. */
export type { ExecutionCostLine };
