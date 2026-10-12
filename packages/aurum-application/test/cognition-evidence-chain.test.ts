/**
 * W007 ACCEPTANCE CLAUSE 4 — "evidence chain is reconstructable".
 *
 * Proofs:
 * - `missionTrajectory` rebuilds the full loop trajectory from the mission
 *   record alone: ordered stages with inputs/outputs and the complete
 *   effect chain;
 * - EVERY chain entry is verifiable in the domain: claims cite real
 *   observations and carry mission-citing provenance; unknowns match the
 *   reasoned gaps; the belief rests on the mission's claims; the memory
 *   carries the disposition; actions sit at `recommended` with
 *   evidence-cited expectedEvidence;
 * - the kernel audit trail contains the mission's consequential
 *   transitions (unknown.raised, memory.revised, action.recommended) —
 *   an inspector holding only the kernel can find the mission footprint.
 */
import { describe, expect, it } from "vitest";
import {
  cognitionFixture,
  createMissionInput,
  now,
  okOf,
  scope,
  seedObservation,
  seedUnknown,
  standardContent,
  topic,
} from "./cognition-helpers.js";

describe("cognition evidence chain (catalog clause 4: reconstructable)", () => {
  it("rebuilds the full trajectory from the mission record alone", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    await fx.service.runToCompletion(s, "mission-1", { now: now(1) });

    const trajectory = okOf(fx.service.missionTrajectory(s, "mission-1"));
    expect(trajectory.missionId).toBe("mission-1");
    expect(trajectory.subject).toEqual(topic());
    expect(trajectory.status).toBe("complete");
    expect(trajectory.disposition).toBe("satisfied");
    expect(trajectory.stages.map((stage) => stage.stage)).toEqual([
      "orient",
      "reason",
      "evaluate",
      "propose",
      "gate",
      "record",
    ]);
    for (const stage of trajectory.stages) {
      expect(stage.stageIndex).toBe(trajectory.stages.indexOf(stage));
      expect(typeof stage.at).toBe("number");
      expect(stage.summary.length).toBeGreaterThan(0);
    }
    expect(trajectory.evidenceChain.observations).toEqual(["obs-1", "obs-2"]);
    expect(trajectory.evidenceChain.claims).toEqual(["mission-1:claim-0", "mission-1:claim-1"]);
    expect(trajectory.evidenceChain.beliefs).toEqual(["mission-1:belief-0"]);
    expect(trajectory.evidenceChain.actions).toEqual([
      { actionId: "mission-1:action-0", finalState: "recommended" },
    ]);
    expect(trajectory.evidenceChain.memory).toEqual(["mission-1:memory-0"]);
    expect(trajectory.evidenceChain.unknowns).toEqual([]);
  });

  it("every claim is verifiable: real observations + mission-citing provenance", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    await fx.service.runToCompletion(s, "mission-1", { now: now(1) });
    const trajectory = okOf(fx.service.missionTrajectory(s, "mission-1"));

    for (const claimId of trajectory.evidenceChain.claims) {
      const claim = okOf(fx.kernel.epistemics.getClaim(s, claimId));
      expect(claim.status).toBe("active");
      expect(claim.provenance.actor).toEqual({ kind: "system", name: "aurum-cognition" });
      expect(claim.provenance.source).toBe("inferred");
      expect(claim.provenance.note).toBe(`mission=mission-1;stage=propose;effect=${claimId}`);
      for (const observationId of claim.derivedFrom) {
        expect(trajectory.evidenceChain.observations).toContain(observationId);
        expect(fx.kernel.evidence.getObservation(s, observationId).ok).toBe(true);
      }
    }
  });

  it("raised unknowns are verifiable and audited (reasoned gaps become honest unknowns)", async () => {
    const gapContent = {
      ...standardContent(),
      gaps: Object.freeze([
        Object.freeze({
          question: "What is ACME's batch API rate limit?",
          consequence: "automation design cannot size the intake window",
        }),
      ]),
    };
    const fx = cognitionFixture([gapContent]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    expect(mission.disposition).toBe("knowledge-gap-remains");

    const unknown = okOf(fx.kernel.inquiry.getUnknown(s, "mission-1:unknown-0"));
    expect(unknown.question).toBe("What is ACME's batch API rate limit?");
    expect(unknown.consequence).toBe("automation design cannot size the intake window");
    expect(unknown.status).toBe("open");
    expect(unknown.provenance.note).toBe(
      "mission=mission-1;stage=propose;effect=mission-1:unknown-0",
    );
    expect(unknown.relatedSubjects).toEqual([topic()]);

    // The kernel audit trail carries the mission's unknown.raised entry.
    const audits = fx.kernel.audit.queryAudit(s, {
      subject: { kind: "unknown", id: "mission-1:unknown-0" },
    });
    expect(audits.some((entry) => entry.action === "unknown.raised")).toBe(true);
  });

  it("pre-existing unknowns orient the mission but are never re-raised", async () => {
    const fx = cognitionFixture([standardContent()]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    seedUnknown(fx.kernel, s, { unknownId: "pre-1", linked: true });
    seedUnknown(fx.kernel, s, { unknownId: "pre-2", linked: false });
    okOf(fx.service.createMission(s, createMissionInput()));

    const oriented = okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    const orient = oriented.stages[0];
    if (orient?.stage !== "orient") throw new Error("expected orient record");
    expect(orient.orientation.openUnknowns.map((entry) => entry.unknownId)).toEqual(["pre-1"]);

    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(2) }));
    const evaluate = mission.stages[2];
    if (evaluate?.stage !== "evaluate") throw new Error("expected evaluate record");
    const preExisting = evaluate.evaluation.gaps.filter((gap) => gap.origin === "pre-existing");
    expect(preExisting.length).toBe(1);
    expect(mission.disposition).toBe("knowledge-gap-remains");
    // The propose stage raised zero new unknowns (the gap is pre-existing).
    const propose = mission.stages[3];
    if (propose?.stage !== "propose") throw new Error("expected propose record");
    expect(propose.manifest.unknowns).toEqual([]);
    expect(fx.kernel.inquiry.getUnknown(s, "mission-1:unknown-0").ok).toBe(false);
  });

  it("the belief is verifiable: first revision resting on the mission's claims", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    await fx.service.runToCompletion(s, "mission-1", { now: now(1) });

    const belief = okOf(fx.kernel.epistemics.getBelief(s, "mission-1:belief-0"));
    expect(belief.subject).toEqual(topic());
    expect(belief.revisions.length).toBe(1);
    const revision = belief.revisions[0];
    if (revision === undefined) throw new Error("expected revision");
    expect(revision.revisionNumber).toBe(1);
    expect(revision.statement).toContain("Invoice processing");
    expect(revision.supportingClaimIds).toEqual(["mission-1:claim-0", "mission-1:claim-1"]);
    expect(revision.provenance.note).toBe(
      "mission=mission-1;stage=propose;effect=mission-1:belief-0",
    );
  });

  it("the memory outcome is verifiable and audited", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    await fx.service.runToCompletion(s, "mission-1", { now: now(1) });

    const memory = okOf(fx.kernel.memory.getMemory(s, "mission-1:memory-0"));
    expect(memory.subject).toEqual(topic());
    expect(memory.versions.length).toBe(1);
    expect(memory.versions[0]?.content).toContain("satisfied");
    expect(memory.versions[0]?.content).toContain("2 finding(s) admitted");
    expect(memory.versions[0]?.provenance.note).toBe(
      "mission=mission-1;stage=record;effect=mission-1:memory-0",
    );
    const audits = fx.kernel.audit.queryAudit(s, {
      subject: { kind: "memory", id: "mission-1:memory-0" },
    });
    expect(audits.some((entry) => entry.action === "memory.revised")).toBe(true);
  });

  it("gated actions are verifiable: recommended state + audited recommendation + evidence citation", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    await fx.service.runToCompletion(s, "mission-1", { now: now(1) });
    const trajectory = okOf(fx.service.missionTrajectory(s, "mission-1"));

    for (const entry of trajectory.evidenceChain.actions) {
      const action = okOf(fx.kernel.actions.getAction(s, entry.actionId));
      expect(action.state).toBe(entry.finalState);
      expect(action.expectedEvidence).toBe("claims:mission-1:claim-0,mission-1:claim-1");
      const audits = fx.kernel.audit.queryAudit(s, {
        subject: { kind: "action", id: entry.actionId },
      });
      const recommended = audits.find((audit) => audit.action === "action.recommended");
      expect(recommended?.actor).toEqual({ kind: "system", name: "aurum-cognition" });
      expect(recommended?.reason).toContain("mission mission-1 analysis recommends");
    }
  });

  it("all effect ids across the trajectory are unique", async () => {
    const many = {
      ...standardContent({ proposals: 3 }),
      gaps: Object.freeze([
        Object.freeze({ question: "gap one?", consequence: "c1" }),
        Object.freeze({ question: "gap two?", consequence: "c2" }),
      ]),
    };
    const fx = cognitionFixture([many]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    await fx.service.runToCompletion(s, "mission-1", { now: now(1) });

    const trajectory = okOf(fx.service.missionTrajectory(s, "mission-1"));
    const allTargets = [
      ...trajectory.evidenceChain.claims,
      ...trajectory.evidenceChain.unknowns,
      ...trajectory.evidenceChain.beliefs,
      ...trajectory.evidenceChain.actions.map((entry) => entry.actionId),
      ...trajectory.evidenceChain.memory,
    ];
    expect(new Set(allTargets).size).toBe(allTargets.length);
    expect(trajectory.evidenceChain.claims.length).toBe(2);
    expect(trajectory.evidenceChain.unknowns.length).toBe(2);
    expect(trajectory.evidenceChain.actions.length).toBe(3);
  });

  it("trajectory on a pending mission reconstructs the empty prefix", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    const trajectory = okOf(fx.service.missionTrajectory(s, "mission-1"));
    expect(trajectory.status).toBe("pending");
    expect(trajectory.stages).toEqual([]);
    expect(trajectory.evidenceChain.claims).toEqual([]);
  });
});
