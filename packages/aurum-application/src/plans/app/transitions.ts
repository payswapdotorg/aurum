/**
 * Plan service validation + lifecycle/approval transitions (W009 app layer).
 *
 * Extracted from `planService.ts` so the service file stays under the
 * 400-line architecture-policy limit. Pure helpers — they take the plan +
 * the deps ports and return the new plan state.
 */
import {
  err,
  ok,
  organizationCandidateIssues,
  provenanceIssues,
  type ActorReference,
  type GoalRecord,
  type OrganizationCandidate,
  type ProvenanceRecord,
  type Result,
  type SubjectReference,
  type TenantScope,
  type ValidationIssue,
} from "@aurum/domain";
import type { ActorAssignment, CapabilityAllocation } from "@aurum/domain";
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
  type PlanLifecycleState,
} from "../domain/vocabulary.js";
import { buildTaskDag } from "../domain/dag.js";
import { executorAuthorityIssues, handoffDescriptorIssues } from "../domain/relay.js";
import type { ExecutionPlan, PlanTask } from "../domain/records.js";
import type {
  PlanApprovalAuthority,
  PlanAuditPort,
  PlanCandidateViews,
  PlanGoalViews,
  PlanStore,
} from "../domain/ports.js";
import type { CreatePlanInput, PlanApprovalInput, PlanLifecycleInput } from "./inputs.js";

/**
 * Validates a plan's construction against the W002/W005 seams. Catalog
 * clause 1: "create/draft plan (validates DAG + allocations against W005
 * validators)". Returns the candidate + DAG when valid; a typed plan error
 * otherwise (closed-failure for tenant isolation).
 */
export function validatePlanConstruction(
  scope: TenantScope,
  input: CreatePlanInput,
  goals: PlanGoalViews,
  candidates: PlanCandidateViews,
): Result<{ candidate: OrganizationCandidate; dag: ExecutionPlan["taskDag"] }, PlanError> {
  // Provenance sanity.
  const provIssues = provenanceIssues(input.provenance as ProvenanceRecord);
  if (provIssues.length > 0) return err(planValidationError(provIssues));

  // Goal existence (closed-failure).
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
  const issues: ValidationIssue[] = [];
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

/**
 * Performs an approval transition (draft → submitted → approved/rejected).
 * Catalog clause 1: approvals are human-gated; the W002 action authority
 * port asserts the citation on the approve transition.
 */
export function transitionApproval(
  scope: TenantScope,
  input: PlanApprovalInput,
  target: PlanApprovalState,
  plans: PlanStore,
  approval: PlanApprovalAuthority,
  audit: PlanAuditPort,
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
  const auditAction =
    target === "submitted"
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
    return applyApprovedTransition(scope, input, plan, plans, approval);
  }

  if (target === "rejected") {
    return applyRejectedTransition(input, plan, plans);
  }

  // target === "submitted"
  return applySubmittedTransition(input, plan, plans);
}

function applyApprovedTransition(
  _scope: TenantScope,
  input: PlanApprovalInput,
  plan: ExecutionPlan,
  plans: PlanStore,
  approval: PlanApprovalAuthority,
): Result<ExecutionPlan, PlanError> {
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
  const assertResult = approval.assertApprovalCitation(_scope, {
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
    to: "approved" as const,
    at: input.now,
    actor: input.actor,
    reason: input.reason,
    citation,
  };
  const updated: ExecutionPlan = {
    ...plan,
    approval: {
      state: "approved",
      history: Object.freeze([...plan.approval.history, transition]),
      citation,
    },
  };
  return plans.putPlan(updated) as Result<ExecutionPlan, PlanError>;
}

function applyRejectedTransition(
  input: PlanApprovalInput,
  plan: ExecutionPlan,
  plans: PlanStore,
): Result<ExecutionPlan, PlanError> {
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
    to: "rejected" as const,
    at: input.now,
    actor: input.actor,
    reason: input.reason,
  };
  const updated: ExecutionPlan = {
    ...plan,
    approval: {
      state: "rejected",
      history: Object.freeze([...plan.approval.history, transition]),
      rejection,
    },
  };
  return plans.putPlan(updated) as Result<ExecutionPlan, PlanError>;
}

function applySubmittedTransition(
  input: PlanApprovalInput,
  plan: ExecutionPlan,
  plans: PlanStore,
): Result<ExecutionPlan, PlanError> {
  const transition = {
    from: plan.approval.state,
    to: "submitted" as const,
    at: input.now,
    actor: input.actor,
    reason: input.reason,
  };
  const updated: ExecutionPlan = {
    ...plan,
    approval: {
      state: "submitted",
      history: Object.freeze([...plan.approval.history, transition]),
      ...(plan.approval.citation ? { citation: plan.approval.citation } : {}),
      ...(plan.approval.rejection ? { rejection: plan.approval.rejection } : {}),
    },
  };
  return plans.putPlan(updated) as Result<ExecutionPlan, PlanError>;
}

/**
 * Performs a lifecycle transition (active → completed/cancelled). Catalog
 * clause 1: lifecycle transitions are audit-cited.
 */
export function transitionLifecycle(
  scope: TenantScope,
  input: PlanLifecycleInput,
  target: PlanLifecycleState,
  plans: PlanStore,
): Result<ExecutionPlan, PlanError> {
  const planResult = plans.getPlan(scope, input.planId);
  if (!planResult.ok) return err(planResult.error);
  const plan = planResult.value as ExecutionPlan;
  if (plan.scope.tenantId !== scope.tenantId) return err(planNotFound("plan"));
  // Active requires approved; completed/cancelled require active.
  if (target === "active" && plan.approval.state !== "approved") {
    return err(planLifecycleIllegal(plan.approval.state, target));
  }
  if ((target === "completed" || target === "cancelled") && plan.lifecycleState !== "active") {
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
