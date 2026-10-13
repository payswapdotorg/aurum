/**
 * Control-tower overview derivations (W010 domain layer): PURE functions
 * that turn the four areas' real records into the tower's view models.
 * No IO, no seams, no mutation — every input is a record the caller read
 * through the public contracts; every output is a fresh frozen value.
 *
 * Derivation law: a card field is either COPIED from exactly one source
 * record field or COUNTED from them (lengths / matched ids). Nothing is
 * inferred, scored or re-classified here — the tower renders, it does not
 * judge.
 */
import type {
  AttentionCriterion,
  AttentionReport,
  SituationReport,
} from "../../company/contract.company.js";
import type { LabEvaluationRecord } from "../../lab/contract.lab.js";
import type { ExecutionPlan } from "../../plans/contract.plans.js";
import { MISSION_STAGES } from "../../cognition/contract.cognition.js";
import type { MissionRecord } from "../../cognition/contract.cognition.js";
import type {
  GoalTowerCard,
  LabEvaluationSummary,
  LabTowerSummary,
  MissionTowerCard,
  PendingApproval,
  PlanTowerCard,
} from "./records.js";

/** Readiness counts keyed by planId (absent = not an active-plan concern). */
export type PlanReadinessCounts = ReadonlyMap<string, number>;

/** Escalation counts keyed by planId (absent = not an active-plan concern). */
export type PlanEscalationCounts = ReadonlyMap<string, number>;

/** Derives the goal cards: situation × attention × child plans/missions. */
export function goalCardsOf(
  situation: SituationReport,
  attention: AttentionReport,
  plans: readonly ExecutionPlan[],
  missions: readonly MissionRecord[],
): readonly GoalTowerCard[] {
  const criteriaByGoal = new Map<string, readonly AttentionCriterion[]>();
  for (const entry of attention.attention) {
    criteriaByGoal.set(
      entry.goalId,
      entry.criteria.map((finding) => finding.criterion),
    );
  }
  return situation.goals.map((goal) => {
    const planIds = plans.filter((plan) => plan.goalId === goal.goalId).map((plan) => plan.planId);
    const missionIds = missions
      .filter((mission) => mission.charter.goalId === goal.goalId)
      .map((mission) => mission.missionId);
    return {
      goalId: goal.goalId,
      revision: goal.revision,
      objective: goal.objective,
      priority: goal.priority,
      horizonState: goal.horizonState,
      horizonEnd: goal.horizonEnd,
      ownerPersonId: goal.ownerPersonId,
      openUnknowns: goal.openUnknowns,
      openContradictions: goal.openContradictions,
      expectedEvidenceCoverage: goal.expectedEvidenceCoverage,
      freshness: goal.freshness,
      attentionCriteria: criteriaByGoal.get(goal.goalId) ?? [],
      planIds: Object.freeze(planIds),
      missionIds: Object.freeze(missionIds),
    };
  });
}

/** Derives the mission cards from the mission records (counts only). */
export function missionCardsOf(missions: readonly MissionRecord[]): readonly MissionTowerCard[] {
  return missions.map((mission) => ({
    missionId: mission.missionId,
    question: mission.charter.question,
    status: mission.status,
    stagesCompleted: mission.stages.length,
    totalStages: MISSION_STAGES.length,
    ...(mission.disposition !== undefined ? { disposition: mission.disposition } : {}),
    ...(mission.charter.goalId !== undefined ? { goalId: mission.charter.goalId } : {}),
    createdAt: mission.createdAt,
  }));
}

/** Derives the plan cards (readiness/escalations only for active plans). */
export function planCardsOf(
  plans: readonly ExecutionPlan[],
  readiness: PlanReadinessCounts,
  escalations: PlanEscalationCounts,
): readonly PlanTowerCard[] {
  return plans.map((plan) => ({
    planId: plan.planId,
    ...(plan.goalId !== undefined ? { goalId: plan.goalId } : {}),
    candidateId: plan.candidateId,
    version: plan.version,
    approvalState: plan.approval.state,
    lifecycleState: plan.lifecycleState,
    taskCount: plan.taskDag.tasks.length,
    ...(plan.lifecycleState === "active" && readiness.has(plan.planId)
      ? { readyTaskCount: readiness.get(plan.planId) }
      : {}),
    ...(plan.lifecycleState === "active" && escalations.has(plan.planId)
      ? { escalationCount: escalations.get(plan.planId) }
      : {}),
    createdAt: plan.createdAt,
  }));
}

/** Derives the Lab panel: newest-first evaluation summaries (bounded). */
export function labSummaryOf(
  evaluations: readonly LabEvaluationRecord[],
  limit = 10,
): LabTowerSummary {
  const ordered = [...evaluations].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt;
    return left.evaluationId.localeCompare(right.evaluationId);
  });
  const summaries: LabEvaluationSummary[] = ordered.slice(0, limit).map((evaluation) => {
    const top = evaluation.ranked[0];
    return {
      evaluationId: evaluation.evaluationId,
      ...(evaluation.goalId !== undefined ? { goalId: evaluation.goalId } : {}),
      fingerprintDigest: evaluation.fingerprintDigest,
      rankedCount: evaluation.ranked.length,
      ...(top !== undefined
        ? {
            topCandidateId: top.candidateId,
            topScore: top.weightedScore,
          }
        : {}),
      createdAt: evaluation.createdAt,
    };
  });
  return { evaluations: Object.freeze(summaries) };
}

/**
 * Derives the pending-approvals list — the tower's HUMAN-decision queue.
 * Sources (and only these):
 * - mission gate stages whose actions stopped at `recommended` (the gate
 *   law: missions propose/recommend, humans approve — the mission record's
 *   own gate journal entry + propose manifest carry the title/subject);
 * - plans whose approval state is `submitted`.
 */
export function pendingApprovalsOf(
  missions: readonly MissionRecord[],
  plans: readonly ExecutionPlan[],
): readonly PendingApproval[] {
  const pending: PendingApproval[] = [];
  for (const mission of missions) {
    const gate = mission.stages.find((stage) => stage.stage === "gate");
    if (gate === undefined || gate.stage !== "gate") continue;
    const propose = mission.stages.find((stage) => stage.stage === "propose");
    const manifest = propose !== undefined && propose.stage === "propose" ? propose.manifest : null;
    for (const gated of gate.gated) {
      if (gated.finalState !== "recommended") continue;
      const effect = manifest?.actions.find((action) => action.actionId === gated.actionId);
      pending.push({
        kind: "mission-action",
        sourceId: mission.missionId,
        actionId: gated.actionId,
        title: effect?.title ?? `Recommended action ${gated.actionId}`,
        ...(effect?.description !== undefined ? { description: effect.description } : {}),
        ...(effect !== undefined ? { subject: effect.subject } : {}),
        raisedAt: gate.at,
      });
    }
  }
  for (const plan of plans) {
    if (plan.approval.state !== "submitted") continue;
    const last = plan.approval.history[plan.approval.history.length - 1];
    pending.push({
      kind: "plan",
      sourceId: plan.planId,
      title: `Plan ${plan.planId} (v${plan.version}) awaits approval`,
      description: `${plan.taskDag.tasks.length} task(s) for candidate ${plan.candidateId}`,
      raisedAt: last !== undefined ? last.at : plan.createdAt,
    });
  }
  return Object.freeze(
    pending.sort((left, right) => {
      if (left.raisedAt !== right.raisedAt) return right.raisedAt - left.raisedAt;
      return `${left.sourceId}:${left.actionId ?? ""}`.localeCompare(
        `${right.sourceId}:${right.actionId ?? ""}`,
      );
    }),
  );
}
