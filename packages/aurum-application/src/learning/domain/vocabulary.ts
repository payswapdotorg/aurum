/**
 * Learning vocabulary (W013 domain layer): the frozen outcome-status and
 * outcome-source unions plus the calibration constants. The Lab + learning
 * loop is: search/evaluate (W008) -> select + run (W009/W006, human-gated)
 * -> observe the outcome -> JOIN the outcome to the full conditioning
 * context (this work item) -> calibrate future searches conditionally.
 *
 * The learning area PROPOSES and CALIBRATES; it never authorizes, installs,
 * activates or executes (the W008 tripwire law extends here unchanged —
 * spec/REBUILD-CONSTITUTION.md "Lab may simulate, evaluate, compare,
 * recommend, learn and propose roles").
 *
 * FAILED OUTCOMES ARE FIRST-CLASS (catalog acceptance clause 2): "missed"
 * and "failed" are recorded, counted and surfaced as calibration evidence —
 * never discarded. Only "achieved" counts as success; "partial" is visible
 * but neither success nor failure.
 */
export const OUTCOME_STATUSES = ["achieved", "partial", "missed", "failed"] as const;

export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export function isKnownOutcomeStatus(value: string): value is OutcomeStatus {
  return (OUTCOME_STATUSES as readonly string[]).includes(value);
}

/**
 * Where an outcome observation came from (frozen union):
 * - "mission": a W007 cognition mission reached its record stage;
 * - "plan": a W009 execution plan completed (with its task completions);
 * - "manual": an operator-recorded observation (the human override path).
 */
export const OUTCOME_SOURCE_KINDS = ["mission", "plan", "manual"] as const;

export type OutcomeSourceKind = (typeof OUTCOME_SOURCE_KINDS)[number];

export function isKnownOutcomeSourceKind(value: string): value is OutcomeSourceKind {
  return (OUTCOME_SOURCE_KINDS as readonly string[]).includes(value);
}

/** Failure classification (documented): missed + failed are failures. */
export function isFailedOutcomeStatus(status: OutcomeStatus): boolean {
  return status === "missed" || status === "failed";
}

/**
 * Calibration constants (documented, deterministic). The adjustment applied
 * to a ranked organization's weighted score is
 *
 *   adjustment = clamp(-penaltyCap, +boostCap,
 *                      (2 * achievedRate - 1) * sampleWeight * freshnessDecay)
 *
 * - sampleWeight ramps linearly to 1 at `minSamplesForFullWeight` samples
 *   (thin evidence moves rankings less than thick evidence);
 * - freshnessDecay shrinks the influence of aging/stale/unknown evidence
 *   (stale evidence is still VISIBLE — catalog clause 3 — it just carries
 *   less directional weight; it is never dropped);
 * - failures bite harder than successes help (asymmetric caps: a proven
 *   failure under a context class demotes up to -0.5, a proven success
 *   boosts at most +0.25) — conservative by design.
 */
export const CALIBRATION_LIMITS = {
  /** Samples at which the evidence reaches full directional weight. */
  minSamplesForFullWeight: 3,
  /** Maximum upward score adjustment (documented success boost cap). */
  boostCap: 0.25,
  /** Maximum downward score adjustment (failures bite harder). */
  penaltyCap: 0.5,
  /** Directional-weight multiplier per evidence freshness class. */
  freshnessDecay: {
    current: 1,
    aging: 0.5,
    stale: 0.25,
    unknown: 0.25,
  },
} as const;

/** The conditional ranking rule id (recorded on every calibrated result). */
export const CONDITIONAL_RANKING_RULE = "conditional-shape-evidence-v1";
