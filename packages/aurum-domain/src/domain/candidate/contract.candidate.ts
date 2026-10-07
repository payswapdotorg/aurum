/**
 * candidate area public surface (W005): the frozen shared organizational
 * vocabulary — OrganizationCandidate, ActorAssignment, CapabilityAllocation,
 * contextual constraint shapes — plus the registry.
 */
export {
  CANDIDATE_ACTOR_KINDS,
  candidateActorIssues,
  isKnownCandidateActorKind,
  modelOccupancyIssues,
} from "./actors.js";
export type { CandidateActor, CandidateActorKind, ModelOccupancy } from "./actors.js";
export { actorAssignmentIssues, capabilityAllocationIssues } from "./allocations.js";
export type { ActorAssignment, CapabilityAllocation } from "./allocations.js";
export {
  TOPOLOGY_EDGE_KINDS,
  executionTopologyIssues,
  informationTopologyIssues,
  isKnownTopologyEdgeKind,
} from "./topology.js";
export type {
  ExecutionStep,
  ExecutionTopology,
  InformationFlow,
  InformationTopology,
  TopologyEdge,
  TopologyEdgeKind,
} from "./topology.js";
export {
  INSPECTION_INTENSITIES,
  RISK_TOLERANCES,
  contextualConstraintIssues,
} from "./constraints.js";
export type {
  BudgetConstraint,
  ContextualConstraints,
  EvidenceFreshnessConstraint,
  InspectionIntensity,
  QualityConstraints,
  RiskTolerance,
  SlaConstraints,
  StaffingBounds,
} from "./constraints.js";
export {
  CANDIDATE_RISK_KINDS,
  CANDIDATE_RISK_SEVERITIES,
  organizationCandidateIssues,
} from "./records.js";
export type {
  CandidateBudget,
  CandidateRisk,
  CandidateRiskKind,
  CandidateRiskSeverity,
  EnvironmentRef,
  ExpectedOutcome,
  OrganizationCandidate,
} from "./records.js";
export { createCandidateRegistry } from "./candidateStore.js";
export type {
  ActorAssignmentInput,
  CandidateActorInput,
  CapabilityAllocationInput,
  OrganizationCandidateRegistry,
  RegisterCandidateInput,
} from "./ports.js";
