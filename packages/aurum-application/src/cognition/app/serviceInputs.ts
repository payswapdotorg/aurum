/**
 * Cognition service inputs + journal guards (W007 app layer): the shared
 * validation helpers and index-checked journal accessors used by the
 * cognition service. Pure functions only — no seam access.
 */
import { err, ok, isKnownActorKind, isKnownSubjectKind } from "@aurum/domain";
import type { ActorReference, Result, SubjectReference, ValidationIssue } from "@aurum/domain";
import { missionInvariant } from "../domain/errors.js";
import type { MissionError } from "../domain/errors.js";
import { MISSION_BOUNDS } from "../domain/vocabulary.js";
import type {
  EvaluateStageRecord,
  MissionRecord,
  OrientStageRecord,
  ProposeStageRecord,
  ReasonStageRecord,
} from "../domain/records.js";

export function subjectIssues(subject: SubjectReference | undefined): ValidationIssue[] {
  if (!subject || typeof subject !== "object") {
    return [{ field: "subject", problem: "is required" }];
  }
  if (!isKnownSubjectKind(subject.kind)) {
    return [{ field: "subject.kind", problem: "must be a known subject kind" }];
  }
  if (typeof subject.id !== "string" || subject.id.trim().length === 0) {
    return [{ field: "subject.id", problem: "must be a non-empty id" }];
  }
  return [];
}

export function actorIssues(actor: ActorReference | undefined, field: string): ValidationIssue[] {
  if (!actor || typeof actor !== "object" || !isKnownActorKind(actor.kind)) {
    return [{ field, problem: "must be a known actor" }];
  }
  if (actor.kind === "person" && !actor.personId) {
    return [{ field: `${field}.personId`, problem: "is required for person actors" }];
  }
  return [];
}

export function missionIdIssues(missionId: unknown): ValidationIssue[] {
  if (typeof missionId !== "string" || missionId.trim().length === 0) {
    return [{ field: "missionId", problem: "must be a non-empty id" }];
  }
  if (missionId.length > MISSION_BOUNDS.missionIdMaxLength) {
    return [
      {
        field: "missionId",
        problem: `must be at most ${MISSION_BOUNDS.missionIdMaxLength} characters`,
      },
    ];
  }
  return [];
}

/** Journal stage 0 must be the orient record. */
export function orientRecord(mission: MissionRecord): Result<OrientStageRecord, MissionError> {
  const record = mission.stages[0];
  if (record === undefined || record.stage !== "orient") {
    return err(missionInvariant("journal stage 0 must be the orient record"));
  }
  return ok(record);
}

/** Journal stage 1 must be the reason record. */
export function reasonRecord(mission: MissionRecord): Result<ReasonStageRecord, MissionError> {
  const record = mission.stages[1];
  if (record === undefined || record.stage !== "reason") {
    return err(missionInvariant("journal stage 1 must be the reason record"));
  }
  return ok(record);
}

/** Journal stage 2 must be the evaluate record. */
export function evaluateRecord(mission: MissionRecord): Result<EvaluateStageRecord, MissionError> {
  const record = mission.stages[2];
  if (record === undefined || record.stage !== "evaluate") {
    return err(missionInvariant("journal stage 2 must be the evaluate record"));
  }
  return ok(record);
}

/** Journal stage 3 must be the propose record. */
export function proposeRecord(mission: MissionRecord): Result<ProposeStageRecord, MissionError> {
  const record = mission.stages[3];
  if (record === undefined || record.stage !== "propose") {
    return err(missionInvariant("journal stage 3 must be the propose record"));
  }
  return ok(record);
}
