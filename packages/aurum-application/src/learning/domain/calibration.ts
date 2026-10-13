/**
 * Calibration (W013 domain layer, pure): aggregates outcome join records
 * into CONDITIONAL evidence and applies that evidence to a lab search
 * result — per (context class x organization shape), never globally.
 *
 * Acceptance mapping (spec/WORK-ITEM-CATALOG.md W013):
 * - "Lab learns conditional performance, not a universal best
 *   organization": evidence groups are keyed by conditioning pair and
 *   `applyConditionalCalibration` consumes ONLY evidence whose context
 *   class matches the search's own class (foreign-class evidence is
 *   ignored — test-locked isolation);
 * - "failed outcomes become calibration evidence": failures count into
 *   `failedCount`, their ids stay in `outcomeIds`, and the adjustment
 *   penalizes (asymmetric caps: failures bite harder);
 * - "stale evidence is visible": freshness is classified with the W002
 *   `classifyFreshness` AT CONSUMPTION TIME (the caller's `now`), surfaced
 *   per evidence group, and only DECAYS directional weight — never removes
 *   the evidence.
 *
 * Everything here is deterministic and IO-free: same inputs -> identical
 * outputs (byte-identical JSON), no randomness, no environment reads.
 */
import {
  classifyFreshness,
  DEFAULT_FRESHNESS_POLICY,
  err,
  ok,
  type DomainTimestamp,
  type FreshnessClass,
  type FreshnessPolicy,
  type Result,
} from "@aurum/domain";
import type { OrganizationSearchResult } from "../../lab/contract.lab.js";
import { CALIBRATION_LIMITS, CONDITIONAL_RANKING_RULE } from "./vocabulary.js";
import { contextClassOf } from "./contextClass.js";
import type { ContextClass } from "./contextClass.js";
import { organizationShapeOf } from "./shape.js";
import type { LearningError } from "./errors.js";
import type {
  CalibratedOrganization,
  CalibratedSearchResult,
  ConditionalEvidence,
  OutcomeJoinRecord,
} from "./records.js";

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Freshness of one outcome record at consumption time. The observation's
 * `observedAt` is the stamp; the W002 default policy classifies (missing
 * stamp -> "unknown" — absence of evidence is never silently fresh).
 */
export function outcomeFreshnessOf(
  record: OutcomeJoinRecord,
  now: DomainTimestamp,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): FreshnessClass {
  return classifyFreshness({ asOf: record.observation.observedAt }, now, policy);
}

function isStaleLike(freshness: FreshnessClass): boolean {
  return freshness === "stale" || freshness === "unknown";
}

interface EvidenceAccumulator {
  readonly contextClass: ContextClass;
  readonly shapeKey: string;
  readonly shapeCanonical: string;
  achieved: number;
  partial: number;
  failed: number;
  stale: number;
  outcomeIds: string[];
  lastObservedAt: DomainTimestamp | undefined;
  lastRecord: OutcomeJoinRecord | undefined;
}

/**
 * The bounded adjustment of one evidence group (documented formula):
 *
 *   adjustment = clamp(-penaltyCap, +boostCap,
 *                      (2 * achievedRate - 1) * sampleWeight) * freshnessDecay
 *
 * The clamp runs BEFORE the freshness decay (ruling): applying the decay
 * first would make it a no-op whenever the raw adjustment already sits at
 * (or beyond) a cap — aging evidence would bite exactly as hard as current
 * evidence whenever a shape's record is uniformly good or bad, which is the
 * common case at the sample floor. Clamping first guarantees the decay
 * ALWAYS shrinks the directional weight as evidence ages.
 */
function adjustmentOf(
  achievedRate: number,
  sampleCount: number,
  evidenceFreshness: FreshnessClass,
): number {
  const sampleWeight = Math.min(1, sampleCount / CALIBRATION_LIMITS.minSamplesForFullWeight);
  const capped = clamp(
    (2 * achievedRate - 1) * sampleWeight,
    -CALIBRATION_LIMITS.penaltyCap,
    CALIBRATION_LIMITS.boostCap,
  );
  return round4(capped * CALIBRATION_LIMITS.freshnessDecay[evidenceFreshness]);
}

/**
 * Aggregates outcome join records into conditional evidence groups keyed by
 * (context class, organization shape). Deterministic: groups are emitted in
 * (classKey, shapeKey) codepoint order. Freshness classes are computed at
 * the caller's `now` — the same records grow staler as time passes, and the
 * decay shrinks their directional weight while every count stays visible.
 */
