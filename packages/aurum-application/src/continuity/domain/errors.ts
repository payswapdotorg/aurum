/**
 * Continuity errors (W012 domain layer). The continuity area owns session
 * lifecycle, replay and attachment RECORDS — not semantic decisions. Its
 * error namespace is therefore continuity-local (mirroring the W007/W009/W010
 * pattern: one command path, one error namespace per area; the domain
 * `DomainErrorCode` union is frozen by W002 and is not extended here).
 *
 * Delegated semantic actions (tower calls) fail with the OWNING area's typed
 * errors, returned verbatim — the continuity layer never re-wraps them.
 */
import type { ValidationIssue } from "@aurum/domain";

export type ContinuityErrorCode =
  /** Input failed validation; `issues` lists the offending fields. */
  | "continuity-validation"
  /** Session/record/attachment id collision — append-only and open-once
   *  semantics refuse duplicates (the no-second-run law's typed edge). */
  | "continuity-conflict"
  /** Session or attachment not found. Uniform for foreign-tenant and
   *  never-existing ids: no existence leaks. */
  | "continuity-not-found"
  /** The record sequence violated the replay contract (e.g. a session's
   *  records do not start with `session-opened`, or a replay was asked to
   *  run without one). A continuity bug or a corrupted ledger — never a
   *  caller input problem. */
  | "continuity-invariant"
  /** The attachment surface refused the materialization (substrate-side
   *  failure: no host, no space, unsupported content). Runtime-plane only —
   *  never a semantic failure. */
  | "continuity-surface-refused"
  /** An operation is illegal in the session's current state (e.g. closing an
   *  already-closed attachment, attaching to an unknown session). */
  | "continuity-state";

/** Structured, typed continuity error. `message` is safe to display. */
export class ContinuityError extends Error {
  readonly code: ContinuityErrorCode;
  /** Present for validation codes. Empty otherwise. */
  readonly issues: readonly ValidationIssue[];

  constructor(code: ContinuityErrorCode, message: string, issues: readonly ValidationIssue[] = []) {
    super(message);
    this.name = "ContinuityError";
    this.code = code;
    this.issues = [...issues];
  }
}

export function isContinuityError(value: unknown): value is ContinuityError {
  return value instanceof ContinuityError;
}

export function continuityValidationError(issues: readonly ValidationIssue[]): ContinuityError {
  return new ContinuityError(
    "continuity-validation",
    "continuity input failed validation",
    issues,
  );
}

export function continuityConflict(message: string): ContinuityError {
  return new ContinuityError("continuity-conflict", message);
}

export function continuityNotFound(message: string): ContinuityError {
  return new ContinuityError("continuity-not-found", message);
}

export function continuityInvariant(message: string): ContinuityError {
  return new ContinuityError("continuity-invariant", message);
}

export function continuitySurfaceRefused(message: string): ContinuityError {
  return new ContinuityError("continuity-surface-refused", message);
}

export function continuityState(message: string): ContinuityError {
  return new ContinuityError("continuity-state", message);
}
