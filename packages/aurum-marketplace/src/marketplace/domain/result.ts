/**
 * Result type (mirrors @aurum/domain core/result.ts — the marketplace-local
 * re-declaration pending the CR-W011 dep wiring). Store and service
 * operations return `Result` instead of throwing: expected failures are
 * values, not exceptions.
 */

export type Result<T, E = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
