/**
 * Company subject query (W004 app layer): "what do we know about X?" — the
 * honest answer. Assembles the read-side evidence (observations, belief ←
 * claim ← observation chains, memory versions), classifies it through the
 * pure honesty classifier, and makes every blind spot explicit. Records are
 * unique per seam (the kernel indexes by id); the answer never duplicates a
 * record, and a belief is reported as asserted only while its support is
 * re-derived as active on this read.
 */
import type {
  DomainTimestamp,
  FreshnessPolicy,
  SubjectReference,
  TenantScope,
} from "@aurum/domain";
import { gatherSubjectEvidence, type SubjectEvidence } from "./evidenceGathering.js";
import { expectedReadingsFor, type ExpectedEvidenceReading } from "./coverageQuery.js";
import {
  classifySubjectKnowledge,
  worstSupportFreshness,
  type ClassificationOutcome,
} from "../domain/classification.js";
import type { BeliefEntry, BlindSpot, CompanyAnswer } from "../domain/records.js";
import type { CompanyDomainViews } from "../domain/ports.js";

/** Freshness that can still be relied on as current. */
const RELIABLE_FRESHNESS: readonly BeliefEntry["freshness"][] = ["current", "aging"];

const BLIND_SPOT_ORDER: readonly BlindSpot["kind"][] = [
  "open-unknown",
  "open-contradiction",
  "stale-evidence",
  "missing-expected-evidence",
];

function byKindThenRecordId(left: BlindSpot, right: BlindSpot): number {
  const kindDelta = BLIND_SPOT_ORDER.indexOf(left.kind) - BLIND_SPOT_ORDER.indexOf(right.kind);
  if (kindDelta !== 0) return kindDelta;
  return (left.recordId ?? "").localeCompare(right.recordId ?? "");
}

/**
 * Blind spots of the subject's own evidence: usable records whose freshness
 * cannot be relied on, and asserted beliefs resting on expired support.
 * These are the honest counterparts of the answer's entries — the entries
 * say what was recorded; the blind spots say what cannot be relied upon.
 */
function evidenceBlindSpots(evidence: SubjectEvidence): BlindSpot[] {
  const spots: BlindSpot[] = [];
  for (const observation of evidence.observations) {
    if (observation.status !== "active") continue;
    if (RELIABLE_FRESHNESS.includes(observation.freshness)) continue;
    spots.push({
      kind: "stale-evidence",
      subject: evidence.subject,
      description: `observation "${observation.content}" is ${observation.freshness}`,
      recordId: observation.recordId,
    });
  }
  for (const memory of evidence.memories) {
    if (RELIABLE_FRESHNESS.includes(memory.freshness)) continue;
    spots.push({
      kind: "stale-evidence",
      subject: evidence.subject,
      description: `memory version ${memory.version} is ${memory.freshness}`,
      recordId: memory.recordId,
    });
  }
  for (const belief of evidence.beliefs) {
    if (!belief.asserted) continue;
    const worst = worstSupportFreshness(belief);
    if (worst !== undefined && RELIABLE_FRESHNESS.includes(worst)) continue;
    spots.push({
      kind: "stale-evidence",
      subject: evidence.subject,
      description: `belief ${belief.beliefId} revision ${belief.revision} rests on ${worst}-freshness support`,
      recordId: belief.recordId,
    });
  }
  return spots;
}

/** Inquiry blind spots: recorded open unknowns and retained contradictions. */
function inquiryBlindSpots(evidence: SubjectEvidence): BlindSpot[] {
  const spots: BlindSpot[] = [];
  for (const unknown of evidence.openUnknowns) {
    spots.push({
      kind: "open-unknown",
      subject: evidence.subject,
      description: unknown.question,
      consequence: unknown.consequence,
      raisedAt: unknown.raisedAt,
      recordId: unknown.unknownId,
    });
  }
  for (const contradiction of evidence.openContradictions) {
    spots.push({
      kind: "open-contradiction",
      subject: evidence.subject,
      description: contradiction.description,
      recordId: contradiction.contradictionId,
    });
  }
  return spots;
}

/** Expectation blind spots for goal subjects (expected evidence gaps). */
function expectationBlindSpots(
  evidence: SubjectEvidence,
  readings: readonly ExpectedEvidenceReading[],
): BlindSpot[] {
  const spots: BlindSpot[] = [];
  for (const reading of readings) {
    if (reading.status === "covered") continue;
    if (reading.status === "stale") {
      spots.push({
        kind: "stale-evidence",
        subject: evidence.subject,
        description: `expected evidence "${reading.description}" only has ${reading.freshness}-freshness observations`,
        recordId: reading.evidenceRecordId,
      });
    } else {
      spots.push({
        kind: "missing-expected-evidence",
        subject: evidence.subject,
        description: `expected evidence "${reading.description}" has no usable observations`,
      });
    }
  }
  return spots;
}

/** Assembles the blind-spot list: inquiry, own evidence, expectations. */
export function blindSpotsOfSubject(
  evidence: SubjectEvidence,
  readings: readonly ExpectedEvidenceReading[],
): readonly BlindSpot[] {
  const spots = [
    ...inquiryBlindSpots(evidence),
    ...evidenceBlindSpots(evidence),
    ...expectationBlindSpots(evidence, readings),
  ];
  return Object.freeze([...spots].sort(byKindThenRecordId));
}

/** Classifies the gathered evidence (four paths, one per answer). */
export function classifyEvidence(evidence: SubjectEvidence): ClassificationOutcome {
  return classifySubjectKnowledge({
    observations: evidence.observations,
    beliefs: evidence.beliefs,
    memories: evidence.memories,
    consequential: evidence.openUnknowns.length >= 1,
    openUnknownCount: evidence.openUnknowns.length,
  });
}

/**
 * The subject query: gathers evidence about the subject, classifies it
 * honestly, and returns the answer with every blind spot made explicit.
 * Never fails for missing evidence — missing evidence IS the answer
 * (unknown / learning-mission-required), not an error.
 */
export function askAboutSubject(
  views: CompanyDomainViews,
  scope: TenantScope,
  subject: SubjectReference,
  now: DomainTimestamp,
  policy?: FreshnessPolicy,
): CompanyAnswer {
  const evidence = gatherSubjectEvidence(views, scope, subject, now, policy);
  const readings = expectedReadingsFor(views, scope, subject, now, policy);
  const outcome = classifyEvidence(evidence);
  return {
    subject,
    classification: outcome.classification,
    classificationBasis: outcome.basis,
    answeredAt: now,
    observations: evidence.observations,
    beliefs: evidence.beliefs,
    memories: evidence.memories,
    blindSpots: blindSpotsOfSubject(evidence, readings),
  };
}
