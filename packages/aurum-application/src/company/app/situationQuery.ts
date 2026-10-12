/**
 * Company situation query (W004 app layer): the goal landscape — every goal
 * with its current revision read honestly (horizon state, priority, owner,
 * related open unknowns/contradictions, expected-evidence coverage, knowledge
 * age) — plus the deterministic attention report (five inspectable criteria,
 * no scoring magic: a criterion either fired, with its reason, or did not).
 */
import type { DomainTimestamp, FreshnessPolicy, TenantScope } from "@aurum/domain";
import { classifyFreshness, DEFAULT_FRESHNESS_POLICY } from "@aurum/domain";
import { referencesSubject } from "./evidenceGathering.js";
import { readExpectedEvidence, type ExpectedEvidenceReading } from "./coverageQuery.js";
import type {
  AttentionReport,
  BlindSpot,
  CriterionFinding,
  GoalAttention,
  GoalSituation,
  SituationReport,
} from "../domain/records.js";
import type { CompanyDomainViews } from "../domain/ports.js";

/** Default horizon-closing threshold: two weeks in milliseconds. */
export const DEFAULT_HORIZON_CLOSING_MS = 14 * 24 * 60 * 60 * 1000;

function horizonStateOf(
  now: DomainTimestamp,
  start: DomainTimestamp,
  end: DomainTimestamp,
): GoalSituation["horizonState"] {
  if (now < start) return "upcoming";
  if (now < end) return "active";
  return "elapsed";
}

/**
 * Expected-evidence coverage ladder: none-declared (no expectations),
 * covered (every expectation covered), unevidenced (no expectation has
 * usable observations), partial (everything else). Monotone in evidence.
 */
function coverageLadderOf(
  readings: readonly ExpectedEvidenceReading[],
): GoalSituation["expectedEvidenceCoverage"] {
  if (readings.length === 0) return "none-declared";
  if (readings.every((reading) => reading.status === "covered")) return "covered";
  if (readings.every((reading) => reading.status === "unevidenced")) return "unevidenced";
  return "partial";
}

/** The situation query: one honest reading per goal, plus tenant totals. */
export function situationQuery(
  views: CompanyDomainViews,
  scope: TenantScope,
  now: DomainTimestamp,
  policy?: FreshnessPolicy,
): SituationReport {
  const openUnknowns = views.inquiry.listOpenUnknowns(scope);
  const openContradictions = views.inquiry.listOpenContradictions(scope);
  const spots: BlindSpot[] = [];

  const goals: GoalSituation[] = [];
  for (const goal of views.goals.listGoals(scope)) {
    // Kernel invariant: every goal has >= 1 revision. A goal without a
    // current revision is skipped defensively — never fabricated around.
    const current = goal.revisions[goal.currentRevision - 1];
    if (current === undefined) continue;
    const readings = readExpectedEvidence(
      views,
      scope,
      current.expectedEvidence,
      now,
      policy ?? DEFAULT_FRESHNESS_POLICY,
    );
    const relatedUnknowns = openUnknowns.filter((unknown) =>
      referencesSubject(unknown.relatedSubjects, { kind: "goal", id: goal.goalId }),
    );
    const relatedContradictions = openContradictions.filter((contradiction) =>
      referencesSubject(contradiction.between, { kind: "goal", id: goal.goalId }),
    );
    for (const unknown of relatedUnknowns) {
      spots.push({
        kind: "open-unknown",
        subject: { kind: "goal", id: goal.goalId },
        description: unknown.question,
        consequence: unknown.consequence,
        raisedAt: unknown.raisedAt,
        recordId: unknown.unknownId,
      });
    }
    for (const contradiction of relatedContradictions) {
      spots.push({
        kind: "open-contradiction",
        subject: { kind: "goal", id: goal.goalId },
        description: contradiction.description,
        recordId: contradiction.contradictionId,
      });
    }
    for (const reading of readings) {
      if (reading.status === "stale") {
        spots.push({
          kind: "stale-evidence",
          subject: { kind: "goal", id: goal.goalId },
          description: `expected evidence "${reading.description}" only has ${reading.freshness}-freshness observations`,
          recordId: reading.evidenceRecordId,
        });
      } else if (reading.status === "unevidenced") {
        spots.push({
          kind: "missing-expected-evidence",
          subject: { kind: "goal", id: goal.goalId },
          description: `expected evidence "${reading.description}" has no usable observations`,
        });
      }
    }
    goals.push({
      goalId: goal.goalId,
      revision: current.revisionNumber,
      objective: current.objective,
      priority: current.priority,
      horizonStart: current.horizonStart,
      horizonEnd: current.horizonEnd,
      horizonState: horizonStateOf(now, current.horizonStart, current.horizonEnd),
      ownerPersonId: current.owner.personId,
      openUnknowns: relatedUnknowns.length,
      openContradictions: relatedContradictions.length,
      expectedEvidenceCoverage: coverageLadderOf(readings),
      expectedEvidenceCount: readings.length,
      provenance: {
        actor: current.provenance.actor,
        source: current.provenance.source,
        recordedAt: current.provenance.recordedAt,
      },
      freshness: classifyFreshness(
        { asOf: current.createdAt },
        now,
        policy ?? DEFAULT_FRESHNESS_POLICY,
      ),
    });
  }

  return {
    asOf: now,
    goals: Object.freeze(goals),
    totals: {
      goals: goals.length,
      openUnknowns: openUnknowns.length,
      openContradictions: openContradictions.length,
    },
    blindSpots: Object.freeze(
      [...spots].sort((left, right) => {
        if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
        return (left.recordId ?? "").localeCompare(right.recordId ?? "");
      }),
    ),
  };
}

