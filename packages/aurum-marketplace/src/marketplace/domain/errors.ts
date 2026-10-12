/**
 * Marketplace typed error namespace (W011). The governance machines never
 * throw bare strings: every failure is a structured `MarketplaceError`
 * carried inside a `Result`.
 *
 * THE SEPARATION CODES (catalog acceptance: publication/installation/
 * activation/approval are separate): the dedicated `marketplace-unpublished`
 * and `marketplace-not-installed` codes make prerequisite violations
 * inspectable at the type level — an install attempt against an
 * unpublished version and an activation attempt against a missing
 * installation are REFUSED with their own codes, never silently coerced.
 *
 * TENANT LAW: `marketplace-not-found` is uniform for foreign-tenant and
 * never-existing ids (no existence leaks — spec/ARCHITECTURE.md).
 */
import type { MarketplaceValidationIssue } from "./primitives.js";

export type MarketplaceErrorCode =
  /** Input failed validation; `issues` lists the offending fields. */
  | "marketplace-validation"
  /** Record not found in the requesting tenant. Uniform for foreign-tenant
   *  and never-existing ids: no existence leaks. */
  | "marketplace-not-found"
  /** Id collision or terminal-state conflict on an existing record. */
  | "marketplace-conflict"
  /** Illegal state transition in one of the four governance machines. */
  | "marketplace-lifecycle"
  /** Install/activate prerequisite refused: the package version is not
   *  PUBLISHED in the requesting tenant's catalog (separation 1+2). */
  | "marketplace-unpublished"
  /** Activation prerequisite refused: no INSTALLED installation record in
   *  the requesting tenant (separation 2+3). */
  | "marketplace-not-installed"
  /** Authority refused: non-human reviewer, missing/invalid W002 citation,
   *  or an actor lacking governance authority (separation 3+4). */
  | "marketplace-unauthorized"
  /** Internal invariant violation (a marketplace bug, never a caller error). */
  | "marketplace-invariant";

/** Structured, typed marketplace error. `message` is safe to display. */
export class MarketplaceError extends Error {
  readonly code: MarketplaceErrorCode;
  /** Present for validation codes. Empty otherwise. */
  readonly issues: readonly MarketplaceValidationIssue[];

  constructor(
    code: MarketplaceErrorCode,
    message: string,
    options: { issues?: readonly MarketplaceValidationIssue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "MarketplaceError";
    this.code = code;
    this.issues = options.issues ?? [];
  }
}

export function isMarketplaceError(value: unknown): value is MarketplaceError {
  return value instanceof MarketplaceError;
}

export function marketplaceValidationError(
  issues: readonly MarketplaceValidationIssue[],
): MarketplaceError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new MarketplaceError("marketplace-validation", `validation failed: ${summary}`, {
    issues,
  });
}

/** Uniform not-found for marketplace-owned records. No tenant leaks. */
export function marketplaceNotFound(recordKind: string): MarketplaceError {
  return new MarketplaceError("marketplace-not-found", `${recordKind} not found`);
}

export function marketplaceConflict(message: string): MarketplaceError {
  return new MarketplaceError("marketplace-conflict", message);
}

export function marketplaceLifecycleIllegal(machine: string, from: string, to: string) {
  return new MarketplaceError(
    "marketplace-lifecycle",
    `illegal ${machine} transition: ${from} -> ${to}`,
  );
}

/** Separation 1+2 refusal: version is not published in this tenant. */
export function marketplaceUnpublished(packageId: string, version: number): MarketplaceError {
  return new MarketplaceError(
    "marketplace-unpublished",
    `package ${packageId} version ${version} is not published in this tenant`,
  );
}

/** Separation 2+3 refusal: no installed installation in this tenant. */
export function marketplaceNotInstalled(installationId: string): MarketplaceError {
  return new MarketplaceError(
    "marketplace-not-installed",
    `installation ${installationId} is not installed in this tenant`,
  );
}

export function marketplaceUnauthorized(message: string): MarketplaceError {
  return new MarketplaceError("marketplace-unauthorized", message);
}

export function marketplaceInvariant(message: string): MarketplaceError {
  return new MarketplaceError("marketplace-invariant", `marketplace invariant violated: ${message}`);
}
