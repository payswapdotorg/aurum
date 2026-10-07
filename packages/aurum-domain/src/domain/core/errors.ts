/**
 * Typed domain error semantics. The kernel never throws bare strings: every
 * failure is a structured `DomainError` carried inside a `Result`. See
 * spec/WORK-ITEM-CATALOG.md W002 acceptance: "explicit validation + typed
 * error semantics".
 */

export type DomainErrorCode =
  /** Input failed validation; `issues` lists the offending fields. */
  | "validation"
  /** Record not found in the requesting tenant. Uniform for foreign-tenant and
   *  never-existing ids: no existence leaks (spec/ARCHITECTURE.md tenant
   *  isolation). */
  | "not-found"
  /** Id collision or terminal-state conflict on an existing record. */
  | "conflict"
  /** Optimistic-concurrency failure: expected state/revision is not current. */
  | "stale"
  /** Actor lacks authority for the operation. */
  | "forbidden"
  /** Illegal state transition or invariant violation. */
  | "invariant";

export interface ValidationIssue {
  /** Dotted path of the offending input field, e.g. "revision.objective". */
  readonly field: string;
  /** Human-readable problem description (stable, no secrets). */
  readonly problem: string;
}

/** Structured, typed domain error. `message` is safe to display. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  /** Present when code === "validation". Empty array otherwise. */
  readonly issues: readonly ValidationIssue[];

  constructor(
    code: DomainErrorCode,
    message: string,
    options: { issues?: readonly ValidationIssue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "DomainError";
    this.code = code;
    this.issues = options.issues ?? [];
  }
}

export function validationError(issues: readonly ValidationIssue[]): DomainError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new DomainError("validation", `validation failed: ${summary}`, { issues });
}

/** Uniform not-found: never reveals whether the id exists in another tenant. */
export function notFound(recordKind: string): DomainError {
  return new DomainError("not-found", `${recordKind} not found`);
}

export function conflictError(message: string): DomainError {
  return new DomainError("conflict", message);
}

export function staleError(expected: string, actual: string): DomainError {
  return new DomainError(
    "stale",
    `stale state: expected ${expected} but current state is ${actual}`,
  );
}

export function forbiddenError(message: string): DomainError {
  return new DomainError("forbidden", message);
}

export function invariantError(message: string): DomainError {
  return new DomainError("invariant", message);
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
