/**
 * Organization world model: what Aurum knows about the organization —
 * company entities, sites and units (spec/DOMAIN-MAPPING.md Foundation).
 */
import type { DomainTimestamp, OrganizationId, SiteId, UnitId } from "../core/branding.js";
import type { TenantScopedRecord } from "../core/scope.js";
import type { ActorReference } from "../core/refs.js";

/** Company/organization entity. */
export interface OrganizationRecord extends TenantScopedRecord {
  readonly organizationId: OrganizationId;
  readonly name: string;
  readonly provenance: ActorReference;
  readonly registeredAt: DomainTimestamp;
}

/** A physical or logical site belonging to an organization. */
export interface SiteRecord extends TenantScopedRecord {
  readonly siteId: SiteId;
  readonly organizationId: OrganizationId;
  readonly name: string;
  readonly provenance: ActorReference;
  readonly registeredAt: DomainTimestamp;
}

/** A unit in the organization tree (departments, teams, lines of business). */
export interface UnitRecord extends TenantScopedRecord {
  readonly unitId: UnitId;
  readonly organizationId: OrganizationId;
  readonly parentUnitId?: UnitId;
  readonly name: string;
  readonly provenance: ActorReference;
  readonly registeredAt: DomainTimestamp;
}

/** Snapshot of everything known about one organization in one tenant. */
export interface OrganizationSnapshot {
  readonly organization: OrganizationRecord;
  readonly sites: readonly SiteRecord[];
  readonly units: readonly UnitRecord[];
}

/**
 * Detects whether linking child -> parentUnits would create a cycle in the
 * tenant's unit forest. Pure: operates on the supplied unit list.
 */
export function wouldCreateUnitCycle(
  unitId: UnitId,
  parentUnitId: UnitId,
  existing: readonly UnitRecord[],
): boolean {
  if (unitId === parentUnitId) return true;
  const byId = new Map(existing.map((unit) => [unit.unitId, unit]));
  let cursor: UnitId | undefined = parentUnitId;
  const visited = new Set<string>();
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor);
    if (cursor === unitId) return true;
    cursor = byId.get(cursor)?.parentUnitId;
  }
  return false;
}
