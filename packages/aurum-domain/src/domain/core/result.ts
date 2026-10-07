/**
 * Result type for explicit error handling at the contract boundary. Store
 * operations return `Result` instead of throwing: expected failures (unknown
 * ids, invalid input, denied authority) are values, not exceptions.
 */
import type { DomainError } from "./errors.js";

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Narrows a Result for tests/internal use: throws on failure. */
export function unwrap<T>(result: Result<T, DomainError>): T {
  if (result.ok) return result.value;
  throw result.error;
}
