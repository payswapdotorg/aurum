/**
 * The cognition service (W007 app layer): the explicit asynchronous,
 * resumable intelligence loop. Each `advance` call executes exactly ONE
 * stage — the next one derived from the journal length (stage order is
 * application-owned; callers and models never choose it) — applies its
 * effects idempotently, and appends the persisted, replayable stage record.
 * Interruption at any point resumes without duplicate side effects.
 *
 * The service orchestrates; the seams stay dumb: reads orient, the bounded
 * `ReasoningPort` reasons, the authority gate gates, and every failure is a
 * typed `MissionError` in a `Result` (never a thrown bare string).
 */
import {
  err,
  ok,
  type ActorReference,
  type DomainTimestamp,
  type Result,
  type SubjectReference,
  type TenantScope,
  type ValidationIssue,
} from "@aurum/domain";
import {
  mapDomainError,
  missionConflict,
  missionInvariant,
  missionModelRefused,
  missionStateIllegal,
  missionSubjectNotFound,
  missionValidationError,
  type MissionError,
} from "../domain/errors.js";
import {
  isTerminalMissionStatus,
  MISSION_BOUNDS,
  MISSION_STAGES,
  nextMissionStage,
} from "../domain/vocabulary.js";
import type { MissionStatus } from "../domain/vocabulary.js";
import { deriveEffectManifest } from "../domain/effects.js";
import { reasonedContentIssues } from "../domain/bounded.js";
import type { ReasonedContent, ReasoningRequest } from "../domain/bounded.js";
import type { MissionRecord, MissionStageRecord } from "../domain/records.js";
import type { CognitionServiceDeps, MissionFilter } from "../domain/ports.js";
import { buildOrientation, reasoningRequestFromOrientation } from "./orient.js";
import { evaluateMission } from "./evaluate.js";
import { applyGateStage, applyProposeStage, applyRecordStage, cognitionActor } from "./apply.js";
import { missionTrajectoryOf, type MissionTrajectory } from "./trajectory.js";
import {
  actorIssues,
  evaluateRecord,
  missionIdIssues,
  orientRecord,
  proposeRecord,
  reasonRecord,
  subjectIssues,
} from "./serviceInputs.js";

/** Input of `createMission`. */
export interface CreateMissionInput {
  readonly missionId: string;
  readonly subject: SubjectReference;
  readonly question: string;
  readonly consequence: string;
  readonly goalId?: string;
  readonly createdBy: ActorReference;
  readonly now: DomainTimestamp;
}

/** The public cognition service surface (7 methods; policy limit is 12). */
export interface CognitionService {
  createMission(scope: TenantScope, input: CreateMissionInput): Result<MissionRecord, MissionError>;
  /** Executes the next journal-derived stage. ONE stage per call. */
  advance(
    scope: TenantScope,
    missionId: string,
    input: { now: DomainTimestamp },
  ): Promise<Result<MissionRecord, MissionError>>;
  /**
   * Drives `advance` until the mission reaches a terminal status. Idempotent:
   * a mission that is already terminal (complete or cancelled) is returned
   * as-is — a re-driven run after an interruption never errors or re-writes.
   */
  runToCompletion(
    scope: TenantScope,
    missionId: string,
    input: { now: DomainTimestamp },
  ): Promise<Result<MissionRecord, MissionError>>;
  getMission(scope: TenantScope, missionId: string): Result<MissionRecord, MissionError>;
  listMissions(scope: TenantScope, filter?: MissionFilter): readonly MissionRecord[];
  missionTrajectory(scope: TenantScope, missionId: string): Result<MissionTrajectory, MissionError>;
  cancelMission(
    scope: TenantScope,
    missionId: string,
    input: { now: DomainTimestamp; actor: ActorReference; reason: string },
  ): Result<MissionRecord, MissionError>;
}

// --- the service factory ---

