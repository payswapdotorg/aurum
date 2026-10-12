/**
 * Orient stage (W007 app layer): assemble the bounded orientation snapshot
 * for a mission — the "observe / evidence / memory" head of the canonical
 * loop (spec/ARCHITECTURE.md "Cognition"). READ-ONLY against the domain
 * seams: the orientation derives, never mutates. Retracted or superseded
 * observations are excluded (honesty: retracted evidence is not reasoning
 * input), and per-kind caps are applied with explicit truncation counts.
 */
import { err, ok, type Result, type SubjectReference, type TenantScope } from "@aurum/domain";
import { mapDomainError, missionSubjectNotFound, type MissionError } from "../domain/errors.js";
import type {
  MissionOrientation,
  OrientationBelief,
  OrientationContradiction,
  OrientationGoal,
  OrientationMemory,
  OrientationObservation,
  OrientationUnknown,
} from "../domain/bounded.js";
import type { MissionCharter } from "../domain/records.js";
import type { CognitionReadSeams } from "../domain/ports.js";
import { MISSION_BOUNDS } from "../domain/vocabulary.js";

function subjectMatches(subject: SubjectReference, other: SubjectReference): boolean {
  return subject.kind === other.kind && subject.id === other.id;
}

/** Builds the orientation snapshot. Reads only; deterministic for the tenant state. */
export function buildOrientation(
  reads: CognitionReadSeams,
  scope: TenantScope,
  charter: MissionCharter,
): Result<MissionOrientation, MissionError> {
  let goal: OrientationGoal | undefined;
  if (charter.goalId !== undefined) {
    const fetched = reads.goals.getGoal(scope, charter.goalId);
    if (!fetched.ok) {
      if (fetched.error.code === "not-found") {
        return err(missionSubjectNotFound(`goal ${charter.goalId}`));
      }
      return err(mapDomainError(fetched.error));
    }
    const current = fetched.value.revisions[fetched.value.currentRevision - 1];
    if (current === undefined) {
      return err(missionSubjectNotFound(`goal revision ${charter.goalId}`));
    }
    goal = Object.freeze({
      goalId: fetched.value.goalId,
      objective: current.objective,
      priority: current.priority,
      horizonStart: current.horizonStart,
      horizonEnd: current.horizonEnd,
      expectedEvidenceSubjects: Object.freeze(
        current.expectedEvidence.map((entry) => entry.subject),
      ),
    });
  }

  const activeObservations = reads.evidence
    .listObservations(scope, charter.subject)
    .filter((observation) => observation.status === "active");
  const observations: OrientationObservation[] = activeObservations
    .slice(0, MISSION_BOUNDS.observationsMax)
    .map((observation) =>
      Object.freeze({
        observationId: observation.observationId,
        subject: observation.subject,
        content: observation.content,
        observedAt: observation.observedAt,
        freshness: observation.freshness,
      }),
    );

  const listedBeliefs = reads.epistemics.listBeliefs(scope, charter.subject);
  const beliefs: OrientationBelief[] = listedBeliefs
    .slice(0, MISSION_BOUNDS.beliefsMax)
    .map((belief) => {
      const current = belief.revisions[belief.currentRevision - 1];
      return Object.freeze({
        beliefId: belief.beliefId,
        subject: belief.subject,
        statement: current === undefined ? "" : current.statement,
        revisionCount: belief.revisions.length,
      });
    });

  const listedMemory = reads.memory.listMemory(scope, charter.subject);
  const memory: OrientationMemory[] = listedMemory
    .slice(0, MISSION_BOUNDS.memoryMax)
    .map((record) => {
      const current = record.versions[record.currentVersion - 1];
      return Object.freeze({
        memoryId: record.memoryId,
        subject: record.subject,
        content: current === undefined ? "" : current.content,
      });
    });

  const subjectUnknowns = reads.inquiry
    .listOpenUnknowns(scope)
    .filter((unknown) =>
      unknown.relatedSubjects.some((ref) => subjectMatches(ref, charter.subject)),
    );
  const openUnknowns: OrientationUnknown[] = subjectUnknowns
    .slice(0, MISSION_BOUNDS.unknownsMax)
    .map((unknown) =>
      Object.freeze({
        unknownId: unknown.unknownId,
        question: unknown.question,
        consequence: unknown.consequence,
      }),
    );

  const subjectContradictions = reads.inquiry
    .listOpenContradictions(scope)
    .filter((contradiction) =>
      contradiction.between.some((ref) => subjectMatches(ref, charter.subject)),
    );
  const openContradictions: OrientationContradiction[] = subjectContradictions
    .slice(0, MISSION_BOUNDS.contradictionsMax)
    .map((contradiction) =>
      Object.freeze({
        contradictionId: contradiction.contradictionId,
        description: contradiction.description,
      }),
    );

  return ok(
    Object.freeze({
      subject: charter.subject,
      question: charter.question,
      consequence: charter.consequence,
      ...(goal !== undefined ? { goal } : {}),
      observations: Object.freeze(observations),
      beliefs: Object.freeze(beliefs),
      memory: Object.freeze(memory),
      openUnknowns: Object.freeze(openUnknowns),
      openContradictions: Object.freeze(openContradictions),
      truncation: Object.freeze({
        observations: activeObservations.length - observations.length,
        beliefs: listedBeliefs.length - beliefs.length,
        memory: listedMemory.length - memory.length,
        unknowns: subjectUnknowns.length - openUnknowns.length,
        contradictions: subjectContradictions.length - openContradictions.length,
      }),
    }),
  );
}

/** The bounded request handed to the reasoning port (no domain records). */
export function reasoningRequestFromOrientation(
  missionId: string,
  orientation: MissionOrientation,
): import("../domain/bounded.js").ReasoningRequest {
  return Object.freeze({
    missionId,
    subject: orientation.subject,
    question: orientation.question,
    consequence: orientation.consequence,
    ...(orientation.goal !== undefined ? { goal: orientation.goal } : {}),
    observations: orientation.observations,
    beliefs: orientation.beliefs,
    memory: orientation.memory,
    openUnknowns: orientation.openUnknowns,
    openContradictions: orientation.openContradictions,
    truncated: orientation.truncation,
  });
}
