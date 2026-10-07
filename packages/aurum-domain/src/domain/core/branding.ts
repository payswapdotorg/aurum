/**
 * Branded primitive types. Branding keeps ids/scope values from being mixed up
 * at compile time without changing runtime representation (they are still
 * strings/numbers). Factories that validate and brand values live next to the
 * owning area; this file only declares the types.
 */

declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Tenant identity. Independent from any filesystem path or runtime session. */
export type TenantId = Brand<string, "TenantId">;
/** Opaque person id (identity/people reference). */
export type PersonId = Brand<string, "PersonId">;
/** Membership record id (person <-> organization unit with roles). */
export type MembershipId = Brand<string, "MembershipId">;
/** Organization (company) entity id. */
export type OrganizationId = Brand<string, "OrganizationId">;
/** Physical/logical site id within an organization. */
export type SiteId = Brand<string, "SiteId">;
/** Organization unit id (tree node). */
export type UnitId = Brand<string, "UnitId">;
/** Recorded event id. */
export type EventId = Brand<string, "EventId">;
/** Observation (evidence encountered) id. */
export type ObservationId = Brand<string, "ObservationId">;
/** Claim (evidence-derived proposition) id. */
export type ClaimId = Brand<string, "ClaimId">;
/** Belief (versioned current understanding) id. */
export type BeliefId = Brand<string, "BeliefId">;
/** Hypothesis (unresolved explanation) id. */
export type HypothesisId = Brand<string, "HypothesisId">;
/** Contradiction (retained conflict) id. */
export type ContradictionId = Brand<string, "ContradictionId">;
/** Unknown (consequential question + consequence) id. */
export type UnknownId = Brand<string, "UnknownId">;
/** Goal id (append-only revision history). */
export type GoalId = Brand<string, "GoalId">;
/** Organizational memory record id. */
export type MemoryId = Brand<string, "MemoryId">;
/** Action (authority lifecycle) id. */
export type ActionId = Brand<string, "ActionId">;
/** Audit entry id. */
export type AuditId = Brand<string, "AuditId">;

/** Epoch milliseconds. The domain never reads a wall clock; callers pass `now`. */
export type DomainTimestamp = Brand<number, "DomainTimestamp">;

/** Any branded record id used across the kernel (for generic helpers). */
export type RecordId =
  | PersonId
  | MembershipId
  | OrganizationId
  | SiteId
  | UnitId
  | EventId
  | ObservationId
  | ClaimId
  | BeliefId
  | HypothesisId
  | ContradictionId
  | UnknownId
  | GoalId
  | MemoryId
  | ActionId
  | AuditId;
