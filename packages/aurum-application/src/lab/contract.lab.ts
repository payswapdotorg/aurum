/**
 * Lab area public surface (W008): the Organizational Lab core — context
 * fingerprints, mixed organization search, constrained allocation and the
 * evaluation/ranking harness. The Lab evaluates/recommends; it does not
 * authorize, install, activate or execute (spec/REBUILD-CONSTITUTION.md).
 *
 * Cross-module consumption: @aurum/domain is imported ONLY through its
 * public package entrypoint; agent bodies and model bindings stay opaque
 * references (the provider/agent plane owns those registries). No
 * aurum-execution import exists anywhere in the lab module (tripwire).
 */
export { LabError, isLabError } from "./domain/errors.js";
export type { LabErrorCode } from "./domain/errors.js";

export {
  GOAL_PRESSURE_CLASSES,
  TIME_HORIZON_CLASSES,
  UNCERTAINTY_CLASSES,
  FRESHNESS_SIGNALS,
  canonicalFingerprint,
  contextFingerprint,
  fingerprintDigest,
  fingerprintIssues,
} from "./domain/fingerprint.js";
export type {
  CapabilityDemand,
  ContextFingerprint,
  FingerprintInput,
  FreshnessSignal,
  GoalPressureClass,
  TimeHorizonClass,
  UncertaintyClass,
} from "./domain/fingerprint.js";

export {
  SCORING_CRITERIA,
  contextModifiersForFingerprint,
  weightsForFingerprint,
} from "./domain/weights.js";
export type { ContextModifiers, ScoringCriterion, ScoringWeights } from "./domain/weights.js";

export {
  COST_PROXY_UNITS,
  DEFAULT_ALLOCATION_LIMITS,
  bindingConstraintsOf,
  constraintSetIssues,
  costProxyOf,
  defaultReferenceBudget,
} from "./domain/constraints.js";
export type {
  AllocationLimits,
  BindingConstraint,
  LabConstraintSet,
} from "./domain/constraints.js";

export {
  RANKING_RULE,
  capacityHeadroomOf,
  costProxyOfCandidate,
  coverageFitOf,
  effectiveLevelOf,
  occupancyRealismOf,
  rankCandidates,
  scoreCandidate,
} from "./domain/evaluation.js";
export type {
  CandidateScore,
  EvaluationContext,
  RankableCandidate,
  ScoredCriteria,
} from "./domain/evaluation.js";

export { limitsOf, synthesizeAllocation } from "./domain/allocation.js";
export type {
  AllocationDirective,
  AllocationDirectives,
  AllocationSynthesis,
  AssignmentDirective,
} from "./domain/allocation.js";

export { SEARCH_STRATEGIES, isKnownSearchStrategy } from "./domain/records.js";
export type {
  EvaluateOrganizationsInput,
  ExcludedBlueprint,
  FingerprintSituationInput,
  LabEvaluationRecord,
  OrganizationSearchResult,
  PoolSummaryEntry,
  RankedOrganization,
  SearchOrganizationsInput,
  SearchStrategy,
  SituationTrace,
} from "./domain/records.js";

export type {
  EvaluationFilter,
  LabDomainViews,
  LabEvaluationStore,
  OrganizationalLabDeps,
} from "./domain/ports.js";

export { assembleSituation } from "./app/situation.js";
export { createOrganizationalLab, makeFingerprint } from "./app/labService.js";
export type { OrganizationalLab } from "./app/labService.js";
export { normalizeStrategies, resolveConstraintSet, verifyFingerprint } from "./app/search.js";
export { createInMemoryEvaluationStore } from "./adapters/in-memory-evaluation-store.js";