/** Attention detail for the horizon criteria (deterministic ms arithmetic). */
function horizonFindings(
  now: DomainTimestamp,
  horizonEnd: DomainTimestamp,
  closingWithinMs: number,
): CriterionFinding[] {
  if (horizonEnd <= now) {
    return [
      { criterion: "horizon-elapsed", detail: `horizon ended ${now - horizonEnd} ms before asOf` },
    ];
  }
  const remaining = horizonEnd - now;
  if (remaining <= closingWithinMs) {
    return [
      {
        criterion: "horizon-closing",
        detail: `horizon ends in ${remaining} ms (within ${closingWithinMs} ms)`,
      },
    ];
  }
  return [];
}

/**
 * The attention query: five deterministic criteria per goal — horizon-elapsed,
 * horizon-closing, open-contradiction, open-unknown, missing-expected-evidence.
 * A goal appears only when at least one criterion fired; ordering is by score
 * (descending), then goalId. No criterion fires without its inspectable reason.
 */
export function goalAttentionQuery(
  views: CompanyDomainViews,
  scope: TenantScope,
  now: DomainTimestamp,
  horizonClosingWithinMs: number = DEFAULT_HORIZON_CLOSING_MS,
  policy?: FreshnessPolicy,
): AttentionReport {
  const openUnknowns = views.inquiry.listOpenUnknowns(scope);
  const openContradictions = views.inquiry.listOpenContradictions(scope);
  const attention: GoalAttention[] = [];

  for (const goal of views.goals.listGoals(scope)) {
    const current = goal.revisions[goal.currentRevision - 1];
    if (current === undefined) continue;
    const readings = readExpectedEvidence(
      views,
      scope,
      current.expectedEvidence,
      now,
      policy ?? DEFAULT_FRESHNESS_POLICY,
    );
    const relatedUnknowns = openUnknowns.filter((unknown) =>
      referencesSubject(unknown.relatedSubjects, { kind: "goal", id: goal.goalId }),
    ).length;
    const relatedContradictions = openContradictions.filter((contradiction) =>
      referencesSubject(contradiction.between, { kind: "goal", id: goal.goalId }),
    ).length;
    const missing = readings.filter((reading) => reading.status === "unevidenced").length;

    const criteria: CriterionFinding[] = [
      ...horizonFindings(now, current.horizonEnd, horizonClosingWithinMs),
    ];
    if (relatedContradictions >= 1) {
      criteria.push({
        criterion: "open-contradiction",
        detail: `${relatedContradictions} open contradiction(s) reference this goal`,
      });
    }
    if (relatedUnknowns >= 1) {
      criteria.push({
        criterion: "open-unknown",
        detail: `${relatedUnknowns} open unknown(s) reference this goal; consequences recorded`,
      });
    }
    if (missing >= 1) {
      criteria.push({
        criterion: "missing-expected-evidence",
        detail: `${missing} of ${readings.length} expected-evidence expectations have no usable observations`,
      });
    }
    if (criteria.length === 0) continue;

    attention.push({
      goalId: goal.goalId,
      revision: current.revisionNumber,
      objective: current.objective,
      priority: current.priority,
      score: criteria.length,
      criteria: Object.freeze(criteria),
    });
  }

  attention.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    return left.goalId.localeCompare(right.goalId);
  });

  return {
    asOf: now,
    horizonClosingWithinMs,
    attention: Object.freeze(attention),
  };
}
