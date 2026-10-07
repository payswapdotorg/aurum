/**
 * Tenant + identity: people references (opaque ids + typed labels),
 * memberships and the roles vocabulary. This is the Foundation identity
 * vocabulary from spec/DOMAIN-MAPPING.md — it models *references*, not
 * authentication or HR records.
 */
import type { DomainTimestamp } from "../core/branding.js";
import type { TenantScopedRecord } from "../core/scope.js";
import type { PersonId, MembershipId } from "../core/branding.js";
import type { ActorReference } from "../core/refs.js";

/** Typed labels describing what kind of identity a person reference carries. */
export const IDENTITY_LABELS = [
  "employee",
  "contractor",
  "consultant",
  "manager",
  "executive",
  "partner",
  "agent-operator",
  "external",
] as const;

export type IdentityLabel = (typeof IDENTITY_LABELS)[number];

export function isKnownIdentityLabel(value: string): value is IdentityLabel {
  return (IDENTITY_LABELS as readonly string[]).includes(value);
}

/** Roles vocabulary used by memberships and action authority policies. */
export const ROLES = [
  "owner",
  "admin",
  "manager",
  "approver",
  "authorizer",
  "executor",
  "member",
  "observer",
] as const;

export type RoleName = (typeof ROLES)[number];

export function isKnownRole(value: string): value is RoleName {
  return (ROLES as readonly string[]).includes(value);
}

/** A person reference: opaque id plus typed labels valid for the reference. */
export interface IdentityReference {
  readonly personId: PersonId;
  readonly labels: readonly IdentityLabel[];
}

/** A registered person record (what Aurum knows about someone). */
export interface PersonRecord extends TenantScopedRecord {
  readonly personId: PersonId;
  readonly displayName: string;
  readonly labels: readonly IdentityLabel[];
  /** Opaque external identifier (HR system, directory), if any. */
  readonly externalRef?: string;
  readonly provenance: ActorReference;
  readonly registeredAt: DomainTimestamp;
}

export type MembershipStatus = "active" | "ended";

/** Membership of a person in the organization (tenant-wide or per unit). */
export interface MembershipRecord extends TenantScopedRecord {
  readonly membershipId: MembershipId;
  readonly personId: PersonId;
  readonly organizationId: string;
  readonly unitId?: string;
  readonly roles: readonly RoleName[];
  readonly status: MembershipStatus;
  readonly grantedAt: DomainTimestamp;
  readonly grantedBy: ActorReference;
  readonly endedAt?: DomainTimestamp;
  readonly endedBy?: ActorReference;
}

/**
 * Aggregates the currently active roles a person holds in a tenant across all
 * memberships, as of the given time.
 */
export function activeRolesFor(
  personId: PersonId,
  memberships: readonly MembershipRecord[],
  at: DomainTimestamp,
): readonly RoleName[] {
  const roles = new Set<RoleName>();
  for (const membership of memberships) {
    if (
      membership.personId === personId &&
      membership.status === "active" &&
      membership.grantedAt <= at &&
      (membership.endedAt === undefined || membership.endedAt > at)
    ) {
      for (const role of membership.roles) roles.add(role);
    }
  }
  return Object.freeze([...roles]);
}
