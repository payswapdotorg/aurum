/**
 * Context-conditioned scoring weights (W008 domain layer, pure).
 *
 * The evaluation harness scores candidate organizations on four criteria
 * (spec/WORK-ITEM-CATALOG.md W008): coverage fit, capacity headroom, cost
 * proxy and occupancy realism. The weights are a DETERMINISTIC, documented
 * function of the ContextFingerprint — this is the mechanism that makes the
 * same subject yield different organizations under different contexts
 * (catalog acceptance clause 1): when the context changes, the weight vector
 * and the context modifiers change, and the ranking can flip.
 *
 * All weight tables are exact multiples of 0.05 and sum to exactly 1 (no
 * floating-point drift: computed in integer hundredths).
 *
 * Context modifiers (also pure functions of the fingerprint, documented on
 * every scored result):
 * - urgency premium: goal pressure "urgent" triples the human/team unit cost
 *   in the cost proxy (expedite/overtime proxy).
 * - interpretive discount: uncertainty "open" reduces the effective
 *   allocation level of non-human-only allocations by 1 (no in-house
 *   human/team actor in the loop: automated and externally contracted
 *   capacity is brittle against open interpretive questions).
 * - drift discount: freshness signal "stale" reduces the effective level of
 *   non-human-only allocations by 1 (capability claims about automated and
 *   contracted capacity age fast; re-verify before relying on them).
 */
import type { ContextFingerprint } from "./fingerprint.js";

/** The four scoring criteria (frozen list; the weights follow this order). */
export const SCORING_CRITERIA = [
  "coverageFit",
  "capacityHeadroom",
  "costProxy",
  "occupancyRealism",
] as const;

export type ScoringCriterion = (typeof SCORING_CRITERIA)[number];

/** Weight vector over the four criteria; always sums to exactly 1. */
export interface ScoringWeights {
  readonly coverageFit: number;
  readonly capacityHeadroom: number;
  readonly costProxy: number;
  readonly occupancyRealism: number;
  /** Documented derivation trace (inspectability: why these weights). */
  readonly derivation: string;
}

/** Context modifiers applied while scoring; recorded on every result. */
export interface ContextModifiers {
  /** Human/team unit cost multiplier in the cost proxy (1 or 3). */
  readonly urgencyPremium: number;
  /** Effective-level discount for non-human-only allocations (0 or 1). */
  readonly interpretiveDiscount: number;
  /** Effective-level discount for non-human-only allocations (0 or 1). */
  readonly driftDiscount: number;
  readonly derivation: string;
}

type WeightTable = Record<ScoringCriterion, number>;

interface WeightBook {
  readonly urgent: WeightTable;
  readonly standardOpen: WeightTable;
  readonly standard: WeightTable;
  readonly relaxedLong: WeightTable;
  readonly relaxed: WeightTable;
}

const HUNDREDTHS: WeightBook = {
  // urgency: coverage dominates; cost is consciously de-prioritized.
  urgent: { coverageFit: 45, capacityHeadroom: 10, costProxy: 20, occupancyRealism: 25 },
  // standard, open questions: keep slack for surprises (headroom up).
  standardOpen: { coverageFit: 40, capacityHeadroom: 25, costProxy: 15, occupancyRealism: 20 },
  // standard, otherwise: balanced.
  standard: { coverageFit: 40, capacityHeadroom: 15, costProxy: 30, occupancyRealism: 15 },
  // relaxed long horizon: sustained cost and stability dominate.
  relaxedLong: { coverageFit: 35, capacityHeadroom: 15, costProxy: 35, occupancyRealism: 15 },
  relaxed: { coverageFit: 40, capacityHeadroom: 15, costProxy: 30, occupancyRealism: 15 },
};

function weightsFrom(hundredths: WeightTable, derivation: string): ScoringWeights {
  const total = Object.values(hundredths).reduce((sum, value) => sum + value, 0);
  if (total !== 100) {
    throw new Error(`weight table must sum to 100 hundredths (got ${total})`);
  }
  return {
    coverageFit: hundredths.coverageFit / 100,
    capacityHeadroom: hundredths.capacityHeadroom / 100,
    costProxy: hundredths.costProxy / 100,
    occupancyRealism: hundredths.occupancyRealism / 100,
    derivation,
  };
}

/**
 * Deterministic weight vector for a fingerprint. Documented rules:
 * 1. goal pressure "urgent"            -> urgency table;
 * 2. uncertainty "open"                -> headroom raised (slack for surprises);
 * 3. pressure "relaxed" AND horizon
 *    "long"                             -> cost/stability table;
 * 4. otherwise                         -> balanced table.
 */
export function weightsForFingerprint(fingerprint: ContextFingerprint): ScoringWeights {
  const axes = fingerprint.axes;
  if (axes.goalPressure === "urgent") {
    return weightsFrom(
      HUNDREDTHS.urgent,
      "goal pressure urgent: coverage first, cost de-prioritized",
    );
  }
  if (axes.uncertaintyClass === "open") {
    return weightsFrom(
      HUNDREDTHS.standardOpen,
      "uncertainty open: capacity headroom raised for interpretive slack",
    );
  }
  if (axes.goalPressure === "relaxed" && axes.timeHorizon === "long") {
    return weightsFrom(
      HUNDREDTHS.relaxedLong,
      "relaxed pressure over a long horizon: sustained cost and stability dominate",
    );
  }
  if (axes.goalPressure === "relaxed") {
    return weightsFrom(HUNDREDTHS.relaxed, "relaxed pressure: balanced with cost focus");
  }
  return weightsFrom(HUNDREDTHS.standard, "standard context: balanced weights");
}

/** Deterministic context modifiers for a fingerprint. */
export function contextModifiersForFingerprint(fingerprint: ContextFingerprint): ContextModifiers {
  const axes = fingerprint.axes;
  const urgent = axes.goalPressure === "urgent";
  const open = axes.uncertaintyClass === "open";
  const stale = axes.freshnessSignal === "stale";
  const derivation = [
    urgent ? "urgency premium x3 on human/team cost (expedite proxy)" : "no urgency premium",
    open
      ? "interpretive discount -1 level on non-human-only allocations (open questions)"
      : "no interpretive discount",
    stale
      ? "drift discount -1 level on non-human-only allocations (stale capability evidence)"
      : "no drift discount",
  ].join("; ");
  return {
    urgencyPremium: urgent ? 3 : 1,
    interpretiveDiscount: open ? 1 : 0,
    driftDiscount: stale ? 1 : 0,
    derivation,
  };
}
