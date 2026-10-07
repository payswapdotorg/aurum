/**
 * Identity directory port: person registration and membership administration,
 * every operation explicitly tenant-scoped.
 */
import type { Result } from "../core/result.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import type { ActorReference } from "../core/refs.js";
import type { AuditInput } from "../audit/records.js";
import type { MembershipRecord, PersonRecord, RoleName } from "./records.js";

export interface RegisterPersonInput {
  readonly personId: string;
  readonly displayName: string;
  readonly labels: readonly string[];
  readonly externalRef?: string;
  readonly provenance: ActorReference;
  readonly now: DomainTimestamp;
}

export interface GrantMembershipInput {
  readonly membershipId: string;
  readonly personId: string;
  readonly organizationId: string;
  readonly unitId?: string;
  readonly roles: readonly string[];
  readonly grantedBy: ActorReference;
  readonly now: DomainTimestamp;
  /** Why this membership was granted (consequential transition). */
  readonly audit: AuditInput;
}

export interface EndMembershipInput {
  readonly membershipId: string;
  readonly endedBy: ActorReference;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

/** Person and membership administration surface (max 12 methods by policy). */
export interface IdentityDirectory {
  registerPerson(scope: TenantScope, input: RegisterPersonInput): Result<PersonRecord>;
  getPerson(scope: TenantScope, personId: string): Result<PersonRecord>;
  listPeople(scope: TenantScope): readonly PersonRecord[];
  grantMembership(scope: TenantScope, input: GrantMembershipInput): Result<MembershipRecord>;
  endMembership(scope: TenantScope, input: EndMembershipInput): Result<MembershipRecord>;
  listMemberships(scope: TenantScope): readonly MembershipRecord[];
  /**
   * Roles the person currently holds in this tenant (derived from active
   * memberships). Foreign or unknown person: empty result, no existence leak.
   */
  rolesOf(scope: TenantScope, personId: string, at: DomainTimestamp): readonly RoleName[];
}
