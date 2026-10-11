/**
 * Aurum-facing platform boundary — lifecycle vocabulary (W001).
 *
 * These are PLATFORM states for work moving through a transport port: they
 * describe how far the substrate has progressed executing a submission, and
 * nothing else. They are deliberately NOT Aurum semantic states — the
 * boundary never decides what an outcome means for Aurum, only that the
 * platform finished, failed, or was stopped.
 *
 * Mandated vocabulary (spec/WORK-ITEM-CATALOG.md §W001): pending, running,
 * settled, cancelled, failed. `paused` is added as the control-plane state
 * that pause/resume-capable environments (W006 acceptance: pause/resume/
 * cancel/recovery) need; it is a platform state of the same kind.
 *
 * State machine (platform view):
 *
 *   pending --> running --> settled      (terminal, result available)
 *                 |  |
 *                 |  +--> failed         (terminal, error available)
 *                 |
 *                 +--> cancelled         (terminal, stopped by request)
 *                 |
 *                 +--> paused --> running (only when capability declares resumable)
 *
 * Terminal states never transition again; a later envelope for the same
 * ticket marked `stale: true` supersedes an earlier terminal read (see
 * envelope.ts) without rewriting it.
 */

/** All platform lifecycle states, in declaration order. */
export const AURUM_TRANSPORT_LIFECYCLE_STATES = [
  "pending",
  "running",
  "paused",
  "settled",
  "cancelled",
  "failed",
] as const;

/**
 * Platform lifecycle state for a submission.
 *
 * - `pending` — accepted by the transport, not yet executing.
 * - `running` — executing on the platform.
 * - `paused` — execution suspended (control-plane state; only environments
 *   that declare `resumable` enter it).
 * - `settled` — terminal; normalized result envelope available.
 * - `cancelled` — terminal; stopped by an explicit cancel request.
 * - `failed` — terminal; platform-level failure, error detail available.
 */
export type AurumTransportLifecycleState = (typeof AURUM_TRANSPORT_LIFECYCLE_STATES)[number];

/** Terminal (no further transitions) platform states. */
export const AURUM_TRANSPORT_TERMINAL_STATES = ["settled", "cancelled", "failed"] as const;

/** Terminal platform state: settled, cancelled, or failed. */
export type AurumTransportTerminalState = (typeof AURUM_TRANSPORT_TERMINAL_STATES)[number];

/** Type guard for a platform lifecycle state value (e.g. off the wire). */
export function isAurumTransportLifecycleState(
  value: unknown,
): value is AurumTransportLifecycleState {
  return (
    typeof value === "string" &&
    (AURUM_TRANSPORT_LIFECYCLE_STATES as readonly string[]).includes(value)
  );
}

/** Type guard for a terminal platform state value. */
export function isAurumTransportTerminalState(
  value: unknown,
): value is AurumTransportTerminalState {
  return (
    typeof value === "string" &&
    (AURUM_TRANSPORT_TERMINAL_STATES as readonly string[]).includes(value)
  );
}
