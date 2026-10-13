/**
 * Emergence vocabulary (W014 domain layer): the frozen signal-kind and
 * proposal-state unions, the detection thresholds, the derivation rule ids
 * and the audit action kinds.
 *
 * THE CONDITIONING DISCIPLINE (W013, extended read-only): recurring-gap
 * grouping reuses the learning area's own key spaces — contextClassKey ×
 * organization shapeKey / failure kind / metric name. The keys themselves
 * are CARRIED VERBATIM from the intake records; this vocabulary adds no
 * second context authority (only the EMERGENCE record-id space, `gap:v1`,
 * which is deliberately a different space from the W013 class/shape keys).
 *
 * THE PROPOSE LAW (constitution): "Lab may simulate, evaluate, compare,
 * recommend, learn and propose roles. It may not authorize, install,
 * activate or execute." Emergence proposes; review is human-governed;
 * publication authority stays in the W011 marketplace machines.
 */

// --- signal kinds (the recurring-gap taxonomy; frozen) ---

export const EMERGENCE_SIGNAL_KINDS = [
  /** Recurring failed/missed outcomes in one context class with one failure kind. */
  "capability-shortfall",
  /** Recurring metric misses (observed < target) by metric name. */
  "metric-shortfall",
  /** A (context class × organization shape) cohort underperforming at the sample floor. */
  "shape-underperformance",
  /** Recurring failed/missed outcomes carrying allocation strain. */
  "effort-strain",
  /** Recurring cognition unknowns across distinct missions. */
  "knowledge-gap",
] as const;

export type EmergenceSignalKind = (typeof EMERGENCE_SIGNAL_KINDS)[number];

export function isKnownEmergenceSignalKind(value: string): value is EmergenceSignalKind {
  return (EMERGENCE_SIGNAL_KINDS as readonly string[]).includes(value);
}

// --- proposal lifecycle (proposed -> accepted | declined; terminal) ---

export const EMERGENCE_PROPOSAL_STATES = ["proposed", "accepted", "declined"] as const;

export type EmergenceProposalState = (typeof EMERGENCE_PROPOSAL_STATES)[number];

export function isKnownEmergenceProposalState(value: string): value is EmergenceProposalState {
  return (EMERGENCE_PROPOSAL_STATES as readonly string[]).includes(value);
}

/** proposed -> accepted | declined. accepted/declined are terminal. */
export const EMERGENCE_PROPOSAL_TRANSITIONS: Readonly<
  Record<EmergenceProposalState, readonly EmergenceProposalState[]>
> = {
  proposed: ["accepted", "declined"],
  accepted: [],
  declined: [],
};

export function emergenceProposalTransitionLegal(
  from: EmergenceProposalState,
  to: EmergenceProposalState,
): boolean {
  return (EMERGENCE_PROPOSAL_TRANSITIONS[from] as readonly string[]).includes(to);
}

// --- detection thresholds (documented, deterministic, caller-overridable) ---

/**
 * Default recurrence thresholds. `minRecurrence` mirrors the W013
 * CALIBRATION_LIMITS.minSamplesForFullWeight (3) — the same "thin evidence
 * moves nothing" discipline: a single failure is an incident, THREE
 * recurring failures are a gap. Shape cohorts additionally require the
 * sample floor before the failure RATE is trusted (mirrors the W013
 * conditional-evidence grouping discipline).
 */
export const EMERGENCE_THRESHOLDS = {
  /** Distinct failed/missed outcome ids (or unknown ids) required per gap. */
  minRecurrence: 3,
  /** Samples required before a (class × shape) cohort's failure rate counts. */
  minShapeSamples: 3,
  /** Failure rate (failed+missed)/samples at or above which a shape underperforms. */
  shapeFailureRate: 0.5,
  /** Allocation strain (totalEffortShare) at or above which an outcome is strained. */
  effortStrain: 0.9,
} as const;

export type EmergenceThresholds = typeof EMERGENCE_THRESHOLDS;

// --- derivation rule ids (recorded on every gap + proposal) ---

export const EMERGENCE_GAP_RULES = {
  "capability-shortfall": "emergence-capability-shortfall-v1",
  "metric-shortfall": "emergence-metric-shortfall-v1",
  "shape-underperformance": "emergence-shape-underperformance-v1",
  "effort-strain": "emergence-effort-strain-v1",
  "knowledge-gap": "emergence-knowledge-gap-v1",
} as const;

/** The alternatives derivation rule (recorded on every proposal). */
export const EMERGENCE_ALTERNATIVES_RULE = "emergence-alternatives-v1";

/** The catalog-draft projection rule (recorded on every projected draft). */
export const EMERGENCE_CATALOG_DRAFT_RULE = "emergence-catalog-draft-v1";

// --- audit action vocabulary (one kind per emergence transition) ---

export const EMERGENCE_AUDIT_ACTIONS = [
  "marketplace.emergence-proposed",
  "marketplace.emergence-accepted",
  "marketplace.emergence-declined",
] as const;

export type EmergenceAuditActionKind = (typeof EMERGENCE_AUDIT_ACTIONS)[number];

export function isKnownEmergenceAuditAction(value: string): value is EmergenceAuditActionKind {
  return (EMERGENCE_AUDIT_ACTIONS as readonly string[]).includes(value);
}
