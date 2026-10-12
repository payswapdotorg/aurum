/**
 * Company intelligence typed error namespace (W004). Every failure is a
 * structured `CompanyError` carried inside a `Result` — never a thrown bare
 * string. The codes are company-local (the domain `DomainErrorCode` union is
 * frozen by W002 and is not extended here — no second authority over domain
 * error semantics).
 */
import type { ValidationIssue } from "@aurum/domain";

export type CompanyErrorCode =
  /** Company query input failed validation; `issues` lists the offending fields. */
  | "company-validation"
  /** Company-owned record (query log) not found in the requesting tenant.
   *  Uniform for foreign-tenant and never-existing ids: no existence leaks. */
  | "company-not-found"
  /** The query subject was not found in the requesting tenant (read seams). */
  | "company-subject-not-found"
  /** Internal invariant violation (a company bug, never a caller error). */
  | "company-invariant";

/** Structured, typed company error. `message` is safe to display. */
export class CompanyError extends Error {
  readonly code: CompanyErrorCode;
  /** Present for validation codes. Empty array otherwise. */
  readonly issues: readonly ValidationIssue[];

  constructor(
    code: CompanyErrorCode,
    message: string,
    options: { issues?: readonly ValidationIssue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "CompanyError";
    this.code = code;
    this.issues = options.issues ?? [];
  }
}

export function isCompanyError(value: unknown): value is CompanyError {
  return value instanceof CompanyError;
}

export function companyValidationError(issues: readonly ValidationIssue[]): CompanyError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new CompanyError("company-validation", `company validation failed: ${summary}`, {
    issues,
  });
}

/** Uniform not-found for company-owned records (query log). No tenant leaks. */
export function companyNotFound(recordKind: string): CompanyError {
  return new CompanyError("company-not-found", `${recordKind} not found`);
}

/** Uniform not-found for read-side subjects. Same closed-failure semantics. */
export function companySubjectNotFound(subject: string): CompanyError {
  return new CompanyError("company-subject-not-found", `subject not found: ${subject}`);
}

export function companyInvariant(message: string): CompanyError {
  return new CompanyError("company-invariant", `company invariant violated: ${message}`);
}
