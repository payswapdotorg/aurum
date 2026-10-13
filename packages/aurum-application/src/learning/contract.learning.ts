/**
 * Learning area public surface (W013): outcome learning + conditional
 * organizations. Joins observed outcomes to the full conditioning context
 * (lab evaluation, organization candidate, actor allocation, model
 * occupancy, information strategy, environment, cost) and calibrates the
 * W008 search CONDITIONALLY — per (context class x organization shape),
 * never a universal best organization. The learning area proposes and
 * calibrates; it does not authorize, install, activate or execute (the
 * W008 tripwire law extends here unchanged).
 *
 * Cross-area consumption (the control-tower precedent): the lab surface is
 * imported through its AREA CONTRACT (`../lab/contract.lab.js` — the same
 * public boundary the package contract re-exports), the mission/plan types
 * through their area contracts, and `@aurum/domain` ONLY through its
 * public package entrypoint. No `@aurum/execution` import exists anywhere
 * in the learning module (tripwire: test/learning-contract-hygiene.test.ts).
 */
// --- typed errors (domain) ---
export { LearningError, isLearningError } from "./domain/errors.js";
export type { LearningErrorCode } from "./domain/errors.js";
export {
  learningConflict,
  learningInvariant,
  learningJoinAnchorNotFound,
  learningJoinRefused,
  learningNotFound,
  learningValidationError,
} from "./domain/errors.js";

// --- vocabulary (domain) ---
export {
  CALIBRATION_LIMITS,
  CONDITIONAL_RANKING_RULE,
  OUTCOME_SOURCE_KINDS,
  OUTCOME_STATUSES,
  isFailedOutcomeStatus,
  isKnownOutcomeSourceKind,
  isKnownOutcomeStatus,
} from "./domain/vocabulary.js";
export type { OutcomeSourceKind, OutcomeStatus } from "./domain/vocabulary.js";

// --- context class (domain) ---
export { canonicalContextClass, contextAxesIssues, contextClassOf } from "./domain/contextClass.js";
export type { ContextClass, ContextClassAxes } from "./domain/contextClass.js";

// --- organization shape (domain) ---
export { AUTOMATION_CLASSES, organizationShapeOf } from "./domain/shape.js";
export type { AutomationClass, OrganizationShape } from "./domain/shape.js";

// --- records (domain) ---
export type {
  AllocationJoin,
  CalibratedOrganization,
  CalibratedSearchResult,
  ConditionalEvidence,
  CostJoin,
  InformationStrategyJoin,
  OccupancyJoin,
  OutcomeFilter,
  OutcomeJoinRecord,
  OutcomeObservation,
  RecordOutcomeInput,
} from "./domain/records.js";

// --- calibration (domain, pure) ---
export {
  applyConditionalCalibration,
  calibrateEvidence,
  outcomeFreshnessOf,
} from "./domain/calibration.js";

// --- ports (domain) ---
export type {
  LearningCandidateViews,
  LearningEvaluationViews,
  OutcomeLearningDeps,
  OutcomeStore,
} from "./domain/ports.js";

// --- join assembly + service (app) ---
export { assembleOutcomeJoin } from "./app/outcomeJoin.js";
export type { OutcomeJoinViews } from "./app/outcomeJoin.js";
export { createOutcomeLearning, mapLabError } from "./app/learningService.js";
export type { ConditionalEvidenceQuery, OutcomeLearning } from "./app/learningService.js";

// --- reference adapters (adapters) ---
export { createInMemoryOutcomeStore } from "./adapters/in-memory-outcome-store.js";
export { missionOutcomeObservation } from "./adapters/mission-outcome-source.js";
export { planOutcomeObservation } from "./adapters/plan-outcome-source.js";
