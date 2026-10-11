/**
 * Aurum-facing platform boundary — typed error vocabulary (W001).
 *
 * Every failure observable through the boundary is one of:
 *
 * 1. an `AurumBoundaryErrorDetail` — plain, serializable data — for
 *    synchronous results (seam lookups) and for the `error` field of a
 *    normalized result envelope;
 * 2. an `AurumBoundaryError` (an `Error` subclass carrying a detail) — used
 *    by transport-port implementations to reject promises.
 *
 * Hard rules locked by tests:
 * - codes are a closed string union with `aurum-seam/` / `aurum-transport/`
 *   namespacing (plus `aurum-boundary/unknown` for normalization);
 * - no `any` anywhere; unknown rejections are normalized with
 *   `toAurumBoundaryErrorDetail`, never rethrown as bare strings;
 * - `retryable` is explicit so callers can make policy without guessing.
 */

/** Closed vocabulary of boundary error codes. */
export type AurumBoundaryErrorCode =
  // seam registry namespace
  | "aurum-seam/capability-unavailable"
  | "aurum-seam/capability-unknown-class"
  | "aurum-seam/handle-invalid"
  | "aurum-seam/registry-closed"
  // transport port namespace
  | "aurum-transport/submission-invalid"
  | "aurum-transport/ticket-unknown"
  | "aurum-transport/not-cancellable"
  | "aurum-transport/control-unsupported"
  | "aurum-transport/transport-closed"
  | "aurum-transport/deadline-exceeded"
  | "aurum-transport/await-aborted"
  | "aurum-transport/internal"
  // normalization fallback (never produced by a conforming implementation)
  | "aurum-boundary/unknown";

/**
 * Plain, serializable error detail. Used as the `error` field of normalized
 * result envelopes, as the `error` arm of seam lookup results, and as the
 * payload of `AurumBoundaryError`.
 */
export interface AurumBoundaryErrorDetail {
  /** One of the closed `AurumBoundaryErrorCode` values. */
  readonly code: AurumBoundaryErrorCode;
  /** Human-readable explanation. Diagnostic only, never parsed for policy. */
  readonly message: string;
  /** Whether retrying the same request may succeed. */
  readonly retryable: boolean;
  /**
   * Opaque adapter-provided supplement (structured or string). Never parsed
   * by the boundary; consumers must treat it as diagnostic payload.
   */
  readonly detail?: string;
}

/**
 * Typed error thrown (as promise rejections) by conforming transport-port
 * and seam implementations. Extends `Error` so stacks and `cause` chains
 * behave normally; `no thrown bare strings` is enforced by construction.
 */
export class AurumBoundaryError extends Error {
  readonly code: AurumBoundaryErrorCode;
  readonly retryable: boolean;
  readonly detail?: string;

  constructor(
    code: AurumBoundaryErrorCode,
    message: string,
    options?: { readonly retryable?: boolean; readonly detail?: string; readonly cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AurumBoundaryError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.detail = options?.detail;
  }

  /** The plain, serializable form used inside envelopes and lookup results. */
  toDetail(): AurumBoundaryErrorDetail {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

/** Type guard for `AurumBoundaryError`. */
export function isAurumBoundaryError(value: unknown): value is AurumBoundaryError {
  return value instanceof AurumBoundaryError;
}

/**
 * Normalize ANY rejection value into an `AurumBoundaryErrorDetail` without
 * throwing. The fallback code is `aurum-boundary/unknown`; `String()` is
 * only applied to non-Error values so no information is silently dropped.
 */
export function toAurumBoundaryErrorDetail(error: unknown): AurumBoundaryErrorDetail {
  if (isAurumBoundaryError(error)) return error.toDetail();
  if (error instanceof Error) {
    return { code: "aurum-boundary/unknown", message: error.message, retryable: false };
  }
  return { code: "aurum-boundary/unknown", message: String(error), retryable: false };
}
