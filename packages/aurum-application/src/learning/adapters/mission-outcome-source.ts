/**
 * Mission outcome source adapter (W013 adapters layer): derives an outcome
 * OBSERVATION from a W007 cognition mission record. Pure record mapping —
 * no service handles, no state mutation; the caller pulls the mission
 * through the cognition contract and passes the value in.
 *
 * Mapping (documented):
 * - a terminal-complete mission with a record stage observes an outcome:
 *   disposition "satisfied" -> status "achieved"; "knowledge-gap-remains"
 *   -> status "missed" (the learning question stayed open — an outcome-level
 *   miss, recorded as first-class calibration evidence, never discarded);
 * - a cancelled or not-yet-terminal mission observes NOTHING (null) —
 *   abandonment and in-flight work are not organization-performance
 *   outcomes (ruling: fabricating outcomes for unobserved runs would
 *   corrupt the calibration evidence).
 */
import type { MissionRecord } from "../../cognition/contract.cognition.js";
import type { OutcomeObservation } from "../domain/records.js";

export function missionOutcomeObservation(mission: MissionRecord): OutcomeObservation | null {
  if (mission.status !== "complete" || mission.disposition === undefined) return null;
  const recordStage = mission.stages.find((stage) => stage.stage === "record");
  if (!recordStage) return null;
  const missed = mission.disposition === "knowledge-gap-remains";
  return {
    status: missed ? "missed" : "achieved",
    source: { kind: "mission", ref: mission.missionId },
    observedAt: recordStage.at,
    observedBy: mission.createdBy,
    ...(missed
      ? {
          failure: {
            kind: "knowledge-gap-remains",
            detail: `mission ended with disposition ${mission.disposition} (${recordStage.outcome.gapsRaised} gap(s) raised)`,
          },
        }
      : {}),
    notes: `mission outcome: ${recordStage.outcome.admittedFindings} admitted finding(s), ${recordStage.outcome.actionsProposed} action(s) proposed`,
  };
}
