/**
 * Trajectory reconstruction (W007 app layer, catalog clause 4: "evidence
 * chain is reconstructable"). `missionTrajectory` rebuilds the full loop
 * trajectory PURELY from the mission record: the ordered stages with their
 * inputs/outputs and the complete effect chain (claim / unknown / belief /
 * action / memory target ids) that an inspector can verify against the
 * domain seams — every target's provenance note cites the mission, stage
 * and effect id that produced it.
 */
import type { ActorReference, DomainTimestamp, Result, SubjectReference } from "@aurum/domain";
import { err, ok } from "@aurum/domain";
import type { MissionError } from "../domain/errors.js";
import { missionNotFound } from "../domain/errors.js";
import type { MissionRecord, MissionStageRecord } from "../domain/records.js";
import type { MissionDisposition, MissionStage, MissionStatus } from "../domain/vocabulary.js";

/** One reconstructed stage summary. */
export interface TrajectoryStage {
  readonly stage: MissionStage;
  readonly stageIndex: number;
  readonly at: DomainTimestamp;
  readonly actor: ActorReference;
  /** Effect target ids applied (or gated) by this stage. */
  readonly effectTargets: readonly string[];
  /** Short human-readable reconstruction of the stage's key output. */
  readonly summary: string;
}

/** The reconstructable evidence chain of a mission run. */
export interface TrajectoryEvidenceChain {
  /** Observations the mission reasoned over (orientation inputs). */
  readonly observations: readonly string[];
  readonly claims: readonly string[];
  readonly unknowns: readonly string[];
  readonly beliefs: readonly string[];
  readonly actions: readonly { readonly actionId: string; readonly finalState: string }[];
  readonly memory: readonly string[];
}

/** The full, inspectable loop trajectory. */
export interface MissionTrajectory {
  readonly missionId: string;
  readonly subject: SubjectReference;
  readonly question: string;
  readonly status: MissionStatus;
  readonly disposition?: MissionDisposition;
  readonly stages: readonly TrajectoryStage[];
  readonly evidenceChain: TrajectoryEvidenceChain;
}

function stageSummary(record: MissionStageRecord): string {
  switch (record.stage) {
    case "orient":
      return `oriented on ${record.orientation.subject.kind}:${record.orientation.subject.id} — ${record.orientation.observations.length} observation(s), ${record.orientation.openUnknowns.length} open unknown(s)`;
    case "reason":
      return `reasoned via ${record.modelName} — ${record.content.findings.length} finding(s), ${record.content.gaps.length} gap(s), ${record.content.proposals.length} proposal(s)`;
    case "evaluate":
      return `evaluated — ${record.evaluation.admittedFindings} admitted, ${record.evaluation.staleFindings} stale, disposition ${record.evaluation.disposition}`;
    case "propose":
      return `applied knowledge — ${record.applied.length} new write(s), manifest ${record.manifest.claims.length} claim(s) / ${record.manifest.unknowns.length} unknown(s)`;
    case "gate":
      return `gated actions — ${record.gated.map((entry) => `${entry.actionId}:${entry.finalState}`).join(", ") || "none"}`;
    case "record":
      return `recorded outcome — ${record.outcome.disposition}, ${record.outcome.admittedFindings} admitted finding(s)`;
  }
}

function effectTargets(record: MissionStageRecord): string[] {
  switch (record.stage) {
    case "orient":
      return record.orientation.observations.map((entry) => entry.observationId);
    case "reason":
      return [];
    case "evaluate":
      return [];
    case "propose":
      return record.applied.map((effect) => effect.targetId);
    case "gate":
      return record.gated.map((entry) => entry.actionId);
    case "record":
      return [];
  }
}

/** Builds the trajectory from the mission record (no seam access). */
export function missionTrajectoryOf(mission: MissionRecord): MissionTrajectory {
  const stages: TrajectoryStage[] = mission.stages.map((record) => ({
    stage: record.stage,
    stageIndex: record.stageIndex,
    at: record.at,
    actor: record.actor,
    effectTargets: Object.freeze(effectTargets(record)),
    summary: stageSummary(record),
  }));

  const chain: TrajectoryEvidenceChain = (() => {
    const orientation = mission.stages.find(
      (record): record is Extract<MissionStageRecord, { stage: "orient" }> =>
        record.stage === "orient",
    );
    const propose = mission.stages.find(
      (record): record is Extract<MissionStageRecord, { stage: "propose" }> =>
        record.stage === "propose",
    );
    const gate = mission.stages.find(
      (record): record is Extract<MissionStageRecord, { stage: "gate" }> => record.stage === "gate",
    );
    const recordStage = mission.stages.find(
      (record): record is Extract<MissionStageRecord, { stage: "record" }> =>
        record.stage === "record",
    );
    return {
      observations: Object.freeze(
        orientation ? orientation.orientation.observations.map((entry) => entry.observationId) : [],
      ),
      claims: Object.freeze(propose ? propose.manifest.claims.map((claim) => claim.claimId) : []),
      unknowns: Object.freeze(
        propose ? propose.manifest.unknowns.map((unknown) => unknown.unknownId) : [],
      ),
      beliefs: Object.freeze(
        propose && propose.manifest.belief !== undefined ? [propose.manifest.belief.beliefId] : [],
      ),
      actions: Object.freeze(
        gate
          ? gate.gated.map((entry) => ({ actionId: entry.actionId, finalState: entry.finalState }))
          : [],
      ),
      memory: Object.freeze(recordStage && propose ? [propose.manifest.memory.memoryId] : []),
    };
  })();

  return Object.freeze({
    missionId: mission.missionId,
    subject: mission.charter.subject,
    question: mission.charter.question,
    status: mission.status,
    ...(mission.disposition !== undefined ? { disposition: mission.disposition } : {}),
    stages: Object.freeze(stages),
    evidenceChain: chain,
  });
}

/** Error-carrying wrapper used by the service. */
export function trajectoryOrNotFound(
  mission: MissionRecord | undefined,
): Result<MissionTrajectory, MissionError> {
  if (mission === undefined) return err(missionNotFound("mission"));
  return ok(missionTrajectoryOf(mission));
}