export function createCognitionService(deps: CognitionServiceDeps): CognitionService {
  const inFlight = new Set<string>();

  function loadMission(scope: TenantScope, missionId: string): Result<MissionRecord, MissionError> {
    return deps.missions.getMission(scope, missionId);
  }

  /** Executes one stage and returns its journal record. */
  async function runStage(
    scope: TenantScope,
    mission: MissionRecord,
    now: DomainTimestamp,
  ): Promise<Result<MissionStageRecord, MissionError>> {
    const stage = nextMissionStage(mission.stages.length);
    if (stage === undefined) {
      return err(missionInvariant("terminal mission has no next stage"));
    }
    switch (stage) {
      case "orient": {
        const orientation = buildOrientation(deps.reads, scope, mission.charter);
        if (!orientation.ok) return err(orientation.error);
        return ok({
          stage: "orient",
          stageIndex: 0,
          at: now,
          actor: cognitionActor(),
          orientation: orientation.value,
        });
      }
      case "reason": {
        const orient = orientRecord(mission);
        if (!orient.ok) return err(orient.error);
        const request: ReasoningRequest = reasoningRequestFromOrientation(
          mission.missionId,
          orient.value.orientation,
        );
        const response = await deps.model.requestReasoning(request);
        if (!response.ok) return err(response.error);
        const content: ReasonedContent = response.value;
        const issues = reasonedContentIssues(
          content,
          request.observations.map((observation) => observation.observationId),
        );
        if (issues.length > 0) {
          return err(missionModelRefused("content outside the bounded schema", issues));
        }
        return ok({
          stage: "reason",
          stageIndex: 1,
          at: now,
          actor: cognitionActor(),
          request,
          content,
          modelName: deps.model.name,
        });
      }
      case "evaluate": {
        const orient = orientRecord(mission);
        if (!orient.ok) return err(orient.error);
        const reason = reasonRecord(mission);
        if (!reason.ok) return err(reason.error);
        return ok({
          stage: "evaluate",
          stageIndex: 2,
          at: now,
          actor: cognitionActor(),
          evaluation: evaluateMission(orient.value.orientation, reason.value.content, now),
        });
      }
      case "propose": {
        const reason = reasonRecord(mission);
        if (!reason.ok) return err(reason.error);
        const evaluation = evaluateRecord(mission);
        if (!evaluation.ok) return err(evaluation.error);
        const manifest = deriveEffectManifest({
          missionId: mission.missionId,
          subject: mission.charter.subject,
          evaluation: evaluation.value.evaluation,
          content: reason.value.content,
        });
        return applyProposeStage(deps.knowledge, scope, mission.missionId, manifest, now);
      }
      case "gate": {
        const propose = proposeRecord(mission);
        if (!propose.ok) return err(propose.error);
        return applyGateStage(
          deps.gate,
          scope,
          mission.missionId,
          propose.value.manifest,
          deps.proposalPolicy,
          now,
        );
      }
      case "record": {
        const propose = proposeRecord(mission);
        if (!propose.ok) return err(propose.error);
        const evaluation = evaluateRecord(mission);
        if (!evaluation.ok) return err(evaluation.error);
        return applyRecordStage(
          deps.knowledge.memory,
          scope,
          mission.missionId,
          propose.value.manifest,
          evaluation.value.evaluation,
          now,
        );
      }
    }
  }

  const service: CognitionService = {
    createMission(scope, input) {
      const issues: ValidationIssue[] = [
        ...missionIdIssues(input?.missionId),
        ...subjectIssues(input?.subject),
      ];
      if (typeof input?.question !== "string" || input.question.trim().length === 0) {
        issues.push({ field: "question", problem: "must be a non-empty string" });
      } else if (input.question.length > MISSION_BOUNDS.questionMaxLength) {
        issues.push({
          field: "question",
          problem: `must be at most ${MISSION_BOUNDS.questionMaxLength} characters`,
        });
      }
      if (typeof input?.consequence !== "string" || input.consequence.trim().length === 0) {
        issues.push({ field: "consequence", problem: "must be a non-empty string" });
      } else if (input.consequence.length > MISSION_BOUNDS.consequenceMaxLength) {
        issues.push({
          field: "consequence",
          problem: `must be at most ${MISSION_BOUNDS.consequenceMaxLength} characters`,
        });
      }
      issues.push(...actorIssues(input?.createdBy, "createdBy"));
      if (typeof input?.now !== "number" || !Number.isFinite(input.now) || input.now < 0) {
        issues.push({ field: "now", problem: "must be finite epoch ms >= 0" });
      }
      if (issues.length > 0) return err(missionValidationError(issues));

      // Goal references are validated at creation (closed failure, no leaks).
      if (input.goalId !== undefined) {
        const goal = deps.reads.goals.getGoal(scope, input.goalId);
        if (!goal.ok) {
          if (goal.error.code === "not-found") {
            return err(missionSubjectNotFound(`goal ${input.goalId}`));
          }
          return err(mapDomainError(goal.error));
        }
      }

      const mission: MissionRecord = Object.freeze({
        scope,
        missionId: input.missionId.trim(),
        charter: Object.freeze({
          subject: input.subject,
          question: input.question.trim(),
          consequence: input.consequence.trim(),
          ...(input.goalId !== undefined ? { goalId: input.goalId } : {}),
        }),
        status: "pending",
        stages: Object.freeze([]),
        createdBy: input.createdBy,
        createdAt: input.now,
        provenance: {
          actor: input.createdBy,
          source: "human-entered" as const,
          recordedAt: input.now,
        },
      });
      const existing = deps.missions.getMission(scope, mission.missionId);
      if (existing.ok) {
        return err(missionConflict(`mission ${mission.missionId} already registered in tenant`));
      }
      return deps.missions.putMission(mission);
    },

    async advance(scope, missionId, input) {
      if (typeof input?.now !== "number" || !Number.isFinite(input.now) || input.now < 0) {
        return err(
          missionValidationError([{ field: "now", problem: "must be finite epoch ms >= 0" }]),
        );
      }
      const loaded = loadMission(scope, missionId);
      if (!loaded.ok) return err(loaded.error);
      const mission = loaded.value;
      if (isTerminalMissionStatus(mission.status)) {
        return err(
          missionStateIllegal(
            `mission ${mission.missionId} is ${mission.status}; no further stages may run`,
          ),
        );
      }
      const flightKey = `${scope.tenantId}/${mission.missionId}`;
      if (inFlight.has(flightKey)) {
        return err(
          missionConflict(`a stage is already in flight for mission ${mission.missionId}`),
        );
      }
      inFlight.add(flightKey);
      let stageRecord: Result<MissionStageRecord, MissionError>;
      try {
        stageRecord = await runStage(scope, mission, input.now);
      } finally {
        inFlight.delete(flightKey);
      }
      if (!stageRecord.ok) return err(stageRecord.error);

      const nextStatus: MissionStatus =
        stageRecord.value.stage === "record" ? "complete" : "running";
      const disposition =
        stageRecord.value.stage === "record" ? stageRecord.value.outcome.disposition : undefined;
      const updated: MissionRecord = Object.freeze({
        ...mission,
        status: nextStatus,
        stages: Object.freeze([...mission.stages, stageRecord.value]),
        ...(disposition !== undefined ? { disposition } : {}),
      });
      return deps.missions.putMission(updated);
    },

    async runToCompletion(scope, missionId, input) {
      const loaded = loadMission(scope, missionId);
      if (!loaded.ok) return err(loaded.error);
      // Idempotent driver: a mission that already reached a terminal status
      // (complete or cancelled — e.g. the caller crashed after the last
      // advance) is returned as-is, never re-driven.
      if (isTerminalMissionStatus(loaded.value.status)) return loaded;
      let current = await service.advance(scope, missionId, input);
      if (!current.ok) return current;
      for (let guard = 0; guard < MISSION_STAGES.length; guard += 1) {
        if (isTerminalMissionStatus(current.value.status)) return current;
        current = await service.advance(scope, missionId, input);
        if (!current.ok) return current;
      }
      return err(missionInvariant("runToCompletion exceeded the stage budget"));
    },

    getMission(scope, missionId) {
      return loadMission(scope, missionId);
    },

    listMissions(scope, filter) {
      return deps.missions.listMissions(scope, filter);
    },

    missionTrajectory(scope, missionId) {
      const loaded = loadMission(scope, missionId);
      if (!loaded.ok) return err(loaded.error);
      return ok(missionTrajectoryOf(loaded.value));
    },

    cancelMission(scope, missionId, input) {
      const issues = actorIssues(input?.actor, "actor");
      if (typeof input?.reason !== "string" || input.reason.trim().length === 0) {
        issues.push({ field: "reason", problem: "must be a non-empty string" });
      }
      if (typeof input?.now !== "number" || !Number.isFinite(input.now) || input.now < 0) {
        issues.push({ field: "now", problem: "must be finite epoch ms >= 0" });
      }
      if (issues.length > 0) return err(missionValidationError(issues));
      const loaded = loadMission(scope, missionId);
      if (!loaded.ok) return err(loaded.error);
      const mission = loaded.value;
      if (mission.status === "cancelled") {
        return err(missionConflict(`mission ${mission.missionId} is already cancelled`));
      }
      if (mission.status === "complete") {
        return err(
          missionStateIllegal(`mission ${mission.missionId} is complete; it cannot be cancelled`),
        );
      }
      const updated: MissionRecord = Object.freeze({
        ...mission,
        status: "cancelled",
        cancelled: Object.freeze({
          at: input.now,
          by: input.actor,
          reason: input.reason.trim(),
        }),
      });
      return deps.missions.putMission(updated);
    },
  };
  return service;
}
