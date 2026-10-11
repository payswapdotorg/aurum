/**
 * Simulation/evaluation + ranking harness (W008 domain layer, pure).
 *
 * Scores candidate organizations against four inspectable criteria and ranks
 * them. The scoring function's weights, criteria raw values and context
 * modifiers are recorded on EVERY result (catalog clause 3); ranking is
 * DETERMINISTIC given the same inputs: weighted score descending, then
 * candidate id ascending (codepoint order) as the tiebreak.
 *
 * Criteria (all normalized to [0, 1], all computed from the candidate value
 * plus the context — no environment reads, no randomness):
 * - coverageFit        : fraction of the demand profile met at the required
 *                        level (after context modifiers) and capacity.
 * - capacityHeadroom   : 1 minus the busiest actor's committed effort share.
 * - costProxy          : normalized inverse of the unit-table cost estimate
 *                        (urgency premium included when the context is urgent).
 * - occupancyRealism   : ModelOccupancy sanity for agent actors (every agent
 *                        actor should hold a plausible, conflict-free
 *                        exclusive occupancy).
 */
import type {
  ActorAssignment,
  CandidateActor,
  CapabilityAllocation,
  ModelOccupancy,
  OrganizationCandidate,
} from "@aurum/domain";
import type { CapabilityDemand } from "./fingerprint.js";
import type { ContextModifiers, ScoringWeights } from "./weights.js";
import { costProxyOf } from "./constraints.js";

/** The four raw criterion values (inspectable; each in [0, 1]). */
export interface ScoredCriteria {
  readonly coverageFit: number;
  readonly capacityHeadroom: number;
  readonly costProxy: number;
  readonly occupancyRealism: number;
}

/** Everything the harness needs besides the candidate itself. */
export interface EvaluationContext {
  readonly demand: readonly CapabilityDemand[];
  readonly weights: ScoringWeights;
  readonly modifiers: ContextModifiers;
  /** Cost normalization reference (opaque units; from the constraint set). */
  readonly referenceBudget: number;
}

/** One scored candidate: raw criteria + the weighted total. */
export interface CandidateScore {
  readonly criteria: ScoredCriteria;
  readonly weightedScore: number;
}

const NON_HUMAN = new Set(["agent", "agent-team", "software", "automation"]);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Effective allocation level after context modifiers. Discounts apply only
 * when EVERY actor behind the allocation is non-human (a human in the loop
 * removes the discount — human oversight de-risks automation).
 */
export function effectiveLevelOf(
  allocation: CapabilityAllocation,
  actorKinds: ReadonlyMap<string, string>,
  modifiers: ContextModifiers,
): number {
  const actors = allocation.actorIds.map((actorId) => actorKinds.get(actorId));
  const allNonHuman =
    actors.length > 0 && actors.every((kind) => kind !== undefined && NON_HUMAN.has(kind));
  const discount = allNonHuman ? modifiers.interpretiveDiscount + modifiers.driftDiscount : 0;
  return Math.max(0, allocation.level - discount);
}

/** Coverage fit: fraction of demand entries met at level (post-modifiers) and capacity. */
export function coverageFitOf(
  candidate: OrganizationCandidate,
  demand: readonly CapabilityDemand[],
  modifiers: ContextModifiers,
): number {
  if (demand.length === 0) return 1;
  const actorKinds = new Map(candidate.actors.map((actor) => [actor.actorId, actor.kind]));
  let met = 0;
  for (const entry of demand) {
    const relevant = candidate.capabilityAllocations.filter(
      (allocation) => allocation.capabilityId === entry.capabilityId,
    );
    const levelOk = relevant.filter(
      (allocation) => effectiveLevelOf(allocation, actorKinds, modifiers) >= entry.requiredLevel,
    );
    if (levelOk.length === 0) continue;
    if (entry.requiredCapacityPerPeriod === undefined) {
      met += 1;
      continue;
    }
    const capacity = levelOk.reduce((sum, allocation) => sum + allocation.capacityPerPeriod, 0);
    if (capacity >= entry.requiredCapacityPerPeriod) met += 1;
  }
  return clamp01(met / demand.length);
}

/** Capacity headroom: 1 minus the busiest actor's committed effort share. */
export function capacityHeadroomOf(assignments: readonly ActorAssignment[]): number {
  if (assignments.length === 0) return 1;
  const committed = new Map<string, number>();
  for (const assignment of assignments) {
    committed.set(
      assignment.actorId,
      (committed.get(assignment.actorId) ?? 0) + assignment.effortShare,
    );
  }
  const busiest = Math.max(0, ...committed.values());
  return clamp01(1 - busiest);
}

