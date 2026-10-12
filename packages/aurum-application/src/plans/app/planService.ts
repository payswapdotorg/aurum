/**
 * The Plan service facade (W009 app layer). Composes plan construction
 * (transitions.ts), the relay (relay.ts), escalation (escalation.ts), and
 * the execution substrate port into a 12-method service. In-memory state
 * machine (house pattern — persistence is the TL-tracked P-series debt).
 *
 * PLAN-IS-TRUTH LAW: the plan service NEVER stores execution-session ids on
 * plan records. The settlement reference is carried on `TaskCompletionRecord`
 * and `HandoffPayload` (relay-side records) — never on `ExecutionPlan`.
 *
 * Catalog clause 5: "PlanService: create/draft plan (validates DAG +
 * allocations against W005 validators), submit for approval, approve/reject
 * (human-only), activate, get/list plans per tenant, readiness queries,
 * handoff issuance + delivery (the relay), escalation listing".
 */
import {
  err,
  ok,
  type ActorReference,
  type DomainTimestamp,
  type PersonId,
  type Result,
  type TenantScope,
} from "@aurum/domain";
import {
  planNotFound,
  planValidationError,
  planLifecycleIllegal,
  type PlanError,
} from "../domain/errors.js";
import { buildTaskDag, readyTasks } from "../domain/dag.js";
import { buildHandoffPayload, deliverHandoffIdempotent } from "../domain/relay.js";
import { buildTaskFailedEscalation } from "../domain/escalation.js";
import type { HandoffPayload, TaskCompletionRecord } from "../domain/records.js";
import type { ExecutionPlan } from "../domain/records.js";
import type { EscalationRecord } from "../domain/records.js";
import type { OrganizationCandidateId } from "@aurum/domain";
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
} from "../domain/ports.js";
import type {
  CreatePlanInput,
  DispatchTaskInput,
  IssueHandoffInput,
  PlanApprovalInput,
  PlanLifecycleInput,
  PlanService,
} from "./inputs.js";
import {
  transitionApproval,
  transitionLifecycle,
  validatePlanConstruction,
} from "./transitions.js";

let planCounter = 0;
let escalationCounter = 0;

function nextPlanId(): string {
  planCounter += 1;
  return `plan-${planCounter}`;
}

function nextEscalationId(): string {
  escalationCounter += 1;
  return `esc-${escalationCounter}`;
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

  return {
    createPlan(scope, input) {
      const validation = validatePlanConstruction(scope, input, goals, candidates);
      if (!validation.ok) return err(validation.error);
      const { dag } = validation.value;
      const planId = input.planId ?? nextPlanId();
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
        ...(input.goalId ? { goalId: input.goalId as ExecutionPlan["goalId"] } : {}),
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
      return transitionApproval(scope, input, "submitted", plans, approval, audit);
    },

    approvePlan(scope, input) {
      return transitionApproval(scope, input, "approved", plans, approval, audit);
    },

    rejectPlan(scope, input) {
      return transitionApproval(scope, input, "rejected", plans, approval, audit);
    },

    activatePlan(scope, input) {
      return transitionLifecycle(scope, input, "active", plans);
    },

    completePlan(scope, input) {
      return transitionLifecycle(scope, input, "completed", plans);
    },

    cancelPlan(scope, input) {
      return transitionLifecycle(scope, input, "cancelled", plans);
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
      // Authorization check (catalog: relay is auth-aware).
      const authorityResult = approval.assertExecutorAuthority(
        scope,
        producingTask.authorityRequirement,
      );
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
      // Recovery: re-dispatch creates a NEW execution session (catalog clause 4).
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
      // Escalation-on-failure (catalog clause 4 — proposes).
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
      const planResult = plans.getPlan(scope, planId);
      if (!planResult.ok) return err(planResult.error);
      const plan = planResult.value as ExecutionPlan;
      if (plan.scope.tenantId !== scope.tenantId) return err(planNotFound("plan"));
      return ok(Object.freeze(escalations.listEscalations(scope, planId)));
    },
  };
}
