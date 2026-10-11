/**
 * Recovery semantics (W006): resume-after-interruption with EXACTLY-ONCE
 * semantic settlement.
 *
 * A crash can land in two windows:
 * 1. after the session is recorded but before the platform acknowledgement is
 *    stored → session `pending` with NO ticket;
 * 2. after acknowledgement but before settlement → session `pending`/`running`/
 *    `paused` WITH a ticket.
 *
 * The recovery path re-drives both through the SAME idempotency key:
 * - window 1 re-submits with the derived `submissionKey`; the platform
 *   contract (W001 transport port) deduplicates by that key — the SAME ticket
 *   comes back (`replay: true`) and the work never executes twice;
 * - window 2 re-awaits the existing ticket.
 * Either way the session settles exactly once: `settleSession` suppresses an
 * identical duplicate settlement and refuses a divergent one.
 */
import type { ExecutionRequestId, ExecutionTenantId } from "./ids.js";
import type { ExecutionSession } from "./session.js";

/**
 * Derives the platform idempotency key for one tenant + request. Stable and
 * collision-free across tenants; the platform dedups on exactly this string.
 */
export function submissionKeyOf(
  tenantId: ExecutionTenantId,
  requestId: ExecutionRequestId,
): string {
  return `exec:${tenantId as string}:${requestId as string}`;
}

/** Whether a session is non-terminal and therefore recoverable. */
export function isRecoverableSession(session: ExecutionSession): boolean {
  switch (session.state) {
    case "pending":
    case "running":
    case "paused":
      return true;
    case "settled":
    case "cancelled":
    case "failed":
      return false;
  }
}

/**
 * The recovery route for one interrupted session:
 * - `"resubmit"` — no ticket stored (crash window 1): re-submit with the
 *   derived submission key; the platform dedups.
 * - `"reawait"` — ticket stored (crash window 2): re-await the ticket.
 */
export type RecoveryRoute = "resubmit" | "reawait";

export interface RecoveryRouteDecision {
  readonly route: RecoveryRoute;
  readonly ticket: string | null;
  readonly submissionKey: string;
}

/** Decides the recovery route for a recoverable session. */
export function recoveryRouteOf(session: ExecutionSession): RecoveryRouteDecision {
  const submissionKey =
    session.submissionKey ?? submissionKeyOf(session.tenantId, session.requestId);
  const ticket = session.submissionTicket ?? null;
  return ticket === null
    ? { route: "resubmit", ticket: null, submissionKey }
    : { route: "reawait", ticket, submissionKey };
}

/** Sessions from a list that need recovery, in request order. */
export function interruptedSessionsOf(
  sessions: readonly ExecutionSession[],
): readonly ExecutionSession[] {
  return sessions
    .filter((session) => isRecoverableSession(session))
    .sort((a, b) => (a.requestId as string).localeCompare(b.requestId as string));
}
