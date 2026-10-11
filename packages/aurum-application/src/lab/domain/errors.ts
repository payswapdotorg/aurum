/**
 * Lab typed error namespace (W008). The Lab never throws bare strings: every
 * failure is a structured `LabError` carried inside a `Result`. The codes are
 * lab-local (the domain `DomainErrorCode` union is frozen by W002 and is not
 * extended here — no second authority over domain error semantics).
 *
 * The W005 allocation issue validators (`actorAssignmentIssues`,
 * `capabilityAllocationIssues`) are the acceptance gate for constrained
 * allocation; refusals carry their issue lists verbatim
 * (code "lab-allocation-refused").
 */
import type { ValidationIssue } from "@aurum/domain";

export type LabErrorCode =
  /** Lab input failed validation; `issues` lists the offending fields. */
  | "lab-validation"
  /** Lab record not found in the requesting tenant. Uniform for foreign-tenant
   *  and never-existing ids: no existence leaks (spec/ARCHITECTURE.md). */
  | "lab-not-found"
  /** The subject (goal) was not found in the requesting tenant. */
  | "lab-subject-not-found"
  /** Constrained allocation refused by the W005 validators; `issues` carries
   *  the verbatim actor-assignment / capability-allocation issue list. */
  | "lab-allocation-refused"
  /** Internal invariant violation (a lab bug, never a caller error). */
  | "lab-invariant";

/** Structured, typed lab error. `message` is safe to display. */
export class LabError extends Error {
  readonly code: LabErrorCode;
  /** Present for validation/refusal codes. Empty array otherwise. */
  readonly issues: readonly ValidationIssue[];

  constructor(
    code: LabErrorCode,
    message: string,
    options: { issues?: readonly ValidationIssue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "LabError";
    this.code = code;
    this.issues = options.issues ?? [];
  }
}

export function isLabError(value: unknown): value is LabError {
  return value instanceof LabError;
}

export function labValidationError(issues: readonly ValidationIssue[]): LabError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new LabError("lab-validation", `lab validation failed: ${summary}`, { issues });
}

/** Uniform not-found for lab-owned records (evaluations). No tenant leaks. */
export function labNotFound(recordKind: string): LabError {
  return new LabError("lab-not-found", `${recordKind} not found`);
}

/** Uniform not-found for the search subject. Same closed-failure semantics. */
export function labSubjectNotFound(subject: string): LabError {
  return new LabError("lab-subject-not-found", `subject not found: ${subject}`);
}

/**
 * Constrained-allocation refusal: the W005 validators rejected the synthesis.
 * The verbatim issue list travels on the error (inspectability).
 */
export function labAllocationRefused(issues: readonly ValidationIssue[]): LabError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new LabError("lab-allocation-refused", `allocation refused: ${summary}`, { issues });
}

export function labInvariant(message: string): LabError {
  return new LabError("lab-invariant", `lab invariant violated: ${message}`);
}
