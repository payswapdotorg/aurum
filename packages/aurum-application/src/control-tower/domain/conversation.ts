/**
 * Control-tower conversation derivations (W010 domain layer): PURE
 * functions that turn ONE mission or plan record into a conversation thread
 * view model. The conversation experience is a READ over the records' own
 * journals — every turn is one journal/history entry, cited by record id.
 *
 * Bounded-content law: the `reason` turn renders the model's bounded
 * content summary VERBATIM (it is already schema-validated + capped by the
 * cognition area); the tower never rephrases, merges or extends it.
 */
import type { ExecutionPlan } from "../../plans/contract.plans.js";
import type { MissionRecord } from "../../cognition/contract.cognition.js";
import { pendingApprovalsOf } from "./overview.js";
import type { ConversationTurn, ConversationViewModel, PendingApproval } from "./records.js";

function actorLabel(actor: { kind: string } | undefined): string {
  if (actor === undefined) return "unknown actor";
  return actor.kind;
}

/** Mission thread: charter (human) → stages (system/model) → cancel (human). */
export function missionConversationOf(mission: MissionRecord): ConversationViewModel {
  const turns: ConversationTurn[] = [];
  const missionId = mission.missionId;
  turns.push({
    turnId: `mission-${missionId}#charter`,
    role: "human",
    kind: "mission-charter",
    at: mission.createdAt,
    actor: mission.createdBy,
    title: mission.charter.question,
    detail: `Consequence if unresolved: ${mission.charter.consequence}`,
    awaitsHuman: false,
    citations: [missionId],
  });
  for (const stage of mission.stages) {
    turns.push(missionStageTurn(missionId, stage));
  }
  if (mission.cancelled !== undefined) {
    turns.push({
      turnId: `mission-${missionId}#cancelled`,
      role: "human",
      kind: "mission-cancelled",
      at: mission.cancelled.at,
      actor: mission.cancelled.by,
      title: "Mission cancelled",
      detail: mission.cancelled.reason,
      awaitsHuman: false,
      citations: [missionId],
    });
  }
  return {
    topic: { kind: "mission", missionId },
    title: mission.charter.question,
    subtitle: `Learning mission ${missionId}`,
    status: mission.status,
    turns: Object.freeze(turns),
    pendingApprovals: pendingApprovalsOf([mission], []),
  };
}

function missionStageTurn(
  missionId: string,
  stage: MissionRecord["stages"][number],
): ConversationTurn {
  const base = {
    at: stage.at,
    actor: stage.actor,
    citations: [`mission-${missionId}#stage-${stage.stageIndex}`] as readonly string[],
  };
  switch (stage.stage) {
    case "orient":
      return {
        ...base,
        turnId: `mission-${missionId}#stage-${stage.stageIndex}`,
        role: "system",
        kind: "mission-orient",
        title: "Oriented over company records",
        detail: `Observed ${stage.orientation.observations.length} observation(s), ${stage.orientation.beliefs.length} belief(s), ${stage.orientation.memory.length} memory record(s), ${stage.orientation.openUnknowns.length} open unknown(s), ${stage.orientation.openContradictions.length} open contradiction(s).`,
        awaitsHuman: false,
      };
    case "reason":
      return {
        ...base,
        turnId: `mission-${missionId}#stage-${stage.stageIndex}`,
        role: "model",
        kind: "mission-reason",
        title: stage.content.summary,
        detail: `Reasoned by ${stage.modelName} over ${stage.request.observations.length} cited observation(s); ${stage.content.findings.length} finding(s), ${stage.content.hypotheses.length} hypothesis(es).`,
        awaitsHuman: false,
      };
    case "evaluate":
      return {
        ...base,
        turnId: `mission-${missionId}#stage-${stage.stageIndex}`,
        role: "system",
        kind: "mission-evaluate",
        title: `Evaluated: ${stage.evaluation.disposition}`,
        detail: `${stage.evaluation.admittedFindings} admissible finding(s), ${stage.evaluation.staleFindings} stale, ${stage.evaluation.gaps.length} gap(s).`,
        awaitsHuman: false,
      };
    case "propose":
      return {
        ...base,
        turnId: `mission-${missionId}#stage-${stage.stageIndex}`,
        role: "system",
        kind: "mission-propose",
        title: "Proposed knowledge effects",
        detail: `${stage.manifest.claims.length} claim(s), ${stage.manifest.unknowns.length} unknown(s), ${stage.manifest.actions.length} action proposal(s); ${stage.applied.length} applied.`,
        awaitsHuman: false,
      };
    case "gate": {
      const recommended = stage.gated.filter((entry) => entry.finalState === "recommended");
      return {
        ...base,
        turnId: `mission-${missionId}#stage-${stage.stageIndex}`,
        role: "system",
        kind: "mission-gate",
        title:
          recommended.length > 0
            ? `${recommended.length} action(s) recommended — awaiting human approval`
            : "Gated action proposals",
        detail:
          stage.gated.length > 0
            ? stage.gated.map((entry) => `${entry.actionId}: ${entry.finalState}`).join("; ")
            : "No action proposals crossed the gate.",
        awaitsHuman: recommended.length > 0,
        citations: [...base.citations, ...stage.gated.map((entry) => entry.actionId)],
      };
    }
    case "record":
      return {
        ...base,
        turnId: `mission-${missionId}#stage-${stage.stageIndex}`,
        role: "system",
        kind: "mission-record",
        title: `Recorded: ${stage.outcome.disposition}`,
        detail: `${stage.outcome.admittedFindings} finding(s) admitted, ${stage.outcome.gapsRaised} gap(s) raised, ${stage.outcome.actionsProposed} action(s) proposed.`,
        awaitsHuman: false,
      };
  }
}

