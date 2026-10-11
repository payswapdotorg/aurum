/**
 * Execution session lifecycle — the SEMANTIC side (W006).
 *
 * These are Aurum execution-session states: how far an authorized execution
 * request has progressed through the execution plane. They are deliberately
 * ALIGNED with — but NOT imported from and NOT a re-export of — the W001
 * boundary's PLATFORM lifecycle (packages/shared/src/aurum-boundary):
 * the boundary describes platform progress for a submission; this state
 * machine describes the semantic session that owns a request, survives
 * submission replays, and settles exactly once. The app layer maps platform
 * states into these states; nothing maps backwards.
 *
 * State machine (semantic view):
 *
 *   pending --> running --> settled      (terminal, normalized result)
 *   pending --> paused     --> running
 *   pending --> failed | cancelled
 *   running --> paused | settled | failed | cancelled
 *   paused  --> running | settled | failed | cancelled
 *
 * - `pending` — request accepted, session recorded; the platform submission
 *   may not be acknowledged yet (crash window; recovery owns it).
 * - `running` — platform reports active execution.
 * - `paused` — suspended by control request (pause).
 * - `settled` / `cancelled` / `failed` — terminal; the normalized settlement
 *   is present and IMMUTABLE. Terminal sessions never transition again; a
 *   duplicate settlement carrying the identical settlement is idempotent
 *   (suppressed), a divergent one is refused (session.ts).
 */

/** All semantic execution-session states, in declaration order. */
export const EXECUTION_SESSION_STATES = [
  "pending",
  "running",
  "paused",
  "settled",
  "cancelled",
  "failed",
] as const;

/** Semantic execution-session state. */
export type ExecutionSessionState = (typeof EXECUTION_SESSION_STATES)[number];

/** Terminal (no further transitions) semantic states. */
export const EXECUTION_SESSION_TERMINAL_STATES = ["settled", "cancelled", "failed"] as const;

/** Terminal semantic state: settled, cancelled, or failed. */
export type ExecutionTerminalState = (typeof EXECUTION_SESSION_TERMINAL_STATES)[number];

/** Settlement statuses carried on the normalized envelope. */
export type ExecutionSettlementStatus = ExecutionTerminalState;

/** Type guard for a session state value (e.g. off the wire). */
export function isExecutionSessionState(value: unknown): value is ExecutionSessionState {
  return (
    typeof value === "string" && (EXECUTION_SESSION_STATES as readonly string[]).includes(value)
  );
}

/** Type guard for a terminal state value. */
export function isExecutionTerminalState(value: unknown): value is ExecutionTerminalState {
  return (
    typeof value === "string" &&
    (EXECUTION_SESSION_TERMINAL_STATES as readonly string[]).includes(value)
  );
}

/** Whether a state admits further transitions. */
export function isTerminalSessionState(state: ExecutionSessionState): boolean {
  return isExecutionTerminalState(state);
}

/**
 * Pure legality of the semantic state graph. Legal transitions:
 * - pending → running | paused | settled | cancelled | failed
 * - running → paused | settled | cancelled | failed
 * - paused  → running | settled | cancelled | failed
 * - terminal → nothing (idempotent duplicates are handled by settleSession,
 *   not by the graph).
 */
export function executionTransitionLegal(
  from: ExecutionSessionState,
  to: ExecutionSessionState,
): boolean {
  if (to === from) return false;
  switch (from) {
    case "pending":
    case "running":
    case "paused":
      return to === "running" || to === "paused" || isExecutionTerminalState(to);
    case "settled":
    case "cancelled":
    case "failed":
      return false;
  }
}

/**
 * All states reachable in one legal transition (test-support + exhaustive
 * legality proofs).
 */
export function legalExecutionTransitionsFrom(
  from: ExecutionSessionState,
): readonly ExecutionSessionState[] {
  return EXECUTION_SESSION_STATES.filter((to) => executionTransitionLegal(from, to));
}
