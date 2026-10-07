/**
 * workforce area public surface (W005).
 */
export {
  EMPLOYMENT_IMPACTING_ADJUSTMENTS,
  WORKFORCE_ADJUSTMENTS,
  WORKFORCE_DECISION_STATES,
  WORK_ASSIGNMENT_STATUSES,
  WORK_OUTCOME_RESULTS,
  isInherentlyEmploymentImpacting,
  isKnownWorkforceAdjustment,
  isKnownWorkOutcomeResult,
} from "./records.js";
export type {
  AlternativeExplanationRecord,
  CapacityBounds,
  CapacityDeclarationRecord,
  WorkAssignmentRecord,
  WorkAssignmentStatus,
  WorkOutcomeRecord,
  WorkOutcomeResult,
  WorkforceAdjustmentKind,
  WorkforceDecision,
  WorkforceDecisionState,
  WorkforceRecommendationRecord,
  WorkforceRoleRecord,
  WorkloadObservationRecord,
} from "./records.js";
export { summarizeWorkload } from "./workload.js";
export type { WorkloadSummary } from "./workload.js";
export { createWorkforceDirectory } from "./workforceStore.js";
export { createWorkforceInsights } from "./insightsStore.js";
export { createWorkforceRecommendations } from "./recommendationStore.js";
export type {
  AssignmentFilter,
  DecideRecommendationInput,
  DeclareCapacityInput,
  EndAssignmentInput,
  ExplanationFilter,
  OutcomeFilter,
  ProposeRecommendationInput,
  RecordAlternativeExplanationInput,
  RecordAssignmentInput,
  RecordOutcomeInput,
  RecordWorkloadObservationInput,
  RecommendationFilter,
  RegisterRoleInput,
  WorkforceDirectory,
  WorkforceInsights,
  WorkforceRecommendations,
  WorkloadObservationFilter,
} from "./ports.js";
