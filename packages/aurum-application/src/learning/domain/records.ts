/**
 * Learning record types (W013 domain layer): the OUTCOME JOIN — outcomes
 * joined to the full conditioning context — plus the derived conditional
 * evidence and the calibrated search result.
 *
 * THE JOIN (catalog deliver: "join outcomes to context, organization, actor
 * allocation, model occupancy, information strategy, environment and
 * cost"). Every dimension is carried verbatim from the records that chose
 * and ran the organization:
 * - context          <- the W008 lab evaluation that ranked the organization:
 *                       fingerprint digest + axes, constraint set, weights,
 *                       modifiers, ranking rule, rank and score at
 *                       evaluation time (the P003 join keys survive
 *                       verbatim on outcome records too);
 * - organization     <- the W005 OrganizationCandidate: id, search strategy
 *                       and the derived organization shape (conditioning key);
 * - actor allocation <- assignment/allocation histograms + effort totals;
 * - model occupancy  <- agent occupancy structure;
 * - information strategy <- information-flow signature (flows, review,
 *                       minimal context, tightest freshness requirement);
 * - environment      <- distinct execution environment references;
 * - cost             <- deterministic cost-proxy estimate (W008 unit table)
 *                       + budget ceiling + observed actual cost when present.
 *
 * Outcome records are APPEND-ONLY evidence (the store port refuses duplicate
 * ids): a recorded outcome is never rewritten, including failures.
 */
import type {
  ActorReference,
  DomainTimestamp,
  ProvenanceRecord,
  SubjectReference,
  TenantScopedRecord,
} from "@aurum/domain";
import type {
  BindingConstraint,
  CandidateScore,
  ContextFingerprint,
  ContextModifiers,
  ExcludedBlueprint,
  LabConstraintSet,
  OrganizationSearchResult,
  PoolSummaryEntry,
  ScoringWeights,
  SearchStrategy,
} from "../../lab/contract.lab.js";
import type { ContextClass } from "./contextClass.js";
import type { OrganizationShape } from "./shape.js";
import type { OutcomeSourceKind, OutcomeStatus } from "./vocabulary.js";
import type { FreshnessClass } from "@aurum/domain";

/** The raw outcome observation (source-agnostic, human-inspectable). */
export interface OutcomeObservation {
  readonly status: OutcomeStatus;
  /** Where the outcome was observed (mission/plan/manual). */
  readonly source: { readonly kind: OutcomeSourceKind; readonly ref: string };
  /** When the outcome was observed (epoch ms; drives freshness). */
  readonly observedAt: DomainTimestamp;
  /** Who observed/reported the outcome. */
  readonly observedBy: ActorReference;
  /** First-class failure detail (present for failed/missed outcomes). */
  readonly failure?: {
    readonly kind: string;
    readonly detail: string;
  };
  /** Observed metric vs the target the organization was expected to hit. */
  readonly metric?: {
    readonly metric: string;
    readonly observed: number;
    readonly target: number;
  };
  /** Observed actual cost (opaque units; the proxy stays an estimate). */
  readonly actualCost?: number;
  readonly notes?: string;
}

