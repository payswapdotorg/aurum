/**
 * Evaluate stage (W007 app layer): the pure epistemic/goal/unknown
 * evaluation over PERSISTED stage records (orientation + reasoned content).
 * Nothing is written; the evaluation is a deterministic function of the
 * journal plus the caller-supplied `now`.
 *
 * Honesty rulings:
 * - a finding is ADMITTED as assertable knowledge only when its cited
 *   observations classify as current/aging at evaluation time — stale or
 *   unknown-backed findings become explicit re-verification gaps instead;
 * - pre-existing open unknowns are carried as gaps (origin "pre-existing")
 *   but never re-raised — they already exist in the domain;
 * - disposition is "knowledge-gap-remains" whenever any gap remains (the
 *   mission never resolves unknowns itself — resolution is an explicit,
 *   audited human decision in the kernel).
 */
import {
  classifyFreshness,
  type DomainTimestamp,
  type FreshnessClass,
  type SubjectReference,
} from "@aurum/domain";
import type { MissionOrientation, ReasonedContent } from "../domain/bounded.js";
import type { EvaluatedGap, FindingEvaluation, MissionEvaluation } from "../domain/records.js";
import { ADMISSIBLE_FRESHNESS, MISSION_BOUNDS } from "../domain/vocabulary.js";

const FRESHNESS_RANK: Readonly<Record<FreshnessClass, number>> = {
  stale: 0,
  unknown: 1,
  aging: 2,
  current: 3,
};

function worstFreshness(classes: readonly FreshnessClass[]): FreshnessClass {
  let worst: FreshnessClass = "current";
  let worstRank = Number.POSITIVE_INFINITY;
  for (const fresh of classes) {
    const rank = FRESHNESS_RANK[fresh];
    if (rank < worstRank) {
      worst = fresh;
      worstRank = rank;
    }
  }
  return classes.length === 0 ? "unknown" : worst;
}

function observationFreshness(
  orientation: MissionOrientation,
  observationId: string,
  now: DomainTimestamp,
): FreshnessClass {
  const observation = orientation.observations.find(
    (entry) => entry.observationId === observationId,
  );
  if (observation === undefined) return "unknown";
  return classifyFreshness(observation.freshness, now);
}

function subjectMatches(subject: SubjectReference, other: SubjectReference): boolean {
  return subject.kind === other.kind && subject.id === other.id;
}

/** The pure evaluation. Deterministic for (orientation, content, now). */
export function evaluateMission(
  orientation: MissionOrientation,
  content: ReasonedContent,
  now: DomainTimestamp,
): MissionEvaluation {
  const findings: FindingEvaluation[] = content.findings.map((finding) => {
    const freshness = worstFreshness(
      finding.basedOn.map((observationId) => observationFreshness(orientation, observationId, now)),
    );
    return Object.freeze({
      statement: finding.statement,
      basedOn: Object.freeze([...finding.basedOn]),
      freshness,
      admissible: ADMISSIBLE_FRESHNESS.includes(freshness),
    });
  });

  const admittedFindings = findings.filter((finding) => finding.admissible).length;
  const staleFindings = findings.length - admittedFindings;

  const gaps: EvaluatedGap[] = [];
  for (const gap of content.gaps) {
    gaps.push(
      Object.freeze({
        question: gap.question,
        consequence: gap.consequence,
        origin: "reasoned",
      }),
    );
  }
  for (const finding of findings) {
    if (finding.admissible) continue;
    const question = `Re-verify: ${finding.statement}`.slice(0, MISSION_BOUNDS.questionMaxLength);
    gaps.push(
      Object.freeze({
        question,
        consequence:
          "the supporting evidence is no longer fresh; the finding is not asserted as knowledge",
        origin: "stale-evidence",
      }),
    );
  }
  for (const unknown of orientation.openUnknowns) {
    gaps.push(
      Object.freeze({
        question: unknown.question,
        consequence: unknown.consequence,
        origin: "pre-existing",
      }),
    );
  }

  let goalAddressed: boolean | undefined;
  if (orientation.goal !== undefined) {
    const expected = orientation.goal.expectedEvidenceSubjects;
    const subjectExpected =
      expected.length === 0 || expected.some((ref) => subjectMatches(ref, orientation.subject));
    goalAddressed = admittedFindings >= 1 && subjectExpected;
  }

  return Object.freeze({
    findings: Object.freeze(findings),
    admittedFindings,
    staleFindings,
    gaps: Object.freeze(gaps),
    hypotheses: Object.freeze(
      content.hypotheses.map((hypothesis) =>
        Object.freeze({
          statement: hypothesis.statement,
          explains: Object.freeze([...hypothesis.explains]),
        }),
      ),
    ),
    ...(goalAddressed !== undefined ? { goalAddressed } : {}),
    disposition: gaps.length > 0 ? "knowledge-gap-remains" : "satisfied",
  });
}
