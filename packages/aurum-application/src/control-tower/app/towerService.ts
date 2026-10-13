/**
 * The control-tower service (W010 app layer): the management control tower
 * + conversation experience. TWO read methods compose the four public areas
 * into view models; NINE action methods are 1:1 delegations to the areas'
 * own service methods (the compiler keeps the signatures identical via
 * indexed-access types — see `domain/ports.ts`).
 *
 * PROJECTION LAW (catalog W010): the tower holds no kernel handle; it reads
 * through the area services and routes actions through them unchanged. It
 * invents no records, no state machine and no policy — approving still
 * requires the plan service's human decision citation, missions still stop
 * their gated actions at `recommended`, and the Lab still only evaluates.
 */
import { err, isKnownActorKind, ok, type ValidationIssue } from "@aurum/domain";
import type { ActorReference, TenantScope } from "@aurum/domain";
import { towerValidationError } from "../domain/errors.js";
import type { ControlTowerDeps, ControlTowerService, TowerReadInput } from "../domain/ports.js";
import type { ControlTowerOverview, ConversationTopic } from "../domain/records.js";
import {
  goalCardsOf,
  labSummaryOf,
  missionCardsOf,
  pendingApprovalsOf,
  planCardsOf,
} from "../domain/overview.js";
import { missionConversationOf, planConversationOf } from "../domain/conversation.js";

function readIssues(input: TowerReadInput | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof input?.now !== "number" || !Number.isFinite(input.now) || input.now < 0) {
    issues.push({ field: "now", problem: "must be finite epoch ms >= 0" });
  }
  const actor = input?.askedBy as ActorReference | undefined;
  if (!actor || !isKnownActorKind(actor.kind)) {
    issues.push({ field: "askedBy", problem: "must be a known actor" });
  } else if (actor.kind === "person" && !actor.personId) {
    issues.push({ field: "askedBy.personId", problem: "is required for person actors" });
  }
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  if (reason.length === 0 || reason.length > 2000) {
    issues.push({ field: "reason", problem: "must be 1..2000 characters" });
  }
  return issues;
}

function topicIssues(topic: ConversationTopic | undefined): ValidationIssue[] {
  if (!topic || (topic.kind !== "mission" && topic.kind !== "plan")) {
    return [{ field: "topic.kind", problem: "must be 'mission' or 'plan'" }];
  }
  const id = topic.kind === "mission" ? topic.missionId : topic.planId;
  if (typeof id !== "string" || id.trim().length === 0) {
    return [{ field: `topic.${topic.kind}Id`, problem: "must be a non-empty id" }];
  }
  return [];
}

/**
 * Readiness/escalation counts for ACTIVE plans. A failing per-plan read is
 * an omission, not a board failure: both card fields are optional by design
 * ("present only for active plans") and the underlying records were just
 * listed — a genuine failure surfaces on the plan's own conversation view.
 */
function activePlanCounts(
  scope: TenantScope,
  deps: ControlTowerDeps,
  planIds: readonly string[],
): { readiness: Map<string, number>; escalations: Map<string, number> } {
  const readiness = new Map<string, number>();
  const escalations = new Map<string, number>();
  for (const planId of planIds) {
    const ready = deps.plans.readyTasks(scope, planId);
    if (ready.ok) readiness.set(planId, ready.value.length);
    const escalated = deps.plans.listEscalations(scope, planId);
    if (escalated.ok) escalations.set(planId, escalated.value.length);
  }
  return { readiness, escalations };
}

export function createControlTowerService(deps: ControlTowerDeps): ControlTowerService {
  return {
    overview(scope, input) {
      const issues = readIssues(input);
      if (issues.length > 0) return err(towerValidationError(issues));

      const situation = deps.company.situation(scope, input);
      if (!situation.ok) return err({ kind: "company", error: situation.error });
      const attention = deps.company.goalAttention(scope, input);
      if (!attention.ok) return err({ kind: "company", error: attention.error });
      const unknowns = deps.company.reportUnknowns(scope, input);
      if (!unknowns.ok) return err({ kind: "company", error: unknowns.error });

      const plans = deps.plans.listPlans(scope);
      const missions = deps.cognition.listMissions(scope);
      const evaluations = deps.lab.listEvaluations(scope);

      const activeIds = plans
        .filter((plan) => plan.lifecycleState === "active")
        .map((plan) => plan.planId);
      const counts = activePlanCounts(scope, deps, activeIds);

      const overview: ControlTowerOverview = Object.freeze({
        asOf: input.now,
        situation: situation.value,
        attention: attention.value,
        unknowns: unknowns.value,
        goals: goalCardsOf(situation.value, attention.value, plans, missions),
        missions: missionCardsOf(missions),
        plans: planCardsOf(plans, counts.readiness, counts.escalations),
        lab: labSummaryOf(evaluations),
        pendingApprovals: pendingApprovalsOf(missions, plans),
      });
      return ok(overview);
    },

    conversation(scope, topic) {
      const issues = topicIssues(topic);
      if (issues.length > 0) return err(towerValidationError(issues));
      if (topic.kind === "mission") {
        const mission = deps.cognition.getMission(scope, topic.missionId);
        if (!mission.ok) return err({ kind: "cognition", error: mission.error });
        return ok(missionConversationOf(mission.value));
      }
      const plan = deps.plans.getPlan(scope, topic.planId);
      if (!plan.ok) return err({ kind: "plans", error: plan.error });
      return ok(planConversationOf(plan.value));
    },

    // --- cognition delegation (signatures are the service's own) ---
    createMission: (scope, input) => deps.cognition.createMission(scope, input),
    advanceMission: (scope, missionId, input) => deps.cognition.advance(scope, missionId, input),
    runMissionToCompletion: (scope, missionId, input) =>
      deps.cognition.runToCompletion(scope, missionId, input),
    cancelMission: (scope, missionId, input) =>
      deps.cognition.cancelMission(scope, missionId, input),

    // --- plans delegation (signatures are the service's own) ---
    submitPlanForApproval: (scope, input) => deps.plans.submitForApproval(scope, input),
    approvePlan: (scope, input) => deps.plans.approvePlan(scope, input),
    rejectPlan: (scope, input) => deps.plans.rejectPlan(scope, input),
    activatePlan: (scope, input) => deps.plans.activatePlan(scope, input),
    dispatchTask: (scope, input) => deps.plans.dispatchTask(scope, input),
  };
}
