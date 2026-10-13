/**
 * Learning typed error namespace (W013). Mirrors the house pattern
 * (LabError/MissionError): the area never throws bare strings — every
 * failure is a structured `LearningError` carried inside a `Result`. The
 * codes are learning-local (the domain `DomainErrorCode` union is frozen by
 * W002 and is not extended here — no second authority over domain error
 * semantics).
 */
import type { ValidationIssue } from "@aurum/domain";

export type LearningErrorCode =
  /** Learning input failed validation; `issues` lists the offending fields. */
  | "learning-validation"
  /** Learning record not found in the requesting tenant. Uniform for
   *  foreign-tenant and never-existing ids: no existence leaks. */
  | "learning-not-found"
  /** The outcome join was refused: the referenced evaluation/candidate pair
   *  does not hold together (e.g. the candidate was never ranked by that
   *  evaluation, or the candidate's stamped fingerprint disagrees with the
   *  evaluation's). `issues` carries the verbatim join-integrity issues. */
  | "learning-join-refused"
  /** Append-only evidence law: the outcome id already exists. */
  | "learning-conflict"
  /** Internal invariant violation (a learning bug, never a caller error). */
  | "learning-invariant";

/** Structured, typed learning error. `message` is safe to display. */
export class LearningError extends Error {
  readonly code: LearningErrorCode;
  /** Present for validation/join-refusal codes. Empty array otherwise. */
  readonly issues: readonly ValidationIssue[];

  constructor(
    code: LearningErrorCode,
    message: string,
    options: { issues?: readonly ValidationIssue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "LearningError";
    this.code = code;
    this.issues = options.issues ?? [];
  }
}

export function isLearningError(value: unknown): value is LearningError {
  return value instanceof LearningError;
}

export function learningValidationError(issues: readonly ValidationIssue[]): LearningError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new LearningError("learning-validation", `learning validation failed: ${summary}`, {
    issues,
  });
}

/** Uniform not-found for learning-owned records (outcomes). No tenant leaks. */
export function learningNotFound(recordKind: string): LearningError {
  return new LearningError("learning-not-found", `${recordKind} not found`);
}

/** Uniform not-found for a join-anchoring record (evaluation/candidate). */
export function learningJoinAnchorNotFound(recordKind: string): LearningError {
  return new LearningError("learning-not-found", `${recordKind} not found`);
}

/**
 * Join-integrity refusal: the outcome cannot be joined to the referenced
 * evaluation/candidate pair. The verbatim issue list travels on the error
 * (inspectability — the caller sees exactly which join key broke).
 */
export function learningJoinRefused(issues: readonly ValidationIssue[]): LearningError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new LearningError("learning-join-refused", `outcome join refused: ${summary}`, {
    issues,
  });
}

/** Append-only evidence law violation (duplicate outcome id). */
export function learningConflict(outcomeId: string): LearningError {
  return new LearningError("learning-conflict", `outcome already recorded: ${outcomeId}`);
}

export function learningInvariant(message: string): LearningError {
  return new LearningError("learning-invariant", `learning invariant violated: ${message}`);
}
