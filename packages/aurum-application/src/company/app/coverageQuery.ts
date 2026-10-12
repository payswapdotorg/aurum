/**
 * Company coverage query (W004 app layer): what is known about a subject,
 * bucketed honestly — covered (usable, treatable-as-current evidence), stale
 * (evidence exists but cannot be treated as current: stale or unknown
 * freshness), unevidenced (declared expectations with no usable evidence) —
 * plus the per-record freshness readings for every evidence-bearing record
 * about the subject. Expected-evidence readings are shared with the other
 * query builders (subject blind spots, situation coverage, unknown reports).
 */
import type {
  DomainTimestamp,
  FreshnessClass,
  FreshnessPolicy,
  SubjectReference,
  TenantScope,
} from "@aurum/domain";
import type { ExpectedEvidence } from "@aurum/domain";
import { classifyFreshness, DEFAULT_FRESHNESS_POLICY } from "@aurum/domain";
import { type SubjectEvidence, gatherSubjectEvidence } from "./evidenceGathering.js";
import type {
  BlindSpot,
  CoverageEntry,
  CoverageReport,
  RecordFreshness,
} from "../domain/records.js";
import type { CompanyDomainViews } from "../domain/ports.js";

/** Freshness that still allows an entry to be treated as current. */
const CURRENT_FRESHNESS: readonly FreshnessClass[] = ["current", "aging"];

/** One expected-evidence expectation, read honestly. */
export interface ExpectedEvidenceReading {
  readonly description: string;
  readonly subject: SubjectReference;
  readonly status: "covered" | "stale" | "unevidenced";
  readonly freshness: FreshnessClass;
  readonly evidenceRecordId?: string;
}

/**
 * Reads a goal revision's expected evidence against the actual observation
 * ledger: an expectation is covered when it has a usable (active) observation
 * whose best freshness is current or aging; stale when usable observations
 * exist but none is treatable as current; unevidenced when no usable
 * observation exists at all.
 */
export function readExpectedEvidence(
  views: CompanyDomainViews,
  scope: TenantScope,
  expected: readonly ExpectedEvidence[],
  now: DomainTimestamp,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): readonly ExpectedEvidenceReading[] {
  const readings: ExpectedEvidenceReading[] = [];
  for (const expectation of expected) {
    const usable = views.evidence
      .listObservations(scope, expectation.subject)
      .filter((record) => record.status === "active");
    if (usable.length === 0) {
      readings.push({
        description: expectation.description,
        subject: expectation.subject,
        status: "unevidenced",
        freshness: "unknown",
      });
      continue;
    }
    let best: FreshnessClass = "unknown";
    let bestRecordId: string | undefined;
    for (const record of usable) {
      const freshness = classifyFreshness(record.freshness, now, policy);
      if (bestRecordId === undefined || rank(freshness) > rank(best)) {
        best = freshness;
        bestRecordId = record.observationId;
      }
    }
    const treatable = CURRENT_FRESHNESS.includes(best);
    readings.push({
      description: expectation.description,
      subject: expectation.subject,
      status: treatable ? "covered" : "stale",
      freshness: best,
      ...(bestRecordId !== undefined ? { evidenceRecordId: bestRecordId } : {}),
    });
  }
  return readings;
}

function rank(freshness: FreshnessClass): number {
  return freshness === "current" ? 3 : freshness === "aging" ? 2 : freshness === "stale" ? 1 : 0;
}

function entryOf(
  subject: SubjectReference,
  description: string,
  status: CoverageEntry["status"],
  freshness: FreshnessClass,
  evidenceRecordId: string | undefined,
): CoverageEntry {
  return {
    subject,
    description,
    status,
    freshness,
    ...(evidenceRecordId !== undefined ? { evidenceRecordId } : {}),
  };
}

