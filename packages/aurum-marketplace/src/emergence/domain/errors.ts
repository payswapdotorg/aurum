/**
 * Emergence typed error namespace (W014 domain layer). Mirrors the
 * LearningError/MarketplaceError house pattern: every failure is a
 * structured `EmergenceError` carried inside a `Result`, never a thrown
 * bare string.
 *
 * THE PUBLICATION SEPARATION CODES (catalog acceptance clauses b+c):
 * `emergence-publication-refused` is the dedicated fail-closed refusal for
 * ANY attempt to reach the catalog from the emergence area outside the
 * governed path (projecting a catalog draft from a proposal that was not
 * ACCEPTED by a human reviewer). It makes the refusal inspectable at the
 * type level — an attempt to shortcut publication is never silently
 * coerced into a draft.
 *
 * W011's `MarketplaceErrorCode` union is NOT extended (no second authority
 * over marketplace error semantics — the W013 LearningError ruling,
 * applied to this area).
 */
import type { MarketplaceValidationIssue } from "../../marketplace/contract.marketplace.js";

export type EmergenceErrorCode =
  /** Input failed validation; `issues` lists the offending fields. */
  | "emergence-validation"
  /** Record not found in the requesting tenant. Uniform for foreign-tenant
   *  and never-existing ids: no existence leaks. */
  | "emergence-not-found"
  /** Id collision on an existing record. */
  | "emergence-conflict"
  /** Illegal lifecycle transition (proposal state machine). */
  | "emergence-lifecycle"
  /** Authority refused: non-human reviewer attempting proposal review (the
   *  Lab proposes, humans dispose). */
  | "emergence-unauthorized"
  /** Publication separation refused: an attempt to reach the catalog from
   *  a proposal that is not ACCEPTED (the emergence area never publishes;
   *  only the W011 governance path does). */
  | "emergence-publication-refused"
  /** Internal invariant violation (an emergence bug, never a caller error). */
  | "emergence-invariant";

/** Structured, typed emergence error. `message` is safe to display. */
export class EmergenceError extends Error {
  readonly code: EmergenceErrorCode;
  /** Present for validation codes. Empty otherwise. */
  readonly issues: readonly MarketplaceValidationIssue[];

  constructor(
    code: EmergenceErrorCode,
    message: string,
    options: { issues?: readonly MarketplaceValidationIssue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "EmergenceError";
    this.code = code;
    this.issues = options.issues ?? [];
  }
}

export function isEmergenceError(value: unknown): value is EmergenceError {
  return value instanceof EmergenceError;
}

export function emergenceValidationError(
  issues: readonly MarketplaceValidationIssue[],
): EmergenceError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new EmergenceError("emergence-validation", `validation failed: ${summary}`, { issues });
}

/** Uniform not-found for emergence-owned records. No tenant leaks. */
export function emergenceNotFound(recordKind: string): EmergenceError {
  return new EmergenceError("emergence-not-found", `${recordKind} not found`);
}

export function emergenceConflict(message: string): EmergenceError {
  return new EmergenceError("emergence-conflict", message);
}

export function emergenceLifecycleIllegal(
  recordKind: string,
  from: string,
  to: string,
): EmergenceError {
  return new EmergenceError(
    "emergence-lifecycle",
    `illegal ${recordKind} transition: ${from} -> ${to}`,
  );
}

/**
 * Human-governance refusal: proposal review is person-only. The Lab (and
 * any system/agent/external actor) may PROPOSE; only a person disposes.
 */
export function emergenceUnauthorized(message: string): EmergenceError {
  return new EmergenceError("emergence-unauthorized", message);
}

/**
 * Publication-separation refusal: the catalog-draft projection requires an
 * ACCEPTED proposal. The emergence area proposes and projects — it never
 * drafts, submits or publishes.
 */
export function emergencePublicationRefused(message: string): EmergenceError {
  return new EmergenceError("emergence-publication-refused", message);
}

export function emergenceInvariant(message: string): EmergenceError {
  return new EmergenceError("emergence-invariant", `emergence invariant violated: ${message}`);
}
