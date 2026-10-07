/**
 * Capability graph port (W005). Supplies/requirements are registered with
 * provenance; gaps are recomputed (append-only) via the pure
 * `assessCoverage` classification. All operations tenant-scoped.
 */
import type { Result } from "../core/result.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { SupplierReference } from "../core/suppliers.js";
import type { TenantScope } from "../core/scope.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { FreshnessStamp } from "../evidence/freshness.js";
import type {
  CapabilityGapRecord,
  CapabilityRecord,
  CapabilityRequirementRecord,
  CapabilitySupplyRecord,
  CoverageAssessment,
  RequirementSourceKind,
} from "./records.js";

export interface RegisterCapabilityInput {
  readonly capabilityId: string;
  readonly name: string;
  readonly description?: string;
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

export interface RegisterSupplyInput {
  readonly supplyId: string;
  readonly capabilityId: string;
  readonly supplier: SupplierReference;
  readonly level: number;
  readonly capacityPerPeriod?: number;
  readonly availableFrom?: DomainTimestamp;
  readonly availableUntil?: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
  readonly freshness?: FreshnessStamp;
  readonly now: DomainTimestamp;
}

export interface RegisterRequirementInput {
  readonly requirementId: string;
  readonly capabilityId: string;
  readonly source: { readonly kind: string; readonly ref: string };
  readonly requiredLevel: number;
  readonly requiredCapacityPerPeriod?: number;
  readonly priority?: string;
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

export interface RecomputeGapsInput {
  /** Restrict the recompute to one requirement; omit for all requirements. */
  readonly requirementId?: string;
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

export interface SupplyFilter {
  readonly capabilityId?: string;
}

export interface RequirementFilter {
  readonly capabilityId?: string;
  readonly sourceKind?: RequirementSourceKind;
}

export interface GapFilter {
  readonly requirementId?: string;
  readonly kind?: CapabilityGapRecord["kind"];
}

/** Capability graph surface (max 12 methods by policy). */
export interface CapabilityGraph {
  registerCapability(scope: TenantScope, input: RegisterCapabilityInput): Result<CapabilityRecord>;
  getCapability(scope: TenantScope, capabilityId: string): Result<CapabilityRecord>;
  listCapabilities(scope: TenantScope): readonly CapabilityRecord[];
  registerSupply(scope: TenantScope, input: RegisterSupplyInput): Result<CapabilitySupplyRecord>;
  listSupplies(scope: TenantScope, filter?: SupplyFilter): readonly CapabilitySupplyRecord[];
  registerRequirement(
    scope: TenantScope,
    input: RegisterRequirementInput,
  ): Result<CapabilityRequirementRecord>;
  listRequirements(
    scope: TenantScope,
    filter?: RequirementFilter,
  ): readonly CapabilityRequirementRecord[];
  /**
   * Recomputes coverage for one or all requirements, appends a gap record for
   * every non-covered assessment (gap ids are kernel-generated sequential
   * values) and returns the assessments.
   */
  recomputeGaps(
    scope: TenantScope,
    input: RecomputeGapsInput,
  ): Result<readonly CoverageAssessment[]>;
  listGaps(scope: TenantScope, filter?: GapFilter): readonly CapabilityGapRecord[];
}
