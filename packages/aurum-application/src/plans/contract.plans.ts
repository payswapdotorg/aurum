/**
 * Plans area public surface (W009): the ExecutionPlan + task DAG +
 * information handoff + escalation + recovery contracts. The plan is
 * SEMANTIC TRUTH (catalog: "plan remains Aurum truth while ZCode workflow
 * is execution substrate"); the W006 execution session is a substrate
 * projection that references plan tasks, never the reverse.
 *
 * Cross-module consumption:
 * - `@aurum/domain` is imported ONLY through its public package entrypoint;
 *   the W005 `OrganizationCandidate` / `ActorAssignment` /
 *   `CapabilityAllocation` vocabulary is the frozen resource-side contract
 *   the plan references BY ID, never copies.
 * - There is NO `@aurum/execution` or `@zcode/shared` import anywhere in
 *   `src/plans/domain/**` (truth-law tripwire:
 *   `test/plans-truth-law.test.ts`). The execution-substrate port
 *   (`ExecutionSubstratePort`) is a LOCAL re-declaration of the W006
 *   `AgentGateway` surface — structurally compatible, wired through a
 *   thin pass-through adapter once CR-W009 lands.
 *
 * Plan approval is human-gated through the W002 action authority
 * (`PlanApprovalAuthority` port — structurally compatible with the
 * kernel's `ActionAuthority`). The plan's lifecycle transitions are
 * audit-cited (the `PlanAuditPort` port — structurally compatible with the
 * kernel's `AuditTrailStore`).
 */
// --- typed errors + Result (domain) ---
export { PlanError, isPlanError } from "./domain/errors.js";
export type { PlanErrorCode } from "./domain/errors.js";
export {
  planAllocationRefused,
  planCycle,
  planHandoffDivergent,
  planInvariant,
  planLifecycleIllegal,
  planNotFound,
  planSubjectNotFound,
  planUnauthorized,
  planValidationError,
} from "./domain/errors.js";

// --- vocabulary (domain) ---
export {
  ESCALATION_DECISIONS,
  ESCALATION_TRIGGERS,
  HANDOFF_DELIVERY_OUTCOMES,
  PLAN_APPROVAL_STATES,
  PLAN_ENVIRONMENT_CLASSES,
  PLAN_LIFECYCLE_STATES,
  PLAN_TASK_KINDS,
  isKnownEscalationDecision,
  isKnownEscalationTrigger,
  isKnownHandoffDeliveryOutcome,
  isKnownPlanApprovalState,
  isKnownPlanEnvironmentClass,
  isKnownPlanLifecycleState,
  isKnownPlanTaskKind,
  planApprovalTransitionLegal,
  taskAuthorityRequirementIssues,
} from "./domain/vocabulary.js";
export type {
  EscalationDecision,
  EscalationTrigger,
  HandoffDeliveryOutcome,
  PlanApprovalState,
  PlanEnvironmentClass,
  PlanLifecycleState,
  PlanTaskKind,
  TaskAuthorityRequirement,
} from "./domain/vocabulary.js";

// --- records (domain) ---
export type {
  EscalationRecord,
  ExecutionPlan,
  HandoffDeliveryResult,
  HandoffDescriptor,
  HandoffPayload,
  PlanApprovalCitation,
  PlanApprovalTransition,
  PlanLifecycleTransition,
  PlanTask,
  TaskCompletionRecord,
  TaskDag,
  TaskResourceAllocation,
} from "./domain/records.js";

// --- DAG construction + inspection (domain) ---
export {
  buildTaskDag,
  criticalPath,
  detectCycle,
  downstreamOf,
  readyTasks,
  taskDagIssues,
  topologicalOrder,
  upstreamOf,
} from "./domain/dag.js";

// --- relay (domain) ---
export {
  buildHandoffPayload,
  deliverHandoffIdempotent,
  executorAuthorityIssues,
  handoffDescriptorIssues,
  handoffPayloadsIdentical,
} from "./domain/relay.js";

// --- escalation (domain) ---
export {
  DEFAULT_ESCALATION_DECISIONS,
  buildDeadlineExceededEscalation,
  buildDependencyFailedEscalation,
  buildTaskFailedEscalation,
  escalationInputIssues,
  nextAttemptNumber,
} from "./domain/escalation.js";

// --- ports (domain) ---
export type {
  EscalationStore,
  ExecutionSubstratePort,
  HandoffRelayStore,
  PlanApprovalAuthority,
  PlanAuditPort,
  PlanCandidateViews,
  PlanGoalViews,
  PlanServiceDeps,
  PlanStore,
  TaskCompletionStore,
  TaskSettlementEcho,
} from "./domain/ports.js";

// --- app service (app) ---
export { createPlanService } from "./app/planService.js";
export type {
  CreatePlanInput,
  DispatchTaskInput,
  IssueHandoffInput,
  PlanApprovalInput,
  PlanLifecycleInput,
  PlanService,
} from "./app/inputs.js";

// --- reference adapters (adapters) ---
export { createInMemoryPlanStore, InMemoryPlanStore } from "./adapters/in-memory-plan-store.js";
export {
  createInMemoryHandoffRelayStore,
  InMemoryHandoffRelayStore,
} from "./adapters/in-memory-handoff-store.js";
export {
  createInMemoryTaskCompletionStore,
  InMemoryTaskCompletionStore,
} from "./adapters/in-memory-completion-store.js";
export {
  createInMemoryEscalationStore,
  InMemoryEscalationStore,
} from "./adapters/in-memory-escalation-store.js";
export {
  cancelledScript,
  createInProcessExecutionSubstrate,
  failedScript,
  InProcessExecutionSubstrate,
  settledScript,
} from "./adapters/in-process-substrate.js";
export type { InProcessSubstrateConfig, SubstrateScript } from "./adapters/in-process-substrate.js";
