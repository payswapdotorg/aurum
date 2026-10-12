/**
 * Marketplace local primitives (W011 domain layer).
 *
 * STRUCTURAL MIRRORS of the aurum-domain kernel's frozen core vocabulary
 * (TenantScope / ActorReference / ProvenanceRecord / AuditInput /
 * ValidationIssue / Result), re-declared locally because the
 * `@aurum/domain` workspace link is not wired into this package yet
 * (spec/contract-requests/CR-W011-package-wiring.md — the lockfile is
 * TL-owned, exactly like CR-W009 for the plans substrate). Every mirror is
 * documented with the kernel file it mirrors; the post-CR adapter asserts
 * assignability in both directions.
 *
 * LAWS:
 * - no IO (the architecture checker's domain-io rule);
 * - tenant scope is explicit on every record and every operation;
 * - every failure is a typed value inside a `Result`, never a thrown bare
 *   string.
 */
import { err, ok, type Result } from "./result.js";

/** Epoch milliseconds (mirrors @aurum/domain core/branding DomainTimestamp). */
export type MarketplaceTimestamp = number;

/** Dotted-path validation issue (mirrors core/errors.ts ValidationIssue). */
export interface MarketplaceValidationIssue {
  /** Dotted path of the offending input field, e.g. "contents.displayName". */
  readonly field: string;
  /** Human-readable problem description (stable, no secrets). */
  readonly problem: string;
}

/** Opaque tenant identity (mirrors core/branding TenantId branding target). */
export type MarketplaceTenantId = string;

/**
 * The explicit tenant scope (mirrors core/scope.ts TenantScope — the
 * structural type the kernel accepts directly once CR-W011 wires the dep).
 * Catalog, installations, activations, citations and recruitment records
 * are ALL tenant-scoped: a foreign-tenant record and a never-existing one
 * are indistinguishable (closed failure, spec/ARCHITECTURE.md).
 */
export interface MarketplaceTenantScope {
  readonly kind: "tenant-scope";
  readonly tenantId: MarketplaceTenantId;
}

/** Marker interface implemented by every tenant-scoped marketplace record. */
export interface MarketplaceTenantScopedRecord {
  readonly scope: MarketplaceTenantScope;
}

/** Validates a tenant id and produces the scope (mirrors core/scope.tenantScope). */
export function marketplaceTenantScope(
  tenantId: string,
): Result<MarketplaceTenantScope, MarketplaceValidationIssue> {
  const trimmed = typeof tenantId === "string" ? tenantId.trim() : "";
  if (trimmed.length === 0 || trimmed.length > 128) {
    return err({
      field: "tenantId",
      problem: "must be a non-empty string of at most 128 characters",
    });
  }
  if (/\p{Cc}/u.test(trimmed)) {
    return err({ field: "tenantId", problem: "must not contain control characters" });
  }
  return ok({ kind: "tenant-scope", tenantId: trimmed as MarketplaceTenantId });
}

/** Actor kinds (mirrors core/refs.ts ACTOR_KINDS — frozen W002 vocabulary). */
export const MARKETPLACE_ACTOR_KINDS = ["person", "system", "agent", "external"] as const;

export type MarketplaceActorKind = (typeof MARKETPLACE_ACTOR_KINDS)[number];

export function isKnownMarketplaceActorKind(value: string): value is MarketplaceActorKind {
  return (MARKETPLACE_ACTOR_KINDS as readonly string[]).includes(value);
}

/**
 * Who did something (mirrors core/refs.ts ActorReference). `personId` is
 * required for kind "person" (validated at each use site); other kinds
 * carry an opaque descriptor name. Provider SDK identities and secrets
 * never enter marketplace contracts.
 */
export interface MarketplaceActorReference {
  readonly kind: MarketplaceActorKind;
  readonly personId?: string;
  readonly name?: string;
}

export function marketplacePersonActor(personId: string): MarketplaceActorReference {
  return { kind: "person", personId };
}

export function marketplaceSystemActor(name: string): MarketplaceActorReference {
  return { kind: "system", name };
}

/** Result type (mirrors core/result.ts — values, not exceptions). */
export type { Result } from "./result.js";
export { err, ok } from "./result.js";

/** Narrows a Result for tests/internal use: throws on failure. */
export function unwrapMarketplace<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}

