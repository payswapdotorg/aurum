/**
 * ContextFingerprint (W008 domain layer): a structured, serializable
 * fingerprint of the situational context that meaningfully influences
 * organization choice (spec/ARCHITECTURE.md "Organizational Lab": the Lab
 * consumes "goal + context fingerprint + ... + freshness + ... + capability
 * graph + ...").
 *
 * Axes and their source seams (each axis is derived, never invented):
 * - goalPressure        <- GoalLedger: current goal revision `priority`
 *                          (critical -> urgent, high/medium -> standard,
 *                          low -> relaxed).
 * - timeHorizon         <- GoalLedger: current revision horizon window length
 *                          (< 1 day immediate, < 7 days short,
 *                          < 90 days medium, otherwise long).
 * - uncertaintyClass    <- InquiryLedger/EpistemicsLedger: open unknowns and
 *                          open contradictions related to the subject
 *                          (any contradiction or >= 3 unknowns -> open,
 *                          >= 1 unknown -> bounded, otherwise known).
 * - freshnessSignal     <- EvidenceLedger/CapabilityGraph: worst freshness
 *                          class among the situation's evidence signals
 *                          (supply freshness stamps, goal expected-evidence
 *                          freshness), classified with `classifyFreshness`.
 * - capabilityDemandProfile <- CapabilityGraph: the subject's capability
 *                          requirements, canonicalized (sorted by capability
 *                          id, one entry per capability).
 *
 * Determinism contract: the constructor is pure. The same situation input
 * produces the identical fingerprint (byte-identical canonical form and
 * digest); two different situations can produce different fingerprints
 * (test-locked). No timestamps are embedded — a fingerprint identifies a
 * context, not a moment.
 */
import { isKnownGoalPriority, type GoalPriority, type ValidationIssue } from "@aurum/domain";
import { err, ok, type Result } from "@aurum/domain";
import type { LabError } from "./errors.js";
import { labValidationError } from "./errors.js";

/** Goal pressure axis (derived from the goal priority vocabulary, W002). */
export const GOAL_PRESSURE_CLASSES = ["urgent", "standard", "relaxed"] as const;
export type GoalPressureClass = (typeof GOAL_PRESSURE_CLASSES)[number];

/** Time horizon axis (derived from the goal horizon window, W002). */
export const TIME_HORIZON_CLASSES = ["immediate", "short", "medium", "long"] as const;
export type TimeHorizonClass = (typeof TIME_HORIZON_CLASSES)[number];

/** Epistemic uncertainty axis (derived from open unknowns/contradictions). */
export const UNCERTAINTY_CLASSES = ["known", "bounded", "open"] as const;
export type UncertaintyClass = (typeof UNCERTAINTY_CLASSES)[number];

/**
 * Information freshness signal axis. Rank order (worst to best):
 * stale < unknown < aging < current. An empty signal list is "unknown" —
 * absence of evidence is never silently treated as fresh.
 */
export const FRESHNESS_SIGNALS = ["stale", "unknown", "aging", "current"] as const;
export type FreshnessSignal = (typeof FRESHNESS_SIGNALS)[number];

const FRESHNESS_SIGNAL_RANK: Readonly<Record<FreshnessSignal, number>> = {
  stale: 0,
  unknown: 1,
  aging: 2,
  current: 3,
};

/** One capability demand entry (from a capability requirement, W005). */
export interface CapabilityDemand {
  readonly capabilityId: string;
  readonly requiredLevel: number;
  readonly requiredCapacityPerPeriod?: number;
}

/** The situation snapshot the fingerprint is computed from (plain data). */
export interface FingerprintInput {
  /** Goal priority (GoalLedger vocabulary: critical/high/medium/low). */
  readonly goalPriority: string;
  /** Goal horizon window (epoch ms, start <= end). */
  readonly horizon: { readonly start: number; readonly end: number };
  /** Open unknowns related to the subject (InquiryLedger count). */
  readonly openUnknowns: number;
  /** Open contradictions related to the subject (EpistemicsLedger count). */
  readonly openContradictions: number;
  /** Freshness classes of the situation's evidence signals (worst wins). */
  readonly evidenceFreshness: readonly string[];
  /** The subject's capability demand profile (CapabilityGraph requirements). */
  readonly capabilityDemand: readonly CapabilityDemand[];
}