/** Cost proxy: normalized inverse cost estimate against the reference budget. */
export function costProxyOfCandidate(
  candidate: OrganizationCandidate,
  modifiers: ContextModifiers,
  referenceBudget: number,
): number {
  const total = costProxyOf(candidate, modifiers.urgencyPremium);
  if (referenceBudget <= 0) return 0;
  return clamp01(1 - total / referenceBudget);
}

function windowsOverlap(a: ModelOccupancy, b: ModelOccupancy): boolean {
  return a.window.start < b.window.end && b.window.start < a.window.end;
}

/**
 * Occupancy realism via ModelOccupancy: agent actors should each hold at
 * least one valid occupancy entry; exclusive occupancies of the same model
 * binding must not overlap in time; occupancy on non-agent actors is invalid.
 */
export function occupancyRealismOf(
  actors: readonly CandidateActor[],
  occupancy: readonly ModelOccupancy[],
): number {
  const agentActors = actors.filter(
    (actor) => actor.kind === "agent" || actor.kind === "agent-team",
  );
  if (agentActors.length === 0) return 1;
  const valid = occupancy.filter(
    (entry) =>
      typeof entry?.modelBindingRef === "string" &&
      entry.modelBindingRef.trim().length > 0 &&
      entry.window.start <= entry.window.end,
  );
  const byActor = new Map<string, number>();
  const kinds = new Map(actors.map((actor) => [actor.actorId, actor.kind]));
  for (const entry of valid) {
    byActor.set(entry.actorId, (byActor.get(entry.actorId) ?? 0) + 1);
  }
  let score = 1;
  for (const actor of agentActors) {
    if ((byActor.get(actor.actorId) ?? 0) === 0) score -= 0.5;
  }
  for (const entry of valid) {
    const kind = kinds.get(entry.actorId);
    if (kind !== "agent" && kind !== "agent-team") score -= 1;
  }
  const exclusives = valid.filter((entry) => entry.exclusive);
  for (let i = 0; i < exclusives.length; i += 1) {
    for (let j = i + 1; j < exclusives.length; j += 1) {
      const first = exclusives[i];
      const second = exclusives[j];
      if (
        first &&
        second &&
        first.modelBindingRef === second.modelBindingRef &&
        windowsOverlap(first, second)
      ) {
        score -= 0.5;
      }
    }
  }
  return clamp01(score);
}

/** Scores one candidate. Pure and deterministic. */
export function scoreCandidate(
  candidate: OrganizationCandidate,
  context: EvaluationContext,
): CandidateScore {
  const criteria: ScoredCriteria = {
    coverageFit: round4(coverageFitOf(candidate, context.demand, context.modifiers)),
    capacityHeadroom: round4(capacityHeadroomOf(candidate.assignments)),
    costProxy: round4(costProxyOfCandidate(candidate, context.modifiers, context.referenceBudget)),
    occupancyRealism: round4(occupancyRealismOf(candidate.actors, candidate.modelOccupancy)),
  };
  const weightedScore = round4(
    criteria.coverageFit * context.weights.coverageFit +
      criteria.capacityHeadroom * context.weights.capacityHeadroom +
      criteria.costProxy * context.weights.costProxy +
      criteria.occupancyRealism * context.weights.occupancyRealism,
  );
  return { criteria, weightedScore };
}

/** The deterministic ranking rule identifier (recorded on every result). */
export const RANKING_RULE = "weighted-score-desc-then-candidate-id-asc";

/** Input to `rankCandidates`. */
export interface RankableCandidate {
  readonly candidate: OrganizationCandidate;
  readonly score: CandidateScore;
}

/**
 * Ranks scored candidates deterministically: weighted score descending, then
 * candidate id ascending (codepoint order — never locale collation).
 */
export function rankCandidates<T extends RankableCandidate>(items: readonly T[]): readonly T[] {
  return Object.freeze(
    [...items].sort((a, b) => {
      if (a.score.weightedScore !== b.score.weightedScore) {
        return b.score.weightedScore - a.score.weightedScore;
      }
      const aId = a.candidate.candidateId;
      const bId = b.candidate.candidateId;
      return aId < bId ? -1 : aId > bId ? 1 : 0;
    }),
  );
}
