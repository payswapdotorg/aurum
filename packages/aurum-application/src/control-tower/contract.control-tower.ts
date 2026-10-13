/**
 * Control-tower area public surface (W010): the management control tower +
 * conversation experience — a READ-ONLY projection of the four public areas
 * (company W004, cognition W007, lab W008, plans W009) plus 1:1 action
 * delegation to those areas' own service methods. The tower adds ZERO
 * semantic authority: no kernel handle, no new command path, no second
 * error namespace (catalog W010 clauses 2+3; tripwires in
 * test/control-tower-contract-hygiene.test.ts).
 *
 * Cross-module consumption: `@aurum/domain` is imported ONLY through its
 * public package entrypoint (vocabulary types; never the kernel factory or
 * store handles). The sibling areas are consumed through their contract
 * files (the intra-package public surfaces composed by src/contract.ts).
 */
// --- typed errors (domain) ---
export { isControlTowerError, towerValidationError } from "./domain/errors.js";
export type { ControlTowerError, TowerValidationIssue } from "./domain/errors.js";

// --- tenant scope + input vocabulary (from the domain package entrypoint) ---
// The tower's consumers (web/desktop variants mounting the canonical local
// composition) construct a session scope, an operator reference and
// timestamps before any call; re-exporting the domain's VALIDATING
// factories keeps their import list to THIS contract only (the composition
// ruling in APPROACH.md R3) and avoids raw brand casts at the surface.
export { domainTime, personId, tenantScope } from "@aurum/domain";
export type { DomainTimestamp, PersonId, TenantScope } from "@aurum/domain";

// --- view-model record types (domain) ---
export type {
  ControlTowerOverview,
  ConversationRole,
  ConversationTopic,
  ConversationTurn,
  ConversationTurnKind,
  ConversationViewModel,
  GoalTowerCard,
  LabEvaluationSummary,
  LabTowerSummary,
  MissionTowerCard,
  PendingApproval,
  PlanTowerCard,
} from "./domain/records.js";

// --- pure derivations (domain) ---
export {
  goalCardsOf,
  labSummaryOf,
  missionCardsOf,
  pendingApprovalsOf,
  planCardsOf,
} from "./domain/overview.js";
export type { PlanEscalationCounts, PlanReadinessCounts } from "./domain/overview.js";
export { missionConversationOf, planConversationOf } from "./domain/conversation.js";

// --- ports (domain) ---
export type {
  ControlTowerDeps,
  ControlTowerService,
  CreateMissionInput,
  CreatePlanInput,
  DispatchTaskInput,
  PlanApprovalInput,
  PlanLifecycleInput,
  TowerReadInput,
} from "./domain/ports.js";

// --- service (app) ---
export { createControlTowerService } from "./app/towerService.js";

// --- reference adapters (adapters) ---
export { createLocalControlTowerRuntime, createUnwiredReasoner } from "./adapters/local-runtime.js";
export type {
  LocalControlTowerRuntime,
  LocalControlTowerRuntimeOptions,
  LocalTowerStoreInjection,
} from "./adapters/local-runtime.js";
export {
  createLocalPlanAuditPort,
  kernelApprovalAuthority,
  kernelCandidateViews,
  kernelGoalViews,
  kernelPlanWiring,
} from "./adapters/kernel-plan-wiring.js";
