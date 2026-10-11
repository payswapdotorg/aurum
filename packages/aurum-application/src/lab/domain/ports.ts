/**
 * Lab ports (W008 domain layer): the narrow, READ-ONLY seams the lab
 * consumes from the composed domain kernel, plus the lab's own evaluation
 * store port. The lab never mutates domain state (no second authority):
 * every seam below is a query.
 *
 * The seams are typed as structural picks of the kernel interfaces so the
 * composed kernel satisfies them directly, while tests can supply minimal
 * deterministic doubles.
 */
import type {
  CapabilityGraph,
  DomainTimestamp,
  GoalLedger,
  InquiryLedger,
  Result,
  TenantScope,
  WorkforceDirectory,
} from "@aurum/domain";
import type { LabEvaluationRecord } from "./records.js";
import type { LabError } from "./errors.js";

/**
 * Read-only domain views the lab consumes (tenant-scoped queries only):
 * - goals       : subject priority + horizon (fingerprint axes);
 * - capabilities: capability demand profile + mixed supply pool;
 * - workforce   : human capacity bounds for allocation discipline;
 * - inquiry     : open unknowns + open contradictions (uncertainty axis).
 */
export interface LabDomainViews {
  readonly goals: Pick<GoalLedger, "getGoal">;
  readonly capabilities: Pick<CapabilityGraph, "listRequirements" | "listSupplies">;
  readonly workforce: Pick<WorkforceDirectory, "getCapacity">;
  readonly inquiry: Pick<InquiryLedger, "listOpenUnknowns" | "listOpenContradictions">;
}

/** Filter for evaluation listing. */
export interface EvaluationFilter {
  readonly goalId?: string;
  readonly fingerprintDigest?: string;
}

/**
 * The lab's own evaluation store (in-memory today; P003 adds PostgreSQL
 * storage ports under src/lab/storage/ behind this same shape). Tenant
 * scoping flows through the seam: cross-tenant reads fail closed as a
 * uniform not-found.
 */
export interface LabEvaluationStore {
  putEvaluation(
    scope: TenantScope,
    record: LabEvaluationRecord,
  ): Result<LabEvaluationRecord, LabError>;
  getEvaluation(scope: TenantScope, evaluationId: string): Result<LabEvaluationRecord, LabError>;
  listEvaluations(scope: TenantScope, filter?: EvaluationFilter): readonly LabEvaluationRecord[];
}

/** Dependencies of the lab service factory. */
export interface OrganizationalLabDeps {
  readonly views: LabDomainViews;
  readonly evaluations: LabEvaluationStore;
}

/** Timestamped read helper shared by the app layer (deterministic `now`). */
export type Now = DomainTimestamp;