/** Input for `recordOutcome` (observation + the join anchor). */
export interface RecordOutcomeInput {
  readonly outcomeId: string;
  /** The lab evaluation that ranked the organization in its context. */
  readonly evaluationId: string;
  /** The candidate organization that was actually run. */
  readonly candidateId: string;
  readonly observation: OutcomeObservation;
  /** Defaults to the observation source + the evaluation's goal. */
  readonly evidenceRefs?: readonly SubjectReference[];
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

/** Actor-allocation join dimension (histograms over the candidate value). */
export interface AllocationJoin {
  readonly actorCount: number;
  readonly assignmentCount: number;
  readonly capabilityAllocationCount: number;
  /** human + team actors (in-house oversight capacity). */
  readonly humanLikeActorCount: number;
  /** agent + agent-team + software + automation actors. */
  readonly automatedActorCount: number;
  /** supplier + partner + external-service actors. */
  readonly externalActorCount: number;
  /** Sum of assignment effort shares (rounded to 4 decimals). */
  readonly totalEffortShare: number;
}

/** Model-occupancy join dimension. */
export interface OccupancyJoin {
  /** agent + agent-team actors (occupancy is only valid for them). */
  readonly agentActorCount: number;
  readonly entryCount: number;
  readonly exclusiveEntryCount: number;
  readonly distinctModelBindings: number;
}

/** Information-strategy join dimension (structural signature). */
export interface InformationStrategyJoin {
  readonly flowCount: number;
  readonly reviewRequiredFlows: number;
  readonly minimalContextFlows: number;
  /** Tightest freshness requirement across flows (min freshnessMaxAgeMs). */
  readonly tightestFreshnessRequirementMs?: number;
}

/** Cost join dimension (estimate + ceiling + observed actual). */
export interface CostJoin {
  /** Deterministic cost-proxy estimate (W008 unit table, no premium). */
  readonly costProxy: number;
  /** Candidate budget ceiling (maxTotalCost) when declared. */
  readonly budgetCeiling?: number;
  /** Observed actual cost from the outcome, when present. */
  readonly actualCost?: number;
}

/** The outcome join record (append-only, tenant-scoped). */
export interface OutcomeJoinRecord extends TenantScopedRecord {
  readonly outcomeId: string;
  readonly observation: OutcomeObservation;
  // --- context (from the lab evaluation) ---
  readonly evaluationId: string;
  readonly goalId?: string;
  readonly fingerprintDigest: string;
  readonly fingerprintAxes: ContextFingerprint["axes"];
  readonly contextClass: ContextClass;
  readonly constraintSet: LabConstraintSet;
  readonly weights: ScoringWeights;
  readonly modifiers: ContextModifiers;
  readonly rankingRule: string;
  readonly rankAtEvaluation: number;
  readonly weightedScoreAtEvaluation: number;
  // --- organization (from the W005 candidate) ---
  readonly candidateId: string;
  readonly strategy?: SearchStrategy;
  readonly shape: OrganizationShape;
  // --- the remaining join dimensions (from the candidate value) ---
  readonly allocation: AllocationJoin;
  readonly occupancy: OccupancyJoin;
  readonly informationStrategy: InformationStrategyJoin;
  readonly environments: readonly string[];
  readonly cost: CostJoin;
  readonly evidenceRefs: readonly SubjectReference[];
  readonly provenance: ProvenanceRecord;
  readonly recordedAt: DomainTimestamp;
}

/** Filter for outcome listing (all fields optional, AND-combined). */
export interface OutcomeFilter {
  readonly goalId?: string;
  readonly candidateId?: string;
  readonly contextClassKey?: string;
  readonly shapeKey?: string;
}

/**
 * Conditional evidence (the LEARNED value): aggregated outcome performance
 * of one organization shape under one context class. Never a global
 * ranking — every field is scoped to (context class, shape). Freshness is
 * classified AT CONSUMPTION TIME (a record that was current yesterday is
 * stale today — the caller's `now` governs; nothing is frozen at record
 * time), so stale evidence stays visible instead of silently persisting as
 * fresh.
 */
export interface ConditionalEvidence {
  readonly contextClass: ContextClass;
  readonly shapeKey: string;
  readonly shapeCanonical: string;
  readonly sampleCount: number;
  readonly achievedCount: number;
  readonly partialCount: number;
  /** missed + failed outcomes (first-class: counted, never discarded). */
  readonly failedCount: number;
  /** achieved / sample, rounded to 4 decimals. */
  readonly achievedRate: number;
  /** Bounded score adjustment (see CALIBRATION_LIMITS). */
  readonly adjustment: number;
  /** Freshness class of the most recent contributing observation. */
  readonly evidenceFreshness: FreshnessClass;
  /** Contributing outcomes classified stale or unknown at consumption time. */
  readonly staleSampleCount: number;
  /** Contributing outcome ids (the evidence chain — failures included). */
  readonly outcomeIds: readonly string[];
  readonly lastObservedAt?: DomainTimestamp;
}

/** One ranked organization after conditional calibration. */
export interface CalibratedOrganization {
  /** Rank in the base (W008) search — the uncalibrated ordering. */
  readonly baseRank: number;
  /** Rank after calibration (deterministic: adjusted score desc, id asc). */
  readonly calibratedRank: number;
  readonly strategy: SearchStrategy;
  readonly candidate: OrganizationSearchResult["ranked"][number]["candidate"];
  /** The base harness score, verbatim (inspectability: what was adjusted). */
  readonly score: CandidateScore;
  readonly bindingConstraints: readonly BindingConstraint[];
  /** Weighted score x (1 + adjustment), rounded to 4 decimals. */
  readonly adjustedScore: number;
  /** The applied adjustment (0 when no evidence exists for this pair). */
  readonly adjustment: number;
  /** The conditional evidence behind the adjustment (null = none). */
  readonly evidence: ConditionalEvidence | null;
}

/**
 * The calibrated search result: the W008 search extended with conditional
 * evidence. The base ranking rule is PRESERVED VERBATIM (P003 join key);
 * the calibration rule is recorded separately. Evidence coverage is
 * explicit — an uncalibrated ranking is honest about having no evidence.
 */
export interface CalibratedSearchResult {
  readonly goalId?: string;
  readonly fingerprintDigest: string;
  readonly fingerprintAxes: ContextFingerprint["axes"];
  readonly constraints: LabConstraintSet;
  readonly weights: ScoringWeights;
  readonly modifiers: ContextModifiers;
  /** The base W008 ranking rule, verbatim (never rewritten). */
  readonly rankingRule: string;
  /** The conditional calibration rule applied on top. */
  readonly calibrationRule: string;
  /** The conditioning class of this search (visible, not implied). */
  readonly contextClass: ContextClass;
  /** How many ranked organizations had matching conditional evidence. */
  readonly evidenceCoverage: { readonly matched: number; readonly total: number };
  readonly ranked: readonly CalibratedOrganization[];
  readonly excluded: readonly ExcludedBlueprint[];
  readonly poolSummary: readonly PoolSummaryEntry[];
  readonly evaluatedAt: DomainTimestamp;
}
