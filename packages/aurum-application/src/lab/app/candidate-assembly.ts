/**
 * Candidate assembly (W008 app layer): finishes blueprint parts into a
 * complete OrganizationCandidate VALUE — topologies, model occupancy,
 * budget, expected outcome, risks — and runs the W005 deep validation.
 * Deterministic: identical parts + context produce the identical candidate.
 */
import type {
  CapabilitySupplyRecord,
  DomainTimestamp,
  ModelOccupancy,
  OrganizationCandidate,
} from "@aurum/domain";
import { COST_PROXY_UNITS } from "../domain/constraints.js";
import type { BlueprintParts, CompositionContext } from "./compose.js";
import { composeBlueprintParts } from "./compose.js";

/** Composes and assembles one complete candidate organization. */
export function assembleCandidate(
  pool: ReadonlyMap<string, readonly CapabilitySupplyRecord[]>,
  ctx: CompositionContext,
): { candidate: OrganizationCandidate; bindings: BlueprintParts["bindings"] } {
  const parts = composeBlueprintParts(pool, ctx);
  const candidate = finishCandidate(parts, ctx);
  return { candidate, bindings: parts.bindings };
}

function finishCandidate(parts: BlueprintParts, ctx: CompositionContext): OrganizationCandidate {
  const { demand, actors, assignments, allocations } = parts;

  const steps = demand.map((entry) => {
    const allocation = allocations.find((item) => item.capabilityId === entry.capabilityId);
    const primary = allocation?.actorIds[0];
    const primaryActor = actors.find((actor) => actor.actorId === primary);
    const automated =
      primaryActor?.kind === "agent" ||
      primaryActor?.kind === "agent-team" ||
      primaryActor?.kind === "software" ||
      primaryActor?.kind === "automation";
    return {
      stepId: `step:${entry.capabilityId}`,
      name: `Deliver ${entry.capabilityId}`,
      ...(primary !== undefined ? { actorId: primary } : {}),
      automated,
    };
  });
  const edges: {
    kind: "delegation";
    fromActorId: string;
    toActorId: string;
    onStepRef?: string;
  }[] = [];
  for (const allocation of allocations) {
    const [primary, ...rest] = allocation.actorIds;
    for (const other of rest) {
      if (primary && other && primary !== other) {
        edges.push({
          kind: "delegation",
          fromActorId: primary,
          toActorId: other,
          onStepRef: `step:${allocation.capabilityId}`,
        });
      }
    }
  }

  const flows = demand.map((entry) => {
    const allocation = allocations.find((item) => item.capabilityId === entry.capabilityId);
    const primary = allocation?.actorIds[0] ?? actors[0]?.actorId;
    const recipients = actors
      .filter((actor) => actor.actorId !== primary)
      .map((actor) => actor.actorId);
    const fallback = primary !== undefined ? [primary] : actors.map((actor) => actor.actorId);
    const humanActor = actors.find((actor) => actor.kind === "human" || actor.kind === "team");
    const escalationActor = humanActor?.actorId ?? primary;
    return {
      flowId: `flow:${entry.capabilityId}`,
      knowledge: `${entry.capabilityId} delivery status`,
      ...(primary !== undefined ? { sourceActorId: primary, ownerActorId: primary } : {}),
      recipientActorIds: Object.freeze(recipients.length > 0 ? recipients : fallback),
      freshnessMaxAgeMs:
        ctx.fingerprint.axes.freshnessSignal === "stale" ? 86_400_000 : 604_800_000,
      minimalContext: true,
      reviewRequired: ctx.fingerprint.axes.goalPressure !== "urgent",
      ...(escalationActor !== undefined ? { escalationActorId: escalationActor } : {}),
    };
  });

  const windowStart = Math.max(ctx.now, ctx.horizon.start) as DomainTimestamp;
  const occupancyWindow = {
    start: windowStart,
    end: Math.max(windowStart + 1, ctx.horizon.end) as DomainTimestamp,
  };
  const modelOccupancy: ModelOccupancy[] = actors
    .filter((actor) => actor.kind === "agent" || actor.kind === "agent-team")
    .map((actor) => ({
      actorId: actor.actorId,
      // Opaque proxy binding reference: the provider fabric owns the real
      // ModelBinding registry; the lab never queries it (no execution seam).
      modelBindingRef: `binding:${actor.agentBodyRef ?? actor.actorId}:cognition`,
      window: occupancyWindow,
      exclusive: true,
    }));

  const budgetBreakdown = { humanCost: 0, agentCost: 0, softwareCost: 0, externalCost: 0 };
  for (const assignment of assignments) {
    const actor = actors.find((item) => item.actorId === assignment.actorId);
    const unit = actor ? (COST_PROXY_UNITS[actor.kind] ?? 50) : 50;
    const cost = unit * assignment.effortShare;
    if (actor?.kind === "human" || actor?.kind === "team") budgetBreakdown.humanCost += cost;
    else if (actor?.kind === "agent" || actor?.kind === "agent-team")
      budgetBreakdown.agentCost += cost;
    else if (actor?.kind === "software" || actor?.kind === "automation")
      budgetBreakdown.softwareCost += cost;
    else budgetBreakdown.externalCost += cost;
  }

  const levelMet = demand.filter((entry) =>
    allocations.some(
      (allocation) =>
        allocation.capabilityId === entry.capabilityId && allocation.level >= entry.requiredLevel,
    ),
  ).length;
  const risks: OrganizationCandidate["risks"][number][] = [
    {
      kind: levelMet < demand.length ? "capability" : "other",
      description:
        levelMet < demand.length
          ? `${demand.length - levelMet} capability demand(s) not met at the required level`
          : "all capability demands met at the required level",
      severity: levelMet < demand.length ? "high" : "low",
    },
  ];
  if (actors.some((actor) => actor.kind === "human" || actor.kind === "team")) {
    risks.push({
      kind: "employment",
      description: "human staffing in this proposal remains human-authorized (constitution)",
      severity: "medium",
    });
  }
  if (
    ctx.fingerprint.axes.uncertaintyClass === "open" &&
    actors.some((actor) => actor.kind === "agent" || actor.kind === "software")
  ) {
    risks.push({
      kind: "operational",
      description: "automated actors under open uncertainty: interpretive work unverified",
      severity: "medium",
    });
  }

  const contextual = {
    ...(ctx.constraints.staffing ? { staffing: ctx.constraints.staffing } : {}),
    ...(ctx.constraints.budget ? { budget: ctx.constraints.budget } : {}),
    ...(ctx.constraints.quality ? { quality: ctx.constraints.quality } : {}),
    ...(ctx.constraints.sla ? { sla: ctx.constraints.sla } : {}),
    ...(ctx.constraints.riskTolerance ? { riskTolerance: ctx.constraints.riskTolerance } : {}),
  };

  return {
    scope: ctx.scope,
    candidateId:
      `lab-${ctx.strategy}-${ctx.fingerprint.digest.slice(0, 8)}` as OrganizationCandidate["candidateId"],
    ...(ctx.goalId !== undefined ? { goalId: ctx.goalId as OrganizationCandidate["goalId"] } : {}),
    contextFingerprint: ctx.fingerprint.digest,
    ...(Object.keys(contextual).length > 0 ? { constraints: contextual } : {}),
    actors,
    assignments,
    capabilityAllocations: allocations,
    topology: {
      execution: Object.freeze({ steps: Object.freeze(steps), edges: Object.freeze(edges) }),
      information: Object.freeze({ flows: Object.freeze(flows) }),
    },
    modelOccupancy: Object.freeze(modelOccupancy),
    environment: Object.freeze([]),
    budget: {
      ...(ctx.constraints.budget?.maxCost !== undefined
        ? { maxTotalCost: ctx.constraints.budget.maxCost }
        : {}),
      ...(ctx.constraints.budget?.currency !== undefined
        ? { currency: ctx.constraints.budget.currency }
        : {}),
      humanCost: Math.round(budgetBreakdown.humanCost * 100) / 100,
      agentCost: Math.round(budgetBreakdown.agentCost * 100) / 100,
      softwareCost: Math.round(budgetBreakdown.softwareCost * 100) / 100,
      externalCost: Math.round(budgetBreakdown.externalCost * 100) / 100,
    },
    expectedOutcome: {
      ...(ctx.goalId !== undefined
        ? { goalId: ctx.goalId as OrganizationCandidate["expectedOutcome"]["goalId"] }
        : {}),
      metric: "capability-coverage",
      target: demand.length,
      confidence: demand.length === 0 ? 0 : Math.round((levelMet / demand.length) * 100) / 100,
    },
    risks: Object.freeze(risks),
    evidenceRefs: Object.freeze([...ctx.evidenceRefs]),
    proposedBy: ctx.proposedBy,
    proposedAt: ctx.now,
    provenance: ctx.provenance,
  };
}
