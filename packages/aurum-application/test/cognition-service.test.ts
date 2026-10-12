/**
 * W007 service behaviors: createMission validation, goal linkage,
 * orientation honesty (truncation, linkage filters, retracted evidence),
 * evaluate honesty (goal evaluation, stale-backed findings), cancellation
 * semantics, listing, and error discipline.
 */
import { describe, expect, it } from "vitest";
import {
  cognitionFixture,
  createMissionInput,
  daysAgo,
  errOf,
  now,
  okOf,
  personActor,
  scope,
  seedGoal,
  seedObservation,
  seedUnknown,
  standardContent,
  topic,
} from "./cognition-helpers.js";

describe("cognition service: createMission validation", () => {
  it("rejects invalid mission ids, subjects, questions, actors and clocks", () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    const cases: [Record<string, unknown>, string][] = [
      [{ ...createMissionInput(), missionId: "" }, "missionId"],
      [{ ...createMissionInput(), missionId: "x".repeat(65) }, "missionId"],
      [{ ...createMissionInput(), subject: { kind: "spaceship", id: "x" } }, "subject.kind"],
      [{ ...createMissionInput(), subject: { kind: "topic", id: " " } }, "subject.id"],
      [{ ...createMissionInput(), question: "" }, "question"],
      [{ ...createMissionInput(), question: "q".repeat(501) }, "question"],
      [{ ...createMissionInput(), consequence: "" }, "consequence"],
      [{ ...createMissionInput(), createdBy: { kind: "person" } }, "createdBy.personId"],
      [{ ...createMissionInput(), now: -1 }, "now"],
    ];
    for (const [input, field] of cases) {
      const error = errOf(fx.service.createMission(s, input as never));
      expect(error.code).toBe("mission-validation");
      expect(error.issues.some((issue) => issue.field === field)).toBe(true);
    }
  });

  it("rejects an unknown goal with closed-failure (no tenant leak)", () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    const error = errOf(
      fx.service.createMission(s, createMissionInput({ goalId: "missing-goal" })),
    );
    expect(error.code).toBe("mission-subject-not-found");
    const other = errOf(
      fx.service.createMission(s, createMissionInput({ goalId: "totally-different" })),
    );
    expect(JSON.stringify(error)).toBe(JSON.stringify(other));
  });

  it("accepts a linked goal and orients with its summary", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    seedGoal(fx.kernel, s);
    okOf(fx.service.createMission(s, createMissionInput({ goalId: "goal-1" })));
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    const orient = mission.stages[0];
    if (orient?.stage !== "orient") throw new Error("expected orient record");
    expect(orient.orientation.goal?.goalId).toBe("goal-1");
    expect(orient.orientation.goal?.priority).toBe("high");
    expect(orient.orientation.goal?.expectedEvidenceSubjects).toEqual([topic()]);
    const evaluate = mission.stages[2];
    if (evaluate?.stage !== "evaluate") throw new Error("expected evaluate record");
    expect(evaluate.evaluation.goalAddressed).toBe(true);
  });

  it("goal evaluation is honest when expected evidence points elsewhere", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    seedGoal(fx.kernel, s, { evidenceSubject: { kind: "process", id: "other" } });
    okOf(fx.service.createMission(s, createMissionInput({ goalId: "goal-1" })));
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    const evaluate = mission.stages[2];
    if (evaluate?.stage !== "evaluate") throw new Error("expected evaluate record");
    expect(evaluate.evaluation.goalAddressed).toBe(false);
  });

  it("refuses duplicate mission ids within one tenant", () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    okOf(fx.service.createMission(s, createMissionInput()));
    const error = errOf(fx.service.createMission(s, createMissionInput()));
    expect(error.code).toBe("mission-conflict");
  });
});

