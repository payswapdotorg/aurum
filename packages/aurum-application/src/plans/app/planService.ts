/**
 * The Plan service (W009 app layer) — the facade that composes plan
 * construction, approval gate, activation, handoff issuance + delivery (the
 * relay), task dispatch through the execution substrate, settlement mapping,
 * and escalation.
 *
 * In-memory state machine (house pattern — persistence is the TL-tracked
 * P-series debt; no IO here). The plan service delegates:
 * - W005 validation (candidate / actor assignment / capability allocation
 *   references) to the `PlanCandidateViews` port;
 * - W002 approval (human-gated) to the `PlanApprovalAuthority` port;
 * - W002 audit (lifecycle transitions) to the `PlanAuditPort` port;
 * - W006 execution substrate to the `ExecutionSubstratePort`;
 * - own state (plans, handoffs, completions, escalations) to the
 *   in-memory stores (P-series debt for PostgreSQL storage).
 *
 * PLAN-IS-TRUTH LAW: the plan service NEVER stores execution-session ids on
 * plan records. The settlement reference is carried on `TaskCompletionRecord`
 * and `HandoffPayload` (relay-side records) — never on `ExecutionPlan`.
 *
 * Catalog: "PlanService: create/draft plan (validates DAG + allocations
 * against W005 validators), submit for approval, approve/reject (human-only),
 * activate, get/list plans per tenant, readiness queries, handoff issuance +
 * delivery (the relay), escalation listing".
 *
 * 9 methods (policy limit is 12).
 */
import {
  err,
  ok,
  type ActorReference,
  type DomainTimestamp,
  type PersonId,
  type ProvenanceRecord,
  type Result,
  type SubjectReference,
  type TenantScope,
} from "@aurum/domain";
import {
  organizationCandidateIssues,
  provenanceIssues,
  type ActorAssignment,
  type CapabilityAllocation,
  type GoalRecord,
  type OrganizationCandidate,
  type OrganizationCandidateId,
} from "@aurum/domain";
import {
  planAllocationRefused,
  planLifecycleIllegal,
  planNotFound,
  planSubjectNotFound,
  planUnauthorized,
  planValidationError,
  type PlanError,
} from "../domain/errors.js";
import {
  planApprovalTransitionLegal,
  type PlanApprovalState,
} from "../domain/vocabulary.js";
import { buildTaskDag, readyTasks, topologicalOrder } from "../domain/dag.js";
import {
  buildHandoffPayload,
  deliverHandoffIdempotent,
  executorAuthorityIssues,
  handoffDescriptorIssues,
} from "../domain/relay.js";
import {
  buildDeadlineExceededEscalation,
  buildDependencyFailedEscalation,
  buildTaskFailedEscalation,
} from "../domain/escalation.js";
import type { HandoffPayload, TaskCompletionRecord } from "../domain/records.js";
import type { ExecutionPlan, PlanTask } from "../domain/records.js";
import type {
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
} from "../domain/ports.js";

let planCounter = 0;
let handoffCounter = 0;
let escalationCounter = 0;

function nextPlanId(): string {
  planCounter += 1;
  return `plan-${planCounter}`;
}

function nextHandoffId(): string {
  // Handoff ids are caller-supplied on descriptors; this counter is for
  // internal delivery tracking only and is not exposed in the public API.
  handoffCounter += 1;
  return `h-${handoffCounter}`;
}

function nextEscalationId(): string {
  escalationCounter += 1;
  return `esc-${escalationCounter}`;
}

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

/** The public Plan service surface (9 methods; policy limit is 12). */
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
  readyTasks(
    scope: TenantScope,
    planId: string,
  ): Result<readonly string[], PlanError>;
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
  ): Result<readonly import("../domain/records.js").EscalationRecord[], PlanError>;
}