/** Plan thread: creation (human) → approval history → lifecycle history. */
export function planConversationOf(plan: ExecutionPlan): ConversationViewModel {
  const turns: ConversationTurn[] = [];
  const planId = plan.planId;
  turns.push({
    turnId: `plan-${planId}#created`,
    role: "human",
    kind: "plan-created",
    at: plan.createdAt,
    actor: plan.createdBy,
    title: `Plan ${planId} drafted (v${plan.version})`,
    detail: `${plan.taskDag.tasks.length} task(s) instantiating candidate ${plan.candidateId}${plan.goalId !== undefined ? ` for goal ${plan.goalId}` : ""}.`,
    awaitsHuman: false,
    citations: [planId],
  });
  plan.approval.history.forEach((transition, index) => {
    turns.push({
      turnId: `plan-${planId}#approval-${index}`,
      role: "human",
      kind: "plan-approval",
      at: transition.at,
      actor: transition.actor,
      title: `Approval: ${transition.from ?? "draft"} → ${transition.to}`,
      detail:
        transition.citation !== undefined
          ? `${transition.reason} (cited by ${actorLabel(transition.citation.approvedBy)})`
          : transition.reason,
      awaitsHuman: false,
      citations: [
        `plan-${planId}#approval-${index}`,
        ...(transition.citation?.actionId !== undefined ? [transition.citation.actionId] : []),
      ],
    });
  });
  if (plan.approval.state === "submitted") {
    const last = turns[turns.length - 1];
    if (last !== undefined && last.kind === "plan-approval") {
      turns[turns.length - 1] = { ...last, awaitsHuman: true };
    }
  }
  plan.lifecycleHistory.forEach((transition, index) => {
    turns.push({
      turnId: `plan-${planId}#lifecycle-${index}`,
      role: "human",
      kind: "plan-lifecycle",
      at: transition.at,
      actor: transition.actor,
      title: `Lifecycle: ${transition.from ?? "inactive"} → ${transition.to}`,
      detail: `${transition.reason} (audit ${transition.auditRef})`,
      awaitsHuman: false,
      citations: [`plan-${planId}#lifecycle-${index}`, transition.auditRef],
    });
  });
  return {
    topic: { kind: "plan", planId },
    title: `Plan ${planId}`,
    subtitle: `Execution plan v${plan.version} — ${plan.approval.state} / ${plan.lifecycleState}`,
    status: `${plan.approval.state} / ${plan.lifecycleState}`,
    turns: Object.freeze(turns),
    pendingApprovals: pendingApprovalsOf([], [plan]) as readonly PendingApproval[],
  };
}
