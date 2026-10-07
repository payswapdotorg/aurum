/**
 * Capability graph (W005, spec/DOMAIN-MAPPING.md): capabilities supplied by
 * employee/team/agent/software/supplier/partner; requirements arising from
 * goal/process/project/opportunity/manual; gaps distinguishing uncovered /
 * level / capacity shortfalls. Gap classification is a pure, documented
 * function of one requirement and its same-capability supplies.
 */
import type {
  CapabilityGapId,
  CapabilityId,
  CapabilityRequirementId,
  CapabilitySupplyId,
  DomainTimestamp,
} from "../core/branding.js";
import type { TenantScopedRecord } from "../core/scope.js";
import type { SupplierReference } from "../core/suppliers.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { FreshnessStamp } from "../evidence/freshness.js";
import type { GoalPriority } from "../goals/records.js";

export const PROFICIENCY_MIN = 1;
export const PROFICIENCY_MAX = 5;

/** Where a capability requirement arises from (spec frozen list). */
export const REQUIREMENT_SOURCES = ["goal", "process", "project", "opportunity", "manual"] as const;

export type RequirementSourceKind = (typeof REQUIREMENT_SOURCES)[number];

export function isKnownRequirementSource(value: string): value is RequirementSourceKind {
  return (REQUIREMENT_SOURCES as readonly string[]).includes(value);
}

/** The three gap classes (spec frozen list) plus "covered". */
export const GAP_KINDS = ["uncovered", "level", "capacity"] as const;

export type CapabilityGapKind = (typeof GAP_KINDS)[number];

export function isKnownCapabilityGapKind(value: string): value is CapabilityGapKind {
  return (GAP_KINDS as readonly string[]).includes(value);
}

export type CoverageStatus = CapabilityGapKind | "covered";

/** The capability itself (what can be supplied/demanded). */
export interface CapabilityRecord extends TenantScopedRecord {
  readonly capabilityId: CapabilityId;
  readonly name: string;
  readonly description?: string;
  readonly provenance: ProvenanceRecord;
  readonly createdAt: DomainTimestamp;
}

/**
 * One supplier's offer of a capability: proficiency level on the 1..5 scale
 * and optionally a quantified capacity per availability window.
 */
export interface CapabilitySupplyRecord extends TenantScopedRecord {
  readonly supplyId: CapabilitySupplyId;
  readonly capabilityId: CapabilityId;
  /** One of employee/team/agent/software/supplier/partner. */
  readonly supplier: SupplierReference;
  readonly level: number;
  readonly capacityPerPeriod?: number;
  readonly availableFrom?: DomainTimestamp;
  readonly availableUntil?: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
  readonly freshness: FreshnessStamp;
  readonly createdAt: DomainTimestamp;
}

/** A demand for a capability arising from a typed source. */
export interface CapabilityRequirementRecord extends TenantScopedRecord {
  readonly requirementId: CapabilityRequirementId;
  readonly capabilityId: CapabilityId;
  readonly source: RequirementSource;
  readonly requiredLevel: number;
  readonly requiredCapacityPerPeriod?: number;
  readonly priority?: GoalPriority;
  readonly provenance: ProvenanceRecord;
  readonly createdAt: DomainTimestamp;
}

/** Where the demand arises: goal/process/project/opportunity/manual. */
export interface RequirementSource {
  readonly kind: RequirementSourceKind;
  /** Opaque reference to the demanding record (goal id, process id, ...). */
  readonly ref: string;
}

/**
 * A computed gap, appended by `recomputeGaps`. Append-only: fixing a gap
 * appends nothing (the requirement's latest assessment is "covered"); the
 * history of past gaps is retained for evidence and calibration (W013).
 */
export interface CapabilityGapRecord extends TenantScopedRecord {
  readonly gapId: CapabilityGapId;
  readonly requirementId: CapabilityRequirementId;
  readonly capabilityId: CapabilityId;
  readonly kind: CapabilityGapKind;
  /** Required minus best supplied level; present for "level" gaps. */
  readonly levelShortfall?: number;
  /** Required minus eligible supplied capacity; present for "capacity" gaps. */
  readonly capacityShortfall?: number;
  readonly candidateSupplyIds: readonly CapabilitySupplyId[];
  readonly computedAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
}

/**
 * Pure coverage assessment of one requirement against its supplies.
 * Frozen rules:
 * 1. no supplies at all -> "uncovered";
 * 2. best supplied level < requiredLevel -> "level" (shortfall is the level
 *    difference; candidate supplies are all known supplies);
 * 3. level demand met but required capacity exceeds the summed capacity of
 *    level-eligible supplies -> "capacity" (shortfall is the capacity
 *    difference; candidate supplies are the level-eligible ones);
 * 4. otherwise -> "covered" (no capacity demand, or capacity met).
 */
export interface CoverageAssessment {
  readonly requirementId: CapabilityRequirementId;
  readonly capabilityId: CapabilityId;
  readonly status: CoverageStatus;
  readonly levelShortfall?: number;
  readonly capacityShortfall?: number;
  readonly candidateSupplyIds: readonly CapabilitySupplyId[];
  readonly computedAt: DomainTimestamp;
}

export function assessCoverage(
  requirement: CapabilityRequirementRecord,
  supplies: readonly CapabilitySupplyRecord[],
  computedAt: DomainTimestamp,
): CoverageAssessment {
  const base = {
    requirementId: requirement.requirementId,
    capabilityId: requirement.capabilityId,
    computedAt,
  };
  if (supplies.length === 0) {
    return {
      ...base,
      status: "uncovered" as const,
      candidateSupplyIds: Object.freeze([]),
    };
  }
  const bestLevel = supplies.reduce((max, supply) => Math.max(max, supply.level), 0);
  if (bestLevel < requirement.requiredLevel) {
    return {
      ...base,
      status: "level" as const,
      levelShortfall: requirement.requiredLevel - bestLevel,
      candidateSupplyIds: Object.freeze(supplies.map((supply) => supply.supplyId)),
    };
  }
  const requiredCapacity = requirement.requiredCapacityPerPeriod;
  if (requiredCapacity === undefined) {
    return {
      ...base,
      status: "covered" as const,
      candidateSupplyIds: Object.freeze([]),
    };
  }
  const eligible = supplies.filter((supply) => supply.level >= requirement.requiredLevel);
  const suppliedCapacity = eligible.reduce(
    (sum, supply) => sum + (supply.capacityPerPeriod ?? 0),
    0,
  );
  const capacityShortfall = requiredCapacity - suppliedCapacity;
  if (capacityShortfall > 0) {
    return {
      ...base,
      status: "capacity" as const,
      capacityShortfall,
      candidateSupplyIds: Object.freeze(eligible.map((supply) => supply.supplyId)),
    };
  }
  return {
    ...base,
    status: "covered" as const,
    candidateSupplyIds: Object.freeze([]),
  };
}
