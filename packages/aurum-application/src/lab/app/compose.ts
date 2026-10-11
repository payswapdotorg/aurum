/**
 * Blueprint composition (W008 app layer): turns a mixed supply pool plus a
 * strategy into the structural parts of a candidate organization (actors,
 * assignments, capability allocations, binding constraints). Deterministic:
 * the same pool, strategy, fingerprint and inputs produce identical parts
 * (no randomness, no environment reads, codepoint ordering).
 *
 * The mixed pool enters through the W005 capability seams: supplies with
 * supplier kinds employee/team/agent/software/supplier/partner map onto
 * candidate actor kinds human/team/agent/software/supplier/partner. Agent
 * bodies and model bindings stay OPAQUE references (the provider/agent
 * plane owns those registries; the lab never queries the fabric).
 */
import type {
  ActorAssignment,
  CandidateActor,
  CapabilityAllocation,
  CapabilitySupplyRecord,
  DomainTimestamp,
  OrganizationCandidate,
  ProvenanceRecord,
  SubjectReference,
  TenantScope,
  ActorReference,
} from "@aurum/domain";
import type { ContextFingerprint, CapabilityDemand } from "../domain/fingerprint.js";
import type { BindingConstraint, LabConstraintSet } from "../domain/constraints.js";
import type { SearchStrategy } from "../domain/records.js";

/** Strategy preference orders over the W005 supplier-kind vocabulary. */
const STRATEGY_KIND_ORDERS: Readonly<Record<SearchStrategy, readonly string[]>> = {
  "human-led": ["employee", "team", "agent", "software", "supplier", "partner"],
  "agent-led": ["agent", "software", "employee", "team", "supplier", "partner"],
  "software-led": ["software", "agent", "employee", "team", "supplier", "partner"],
  external: ["supplier", "partner", "agent", "software", "employee", "team"],
  minimal: ["agent", "software", "employee", "team", "supplier", "partner"],
  balanced: ["employee", "agent", "software", "team", "supplier", "partner"],
};

export interface CompositionContext {
  readonly scope: TenantScope;
  readonly goalId?: string;
  readonly fingerprint: ContextFingerprint;
  readonly constraints: LabConstraintSet;
  readonly strategy: SearchStrategy;
  readonly horizon: { start: DomainTimestamp; end: DomainTimestamp };
  readonly now: DomainTimestamp;
  readonly proposedBy: ActorReference;
  readonly provenance: ProvenanceRecord;
  readonly evidenceRefs: readonly SubjectReference[];
  readonly requirementIds: readonly (string | undefined)[];
}