/** Builds the Plan service over its ports. */
export function createPlanService(deps: PlanServiceDeps): PlanService {
  const goals: PlanGoalViews = deps.goals;
  const candidates: PlanCandidateViews = deps.candidates;
  const approval: PlanApprovalAuthority = deps.approval;
  const audit: PlanAuditPort = deps.audit;
  const substrate: ExecutionSubstratePort = deps.substrate;
  const plans: PlanStore = deps.plans;
  const handoffs: HandoffRelayStore = deps.handoffs;
  const completions: TaskCompletionStore = deps.completions;
  const escalations: EscalationStore = deps.escalations;

  function validatePlanConstruction(
    scope: TenantScope,
    input: CreatePlanInput,
  ): Result<{ candidate: OrganizationCandidate; dag: ExecutionPlan["taskDag"] }, PlanError> {
    // Provenance sanity (mirrors the lab pattern).
    const provIssues = provenanceIssues(input.provenance as ProvenanceRecord);
    if (provIssues.length > 0) return err(planValidationError(provIssues));

    // Goal existence (closed-failure: foreign and missing both look not-found).
    if (input.goalId !== undefined) {
      const goalResult = goals.getGoal(scope, input.goalId);
      if (!goalResult.ok) return err(planSubjectNotFound("goal"));
      const goal = goalResult.value as GoalRecord;
      if (goal.scope.tenantId !== scope.tenantId) return err(planSubjectNotFound("goal"));
    }

    // Candidate existence + W005 deep validation.
    const candidateResult = candidates.getCandidate(scope, input.candidateId);
    if (!candidateResult.ok) return err(candidateResult.error);
    const candidate = candidateResult.value as OrganizationCandidate;
    if (candidate.scope.tenantId !== scope.tenantId) {
      return err(planSubjectNotFound("candidate"));
    }
    const candidateIssues = organizationCandidateIssues(candidate);
    if (candidateIssues.length > 0) return err(planAllocationRefused(candidateIssues));

    // DAG construction (validates shape + detects cycles).
    const dagResult = buildTaskDag(input.tasks);
    if (!dagResult.ok) return err(dagResult.error);
    const dag = dagResult.value;

    // Per-task resource allocations reference W005 ActorAssignment /
    // CapabilityAllocation ids within the candidate. Validate each
    // allocation's references against the candidate's actor / step sets.
    const assignmentIds = new Set<string>(
      candidate.assignments.map((a: ActorAssignment) => a.assignmentId),
    );
    const allocationIds = new Set<string>(
      candidate.capabilityAllocations.map((a: CapabilityAllocation) => a.allocationId),
    );
    const issues: import("@aurum/domain").ValidationIssue[] = [];
    input.tasks.forEach((task, taskIndex) => {
      task.resourceAllocations.forEach((alloc, allocIndex) => {
        if (alloc.candidateId !== input.candidateId) {
          issues.push({
            field: `tasks.${taskIndex}.resourceAllocations.${allocIndex}.candidateId`,
            problem: `must match the plan's candidateId (${input.candidateId})`,
          });
        }
        for (const id of alloc.actorAssignmentIds) {
          if (!assignmentIds.has(id)) {
            issues.push({
              field: `tasks.${taskIndex}.resourceAllocations.${allocIndex}.actorAssignmentIds`,
              problem: `must reference a declared assignment: ${id}`,
            });
          }
        }
        for (const id of alloc.capabilityAllocationIds) {
          if (!allocationIds.has(id)) {
            issues.push({
              field: `tasks.${taskIndex}.resourceAllocations.${allocIndex}.capabilityAllocationIds`,
              problem: `must reference a declared allocation: ${id}`,
            });
          }
        }
      });
      // Validate handoff descriptors (consumes + produces) shape.
      task.consumes.forEach((h, hIndex) => {
        for (const issue of handoffDescriptorIssues(h, `tasks.${taskIndex}.consumes.${hIndex}`)) {
          issues.push(issue);
        }
      });
      task.produces.forEach((h, hIndex) => {
        for (const issue of handoffDescriptorIssues(h, `tasks.${taskIndex}.produces.${hIndex}`)) {
          issues.push(issue);
        }
      });
      // Validate executor authority requirement shape (declared, checked at relay).
      for (const issue of executorAuthorityIssues(
        task.authorityRequirement,
        `tasks.${taskIndex}.authorityRequirement`,
      )) {
        issues.push(issue);
      }
    });
    if (issues.length > 0) return err(planValidationError(issues));

    return ok({ candidate, dag });
  }

  function transitionApproval(
    scope: TenantScope,
    input: PlanApprovalInput,
    target: PlanApprovalState,
  ): Result<ExecutionPlan, PlanError> {
    const planResult = plans.getPlan(scope, input.planId);
    if (!planResult.ok) return err(planResult.error);
    const plan = planResult.value as ExecutionPlan;
    if (plan.scope.tenantId !== scope.tenantId) return err(planNotFound("plan"));
    if (!planApprovalTransitionLegal(plan.approval.state, target)) {
      return err(planLifecycleIllegal(plan.approval.state, target));
    }
    // Audit the transition first (lifecycle records require an audit ref).
    // Subject is the candidate (the plan is not a SubjectKind; it references
    // the W005 candidate). Audit action maps to the W002 action authority
    // vocabulary: submit→recommended, approve→approved, reject→rejected.
    const auditSubject: SubjectReference = { kind: "candidate", id: plan.candidateId };
    const auditAction = target === "submitted"
      ? ("action.recommended" as const)
      : target === "approved"
        ? ("action.approved" as const)
        : ("action.rejected" as const);
    const auditResult = audit.append(scope, auditSubject, auditAction, {
      actor: input.actor,
      at: input.now,
      reason: input.reason,
    });
    if (!auditResult.ok) return err(auditResult.error);

    if (target === "approved") {
      // Human-only + citation required.
      if (!input.humanDecision || !input.citation) {
        return err(
          planValidationError([
            {
              field: "humanDecision",
              problem: "humanDecision + citation are required for the approve transition",
            },
          ]),
        );
      }
      if (input.actor.kind !== "person" || !input.actor.personId) {
        return err(planUnauthorized("approve requires a person actor"));
      }
      if (input.actor.personId !== input.humanDecision.decidedBy) {
        return err(planUnauthorized("approver must match the human decision"));
      }
      // Assert the citation through the W002 action authority port.
      const assertResult = approval.assertApprovalCitation(scope, {
        actionId: input.citation.actionId,
        auditRef: input.citation.auditRef,
        approvedBy: input.actor,
        approvedAt: input.humanDecision.decidedAt,
      });
      if (!assertResult.ok) return err(assertResult.error);
      const citation = {
        actionId: assertResult.value.actionId,
        auditRef: assertResult.value.auditRef,
        approvedBy: input.actor,
        approvedAt: input.humanDecision.decidedAt,
        reason: input.reason,
      };
      const transition = {
        from: plan.approval.state,
        to: target,
        at: input.now,
        actor: input.actor,
        reason: input.reason,
        citation,
      };
      const updated: ExecutionPlan = {
        ...plan,
        approval: {
          state: target,
          history: Object.freeze([...plan.approval.history, transition]),
          citation,
        },
      };
      return plans.putPlan(updated) as Result<ExecutionPlan, PlanError>;
    }

    if (target === "rejected") {
      if (!input.rejectionReason || input.rejectionReason.trim().length === 0) {
        return err(
          planValidationError([{ field: "rejectionReason", problem: "is required for reject" }]),
        );
      }
      const rejection = {
        reason: input.rejectionReason,
        rejectedBy: input.actor,
        rejectedAt: input.now,
      };
      const transition = {
        from: plan.approval.state,
        to: target,
        at: input.now,
        actor: input.actor,
        reason: input.reason,
      };
      const updated: ExecutionPlan = {
        ...plan,
        approval: {
          state: target,
          history: Object.freeze([...plan.approval.history, transition]),
          rejection,
        },
      };
      return plans.putPlan(updated) as Result<ExecutionPlan, PlanError>;
    }

    // target === "submitted" — just a transition.
    const transition = {
      from: plan.approval.state,
      to: target,
      at: input.now,
      actor: input.actor,
      reason: input.reason,
    };
    const updated: ExecutionPlan = {
      ...plan,
      approval: {
        state: target,
        history: Object.freeze([...plan.approval.history, transition]),
        ...(plan.approval.citation ? { citation: plan.approval.citation } : {}),
        ...(plan.approval.rejection ? { rejection: plan.approval.rejection } : {}),
      },
    };
    return plans.putPlan(updated) as Result<ExecutionPlan, PlanError>;
  }

  function transitionLifecycle(
    scope: TenantScope,
    input: PlanLifecycleInput,
    target: "active" | "completed" | "cancelled",
  ): Result<ExecutionPlan, PlanError> {
    const planResult = plans.getPlan(scope, input.planId);
    if (!planResult.ok) return err(planResult.error);
    const plan = planResult.value as ExecutionPlan;
    if (plan.scope.tenantId !== scope.tenantId) return err(planNotFound("plan"));
    // Active requires approved; completed/cancelled require active.
    if (target === "active" && plan.approval.state !== "approved") {
      return err(planLifecycleIllegal(plan.approval.state, target));
    }
    if (
      (target === "completed" || target === "cancelled") &&
      plan.lifecycleState !== "active"
    ) {
      return err(planLifecycleIllegal(plan.lifecycleState, target));
    }
    const transition = {
      from: plan.lifecycleState,
      to: target,
      at: input.now,
      actor: input.actor,
      reason: input.reason,
      auditRef: input.auditRef,
    };
    const updated: ExecutionPlan = {
      ...plan,
      lifecycleState: target,
      lifecycleHistory: Object.freeze([...plan.lifecycleHistory, transition]),
    };
    return plans.putPlan(updated) as Result<ExecutionPlan, PlanError>;
  }

  return {
    createPlan(scope, input) {
      const validation = validatePlanConstruction(scope, input);
      if (!validation.ok) return err(validation.error);
      const { dag } = validation.value;
      const planId = input.planId ?? nextPlanId();
      // Check id collision (deterministic, like the candidate store).
      const existing = plans.getPlan(scope, planId);
      if (existing.ok) {
        return err(
          planValidationError([
            { field: "planId", problem: `plan ${planId} already exists in tenant` },
          ]),
        );
      }
      const plan: ExecutionPlan = {
        scope,
        planId,
        ...(input.goalId
          ? { goalId: input.goalId as ExecutionPlan["goalId"] }
          : {}),
        candidateId: input.candidateId as OrganizationCandidateId,
        version: 1,
        taskDag: dag,
        approval: {
          state: "draft",
          history: Object.freeze([]),
        },
        lifecycleState: "active",
        lifecycleHistory: Object.freeze([]),
        createdBy: input.createdBy,
        createdAt: input.now,
        provenance: input.provenance,
        evidenceRefs: Object.freeze([...input.evidenceRefs]),
      };
      return plans.putPlan(plan) as Result<ExecutionPlan, PlanError>;
    },

    submitForApproval(scope, input) {
      return transitionApproval(scope, input, "submitted");
    },

    approvePlan(scope, input) {
      return transitionApproval(scope, input, "approved");
    },

    rejectPlan(scope, input) {
      return transitionApproval(scope, input, "rejected");
    },

    activatePlan(scope, input) {
      return transitionLifecycle(scope, input, "active");
    },

    completePlan(scope, input) {
      return transitionLifecycle(scope, input, "completed");
    },

    cancelPlan(scope, input) {
      return transitionLifecycle(scope, input, "cancelled");
    },

    getPlan(scope, planId) {
      return plans.getPlan(scope, planId) as Result<ExecutionPlan, PlanError>;
    },

    listPlans(scope) {
      return plans.listPlans(scope) as readonly ExecutionPlan[];
    },

    readyTasks(scope, planId) {
      const planResult = plans.getPlan(scope, planId);
      if (!planResult.ok) return err(planResult.error);
      const plan = planResult.value as ExecutionPlan;
      if (plan.scope.tenantId !== scope.tenantId) return err(planNotFound("plan"));
      const completionList = completions.listCompletions(planId);
      const completionMap = new Map<string, { status: "settled" | "cancelled" | "failed" }>();
      for (const c of completionList) completionMap.set(c.taskId, { status: c.status });
      const deliveredForPlan = handoffs.deliveredForPlan(planId);
      const deliveredByTask = new Map<string, Set<string>>();
      for (const payload of deliveredForPlan) {
        const set = deliveredByTask.get(payload.taskId) ?? new Set<string>();
        set.add(payload.handoffId);
        deliveredByTask.set(payload.taskId, set);
      }
      return ok(readyTasks(plan.taskDag, completionMap, deliveredByTask));
    },

    issueHandoff(scope, input) {
      const planResult = plans.getPlan(scope, input.planId);
      if (!planResult.ok) return err(planResult.error);
      const plan = planResult.value as ExecutionPlan;
      if (plan.scope.tenantId !== scope.tenantId) return err(planNotFound("plan"));
      const producingTask = plan.taskDag.tasks.find((t) => t.taskId === input.producingTaskId);
      if (!producingTask) return err(planNotFound("producing task"));
      const consumingTask = plan.taskDag.tasks.find((t) => t.taskId === input.consumingTaskId);
      if (!consumingTask) return err(planNotFound("consuming task"));
      // Authorization check (catalog: "authorization-aware ... checked at relay time").
      const authorityResult = approval.assertExecutorAuthority(scope, producingTask.authorityRequirement);
      if (!authorityResult.ok) return err(authorityResult.error);
      // Build the payload (minimal-context: gated by the consuming task's descriptor).
      const buildResult = buildHandoffPayload({
        planId: input.planId,
        producingTask,
        consumingTask,
        handoffId: input.handoffId,
        producingSettlement: input.producingSettlement,
        payload: input.payload,
        mediaType:
          consumingTask.consumes.find((h) => h.handoffId === input.handoffId)?.mediaType ??
          "application/octet-stream",
        deliveredAt: input.now,
      });
      if (!buildResult.ok) return err(buildResult.error);
      // Idempotent delivery (catalog: "duplicate delivery is idempotent").
      const previously = handoffs
        .deliveredFor(input.planId, input.consumingTaskId)
        .find((p) => p.handoffId === input.handoffId);
      const delivery = deliverHandoffIdempotent(previously, buildResult.value);
      if (!delivery.ok) return err(delivery.error);
      const recorded = handoffs.recordDelivery(delivery.value.payload);
      if (!recorded.ok) return err(recorded.error);
      return ok(recorded.value.payload);
    },

    async dispatchTask(scope, input) {
      const planResult = plans.getPlan(scope, input.planId);
      if (!planResult.ok) return err(planResult.error);
      const plan = planResult.value as ExecutionPlan;
      if (plan.scope.tenantId !== scope.tenantId) return err(planNotFound("plan"));
      // Plans must be approved before dispatch. (Catalog: approvals are
      // human-gated; the approved state is the only legal pre-dispatch state.)
      if (plan.approval.state !== "approved") {
        return err(planLifecycleIllegal(plan.approval.state, "dispatch"));
      }
      if (plan.lifecycleState !== "active") {
        return err(planLifecycleIllegal(plan.lifecycleState, "dispatch"));
      }
      const task = plan.taskDag.tasks.find((t) => t.taskId === input.taskId);
      if (!task) return err(planNotFound("task"));
      // Authorization check at dispatch time (catalog: relay is auth-aware).
      const authorityResult = approval.assertExecutorAuthority(scope, input.authority);
      if (!authorityResult.ok) return err(authorityResult.error);
      // Determine the attempt number (recovery: catalog clause 4).
      const previousCompletions = completions.listCompletions(input.planId);
      const previousAttempts = previousCompletions
        .filter((c) => c.taskId === input.taskId)
        .map((c) => ({ attempt: 1, requestId: c.settlementRef.requestId }));
      const attempt = previousAttempts.length + 1;
      // Submit to the substrate (W006 through the local port).
      const submitResult = await substrate.submitPlanTask(scope, {
        planId: input.planId,
        taskId: input.taskId,
        environmentClass: task.environmentClass ?? "local",
        ...(task.environmentVariant ? { environmentVariant: task.environmentVariant } : {}),
        payload: input.payload ?? "",
        payloadMediaType: input.payloadMediaType ?? "application/octet-stream",
        authority: input.authority,
        ...(task.deadlineEpochMs ? { deadlineEpochMs: task.deadlineEpochMs } : {}),
        attempt,
      });
      if (!submitResult.ok) return err(submitResult.error);
      const settlement = submitResult.value.settlement;
      // Record the completion (cites the settling envelope — catalog clause 3).
      const completion: TaskCompletionRecord = {
        planId: input.planId,
        taskId: input.taskId,
        status: settlement.status,
        settlementRef: {
          requestId: settlement.requestId,
          settledAt: settlement.settledAt,
        },
        ...(settlement.failure ? { failure: settlement.failure } : {}),
        completedAt: input.now,
      };
      const recorded = completions.recordCompletion(completion);
      if (!recorded.ok) return err(recorded.error);
      // If the task failed, raise an escalation (catalog clause 4 — proposes).
      if (settlement.status === "failed" && settlement.failure) {
        const esc = buildTaskFailedEscalation({
          escalationId: nextEscalationId(),
          planId: input.planId,
          task,
          settlement,
          addressedTo: { kind: "person", name: "plan-approver" },
          reason: `task ${input.taskId} failed: ${settlement.failure.message}`,
          raisedAt: input.now,
          provenance: plan.provenance,
        });
        if (esc.ok) {
          escalations.appendEscalation(esc.value);
        }
      }
      return ok(completion);
    },

    listEscalations(scope, planId) {
      // Tenant isolation: listEscalations is scoped; foreign plans return [].
      const planResult = plans.getPlan(scope, planId);
      if (!planResult.ok) return err(planResult.error);
      const plan = planResult.value as ExecutionPlan;
      if (plan.scope.tenantId !== scope.tenantId) return err(planNotFound("plan"));
      return ok(Object.freeze(escalations.listEscalations(scope, planId)));
    },
  };
}

/** Re-exported for the contract: pure DAG constructor (for tests + consumers). */
export { buildTaskDag, topologicalOrder } from "../domain/dag.js";
/** Re-exported for the contract: pure relay constructor. */
export { buildHandoffPayload, deliverHandoffIdempotent } from "../domain/relay.js";
/** Re-exported for the contract: pure escalation builders. */
export {
  buildTaskFailedEscalation,
  buildDeadlineExceededEscalation,
  buildDependencyFailedEscalation,
} from "../domain/escalation.js";
