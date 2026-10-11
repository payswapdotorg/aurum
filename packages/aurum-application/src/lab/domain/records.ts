/**
 * Lab record types (W008 domain layer): the shapes of what the Lab produces
 * and retains. The Lab evaluates/recommends — it never authorizes, installs,
 * activates or executes (AGENTS.md). These records are the lab's OWN
 * in-memory state (P003 will add storage ports under src/lab/storage/);
 * nothing here mutates domain state.
 */
import type {
  ActorReference,
  DomainTimestamp,
  OrganizationCandidate,
  ProvenanceRecord,
  SubjectReference,
  TenantScopedRecord,
} from "@aurum/domain";
import type { ContextFingerprint } from "./fingerprint.js";
import type { BindingConstraint, LabConstraintSet } from "./constraints.js";
import type { CandidateScore } from "./evaluation.js";
import type { ContextModifiers, ScoringWeights } from "./weights.js";

/** Composition strategies the mixed search enumerates (frozen list). */
export const SEARCH_STRATEGIES = [
  "human-led",
  "agent-led",
  "software-led",
  "external",
  "minimal",
  "balanced",
] as const;

export type SearchStrategy = (typeof SEARCH_STRATEGIES)[number];

export function isKnownSearchStrategy(value: string): value is SearchStrategy {
  return (SEARCH_STRATEGIES as readonly string[]).includes(value);
}

/**
 * One ranked candidate organization produced by the search: the full
 * OrganizationCandidate VALUE (validated with the W005 deep validator),
 * its score, rank, and which constraints bound it.
 */
export interface RankedOrganization {
  readonly rank: number;
  readonly strategy: SearchStrategy;
  readonly candidate: OrganizationCandidate;
  readonly score: CandidateScore;
  /** Constraints of the applied set that actually bound this organization. */
  readonly bindingConstraints: readonly BindingConstraint[];
}

/** A blueprint excluded from ranking, with the reason (inspectability). */
export interface ExcludedBlueprint {
  readonly strategy: SearchStrategy;
  readonly reason: string;
  /** W005 deep-validation issues when the blueprint failed shape validation. */
  readonly issues: readonly { field: string; problem: string }[];
}

/** The mixed-organization search result (everything inspectable). */
export interface OrganizationSearchResult {
  readonly goalId?: string;
  readonly fingerprintDigest: string;
  readonly fingerprintAxes: ContextFingerprint["axes"];
  /** The exact constraint set applied (catalog clause 3). */
  readonly constraints: LabConstraintSet;
  /** The exact weights + context modifiers applied. */
  readonly weights: ScoringWeights;
  readonly modifiers: ContextModifiers;
  readonly rankingRule: string;
  readonly ranked: readonly RankedOrganization[];
  readonly excluded: readonly ExcludedBlueprint[];
  /** The mixed pool the search considered (per capability, per supplier kind). */
  readonly poolSummary: readonly PoolSummaryEntry[];
  readonly evaluatedAt: DomainTimestamp;
}

/** One capability's mixed-pool slice (joint-consideration evidence). */
export interface PoolSummaryEntry {
  readonly capabilityId: string;
  readonly requiredLevel: number;
  readonly requiredCapacityPerPeriod?: number;
  /** Distinct supplier kinds offering this capability (human/agent/software...). */
  readonly supplierKinds: readonly string[];
  readonly eligibleSupplyCount: number;
}

/**
 * The lab evaluation record — the lab's own append-only evidence. Carries
 * the outcome-learning join keys verbatim (spec P003: fingerprintDigest,
 * constraint set, weights, ranking rule must survive round-trips).
 */
export interface LabEvaluationRecord extends TenantScopedRecord {
  readonly evaluationId: string;
  readonly goalId?: string;
  readonly fingerprintDigest: string;
  readonly fingerprintAxes: ContextFingerprint["axes"];
  readonly constraintSet: LabConstraintSet;
  readonly weights: ScoringWeights;
  readonly modifiers: ContextModifiers;
  readonly rankingRule: string;
  readonly ranked: readonly {
    readonly rank: number;
    readonly candidateId: string;
    /** Present for search-produced rankings; omitted for external candidates. */
    readonly strategy?: SearchStrategy;
    readonly weightedScore: number;
    readonly criteria: CandidateScore["criteria"];
    readonly bindingConstraints: readonly BindingConstraint[];
  }[];
  readonly createdAt: DomainTimestamp;
}

/** Search input for the lab service (app layer assembles the pool). */
export interface SearchOrganizationsInput {
  readonly goalId?: string;
  readonly fingerprint: ContextFingerprint;
  /** Partial constraint set; demand comes from the fingerprint profile. */
  readonly constraints?: Partial<Omit<LabConstraintSet, "capabilityDemand">>;
  /** Strategies to enumerate; defaults to all. */
  readonly strategies?: readonly string[];
  readonly proposedBy: ActorReference;
  readonly provenance: ProvenanceRecord;
  /** Defaults to a subject reference when a goalId is given. */
  readonly evidenceRefs?: readonly SubjectReference[];
  readonly now: DomainTimestamp;
}

/** Input for the standalone evaluation harness. */
export interface EvaluateOrganizationsInput {
  readonly goalId?: string;
  readonly fingerprint: ContextFingerprint;
  readonly constraints?: Partial<Omit<LabConstraintSet, "capabilityDemand">>;
  /** Candidate organizations to score and rank (values, not registry ids). */
  readonly candidates: readonly OrganizationCandidate[];
  readonly now: DomainTimestamp;
}

/** Fingerprint derivation input (app layer reads the seams). */
export interface FingerprintSituationInput {
  readonly goalId: string;
  readonly now: DomainTimestamp;
}

/** The situation snapshot enriched with where each value came from. */
export interface SituationTrace {
  readonly goalId: string;
  readonly goalRevision: number;
  readonly openUnknownIds: readonly string[];
  readonly openContradictionIds: readonly string[];
  readonly supplyFreshness: readonly { supplyId: string; freshness: string }[];
  readonly requirementIds: readonly string[];
}