describe("cognition service: orientation honesty", () => {
  it("caps observations and reports truncation counts", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    for (let index = 1; index <= 14; index += 1) {
      seedObservation(fx.kernel, s, { observationId: `obs-${index}` });
    }
    okOf(fx.service.createMission(s, createMissionInput()));
    const mission = okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    const orient = mission.stages[0];
    if (orient?.stage !== "orient") throw new Error("expected orient record");
    expect(orient.orientation.observations.length).toBe(12);
    expect(orient.orientation.truncation.observations).toBe(2);
  });

  it("includes only subject-linked unknowns and contradictions", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    seedUnknown(fx.kernel, s, { unknownId: "linked-1", linked: true });
    seedUnknown(fx.kernel, s, { unknownId: "unlinked-1", linked: false });
    okOf(fx.service.createMission(s, createMissionInput()));
    const mission = okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    const orient = mission.stages[0];
    if (orient?.stage !== "orient") throw new Error("expected orient record");
    expect(orient.orientation.openUnknowns.map((entry) => entry.unknownId)).toEqual(["linked-1"]);
  });

  it("mixed freshness: only current/aging-backed findings are admitted as claims", async () => {
    const content = {
      ...standardContent({ observations: ["obs-1", "obs-2"] }),
      findings: Object.freeze([
        Object.freeze({
          statement: "Fresh finding backed by current evidence.",
          basedOn: Object.freeze(["obs-1"]),
        }),
        Object.freeze({
          statement: "Stale finding backed by aging-beyond evidence.",
          basedOn: Object.freeze(["obs-2"]),
        }),
      ]),
    };
    const fx = cognitionFixture([content]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1", asOf: now(0) });
    seedObservation(fx.kernel, s, { observationId: "obs-2", asOf: daysAgo(45) });
    okOf(fx.service.createMission(s, createMissionInput()));
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));

    const evaluate = mission.stages[2];
    if (evaluate?.stage !== "evaluate") throw new Error("expected evaluate record");
    expect(evaluate.evaluation.findings[0]).toMatchObject({
      freshness: "current",
      admissible: true,
    });
    expect(evaluate.evaluation.findings[1]).toMatchObject({
      freshness: "stale",
      admissible: false,
    });

    const propose = mission.stages[3];
    if (propose?.stage !== "propose") throw new Error("expected propose record");
    expect(propose.manifest.claims.length).toBe(1);
    expect(propose.manifest.claims[0]?.derivedFrom).toEqual(["obs-1"]);
    expect(propose.manifest.unknowns.length).toBe(1);
    expect(propose.manifest.unknowns[0]?.question).toContain("Re-verify");
    expect(mission.disposition).toBe("knowledge-gap-remains");
  });

  it("no admissible findings means no belief is asserted", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1", asOf: daysAgo(45) });
    seedObservation(fx.kernel, s, { observationId: "obs-2", asOf: daysAgo(45) });
    okOf(fx.service.createMission(s, createMissionInput()));
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    const propose = mission.stages[3];
    if (propose?.stage !== "propose") throw new Error("expected propose record");
    expect(propose.manifest.belief).toBeUndefined();
    expect(fx.kernel.epistemics.getBelief(s, "mission-1:belief").ok).toBe(false);
  });
});

describe("cognition service: lifecycle + listing", () => {
  it("cancels a running mission and preserves the journal", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    const cancelled = okOf(
      fx.service.cancelMission(s, "mission-1", {
        now: now(2),
        actor: personActor("p-1"),
        reason: "superseded",
      }),
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.stages.length).toBe(1);
    expect(cancelled.cancelled).toEqual({
      at: now(2),
      by: personActor("p-1"),
      reason: "superseded",
    });
    const again = errOf(
      fx.service.cancelMission(s, "mission-1", {
        now: now(3),
        actor: personActor("p-1"),
        reason: "twice",
      }),
    );
    expect(again.code).toBe("mission-conflict");
  });

  it("a completed mission cannot be cancelled", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    await fx.service.runToCompletion(s, "mission-1", { now: now(1) });
    const error = errOf(
      fx.service.cancelMission(s, "mission-1", {
        now: now(2),
        actor: personActor("p-1"),
        reason: "too late",
      }),
    );
    expect(error.code).toBe("mission-state");
  });

  it("cancelMission validates its inputs", () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    okOf(fx.service.createMission(s, createMissionInput()));
    const error = errOf(
      fx.service.cancelMission(s, "mission-1", {
        now: now(1),
        actor: personActor("p-1"),
        reason: "  ",
      }),
    );
    expect(error.code).toBe("mission-validation");
  });

  it("advance validates now and closed-fails on unknown missions", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    const badClock = errOf(await fx.service.advance(s, "mission-1", { now: -5 }));
    expect(badClock.code).toBe("mission-validation");
    okOf(fx.service.createMission(s, createMissionInput()));
    const missing = errOf(await fx.service.advance(s, "mission-404", { now: now(1) }));
    expect(missing.code).toBe("mission-not-found");
  });

  it("lists missions with status filtering", async () => {
    const fx = cognitionFixture([standardContent(), standardContent()]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput({ missionId: "mission-a" })));
    okOf(fx.service.createMission(s, createMissionInput({ missionId: "mission-b" })));
    await fx.service.runToCompletion(s, "mission-a", { now: now(1) });

    expect(fx.service.listMissions(s).map((m) => m.missionId)).toEqual(["mission-a", "mission-b"]);
    expect(fx.service.listMissions(s, { status: "complete" }).map((m) => m.missionId)).toEqual([
      "mission-a",
    ]);
    expect(fx.service.listMissions(s, { status: "pending" }).map((m) => m.missionId)).toEqual([
      "mission-b",
    ]);
  });

  it("errors are typed MissionErrors, never bare strings", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    const missing = errOf(fx.service.getMission(s, "nope"));
    expect(missing.name).toBe("MissionError");
    expect(typeof missing.code).toBe("string");
    expect(Array.isArray(missing.issues)).toBe(true);
  });
});
