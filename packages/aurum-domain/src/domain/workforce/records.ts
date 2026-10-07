/**
 * Workforce semantics (W005, spec/DOMAIN-MAPPING.md "Operating model"):
 * roles, capabilities, assignments, capacity bounds, workload, outcomes,
 * alternative explanations, and workforce adjustments (training,
 * reassignment, hiring, agent complement/replacement, automation,
 * outsourcing) as *recommendations* — employment-impacting ones always carry
 * evidence and remain decided by humans only (spec/REBUILD-CONSTITUTION.md:
 * "Employment-impacting recommendations remain human-authorized").
 */
import type {
  AlternativeExplanationId,
  CapacityDeclarationId,
  CapabilityId,
  DomainTimestamp,
  PersonId,
  WorkAssignmentId,
  WorkOutcomeId,
  WorkforceRecommendationId,
  WorkforceRoleId,
} from "../core/branding.js";
import type { TenantScopedRecord } from "../core/scope.js";
import type { ActorReference, SubjectReference } from "../core/refs.js";
import type { TimeWindow } from "../core/time.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { FreshnessStamp } from "../evidence/freshness.js";

/** The seven workforce adjustment mechanisms (spec frozen list). */
export const WORKFORCE_ADJUSTMENTS = [
  "training",
  "reassignment",
  "hiring",
  "agent-complement",
  "agent-replacement",
  "automation",
  "outsourcing",
] as const;

export type WorkforceAdjustmentKind = (typeof WORKFORCE_ADJUSTMENTS)[number];

export function isKnownWorkforceAdjustment(value: string): value is WorkforceAdjustmentKind {
  return (WORKFORCE_ADJUSTMENTS as readonly string[]).includes(value);
}

/**
 * Adjustments that impact employment by construction: reassignment changes
 * someone's role, hiring adds one, agent-replacement removes a person from
 * the work, outsourcing moves the work away. The store rejects any attempt
 * to propose these with `employmentImpacting: false`.
 */
export const EMPLOYMENT_IMPACTING_ADJUSTMENTS = [
  "reassignment",
  "hiring",
  "agent-replacement",
  "outsourcing",
] as const;

export function isInherentlyEmploymentImpacting(kind: WorkforceAdjustmentKind): boolean {
  return (EMPLOYMENT_IMPACTING_ADJUSTMENTS as readonly string[]).includes(kind);
}

/** A workforce role definition: title plus the capabilities it requires. */
export interface WorkforceRoleRecord extends TenantScopedRecord {
  readonly roleId: WorkforceRoleId;
  readonly title: string;
  readonly description?: string;
  readonly requiredCapabilities: readonly CapabilityId[];
  readonly provenance: ProvenanceRecord;
  readonly createdAt: DomainTimestamp;
}

/**
 * Capacity bounds for one human over one period. Every human work
 * allocation must be covered by a declaration — this is the contract that
 * keeps planned allocations bounded (workload *observations* may exceed
 * bounds; that is evidence, not an allocation).
 */
export interface CapacityBounds {
  readonly period: TimeWindow;
  /** Total assignable effort within the period (milliseconds). */
  readonly maxEffortMs: number;
  /** Maximum number of simultaneous active assignments. */
  readonly maxConcurrentAssignments: number;
}

export interface CapacityDeclarationRecord extends TenantScopedRecord {
  readonly capacityId: CapacityDeclarationId;
  readonly personId: PersonId;
  readonly bounds: CapacityBounds;
  readonly provenance: ProvenanceRecord;
  readonly createdAt: DomainTimestamp;
}

export const WORK_ASSIGNMENT_STATUSES = ["active", "ended"] as const;

export type WorkAssignmentStatus = (typeof WORK_ASSIGNMENT_STATUSES)[number];

/**
 * An allocation of a person to a role (and optionally to a specific process
 * step). Effort is bounded by the covering capacity declaration.
 */