/** The structured fingerprint value: axes + canonical form + digest. */
export interface ContextFingerprint {
  readonly axes: {
    readonly goalPressure: GoalPressureClass;
    readonly timeHorizon: TimeHorizonClass;
    readonly uncertaintyClass: UncertaintyClass;
    readonly freshnessSignal: FreshnessSignal;
    readonly capabilityDemandProfile: readonly CapabilityDemand[];
  };
  /** Human-readable canonical serialization (stable field order). */
  readonly canonical: string;
  /** 16-hex deterministic digest of the canonical form (FNV-1a, two lanes). */
  readonly digest: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function goalPressureOf(priority: GoalPriority): GoalPressureClass {
  if (priority === "critical") return "urgent";
  if (priority === "low") return "relaxed";
  return "standard";
}

function timeHorizonOf(start: number, end: number): TimeHorizonClass {
  const duration = end - start;
  if (duration < DAY_MS) return "immediate";
  if (duration < 7 * DAY_MS) return "short";
  if (duration < 90 * DAY_MS) return "medium";
  return "long";
}

function uncertaintyOf(unknowns: number, contradictions: number): UncertaintyClass {
  if (contradictions > 0 || unknowns >= 3) return "open";
  if (unknowns >= 1) return "bounded";
  return "known";
}

function worstFreshness(signals: readonly string[]): FreshnessSignal {
  let worst: FreshnessSignal = "unknown";
  let worstRank = FRESHNESS_SIGNAL_RANK.unknown;
  for (const signal of signals) {
    const rank = FRESHNESS_SIGNAL_RANK[signal as FreshnessSignal];
    if (typeof rank === "number" && rank < worstRank) {
      worst = signal as FreshnessSignal;
      worstRank = rank;
    }
  }
  return worst;
}

/** FNV-1a 32-bit lane; the digest runs two independent lanes (64 bits total). */
function fnv1a32(data: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < data.length; index += 1) {
    hash ^= data.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic 16-hex digest (pure; no crypto/IO in the lab domain layer). */
export function fingerprintDigest(canonical: string): string {
  const laneA = fnv1a32(canonical, 0x811c9dc5);
  const laneB = fnv1a32(canonical, 0x9dc5811c);
  return `${laneA.toString(16).padStart(8, "0")}${laneB.toString(16).padStart(8, "0")}`;
}

function canonicalDemand(demand: readonly CapabilityDemand[]): string {
  return demand
    .map((entry) => {
      const capacity =
        entry.requiredCapacityPerPeriod === undefined ? "" : `:${entry.requiredCapacityPerPeriod}`;
      return `${entry.capabilityId}:${entry.requiredLevel}${capacity}`;
    })
    .join(",");
}

/** Builds the canonical serialization (stable order, no timestamps). */
export function canonicalFingerprint(axes: ContextFingerprint["axes"]): string {
  return [
    "fp:v1",
    `pressure=${axes.goalPressure}`,
    `horizon=${axes.timeHorizon}`,
    `uncertainty=${axes.uncertaintyClass}`,
    `freshness=${axes.freshnessSignal}`,
    `demand=${canonicalDemand(axes.capabilityDemandProfile)}`,
  ].join("|");
}

/** Validates a fingerprint input. Returns issues, empty when valid. */
export function fingerprintIssues(input: FingerprintInput | undefined): ValidationIssue[] {
  if (!input || typeof input !== "object") {
    return [{ field: "fingerprint", problem: "situation input is required" }];
  }
  const issues: ValidationIssue[] = [];
  if (!isKnownGoalPriority(String(input.goalPriority))) {
    issues.push({ field: "goalPriority", problem: "must be a known goal priority" });
  }
  const horizon = input.horizon;
  if (
    typeof horizon?.start !== "number" ||
    !Number.isFinite(horizon.start) ||
    horizon.start < 0 ||
    typeof horizon?.end !== "number" ||
    !Number.isFinite(horizon.end) ||
    horizon.end < 0 ||
    horizon.start > horizon.end
  ) {
    issues.push({ field: "horizon", problem: "must be a valid time window" });
  }
  for (const key of ["openUnknowns", "openContradictions"] as const) {
    const value = input[key];
    if (!Number.isInteger(value) || value < 0) {
      issues.push({ field: key, problem: "must be a non-negative integer" });
    }
  }
  const signals = Array.isArray(input.evidenceFreshness) ? input.evidenceFreshness : [];
  signals.forEach((signal, index) => {
    if (!(FRESHNESS_SIGNALS as readonly string[]).includes(String(signal))) {
      issues.push({
        field: `evidenceFreshness.${index}`,
        problem: "must be a known freshness class",
      });
    }
  });
  const demand = Array.isArray(input.capabilityDemand) ? input.capabilityDemand : [];
  if (demand.length === 0) {
    issues.push({
      field: "capabilityDemand",
      problem: "must contain at least one capability demand entry",
    });
  }
  const seen = new Set<string>();
  demand.forEach((entry, index) => {
    const field = `capabilityDemand.${index}`;
    if (
      !entry ||
      typeof entry.capabilityId !== "string" ||
      entry.capabilityId.trim().length === 0
    ) {
      issues.push({ field: `${field}.capabilityId`, problem: "must be a non-empty reference" });
    } else if (seen.has(entry.capabilityId)) {
      issues.push({
        field: `${field}.capabilityId`,
        problem: `duplicate capability id: ${entry.capabilityId}`,
      });
    } else {
      seen.add(entry.capabilityId);
    }
    if (
      !Number.isInteger(entry?.requiredLevel) ||
      (entry?.requiredLevel ?? 0) < 1 ||
      (entry?.requiredLevel ?? 0) > 5
    ) {
      issues.push({ field: `${field}.requiredLevel`, problem: "must be an integer level in 1..5" });
    }
    const capacity = entry?.requiredCapacityPerPeriod;
    if (
      capacity !== undefined &&
      (typeof capacity !== "number" || !Number.isFinite(capacity) || capacity < 0)
    ) {
      issues.push({
        field: `${field}.requiredCapacityPerPeriod`,
        problem: "must be a non-negative number when present",
      });
    }
  });
  return issues;
}

/**
 * The pure fingerprint constructor. Deterministic: identical inputs produce
 * identical canonical forms and digests. Invalid inputs fail with a typed
 * validation error carrying the issue list.
 */
export function contextFingerprint(input: FingerprintInput): Result<ContextFingerprint, LabError> {
  const issues = fingerprintIssues(input);
  if (issues.length > 0) {
    return err(labValidationError(issues));
  }
  const priority = input.goalPriority as GoalPriority;
  // Codepoint order (NOT localeCompare): the digest must be identical in
  // every runtime environment — locale collation would break determinism.
  const demand = [...input.capabilityDemand].sort((a, b) =>
    a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0,
  );
  const axes: ContextFingerprint["axes"] = Object.freeze({
    goalPressure: goalPressureOf(priority),
    timeHorizon: timeHorizonOf(input.horizon.start, input.horizon.end),
    uncertaintyClass: uncertaintyOf(input.openUnknowns, input.openContradictions),
    freshnessSignal: worstFreshness(input.evidenceFreshness),
    capabilityDemandProfile: Object.freeze(demand),
  });
  const canonical = canonicalFingerprint(axes);
  return ok(Object.freeze({ axes, canonical, digest: fingerprintDigest(canonical) }));
}