/** Builds the coverage report for one subject from gathered evidence. */
export function buildCoverageReport(
  evidence: SubjectEvidence,
  expectedReadings: readonly ExpectedEvidenceReading[],
  blindSpots: readonly BlindSpot[],
): CoverageReport {
  const covered: CoverageEntry[] = [];
  const stale: CoverageEntry[] = [];
  const freshness: RecordFreshness[] = [];

  for (const observation of evidence.observations) {
    freshness.push({
      recordId: observation.recordId,
      kind: "observation",
      description: observation.content,
      freshness: observation.freshness,
    });
    if (observation.status !== "active") continue;
    const treatable = CURRENT_FRESHNESS.includes(observation.freshness);
    (treatable ? covered : stale).push(
      entryOf(
        evidence.subject,
        observation.content,
        treatable ? "covered" : "stale",
        observation.freshness,
        observation.recordId,
      ),
    );
  }
  for (const memory of evidence.memories) {
    freshness.push({
      recordId: memory.recordId,
      kind: "memory",
      description: memory.content,
      freshness: memory.freshness,
    });
    const treatable = CURRENT_FRESHNESS.includes(memory.freshness);
    (treatable ? covered : stale).push(
      entryOf(
        evidence.subject,
        memory.content,
        treatable ? "covered" : "stale",
        memory.freshness,
        memory.recordId,
      ),
    );
  }
  for (const belief of evidence.beliefs) {
    for (const claim of belief.supportingClaims) {
      freshness.push({
        recordId: claim.recordId,
        kind: "claim",
        description: claim.statement,
        freshness: claim.freshness,
      });
    }
    freshness.push({
      recordId: belief.recordId,
      kind: "belief",
      description: belief.statement,
      freshness: belief.freshness,
    });
  }
  // Declared expectations read last: each expectation is one freshness
  // reading — the best observation's class, or unknown when unevidenced.
  expectedReadings.forEach((reading, index) => {
    freshness.push({
      recordId: `expected:${index + 1}:${reading.subject.kind}/${reading.subject.id}`,
      kind: "expected-evidence",
      description: reading.description,
      freshness: reading.freshness,
    });
  });
  const unevidenced: CoverageEntry[] = expectedReadings
    .filter((reading) => reading.status === "unevidenced")
    .map((reading) =>
      entryOf(reading.subject, reading.description, "unevidenced", reading.freshness, undefined),
    );

  return {
    subject: evidence.subject,
    covered: Object.freeze(covered),
    stale: Object.freeze(stale),
    unevidenced: Object.freeze(unevidenced),
    freshness: Object.freeze(freshness),
    blindSpots,
  };
}

/** Full coverage query: gather → read expectations → build the report. */
export function reportCoverage(
  views: CompanyDomainViews,
  scope: TenantScope,
  subject: SubjectReference,
  now: DomainTimestamp,
  policy?: FreshnessPolicy,
): CoverageReport {
  const evidence = gatherSubjectEvidence(views, scope, subject, now, policy);
  const expectedReadings = expectedReadingsFor(views, scope, subject, now, policy);
  const blindSpots = coverageBlindSpots(evidence, expectedReadings);
  return buildCoverageReport(evidence, expectedReadings, blindSpots);
}

/** Expected-evidence readings for a subject (goals carry expectations). */
export function expectedReadingsFor(
  views: CompanyDomainViews,
  scope: TenantScope,
  subject: SubjectReference,
  now: DomainTimestamp,
  policy?: FreshnessPolicy,
): readonly ExpectedEvidenceReading[] {
  if (subject.kind !== "goal") return [];
  const goal = views.goals.getGoal(scope, subject.id);
  if (!goal.ok) return [];
  const current = goal.value.revisions[goal.value.currentRevision - 1];
  if (current === undefined) return [];
  return readExpectedEvidence(views, scope, current.expectedEvidence, now, policy);
}

/** Coverage blind spots: open unknowns, open contradictions, stale/missing. */
export function coverageBlindSpots(
  evidence: SubjectEvidence,
  expectedReadings: readonly ExpectedEvidenceReading[],
): readonly BlindSpot[] {
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
  for (const reading of expectedReadings) {
    if (reading.status === "stale") {
      spots.push({
        kind: "stale-evidence",
        subject: evidence.subject,
        description: `expected evidence "${reading.description}" only has ${reading.freshness}-freshness evidence`,
        recordId: reading.evidenceRecordId,
      });
    } else if (reading.status === "unevidenced") {
      spots.push({
        kind: "missing-expected-evidence",
        subject: evidence.subject,
        description: `expected evidence "${reading.description}" has no usable observations`,
      });
    }
  }
  return Object.freeze(spots);
}