export interface WorkAssignmentRecord extends TenantScopedRecord {
  readonly assignmentId: WorkAssignmentId;
  readonly personId: PersonId;
  readonly roleId?: WorkforceRoleId;
  readonly processRef?: { readonly processId: string; readonly stepId: string };
  readonly effortMs: number;
  readonly period: TimeWindow;
  readonly status: WorkAssignmentStatus;
  readonly provenance: ProvenanceRecord;
  readonly createdAt: DomainTimestamp;
  readonly endedAt?: DomainTimestamp;
  readonly endedBy?: ActorReference;
}

/**
 * Observed workload (evidence): actual effort exerted by a person in a
 * period. Unlike allocations, observations may exceed capacity — the
 * `overCapacity` flag in workload summaries makes that explicit.
 */
export interface WorkloadObservationRecord extends TenantScopedRecord {
  readonly observationId: string;
  readonly personId: PersonId;
  readonly period: TimeWindow;
  readonly observedEffortMs: number;
  readonly observedUtilization?: number;
  readonly note?: string;
  readonly provenance: ProvenanceRecord;
  readonly freshness: FreshnessStamp;
  readonly recordedAt: DomainTimestamp;
}

export const WORK_OUTCOME_RESULTS = ["met", "partial", "missed"] as const;

export type WorkOutcomeResult = (typeof WORK_OUTCOME_RESULTS)[number];

export function isKnownWorkOutcomeResult(value: string): value is WorkOutcomeResult {
  return (WORK_OUTCOME_RESULTS as readonly string[]).includes(value);
}

/** An observed work outcome for a person in a period (evidence). */
export interface WorkOutcomeRecord extends TenantScopedRecord {
  readonly outcomeId: WorkOutcomeId;
  readonly personId: PersonId;
  readonly period: TimeWindow;
  readonly subject?: SubjectReference;
  readonly result: WorkOutcomeResult;
  readonly summary: string;
  readonly provenance: ProvenanceRecord;
  readonly createdAt: DomainTimestamp;
}

/**
 * An alternative explanation for an observed workload/outcome pattern
 * (e.g. overload explained by demand surge vs. process friction vs. skill
 * mismatch). Competing explanations are retained, each with its evidence —
 * never silently merged (mirrors the contradiction discipline).
 */
export interface AlternativeExplanationRecord extends TenantScopedRecord {
  readonly explanationId: AlternativeExplanationId;
  readonly subject: SubjectReference;
  /** The observed pattern being explained. */
  readonly pattern: string;
  readonly explanation: string;
  readonly evidenceRefs: readonly SubjectReference[];
  readonly provenance: ProvenanceRecord;
  readonly createdAt: DomainTimestamp;
}

export const WORKFORCE_DECISION_STATES = ["pending", "human-approved", "human-rejected"] as const;

export type WorkforceDecisionState = (typeof WORKFORCE_DECISION_STATES)[number];

/** The decision attached to a workforce recommendation. */
export interface WorkforceDecision {
  readonly state: WorkforceDecisionState;
  /** Present once decided; always a person actor (never system/agent). */
  readonly decidedBy?: ActorReference;
  readonly decidedAt?: DomainTimestamp;
  readonly reason?: string;
}

/**
 * A workforce adjustment recommendation. Advisory by construction: the only
 * reachable decision states are human-approved / human-rejected, set
 * exclusively through a human-actor decide command carrying an explicit
 * reason. Employment-impacting recommendations must be proposed with
 * non-empty evidence references.
 */
export interface WorkforceRecommendationRecord extends TenantScopedRecord {
  readonly recommendationId: WorkforceRecommendationId;
  readonly adjustment: WorkforceAdjustmentKind;
  readonly subject: SubjectReference;
  readonly rationale: string;
  readonly evidenceRefs: readonly SubjectReference[];
  readonly employmentImpacting: boolean;
  readonly decision: WorkforceDecision;
  readonly proposedBy: ActorReference;
  readonly proposedAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
}
