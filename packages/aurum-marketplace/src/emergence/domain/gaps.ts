/**
 * Gap detection (W014 domain layer): the pure, typed `EmergenceQuery`
 * surface that derives candidate RECURRING gaps from W013 evidence.
 *
 * NO-FABRICATION LAW: every gap cites the record ids it derives from —
 * `outcomeIds` / `unknownIds` are the VERBATIM ids of the contributing
 * intake records, `affectedGoalIds` / affected mission refs are carried
 * from those same records. A gap with no citations cannot exist (it is
 * built only by grouping real records).
 *
 * GROUPING LAW (W013 discipline, read-only): recurrence groups key on the
 * CARRIED conditioning keys — contextClassKey × failure kind (capability
 * shortfall), metric name (metric shortfall), contextClassKey × shapeKey
 * (shape underperformance), the strained outcomes themselves (effort
 * strain), and the unknown question text across distinct missions
 * (knowledge gap). Thresholds are caller-overridable with frozen defaults
 * (EMERGENCE_THRESHOLDS); `minRecurrence` defaults to 3, mirroring the W013
 * sample-floor discipline (thin evidence moves nothing).
 *
 * DETERMINISM (the W011 ranking law): no clock reads (`now` is a caller
 * input), no randomness, no environment reads. Gap ids are 16-hex FNV-1a
 * digests over a `gap:v1` canonical form — an EMERGENCE record-id space,
 * deliberately NOT the W013 class/shape key space (those are carried).
 * Output ordering: gapId ascending (codepoint). Repeated identical inputs
 * produce byte-identical outputs.
 */
import type { EmergenceOutcomeEvidence, EmergenceUnknownSignal } from "./evidence.js";
import { demandedCapabilitiesOf, isFailedEmergenceOutcomeStatus } from "./evidence.js";
import {
  EMERGENCE_GAP_RULES,
  EMERGENCE_THRESHOLDS,
  type EmergenceSignalKind,
} from "./vocabulary.js";
import type { EmergenceThresholds } from "./vocabulary.js";
import { emergenceValidationError } from "./errors.js";
import type { EmergenceError } from "./errors.js";
import { err, ok, type Result } from "../../marketplace/contract.marketplace.js";

/** The pure, typed gap-detection query. */
export interface EmergenceQuery {
  /** Caller-supplied evaluation time (epoch ms; NO clock reads inside). */
  readonly now: number;
  /** Optional overrides of the frozen recurrence thresholds. */
  readonly thresholds?: Partial<EmergenceThresholds>;
}

/** One derived recurring gap (pure value; never persisted by this area). */
export interface EmergenceGap {
  /** Deterministic 16-hex digest over the gap canonical form. */
  readonly gapId: string;
  readonly signalKind: EmergenceSignalKind;
  /** The recorded derivation rule id (inspectability). */
  readonly derivationRule: string;
  /** The W013 conditioning class key (carried; absent for knowledge gaps). */
  readonly contextClassKey?: string;
  /** The W013 organization-shape key (carried; shape signal only). */
  readonly shapeKey?: string;
  /** The demand signature of the contributing class (carried verbatim). */
  readonly demandSignature?: string;
  /** Demanded capabilities parsed from the demand signature (sorted). */
  readonly demandedCapabilities: readonly { capabilityId: string; level: number }[];
  /** Recurrence count = distinct contributing record ids. */
  readonly recurrenceCount: number;
  /** VERBATIM contributing outcome ids (never empty; the evidence chain). */
  readonly outcomeIds: readonly string[];
  /** VERBATIM contributing unknown ids (knowledge gaps only). */
  readonly unknownIds?: readonly string[];
  /** Affected goals (carried from contributing records; may be empty). */
  readonly affectedGoalIds: readonly string[];
  /** Affected mission/plan refs (carried from the outcome sources). */
  readonly affectedMissionRefs: readonly string[];
  /** Failure kind (capability signal) or metric name (metric signal). */
  readonly failureKind?: string;
  readonly metricName?: string;
  /** Sum of allocation strain across contributing outcomes (effort signal). */
  readonly effortShareSum?: number;
  /** Cohort counts (shape signal): samples + failures at the floor. */
  readonly cohortSamples?: number;
  readonly cohortFailures?: number;
  /** The query that produced this gap (verbatim; reproducibility). */
  readonly detectionQuery: EmergenceQuery;
}

