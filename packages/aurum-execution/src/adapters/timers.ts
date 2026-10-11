/**
 * Minimal timer double for the adapter layer (W006).
 *
 * This package compiles against the ES2024 stdlib only (no node types, no
 * DOM), so the timer is reached through a typed view of the global scope —
 * the adapters layer is the only place latency simulation is allowed (the
 * domain layer bans timer/IO dependencies, enforced by the architecture
 * checker).
 */
type SetTimeoutLike = (handler: () => void, timeoutMs: number) => unknown;

const globalScope = globalThis as unknown as { setTimeout?: SetTimeoutLike };

/** Resolves after at least `ms` milliseconds (0 → next timer tick). */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = globalScope.setTimeout;
    if (timer === undefined) {
      throw new Error("no timer available in this runtime (delay requires timers)");
    }
    timer(resolve, Math.max(0, ms));
  });
}
