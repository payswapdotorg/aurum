/**
 * Workforce ports (W005). Three narrow stores, each well under the 12-method
 * policy: the directory (roles/capacity/assignments), insights (workload
 * observations/outcomes/alternative explanations) and recommendations
 * (propose + human-only decide).
 */
import type { Result } from "../core/result.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { ActorReference, SubjectReference } from "../core/refs.js";
import type { TenantScope } from "../core/scope.js";
import type { TimeWindow } from "../core/time.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { FreshnessStamp } from "../evidence/freshness.js";
import type { AuditInput } from "../audit/records.js";
import type {
  AlternativeExplanationRecord,
  CapacityBounds,
  CapacityDeclarationRecord,
  WorkAssignmentRecord,
  WorkOutcomeRecord,
  WorkforceRecommendationRecord,
  WorkloadObservationRecord,
  WorkforceRoleRecord,
} from "./records.js";
import type { WorkloadSummary } from "./workload.js";

export interface RegisterRoleInput {
  readonly roleId: string;
  readonly title: string;
  readonly description?: string;
  readonly requiredCapabilities?: readonly string[];
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

export interface DeclareCapacityInput {
  readonly capacityId: string;
  readonly personId: string;
  readonly bounds: CapacityBounds;
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

export interface RecordAssignmentInput {
  readonly assignmentId: string;
  readonly personId: string;
  readonly roleId?: string;
  readonly processRef?: { readonly processId: string; readonly stepId: string };
  readonly effortMs: number;
  readonly period: TimeWindow;
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

export interface EndAssignmentInput {
  readonly assignmentId: string;
  readonly endedBy: ActorReference;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

export interface AssignmentFilter {
  readonly personId?: string;
  readonly status?: "active" | "ended";
}

/** Workforce directory surface (roles, capacity bounds, assignments). */
export interface WorkforceDirectory {
  registerRole(scope: TenantScope, input: RegisterRoleInput): Result<WorkforceRoleRecord>;
  listRoles(scope: TenantScope): readonly WorkforceRoleRecord[];
  declareCapacity(
    scope: TenantScope,
    input: DeclareCapacityInput,
  ): Result<CapacityDeclarationRecord>;
  /** The person's capacity declaration covering `at`, when one exists. */
  getCapacity(
    scope: TenantScope,
    personId: string,
    at: DomainTimestamp,
  ): Result<CapacityDeclarationRecord>;
  /**
   * Records a human allocation. Rejected unless a capacity declaration
   * covers the assignment period and the person stays within both the
   * effort bound and the concurrency bound.
   */
  recordAssignment(scope: TenantScope, input: RecordAssignmentInput): Result<WorkAssignmentRecord>;
  endAssignment(scope: TenantScope, input: EndAssignmentInput): Result<WorkAssignmentRecord>;
  listAssignments(scope: TenantScope, filter?: AssignmentFilter): readonly WorkAssignmentRecord[];
  workloadOf(scope: TenantScope, personId: string, period: TimeWindow): Result<WorkloadSummary>;
}

export interface RecordWorkloadObservationInput {
  readonly observationId: string;
  readonly personId: string;
  readonly period: TimeWindow;
  readonly observedEffortMs: number;
  readonly observedUtilization?: number;
  readonly note?: string;
  readonly provenance: ProvenanceRecord;
  readonly freshness?: FreshnessStamp;
  readonly now: DomainTimestamp;
}

export interface WorkloadObservationFilter {
  readonly personId?: string;
}

export interface RecordOutcomeInput {
  readonly outcomeId: string;
  readonly personId: string;
  readonly period: TimeWindow;
  readonly subject?: SubjectReference;
  readonly result: string;
  readonly summary: string;
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

export interface OutcomeFilter {
  readonly personId?: string;
  readonly result?: "met" | "partial" | "missed";
}

export interface RecordAlternativeExplanationInput {
  readonly explanationId: string;
  readonly subject: SubjectReference;
  readonly pattern: string;
  readonly explanation: string;
  readonly evidenceRefs: readonly SubjectReference[];
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

export interface ExplanationFilter {
  readonly subject?: SubjectReference;
}

/** Workforce insights surface (evidence records about the workforce). */
export interface WorkforceInsights {
  recordWorkloadObservation(
    scope: TenantScope,
    input: RecordWorkloadObservationInput,
  ): Result<WorkloadObservationRecord>;
  listWorkloadObservations(
    scope: TenantScope,
    filter?: WorkloadObservationFilter,
  ): readonly WorkloadObservationRecord[];
  recordOutcome(scope: TenantScope, input: RecordOutcomeInput): Result<WorkOutcomeRecord>;
  listOutcomes(scope: TenantScope, filter?: OutcomeFilter): readonly WorkOutcomeRecord[];
  recordAlternativeExplanation(
    scope: TenantScope,
    input: RecordAlternativeExplanationInput,
  ): Result<AlternativeExplanationRecord>;
  listAlternativeExplanations(
    scope: TenantScope,
    filter?: ExplanationFilter,
  ): readonly AlternativeExplanationRecord[];
}

export interface ProposeRecommendationInput {
  readonly recommendationId: string;
  readonly adjustment: string;
  readonly subject: SubjectReference;
  readonly rationale: string;
  readonly evidenceRefs: readonly SubjectReference[];
  readonly employmentImpacting: boolean;
  readonly proposedBy: ActorReference;
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

export interface DecideRecommendationInput {
  readonly recommendationId: string;
  readonly decision: "human-approved" | "human-rejected";
  /** The deciding human; the store rejects non-person actors. */
  readonly decidedBy: ActorReference;
  readonly reason: string;
  readonly now: DomainTimestamp;
}

export interface RecommendationFilter {
  readonly adjustment?: string;
  readonly state?: "pending" | "human-approved" | "human-rejected";
  readonly employmentImpacting?: boolean;
}

/**
 * Workforce recommendation surface. Propose is open to any actor (analysis);
 * decide is human-only — the store rejects every non-person actor, so no
 * code path can auto-decide an employment-impacting recommendation.
 */
export interface WorkforceRecommendations {
  proposeRecommendation(
    scope: TenantScope,
    input: ProposeRecommendationInput,
  ): Result<WorkforceRecommendationRecord>;
  decideRecommendation(
    scope: TenantScope,
    input: DecideRecommendationInput,
  ): Result<WorkforceRecommendationRecord>;
  getRecommendation(
    scope: TenantScope,
    recommendationId: string,
  ): Result<WorkforceRecommendationRecord>;
  listRecommendations(
    scope: TenantScope,
    filter?: RecommendationFilter,
  ): readonly WorkforceRecommendationRecord[];
}