/** FNV-1a 16-hex digest (the lab fingerprint-digest algorithm family). */
function emergenceDigest(canonical: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Gap id: `gap:v1` canonical form, distinct from the W013 key spaces. */
export function emergenceGapIdOf(signalKind: EmergenceSignalKind, groupKey: string): string {
  return emergenceDigest(`gap:v1|${signalKind}|${groupKey}`);
}

function thresholdsOf(query: EmergenceQuery): EmergenceThresholds {
  return { ...EMERGENCE_THRESHOLDS, ...query.thresholds };
}

function validateQuery(query: EmergenceQuery): EmergenceError | null {
  const issues = [];
  if (typeof query.now !== "number" || !Number.isFinite(query.now) || query.now < 0) {
    issues.push({ field: "now", problem: "must be finite epoch ms >= 0" });
  }
  const thresholds = query.thresholds;
  if (thresholds !== undefined) {
    if (thresholds !== null && typeof thresholds !== "object") {
      issues.push({ field: "thresholds", problem: "must be an object when present" });
    } else if (thresholds) {
      const minRecurrence = (thresholds as Partial<EmergenceThresholds>).minRecurrence;
      if (minRecurrence !== undefined && (!Number.isInteger(minRecurrence) || minRecurrence < 1)) {
        issues.push({ field: "thresholds.minRecurrence", problem: "must be an integer >= 1" });
      }
      const minShapeSamples = (thresholds as Partial<EmergenceThresholds>).minShapeSamples;
      if (
        minShapeSamples !== undefined &&
        (!Number.isInteger(minShapeSamples) || minShapeSamples < 1)
      ) {
        issues.push({ field: "thresholds.minShapeSamples", problem: "must be an integer >= 1" });
      }
      const shapeFailureRate = (thresholds as Partial<EmergenceThresholds>).shapeFailureRate;
      if (
        shapeFailureRate !== undefined &&
        (typeof shapeFailureRate !== "number" ||
          !Number.isFinite(shapeFailureRate) ||
          shapeFailureRate <= 0 ||
          shapeFailureRate > 1)
      ) {
        issues.push({
          field: "thresholds.shapeFailureRate",
          problem: "must be finite in (0, 1]",
        });
      }
      const effortStrain = (thresholds as Partial<EmergenceThresholds>).effortStrain;
      if (
        effortStrain !== undefined &&
        (typeof effortStrain !== "number" || !Number.isFinite(effortStrain) || effortStrain <= 0)
      ) {
        issues.push({ field: "thresholds.effortStrain", problem: "must be finite and > 0" });
      }
    }
  }
  if (issues.length > 0) return emergenceValidationError(issues);
  return null;
}

interface OutcomeAccumulator {
  readonly outcomeIds: string[];
  readonly goalIds: string[];
  readonly missionRefs: string[];
  effortShareSum: number;
}

function accumulateOutcome(
  accumulator: OutcomeAccumulator,
  record: EmergenceOutcomeEvidence,
): void {
  accumulator.outcomeIds.push(record.outcomeId);
  if (record.goalId !== undefined) accumulator.goalIds.push(record.goalId);
  accumulator.missionRefs.push(record.observation.source.ref);
  accumulator.effortShareSum += record.allocation.totalEffortShare;
}

function dedupeSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function sortedIds(values: readonly string[]): readonly string[] {
  return Object.freeze([...values].sort());
}

/**
 * Derives candidate recurring gaps from W013-shaped evidence. PURE: same
 * inputs -> byte-identical gaps (gapId ascending). Failures are
 * first-class (missed + failed, the W013 law). Every gap cites its
 * contributing record ids verbatim.
 */
export function detectEmergenceGaps(
  evidence: readonly EmergenceOutcomeEvidence[],
  unknowns: readonly EmergenceUnknownSignal[],
  query: EmergenceQuery,
): Result<readonly EmergenceGap[], EmergenceError> {
  const queryError = validateQuery(query);
  if (queryError) return err(queryError);
  const thresholds = thresholdsOf(query);
  const gaps: EmergenceGap[] = [];

  // --- signal 1: capability shortfall (contextClassKey x failure kind) ---
  const capabilityGroups = new Map<string, EmergenceOutcomeEvidence[]>();
  for (const record of evidence) {
    if (!isFailedEmergenceOutcomeStatus(record.observation.status)) continue;
    const failureKind = record.observation.failure?.kind;
    if (failureKind === undefined) continue;
    const key = `${record.contextClass.classKey}|${failureKind}`;
    const bucket = capabilityGroups.get(key) ?? [];
    bucket.push(record);
    capabilityGroups.set(key, bucket);
  }
  for (const [key, records] of capabilityGroups) {
    if (records.length < thresholds.minRecurrence) continue;
    const [contextClassKey, failureKind] = key.split("|");
    const first = records[0];
    if (!first || !contextClassKey || !failureKind) continue;
    const accumulator: OutcomeAccumulator = {
      outcomeIds: [],
      goalIds: [],
      missionRefs: [],
      effortShareSum: 0,
    };
    for (const record of records) accumulateOutcome(accumulator, record);
    gaps.push({
      gapId: emergenceGapIdOf("capability-shortfall", key),
      signalKind: "capability-shortfall",
      derivationRule: EMERGENCE_GAP_RULES["capability-shortfall"],
      contextClassKey,
      demandSignature: first.contextClass.demandSignature,
      demandedCapabilities: demandedOf(first),
      recurrenceCount: records.length,
      outcomeIds: sortedIds(accumulator.outcomeIds),
      affectedGoalIds: dedupeSorted(accumulator.goalIds),
      affectedMissionRefs: dedupeSorted(accumulator.missionRefs),
      failureKind,
      effortShareSum: round4(accumulator.effortShareSum),
      detectionQuery: query,
    });
  }

  // --- signal 2: metric shortfall (metric name, failed/missed only) ---
  // RULING: the W013 outcome STATUS is the failure authority — emergence
  // groups recurring failures by the metric name they carry and NEVER
  // re-interprets metric polarity (observed-vs-target direction belongs to
  // whoever recorded the outcome; a second judgment layer here would be a
  // second evidence system).
  const metricGroups = new Map<string, EmergenceOutcomeEvidence[]>();
  for (const record of evidence) {
    if (!isFailedEmergenceOutcomeStatus(record.observation.status)) continue;
    const metric = record.observation.metric;
    if (metric === undefined) continue;
    const bucket = metricGroups.get(metric.metric) ?? [];
    bucket.push(record);
    metricGroups.set(metric.metric, bucket);
  }
  for (const [metricName, records] of metricGroups) {
    if (records.length < thresholds.minRecurrence) continue;
    const first = records[0];
    if (!first) continue;
    const accumulator: OutcomeAccumulator = {
      outcomeIds: [],
      goalIds: [],
      missionRefs: [],
      effortShareSum: 0,
    };
    for (const record of records) accumulateOutcome(accumulator, record);
    gaps.push({
      gapId: emergenceGapIdOf("metric-shortfall", metricName),
      signalKind: "metric-shortfall",
      derivationRule: EMERGENCE_GAP_RULES["metric-shortfall"],
      contextClassKey: first.contextClass.classKey,
      demandSignature: first.contextClass.demandSignature,
      demandedCapabilities: demandedOf(first),
      recurrenceCount: records.length,
      outcomeIds: sortedIds(accumulator.outcomeIds),
      affectedGoalIds: dedupeSorted(accumulator.goalIds),
      affectedMissionRefs: dedupeSorted(accumulator.missionRefs),
      metricName,
      effortShareSum: round4(accumulator.effortShareSum),
      detectionQuery: query,
    });
  }

  // --- signal 3: shape underperformance (contextClassKey x shapeKey cohort) ---
  const shapeGroups = new Map<string, EmergenceOutcomeEvidence[]>();
  for (const record of evidence) {
    const key = `${record.contextClass.classKey}|${record.shape.shapeKey}`;
    const bucket = shapeGroups.get(key) ?? [];
    bucket.push(record);
    shapeGroups.set(key, bucket);
  }
  for (const [key, records] of shapeGroups) {
    if (records.length < thresholds.minShapeSamples) continue;
    const failures = records.filter((record) =>
      isFailedEmergenceOutcomeStatus(record.observation.status),
    );
    const failureRate = failures.length / records.length;
    if (failureRate < thresholds.shapeFailureRate) continue;
    const [contextClassKey, shapeKey] = key.split("|");
    const first = records[0];
    if (!first || !contextClassKey || !shapeKey) continue;
    const accumulator: OutcomeAccumulator = {
      outcomeIds: [],
      goalIds: [],
      missionRefs: [],
      effortShareSum: 0,
    };
    for (const record of records) accumulateOutcome(accumulator, record);
    gaps.push({
      gapId: emergenceGapIdOf("shape-underperformance", key),
      signalKind: "shape-underperformance",
      derivationRule: EMERGENCE_GAP_RULES["shape-underperformance"],
      contextClassKey,
      shapeKey,
      demandSignature: first.contextClass.demandSignature,
      demandedCapabilities: demandedOf(first),
      recurrenceCount: failures.length,
      outcomeIds: sortedIds(accumulator.outcomeIds),
      affectedGoalIds: dedupeSorted(accumulator.goalIds),
      affectedMissionRefs: dedupeSorted(accumulator.missionRefs),
      effortShareSum: round4(accumulator.effortShareSum),
      cohortSamples: records.length,
      cohortFailures: failures.length,
      detectionQuery: query,
    });
  }

  // --- signal 4: effort strain (recurring strained failures) ---
  const strained = evidence.filter(
    (record) =>
      isFailedEmergenceOutcomeStatus(record.observation.status) &&
      record.allocation.totalEffortShare >= thresholds.effortStrain,
  );
  if (strained.length >= thresholds.minRecurrence) {
    const first = strained[0];
    if (first) {
      const accumulator: OutcomeAccumulator = {
        outcomeIds: [],
        goalIds: [],
        missionRefs: [],
        effortShareSum: 0,
      };
      for (const record of strained) accumulateOutcome(accumulator, record);
      gaps.push({
        gapId: emergenceGapIdOf("effort-strain", "tenant"),
        signalKind: "effort-strain",
        derivationRule: EMERGENCE_GAP_RULES["effort-strain"],
        contextClassKey: first.contextClass.classKey,
        demandSignature: first.contextClass.demandSignature,
        demandedCapabilities: demandedOf(first),
        recurrenceCount: strained.length,
        outcomeIds: sortedIds(accumulator.outcomeIds),
        affectedGoalIds: dedupeSorted(accumulator.goalIds),
        affectedMissionRefs: dedupeSorted(accumulator.missionRefs),
        effortShareSum: round4(accumulator.effortShareSum),
        detectionQuery: query,
      });
    }
  }

  // --- signal 5: knowledge gap (recurring unknowns across distinct missions) ---
  const unknownGroups = new Map<string, EmergenceUnknownSignal[]>();
  for (const unknown of unknowns) {
    const bucket = unknownGroups.get(unknown.question) ?? [];
    bucket.push(unknown);
    unknownGroups.set(unknown.question, bucket);
  }
  for (const [question, signals] of unknownGroups) {
    const distinctMissions = new Set(signals.map((signal) => signal.missionRef));
    if (distinctMissions.size < thresholds.minRecurrence) continue;
    gaps.push({
      gapId: emergenceGapIdOf("knowledge-gap", question),
      signalKind: "knowledge-gap",
      derivationRule: EMERGENCE_GAP_RULES["knowledge-gap"],
      demandedCapabilities: [],
      recurrenceCount: signals.length,
      outcomeIds: [],
      unknownIds: sortedIds(signals.map((signal) => signal.unknownId)),
      affectedGoalIds: dedupeSorted(
        signals.map((signal) => signal.goalId).filter((id): id is string => id !== undefined),
      ),
      affectedMissionRefs: sortedIds([...distinctMissions]),
      detectionQuery: query,
    });
  }

  return ok(
    Object.freeze(gaps.sort((a, b) => (a.gapId < b.gapId ? -1 : a.gapId > b.gapId ? 1 : 0))),
  );
}

function demandedOf(
  record: EmergenceOutcomeEvidence,
): readonly { capabilityId: string; level: number }[] {
  return demandedCapabilitiesOf(record.contextClass.demandSignature);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Narrows the failure status law for consumers/tests. */
export function outcomeStatusIsFailure(status: string): boolean {
  return status === "missed" || status === "failed";
}