/** The structural parts the assembler finishes into a candidate. */
export interface BlueprintParts {
  readonly demand: readonly CapabilityDemand[];
  readonly actors: readonly CandidateActor[];
  readonly assignments: readonly ActorAssignment[];
  readonly allocations: readonly CapabilityAllocation[];
  readonly bindings: readonly BindingConstraint[];
  /** Actor id -> committed effort share (inspectability). */
  readonly committedEffort: ReadonlyMap<string, number>;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function actorOf(supply: CapabilitySupplyRecord): CandidateActor {
  const supplier = supply.supplier;
  const identity = {
    actorId: `actor:${supply.supplyId}`,
    displayName: supply.supplyId,
  };
  switch (supplier.kind) {
    case "employee":
      return {
        ...identity,
        kind: "human",
        ...(supplier.personId ? { personId: supplier.personId } : {}),
      } as CandidateActor;
    case "team":
      return {
        ...identity,
        kind: "team",
        ...(supplier.unitId ? { unitId: supplier.unitId } : {}),
      } as CandidateActor;
    case "agent":
      return {
        ...identity,
        kind: "agent",
        ...(supplier.externalRef ? { agentBodyRef: supplier.externalRef } : {}),
      } as CandidateActor;
    default:
      return {
        ...identity,
        kind: supplier.kind,
        ...(supplier.externalRef ? { externalRef: supplier.externalRef } : {}),
      } as CandidateActor;
  }
}

function availabilityOverlaps(
  supply: CapabilitySupplyRecord,
  window: { start: number; end: number },
): boolean {
  if (window.end <= window.start) return false;
  const from = supply.availableFrom ?? Number.NEGATIVE_INFINITY;
  const until = supply.availableUntil ?? Number.POSITIVE_INFINITY;
  return from <= window.end && until >= window.start;
}

/** Eligible supplies for one demand under one strategy's kind preference. */
export function eligibleSuppliesFor(
  supplies: readonly CapabilitySupplyRecord[],
  demand: CapabilityDemand,
  strategy: SearchStrategy,
  window: { start: number; end: number },
): readonly CapabilitySupplyRecord[] {
  const order = STRATEGY_KIND_ORDERS[strategy];
  return supplies
    .filter(
      (supply) =>
        supply.capabilityId === demand.capabilityId &&
        supply.level >= demand.requiredLevel &&
        availabilityOverlaps(supply, window),
    )
    .sort((a, b) => {
      const kindA = order.indexOf(a.supplier.kind);
      const kindB = order.indexOf(b.supplier.kind);
      if (kindA !== kindB) return kindA - kindB;
      if (a.level !== b.level) return b.level - a.level;
      const capA = a.capacityPerPeriod ?? 0;
      const capB = b.capacityPerPeriod ?? 0;
      if (capA !== capB) return capB - capA;
      return a.supplyId < b.supplyId ? -1 : a.supplyId > b.supplyId ? 1 : 0;
    });
}

interface SupplyPick {
  readonly supply: CapabilitySupplyRecord;
  readonly share: number;
}

/** Picks supplies for one demand (capacity-aware, headcount-aware). */
function pickSupplies(
  eligible: readonly CapabilitySupplyRecord[],
  demand: CapabilityDemand,
  humanHeadcount: { current: number },
  maxHeadcount: number | undefined,
  maxActors: number,
): SupplyPick[] {
  const picks: SupplyPick[] = [];
  let committed = 0;
  for (const supply of eligible) {
    if (picks.length >= maxActors) break;
    const kind = supply.supplier.kind;
    const isHumanLike = kind === "employee" || kind === "team";
    if (isHumanLike && maxHeadcount !== undefined && humanHeadcount.current >= maxHeadcount) {
      continue;
    }
    const capacity = supply.capacityPerPeriod ?? 0;
    const required = demand.requiredCapacityPerPeriod;
    const share =
      required === undefined || capacity <= 0 ? 1 : clamp01((required - committed) / capacity);
    if (share <= 0) break;
    picks.push({ supply, share });
    if (isHumanLike) humanHeadcount.current += 1;
    committed += share * capacity;
    if (required === undefined || committed >= required - 1e-9) break;
  }
  return picks;
}

/** Composes the structural parts of one candidate organization. */
export function composeBlueprintParts(
  pool: ReadonlyMap<string, readonly CapabilitySupplyRecord[]>,
  ctx: CompositionContext,
): BlueprintParts {
  const demand = ctx.fingerprint.axes.capabilityDemandProfile;
  const bindings: BindingConstraint[] = [];
  const actors = new Map<string, CandidateActor>();
  const picksByDemand = new Map<number, SupplyPick[]>();
  const humanHeadcount = { current: 0 };
  const maxHeadcount = ctx.constraints.staffing?.maxHeadcount;

  demand.forEach((entry, demandIndex) => {
    const eligible = eligibleSuppliesFor(pool.get(entry.capabilityId) ?? [], entry, ctx.strategy, {
      start: Math.max(ctx.now, ctx.horizon.start),
      end: ctx.horizon.end,
    });
    const picks = pickSupplies(
      eligible,
      entry,
      humanHeadcount,
      maxHeadcount,
      ctx.constraints.allocationLimits.maxActorsPerAllocation,
    );
    picksByDemand.set(demandIndex, picks);
    for (const pick of picks) actors.set(pick.supply.supplyId, actorOf(pick.supply));
  });

  if (maxHeadcount !== undefined && humanHeadcount.current >= maxHeadcount) {
    bindings.push({
      kind: "staffing.maxHeadcount",
      description: "composition stopped adding human/team actors at the staffing ceiling",
      value: humanHeadcount.current,
      limit: maxHeadcount,
    });
  }

  // Per-actor effort scaling: total committed effort per actor stays <= 1.
  const shareSums = new Map<string, number>();
  for (const picks of picksByDemand.values()) {
    for (const pick of picks) {
      const id = pick.supply.supplyId;
      shareSums.set(id, (shareSums.get(id) ?? 0) + pick.share);
    }
  }
  const scaleOf = new Map<string, number>();
  for (const [id, total] of shareSums) {
    scaleOf.set(id, total > 1 ? 1 / total : 1);
    if (total > 1 + 1e-9) {
      bindings.push({
        kind: "allocation.effortSaturation",
        description: `actor:${id} demand exceeds full effort; shares scaled proportionally`,
        value: Math.round(total * 100) / 100,
        limit: 1,
      });
    }
  }

  const assignments: ActorAssignment[] = [];
  const allocations: CapabilityAllocation[] = [];
  const committedEffort = new Map<string, number>();
  demand.forEach((entry, demandIndex) => {
    const picks = picksByDemand.get(demandIndex) ?? [];
    picks.forEach((pick, pickIndex) => {
      const scale = scaleOf.get(pick.supply.supplyId) ?? 1;
      const effortShare = Math.min(1, Math.max(pick.share * scale, 0.01));
      const actorId = `actor:${pick.supply.supplyId}`;
      assignments.push({
        assignmentId: `assign-${demandIndex}-${pickIndex}`,
        actorId,
        position: `owner:${entry.capabilityId}`,
        stepRefs: [`step:${entry.capabilityId}`],
        effortShare,
      });
      committedEffort.set(actorId, (committedEffort.get(actorId) ?? 0) + effortShare);
    });
    if (picks.length > 0) {
      const committedCapacity = picks.reduce((sum, pick) => {
        const scale = scaleOf.get(pick.supply.supplyId) ?? 1;
        return sum + pick.share * scale * (pick.supply.capacityPerPeriod ?? 0);
      }, 0);
      const required = entry.requiredCapacityPerPeriod;
      allocations.push({
        allocationId: `alloc-${demandIndex}`,
        capabilityId: entry.capabilityId as CapabilityAllocation["capabilityId"],
        ...(ctx.requirementIds[demandIndex]
          ? { requirementRef: ctx.requirementIds[demandIndex] }
          : {}),
        actorIds: Object.freeze(picks.map((pick) => `actor:${pick.supply.supplyId}`)),
        level: Math.max(...picks.map((pick) => pick.supply.level)),
        capacityPerPeriod: Math.round(committedCapacity * 100) / 100,
        ...(required !== undefined ? { workloadShare: clamp01(committedCapacity / required) } : {}),
      });
    }
  });

  return {
    demand,
    actors: Object.freeze([...actors.values()].sort((a, b) => (a.actorId < b.actorId ? -1 : 1))),
    assignments: Object.freeze(assignments),
    allocations: Object.freeze(allocations),
    bindings: Object.freeze(bindings),
    committedEffort,
  };
}

/** Convenience alias used by the assembler (full candidate type import). */
export type { OrganizationCandidate };
