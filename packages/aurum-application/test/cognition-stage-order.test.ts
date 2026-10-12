/**
 * W007 ACCEPTANCE CLAUSE 1 — "stage order is application-owned".
 *
 * Proofs:
 * - the mission journal always walks MISSION_STAGES in the fixed order,
 *   one stage per advance, index == position;
 * - the next stage is DERIVED from the journal length (there is no stage
 *   input anywhere on the service surface);
 * - model output cannot influence the sequence (a zero-content reasoner
 *   still walks all six stages in order);
 * - terminal missions refuse further advances; cancelled missions stop the
 *   loop; runToCompletion is just a driver over advance.
 */
import { describe, expect, it } from "vitest";
import { MISSION_STAGES, missionStageIndex, nextMissionStage } from "../src/index.js";
import {
  cognitionFixture,
  createMissionInput,
  errOf,
  now,
  okOf,
  scope,
  seedObservation,
  standardContent,
} from "./cognition-helpers.js";

describe("cognition stage order (catalog clause 1: application-owned)", () => {
  it("exposes the fixed six-stage canonical sequence", () => {
    expect([...MISSION_STAGES]).toEqual([
      "orient",
      "reason",
      "evaluate",
      "propose",
      "gate",
      "record",
    ]);
    for (const [index, stage] of MISSION_STAGES.entries()) {
      expect(missionStageIndex(stage)).toBe(index);
      expect(nextMissionStage(index)).toBe(stage);
    }
    expect(nextMissionStage(MISSION_STAGES.length)).toBeUndefined();
  });

  it("advances exactly one journal-derived stage per call, in order", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));

    const first = okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    expect(first.status).toBe("running");
    expect(first.stages.map((stage) => stage.stage)).toEqual(["orient"]);

    const second = okOf(await fx.service.advance(s, "mission-1", { now: now(2) }));
    expect(second.stages.map((stage) => stage.stage)).toEqual(["orient", "reason"]);

    const third = okOf(await fx.service.advance(s, "mission-1", { now: now(3) }));
    expect(third.stages.map((stage) => stage.stage)).toEqual(["orient", "reason", "evaluate"]);
  });

  it("a full run walks all six stages in the fixed order and completes", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));

    let mission = okOf(fx.service.getMission(s, "mission-1"));
    for (let index = 0; index < MISSION_STAGES.length; index += 1) {
      mission = okOf(await fx.service.advance(s, "mission-1", { now: now(index + 1) }));
    }
    expect(mission.status).toBe("complete");
    expect(mission.stages.map((stage) => stage.stage)).toEqual([...MISSION_STAGES]);
    expect(mission.stages.map((stage) => stage.stageIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(mission.disposition).toBe("satisfied");
  });

  it("refuses a seventh advance on a completed mission", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    const done = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    expect(done.status).toBe("complete");
    const error = errOf(await fx.service.advance(s, "mission-1", { now: now(9) }));
    expect(error.code).toBe("mission-state");
    expect(error.message).toContain("complete");
  });

  it("model output cannot influence the stage sequence (empty content still walks all six)", async () => {
    const empty = Object.freeze({
      summary: "nothing conclusive",
      findings: Object.freeze([]),
      gaps: Object.freeze([]),
      hypotheses: Object.freeze([]),
      proposals: Object.freeze([]),
    });
    const fx = cognitionFixture([empty]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    expect(mission.status).toBe("complete");
    expect(mission.stages.map((stage) => stage.stage)).toEqual([...MISSION_STAGES]);
    // Honest disposition: nothing was admitted, so a knowledge gap remains.
    expect(mission.disposition).toBe("knowledge-gap-remains");
  });

  it("runToCompletion drives a pending mission to completion in one call", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    expect(mission.status).toBe("complete");
    expect(mission.stages.length).toBe(MISSION_STAGES.length);
  });

  it("cancellation stops the loop; the journal is preserved; further advances refuse", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    okOf(await fx.service.advance(s, "mission-1", { now: now(2) }));

    const cancelled = okOf(
      fx.service.cancelMission(s, "mission-1", {
        now: now(3),
        actor: { kind: "person", personId: "p-1" as never },
        reason: "charter withdrawn",
      }),
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.stages.map((stage) => stage.stage)).toEqual(["orient", "reason"]);
    expect(cancelled.cancelled?.reason).toBe("charter withdrawn");

    const error = errOf(await fx.service.advance(s, "mission-1", { now: now(4) }));
    expect(error.code).toBe("mission-state");
    expect(error.message).toContain("cancelled");
  });

  it("the standard script produces a satisfied mission with two admitted findings", async () => {
    const fx = cognitionFixture([standardContent()]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    expect(mission.disposition).toBe("satisfied");
    const evaluate = mission.stages[2];
    if (evaluate?.stage !== "evaluate") throw new Error("expected evaluate record");
    expect(evaluate.evaluation.admittedFindings).toBe(2);
    expect(evaluate.evaluation.staleFindings).toBe(0);
    expect(evaluate.evaluation.goalAddressed).toBeUndefined();
  });
});