/** Provenance source kinds (mirrors evidence/provenance.ts SOURCE_KINDS). */
export const MARKETPLACE_SOURCE_KINDS = [
  "human-entered",
  "system-captured",
  "imported",
  "inferred",
] as const;

export type MarketplaceSourceKind = (typeof MARKETPLACE_SOURCE_KINDS)[number];

export function isKnownMarketplaceSourceKind(value: string): value is MarketplaceSourceKind {
  return (MARKETPLACE_SOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * Rich provenance stamp retained on every marketplace record (mirrors
 * evidence/provenance.ts ProvenanceRecord): publisher identity, how the
 * record was obtained, when, and an optional note.
 */
export interface MarketplaceProvenanceStamp {
  readonly actor: MarketplaceActorReference;
  readonly source: MarketplaceSourceKind;
  readonly recordedAt: MarketplaceTimestamp;
  readonly note?: string;
}

/** Validates a provenance stamp (mirrors provenanceIssues semantics). */
export function marketplaceProvenanceIssues(
  provenance: MarketplaceProvenanceStamp | undefined,
  field = "provenance",
): MarketplaceValidationIssue[] {
  if (!provenance || typeof provenance !== "object") {
    return [{ field, problem: "is required" }];
  }
  const issues: MarketplaceValidationIssue[] = [];
  if (!provenance.actor || typeof provenance.actor.kind !== "string") {
    issues.push({ field: `${field}.actor`, problem: "is required" });
  } else if (provenance.actor.kind === "person" && !provenance.actor.personId) {
    issues.push({ field: `${field}.actor.personId`, problem: "is required for person actors" });
  }
  if (!isKnownMarketplaceSourceKind(provenance.source)) {
    issues.push({ field: `${field}.source`, problem: "must be a known source kind" });
  }
  if (
    typeof provenance.recordedAt !== "number" ||
    !Number.isFinite(provenance.recordedAt) ||
    provenance.recordedAt < 0
  ) {
    issues.push({
      field: `${field}.recordedAt`,
      problem: "must be finite epoch milliseconds >= 0",
    });
  }
  if (provenance.note !== undefined && provenance.note.trim().length === 0) {
    issues.push({ field: `${field}.note`, problem: "must be non-empty when present" });
  }
  return issues;
}

/**
 * Who/when/why required by every governance transition (mirrors
 * audit/records.ts AuditInput). Every one of the four state machines'
 * transitions carries one — audit completeness is a W011 acceptance proof.
 */
export interface MarketplaceAuditStamp {
  readonly actor: MarketplaceActorReference;
  readonly at: MarketplaceTimestamp;
  /** Why the transition happened (non-empty). */
  readonly reason: string;
}

/** Validates an audit stamp (mirrors auditInputIssues semantics). */
export function marketplaceAuditStampIssues(
  stamp: MarketplaceAuditStamp | undefined,
  fieldPrefix = "audit",
): MarketplaceValidationIssue[] {
  if (!stamp || typeof stamp !== "object") {
    return [{ field: fieldPrefix, problem: "is required" }];
  }
  const issues: MarketplaceValidationIssue[] = [];
  if (typeof stamp.reason !== "string" || stamp.reason.trim().length === 0) {
    issues.push({ field: `${fieldPrefix}.reason`, problem: "must be a non-empty string" });
  }
  if (!stamp.actor || typeof stamp.actor.kind !== "string") {
    issues.push({ field: `${fieldPrefix}.actor`, problem: "is required" });
  } else if (stamp.actor.kind === "person" && !stamp.actor.personId) {
    issues.push({
      field: `${fieldPrefix}.actor.personId`,
      problem: "is required for person actors",
    });
  }
  if (typeof stamp.at !== "number" || !Number.isFinite(stamp.at) || stamp.at < 0) {
    issues.push({ field: `${fieldPrefix}.at`, problem: "must be finite epoch milliseconds >= 0" });
  }
  return issues;
}

/** Deep-freezes a record tree (mirrors core/freeze.deepFreeze semantics). */
export function deepFreezeMarketplace<T>(value: T): T {
  if (Object.isFrozen(value)) return value;
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== null && typeof child === "object") deepFreezeMarketplace(child);
  }
  return value;
}