export function calibrateEvidence(
  records: readonly OutcomeJoinRecord[],
  now: DomainTimestamp,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): readonly ConditionalEvidence[] {
  const groups = new Map<string, EvidenceAccumulator>();
  for (const record of records) {
    const key = `${record.contextClass.classKey}|${record.shape.shapeKey}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        contextClass: record.contextClass,
        shapeKey: record.shape.shapeKey,
        shapeCanonical: record.shape.canonical,
        achieved: 0,
        partial: 0,
        failed: 0,
        stale: 0,
        outcomeIds: [],
        lastObservedAt: undefined,
        lastRecord: undefined,
      };
      groups.set(key, group);
    }
    if (record.observation.status === "achieved") group.achieved += 1;
    else if (record.observation.status === "partial") group.partial += 1;
    else group.failed += 1;
    if (isStaleLike(outcomeFreshnessOf(record, now, policy))) group.stale += 1;
    group.outcomeIds.push(record.outcomeId);
    if (
      group.lastObservedAt === undefined ||
      record.observation.observedAt > group.lastObservedAt
    ) {
      group.lastObservedAt = record.observation.observedAt;
      group.lastRecord = record;
    }
  }
  const evidence: ConditionalEvidence[] = [];
  for (const group of [...groups.values()].sort((a, b) =>
    a.contextClass.classKey === b.contextClass.classKey
      ? a.shapeKey < b.shapeKey
        ? -1
        : a.shapeKey > b.shapeKey
          ? 1
          : 0
      : a.contextClass.classKey < b.contextClass.classKey
        ? -1
        : 1,
  )) {
    const sampleCount = group.achieved + group.partial + group.failed;
    if (sampleCount === 0 || group.lastRecord === undefined || group.lastObservedAt === undefined) {
      continue;
    }
    const achievedRate = group.achieved / sampleCount;
    const evidenceFreshness = outcomeFreshnessOf(group.lastRecord, now, policy);
    evidence.push({
      contextClass: group.contextClass,
      shapeKey: group.shapeKey,
      shapeCanonical: group.shapeCanonical,
      sampleCount,
      achievedCount: group.achieved,
      partialCount: group.partial,
      failedCount: group.failed,
      achievedRate: round4(achievedRate),
      adjustment: adjustmentOf(achievedRate, sampleCount, evidenceFreshness),
      evidenceFreshness,
      staleSampleCount: group.stale,
      outcomeIds: Object.freeze([...group.outcomeIds]),
      lastObservedAt: group.lastObservedAt,
    });
  }
  return Object.freeze(evidence);
}

/**
 * Applies conditional evidence to a W008 search result. Only evidence whose
 * context class matches the search's own context class is consumed —
 * evidence learned under a different context NEVER influences this ranking
 * (the conditional-performance law). Deterministic re-ranking: adjusted
 * score descending, then candidate id ascending (the W008 tiebreak
 * discipline, unchanged).
 */
export function applyConditionalCalibration(
  base: OrganizationSearchResult,
  evidence: readonly ConditionalEvidence[],
): Result<CalibratedSearchResult, LearningError> {
  const classOf = contextClassOf(base.fingerprintAxes);
  if (!classOf.ok) return err(classOf.error);
  const contextClass = classOf.value;
  const byShape = new Map<string, ConditionalEvidence>();
  for (const entry of evidence) {
    // Isolation law: foreign-class evidence is ignored outright.
    if (entry.contextClass.classKey !== contextClass.classKey) continue;
    if (!byShape.has(entry.shapeKey)) byShape.set(entry.shapeKey, entry);
  }

  const calibrated: CalibratedOrganization[] = base.ranked.map((entry) => {
    const shape = organizationShapeOf(entry.candidate);
    const matching = byShape.get(shape.shapeKey) ?? null;
    const adjustment = matching ? matching.adjustment : 0;
    return {
      baseRank: entry.rank,
      calibratedRank: 0,
      strategy: entry.strategy,
      candidate: entry.candidate,
      score: entry.score,
      bindingConstraints: entry.bindingConstraints,
      adjustedScore: round4(entry.score.weightedScore * (1 + adjustment)),
      adjustment,
      evidence: matching,
    };
  });

  const ranked = [...calibrated].sort((a, b) => {
    if (a.adjustedScore !== b.adjustedScore) return b.adjustedScore - a.adjustedScore;
    const aId = a.candidate.candidateId;
    const bId = b.candidate.candidateId;
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
  const ordered: CalibratedOrganization[] = ranked.map((entry, index) => ({
    ...entry,
    calibratedRank: index + 1,
  }));

  const matched = calibrated.filter((entry) => entry.evidence !== null).length;
  return ok({
    ...(base.goalId !== undefined ? { goalId: base.goalId } : {}),
    fingerprintDigest: base.fingerprintDigest,
    fingerprintAxes: base.fingerprintAxes,
    constraints: base.constraints,
    weights: base.weights,
    modifiers: base.modifiers,
    rankingRule: base.rankingRule,
    calibrationRule: CONDITIONAL_RANKING_RULE,
    contextClass,
    evidenceCoverage: { matched, total: calibrated.length },
    ranked: Object.freeze(ordered),
    excluded: base.excluded,
    poolSummary: base.poolSummary,
    evaluatedAt: base.evaluatedAt,
  });
}
