/**
 * Plan service input types + service interface (W009 app layer).
 *
 * Extracted from `planService.ts` so the service file stays under the
 * 400-line architecture-policy limit. These are the PUBLIC input shapes
 * consumers pass to the plan service.
 */
import type { ActorReference, DomainTimestamp, PersonId, Result, TenantScope } from "@aurum/domain";
import type { PlanError } from "../domain/errors.js";
import type {
  ExecutionPlan,
  HandoffPayload,
  PlanTask,
  TaskCompletionRecord,
} from "../domain/records.js";
import type { EscalationRecord } from "../domain/records.js";
import type { TaskSettlementEcho } from "../domain/ports.js";
import type { ProvenanceRecord, SubjectReference } from "@aurum/domain";

/** Input for plan creation (the caller's plain-data proposal). */
export interface CreatePlanInput {
  readonly planId?: string;
  readonly goalId?: string;
  readonly candidateId: string;
  readonly tasks: readonly PlanTask[];
  readonly createdBy: ActorReference;
  readonly provenance: ProvenanceRecord;
  readonly evidenceRefs: readonly SubjectReference[];
  readonly now: DomainTimestamp;
}

/** Input for the approval transition (submit / approve / reject). */
export interface PlanApprovalInput {
  readonly planId: string;
  readonly actor: ActorReference;
  readonly reason: string;
  readonly now: DomainTimestamp;
  /** Required for the approve transition (human decision). */
  readonly humanDecision?: { readonly decidedBy: PersonId; readonly decidedAt: DomainTimestamp };
  /** Required for approve; the W002 action authority citation. */
  readonly citation?: { readonly actionId?: string; readonly auditRef?: string };
  /** Required for reject; the rejection reason. */
  readonly rejectionReason?: string;
}

/** Input for the lifecycle transition (activate / complete / cancel). */
export interface PlanLifecycleInput {
  readonly planId: string;
  readonly actor: ActorReference;
  readonly reason: string;
  readonly now: DomainTimestamp;
  /** The audit ref recording the transition (caller pre-records the audit). */
  readonly auditRef: string;
}

/** Input for handoff issuance (the relay). */
export interface IssueHandoffInput {
  readonly planId: string;
  readonly producingTaskId: string;
  readonly consumingTaskId: string;
  readonly handoffId: string;
  readonly producingSettlement: TaskSettlementEcho;
  readonly payload: string;
  readonly now: DomainTimestamp;
}

/** Input for task dispatch through the execution substrate. */
export interface DispatchTaskInput {
  readonly planId: string;
  readonly taskId: string;
  readonly authority: { readonly actionId?: string; readonly auditRef?: string };
  readonly now: DomainTimestamp;
  readonly payload?: string;
  readonly payloadMediaType?: string;
}

/**
 * The public Plan service surface (12 methods; policy limit is 12).
 * Catalog clause 5: create/draft, submit, approve/reject (human-only),
 * activate, get/list, readiness, handoff issuance + delivery, dispatch,
 * escalation listing.
 */
export interface PlanService {
  createPlan(scope: TenantScope, input: CreatePlanInput): Result<ExecutionPlan, PlanError>;
  submitForApproval(scope: TenantScope, input: PlanApprovalInput): Result<ExecutionPlan, PlanError>;
  approvePlan(scope: TenantScope, input: PlanApprovalInput): Result<ExecutionPlan, PlanError>;
  rejectPlan(scope: TenantScope, input: PlanApprovalInput): Result<ExecutionPlan, PlanError>;
  activatePlan(scope: TenantScope, input: PlanLifecycleInput): Result<ExecutionPlan, PlanError>;
  completePlan(scope: TenantScope, input: PlanLifecycleInput): Result<ExecutionPlan, PlanError>;
  cancelPlan(scope: TenantScope, input: PlanLifecycleInput): Result<ExecutionPlan, PlanError>;
  getPlan(scope: TenantScope, planId: string): Result<ExecutionPlan, PlanError>;
  listPlans(scope: TenantScope): readonly ExecutionPlan[];
  /** Readiness query: which tasks are ready to dispatch (catalog clause 2). */
  readyTasks(scope: TenantScope, planId: string): Result<readonly string[], PlanError>;
  /** Handoff issuance + idempotent delivery (the relay, catalog clause 3). */
  issueHandoff(scope: TenantScope, input: IssueHandoffInput): Result<HandoffPayload, PlanError>;
  /** Dispatch a ready task to the W006 execution substrate (catalog clause 5). */
  dispatchTask(
    scope: TenantScope,
    input: DispatchTaskInput,
  ): Promise<Result<TaskCompletionRecord, PlanError>>;
  /** Escalation listing (catalog clause 4). */
  listEscalations(
    scope: TenantScope,
    planId: string,
  ): Result<readonly EscalationRecord[], PlanError>;
}
