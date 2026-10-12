/**
 * Cognition typed error namespace (W007). Every failure of the intelligence
 * loop is a structured `MissionError` carried inside a `Result` — never a
 * thrown bare string. The codes are cognition-local (the domain
 * `DomainErrorCode` union is frozen by W002 and is not extended here — no
 * second authority over domain error semantics).
 *
 * Domain seam failures are TRANSLATED into these codes by the service
 * (`mapDomainError`); a kernel `DomainError` never crosses the cognition
 * public surface.
 */
import type { DomainError, ValidationIssue } from "@aurum/domain";

export type MissionErrorCode =
  /** Mission input failed validation; `issues` lists the offending fields. */
  | "mission-validation"
  /** Mission-owned record not found in the requesting tenant. Uniform for
   *  foreign-tenant and never-existing ids: no existence leaks
   *  (spec/ARCHITECTURE.md tenant isolation). */
  | "mission-not-found"
  /** The referenced subject (goal / observation / claim / ...) was not found
   *  in the requesting tenant — closed-failure semantics, no tenant leaks. */
  | "mission-subject-not-found"
  /** Illegal mission lifecycle move (advance/cancel on a terminal mission,
   *  or a stage already in flight for the same mission). */
  | "mission-state"
  /** Id collision on a mission-owned record, or a concurrent stage attempt. */
  | "mission-conflict"
  /** The reasoning port refused / returned content outside the bounded
   *  schema (catalog W007: "LLM supplies bounded content"). The mission
   *  stays resumable: the reason stage can be re-attempted. */
  | "mission-model-refused"
  /** The authority gate refused a consequential proposal (catalog W007:
   *  "every consequential action enters authority gate"). The mission stays
   *  resumable at the gate stage. */
  | "mission-authority-refused"
  /** Internal invariant violation (a cognition bug, never a caller error). */
  | "mission-invariant";

/** Structured, typed cognition error. `message` is safe to display. */
export class MissionError extends Error {
  readonly code: MissionErrorCode;
  /** Present for validation codes. Empty array otherwise. */
  readonly issues: readonly ValidationIssue[];

  constructor(
    code: MissionErrorCode,
    message: string,
    options: { issues?: readonly ValidationIssue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "MissionError";
    this.code = code;
    this.issues = options.issues ?? [];
  }
}

export function isMissionError(value: unknown): value is MissionError {
  return value instanceof MissionError;
}

export function missionValidationError(issues: readonly ValidationIssue[]): MissionError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new MissionError("mission-validation", `mission validation failed: ${summary}`, {
    issues,
  });
}

/** Uniform not-found for mission-owned records. No tenant leaks. */
export function missionNotFound(recordKind: string): MissionError {
  return new MissionError("mission-not-found", `${recordKind} not found`);
}

/** Uniform not-found for mission subjects (goal/observation/claim). */
export function missionSubjectNotFound(subject: string): MissionError {
  return new MissionError("mission-subject-not-found", `subject not found: ${subject}`);
}

export function missionStateIllegal(message: string): MissionError {
  return new MissionError("mission-state", message);
}

export function missionConflict(message: string): MissionError {
  return new MissionError("mission-conflict", message);
}

/** Bounded-content refusal from the reasoning boundary. */
export function missionModelRefused(
  message: string,
  issues: readonly ValidationIssue[] = [],
): MissionError {
  return new MissionError("mission-model-refused", `reasoning refused: ${message}`, { issues });
}

/** Authority-gate refusal (the gate did its job by refusing). */
export function missionAuthorityRefused(message: string): MissionError {
  return new MissionError("mission-authority-refused", message);
}

export function missionInvariant(message: string): MissionError {
  return new MissionError("mission-invariant", `mission invariant violated: ${message}`);
}

/**
 * Translates a kernel `DomainError` into the cognition error namespace.
 * Closed-failure semantics are preserved: domain `not-found` maps to the
 * uniform mission not-found (foreign-tenant and missing stay identical).
 */
export function mapDomainError(error: DomainError): MissionError {
  switch (error.code) {
    case "validation":
      return missionValidationError(error.issues);
    case "not-found":
      return missionNotFound("domain record");
    case "conflict":
      return missionConflict(error.message);
    case "stale":
      return missionStateIllegal(error.message);
    case "forbidden":
      return missionAuthorityRefused(error.message);
    case "invariant":
      return missionInvariant(error.message);
  }
}
