/**
 * Typed error namespace + Result for the execution plane (W006).
 *
 * THE AUTHORITY LAW (spec/WORK-ITEM-CATALOG.md §W006): runtime failures —
 * adapter throws, transport failures, timeouts — can NEVER rewrite semantic
 * state. Every failure observable through this package is a typed
 * `ExecutionError` carried inside a `Result`; failure paths additionally
 * append execution-plane journal events ("audit events" in the work-item
 * sense — execution-local, append-only; they are NOT domain audit records and
 * never touch the kernel). Callers record semantics through the domain seams
 * themselves; this package only returns normalized results.
 *
 * Codes are execution-local (closed union, `execution/` namespace): no second
 * authority over domain error semantics is created here.
 */
import type { ValidationIssue } from "./issues.js";

/** Closed vocabulary of execution-plane error codes. */
export type ExecutionErrorCode =
  /** Input failed validation; `issues` lists the offending fields. */
  | "execution/validation"
  /** Execution record not found in the requesting tenant. Uniform for
   *  foreign-tenant and never-existing ids: no existence leaks. */
  | "execution/not-found"
  /** No execution environment offers the requested class/variant. */
  | "execution/environment-unavailable"
  /** The environment is registered but not yet wired (fail-closed stub:
   *  browser/computer/workflow/remote substrate adaptation is follow-up work). */
  | "execution/not-wired"
  /** The environment does not honor the requested control (pause/resume/cancel). */
  | "execution/control-unsupported"
  /** The requested lifecycle transition is illegal for the current state. */
  | "execution/lifecycle-illegal"
  /** A runtime failure of the transport/adapter (never a semantic rewrite). */
  | "execution/transport-failed"
  /** The submission deadline passed before settlement. */
  | "execution/timeout"
  /** The wait itself was aborted by the caller; execution continues. */
  | "execution/await-aborted"
  /** A non-terminal session whose platform state is unknown (recovery path). */
  | "execution/interrupted"
  /** Internal invariant violation (an execution-plane bug, never caller error). */
  | "execution/invariant";

/** Structured, typed execution error. `message` is safe to display. */
export class ExecutionError extends Error {
  readonly code: ExecutionErrorCode;
  /** Present for the validation code. Empty array otherwise. */
  readonly issues: readonly ValidationIssue[];

  constructor(
    code: ExecutionErrorCode,
    message: string,
    options: { issues?: readonly ValidationIssue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ExecutionError";
    this.code = code;
    this.issues = options.issues ?? [];
  }
}

/** Type guard for `ExecutionError`. */
export function isExecutionError(value: unknown): value is ExecutionError {
  return value instanceof ExecutionError;
}

export function executionValidationError(issues: readonly ValidationIssue[]): ExecutionError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new ExecutionError("execution/validation", `execution validation failed: ${summary}`, {
    issues,
  });
}

/** Uniform not-found for execution-owned records. No tenant existence leaks. */
export function executionNotFound(recordKind: string): ExecutionError {
  return new ExecutionError("execution/not-found", `${recordKind} not found`);
}

/** Fail-closed rejection for registered-but-unwired environment classes. */
export function executionNotWired(environmentClass: string): ExecutionError {
  return new ExecutionError(
    "execution/not-wired",
    `environment class "${environmentClass}" is registered but not yet wired (ZCode substrate adaptation pending)`,
  );
}

export function executionEnvironmentUnavailable(classOrVariant: string): ExecutionError {
  return new ExecutionError(
    "execution/environment-unavailable",
    `no execution environment offers ${classOrVariant}`,
  );
}

export function executionControlUnsupported(control: string): ExecutionError {
  return new ExecutionError("execution/control-unsupported", `control "${control}" is unsupported`);
}

export function executionLifecycleIllegal(from: string, to: string): ExecutionError {
  return new ExecutionError(
    "execution/lifecycle-illegal",
    `illegal lifecycle transition ${from} -> ${to}`,
  );
}

export function executionTransportFailed(detail: string, cause?: unknown): ExecutionError {
  return new ExecutionError("execution/transport-failed", `transport failure: ${detail}`, {
    cause,
  });
}

export function executionTimeout(deadlineEpochMs: number): ExecutionError {
  return new ExecutionError(
    "execution/timeout",
    `submission deadline ${deadlineEpochMs} (epoch ms) exceeded before settlement`,
  );
}

export function executionAwaitAborted(): ExecutionError {
  return new ExecutionError("execution/await-aborted", "the settlement wait was aborted");
}

export function executionInterrupted(requestId: string): ExecutionError {
  return new ExecutionError(
    "execution/interrupted",
    `execution ${requestId} is non-terminal with unknown platform state (recoverable)`,
  );
}

export function executionInvariant(message: string): ExecutionError {
  return new ExecutionError("execution/invariant", `execution invariant violated: ${message}`);
}

/**
 * Result type for explicit error handling at the execution contract boundary,
 * structurally aligned with the kernel's Result convention (expected failures
 * are values, not exceptions). Declared here so the whole package — and
 * consumers — share one execution-local shape.
 */
export type Result<T, E = ExecutionError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
