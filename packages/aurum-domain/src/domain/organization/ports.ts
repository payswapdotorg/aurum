/**
 * Organization directory port: registering the world model entities. All
 * operations are tenant-scoped; foreign-tenant parents/organizations are
 * uniformly not-found.
 */
import type { Result } from "../core/result.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import type { ActorReference } from "../core/refs.js";
import type { AuditInput } from "../audit/records.js";
import type {
  OrganizationRecord,
  OrganizationSnapshot,
  SiteRecord,
  UnitRecord,
} from "./records.js";

export interface RegisterOrganizationInput {
  readonly organizationId: string;
  readonly name: string;
  readonly provenance: ActorReference;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

export interface RegisterSiteInput {
  readonly siteId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly provenance: ActorReference;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

export interface RegisterUnitInput {
  readonly unitId: string;
  readonly organizationId: string;
  readonly parentUnitId?: string;
  readonly name: string;
  readonly provenance: ActorReference;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

/** World-model administration surface. */
export interface OrganizationDirectory {
  registerOrganization(
    scope: TenantScope,
    input: RegisterOrganizationInput,
  ): Result<OrganizationRecord>;
  getOrganization(scope: TenantScope, organizationId: string): Result<OrganizationRecord>;
  registerSite(scope: TenantScope, input: RegisterSiteInput): Result<SiteRecord>;
  getSite(scope: TenantScope, siteId: string): Result<SiteRecord>;
  registerUnit(scope: TenantScope, input: RegisterUnitInput): Result<UnitRecord>;
  getUnit(scope: TenantScope, unitId: string): Result<UnitRecord>;
  /** Everything known about one organization in the requesting tenant. */
  describeOrganization(scope: TenantScope, organizationId: string): Result<OrganizationSnapshot>;
}
