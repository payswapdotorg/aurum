/**
 * W007 — asynchronous / resumable loop with idempotent stage application.
 *
 * Proofs:
 * - interruption at EVERY stage boundary: resuming via runToCompletion
 *   converges to the same completed journal and the same domain state
 *   (claims / unknowns / beliefs / actions / memory each exactly once);
 * - the crash-between-write-and-journal window: pre-applying a
 *   deterministic effect id directly in the kernel (simulating a domain
 *   write whose journal append was lost) is tolerated — the replaying
 *   stage skips instead of duplicating;
 * - concurrent double-advance is refused (in-flight guard);
 * - tenant isolation is uniform: foreign-tenant access is byte-identical
 *   to a missing mission.
 */
import { describe, expect, it } from "vitest";
import { MISSION_STAGES } from "../src/index.js";
import {
  cognitionFixture,
  createMissionInput,
  errOf,
  now,
  okOf,
  personActor,
  scope,
  seedObservation,
  standardContent,
} from "./cognition-helpers.js";

function seededFixture() {
  const fx = cognitionFixture([standardContent()]);
  const s = scope("t1");
  seedObservation(fx.kernel, s, { observationId: "obs-1" });
  seedObservation(fx.kernel, s, { observationId: "obs-2" });
  okOf(fx.service.createMission(s, createMissionInput()));
  return { fx, s };
}

/** Counts every mission footprint in the kernel (the duplicate detector). */
function missionFootprint(fx: ReturnType<typeof cognitionFixture>, s: ReturnType<typeof scope>) {
  return {
    claims: fx.kernel.epistemics.listBeliefs(s, { kind: "topic", id: "invoices" }).length,
    claimsById: ["mission-1:claim-0", "mission-1:claim-1"].map((id) =>
      fx.kernel.epistemics.getClaim(s, id).ok ? 1 : 0,
    ),
    unknowns: fx.kernel.inquiry.listOpenUnknowns(s).length,
    beliefs: ["mission-1:belief-0"].map((id) => (fx.kernel.epistemics.getBelief(s, id).ok ? 1 : 0)),
    actions: fx.kernel.actions.listActions(s).length,
    memory: fx.kernel.memory.listMemory(s, { kind: "topic", id: "invoices" }).length,
  };
}

describe("cognition resumability (explicit asynchronous loop)", () => {
  it("resumes from every stage boundary without duplicate side effects", async () => {
    for (let interruptedAt = 0; interruptedAt <= MISSION_STAGES.length; interruptedAt += 1) {
      const { fx, s } = seededFixture();
      for (let index = 0; index < interruptedAt; index += 1) {
        okOf(await fx.service.advance(s, "mission-1", { now: now(index + 1) }));
      }
      const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(50) }));
      expect(mission.status).toBe("complete");
      expect(mission.stages.map((stage) => stage.stage)).toEqual([...MISSION_STAGES]);

      const footprint = missionFootprint(fx, s);
      expect(footprint.claimsById).toEqual([1, 1]);
      expect(footprint.beliefs).toEqual([1]);
      expect(footprint.unknowns).toBe(0);
      expect(footprint.actions).toBe(1);
      expect(footprint.memory).toBe(1);
    }
  });

  it("crash window on claims: a pre-registered deterministic claim is skipped, not duplicated", async () => {
    const { fx, s } = seededFixture();
    // Simulate: the propose-stage claim write landed, the journal did not.
    const pre = fx.kernel.epistemics.registerClaim(s, {
      claimId: "mission-1:claim-0",
      statement: "Supplier ACME delivers unbatched invoices causing manual steps.",
      derivedFrom: ["obs-1"],
      provenance: {
        actor: { kind: "system", name: "aurum-cognition" },
        source: "inferred",
        recordedAt: now(10),
        note: "mission=mission-1;stage=propose;effect=mission-1:claim-0",
      },
      freshness: { asOf: now(10) },
    });
    expect(pre.ok).toBe(true);
    for (let index = 0; index < 3; index += 1) {
      okOf(await fx.service.advance(s, "mission-1", { now: now(index + 1) }));
    }
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(20) }));
    expect(mission.status).toBe("complete");
    // claim-0 exists ONCE (the pre-registration), claim-1 was applied by the replay.
    const claim0 = okOf(fx.kernel.epistemics.getClaim(s, "mission-1:claim-0"));
    expect(claim0.provenance.note).toContain("mission=mission-1");
    expect(fx.kernel.epistemics.getClaim(s, "mission-1:claim-1").ok).toBe(true);
    // The belief cites both claims exactly once (single revision).
    const belief = okOf(fx.kernel.epistemics.getBelief(s, "mission-1:belief-0"));
    expect(belief.revisions.length).toBe(1);
    expect(belief.revisions[0]?.supportingClaimIds).toEqual([
      "mission-1:claim-0",
      "mission-1:claim-1",
    ]);
  });

  it("crash window on actions: a pre-proposed+recommended action is journaled, not re-driven", async () => {
    const { fx, s } = seededFixture();
    for (let index = 0; index < 4; index += 1) {
      okOf(await fx.service.advance(s, "mission-1", { now: now(index + 1) }));
    }
    // Simulate: the gate write landed (proposed + recommended), journal lost.
    okOf(
      fx.kernel.actions.proposeAction(s, {
        actionId: "mission-1:action-0",
        title: "Automate ACME invoice intake ",
        subject: { kind: "topic", id: "invoices" },
        policy: {
          approvalRoles: ["approver"],
          authorizationRoles: ["authorizer"],
          employmentImpacting: false,
        },
        createdBy: { kind: "system", name: "aurum-cognition" },
        now: now(10),
      }),
    );
    okOf(
      fx.kernel.actions.recommendAction(s, {
        actionId: "mission-1:action-0",
        expectedState: "proposed",
        now: now(11),
        audit: {
          actor: { kind: "system", name: "aurum-cognition" },
          at: now(11),
          reason: "crash-window recommendation",
        },
      }),
    );
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(20) }));
    expect(mission.status).toBe("complete");
    const action = okOf(fx.kernel.actions.getAction(s, "mission-1:action-0"));
    expect(action.state).toBe("recommended");
    // Exactly one proposed and one recommended transition — no duplicates.
    expect(action.stateHistory.map((entry) => entry.to)).toEqual(["proposed", "recommended"]);
    expect(fx.kernel.actions.listActions(s).length).toBe(1);
  });

  it("crash window on memory: a pre-recorded memory is journaled, not re-versioned", async () => {
    const { fx, s } = seededFixture();
    for (let index = 0; index < 5; index += 1) {
      okOf(await fx.service.advance(s, "mission-1", { now: now(index + 1) }));
    }
    okOf(
      fx.kernel.memory.recordMemory(s, {
        memoryId: "mission-1:memory-0",
        subject: { kind: "topic", id: "invoices" },
        content:
          "mission mission-1 on topic:invoices — satisfied: 2 finding(s) admitted, 0 gap(s) raised, 1 action(s) proposed",
        provenance: {
          actor: { kind: "system", name: "aurum-cognition" },
          source: "inferred",
          recordedAt: now(10),
          note: "mission=mission-1;stage=record;effect=mission-1:memory-0",
        },
        now: now(10),
        audit: {
          actor: { kind: "system", name: "aurum-cognition" },
          at: now(10),
          reason: "crash-window memory",
        },
      }),
    );
    const mission = okOf(await fx.service.advance(s, "mission-1", { now: now(20) }));
    expect(mission.status).toBe("complete");
    const memory = okOf(fx.kernel.memory.getMemory(s, "mission-1:memory-0"));
    expect(memory.versions.length).toBe(1);
  });

  it("concurrent double-advance on one mission is refused (in-flight guard)", async () => {
    const { fx, s } = seededFixture();
    const first = fx.service.advance(s, "mission-1", { now: now(1) });
    const second = fx.service.advance(s, "mission-1", { now: now(1) });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.ok).toBe(true);
    const error = errOf(secondResult);
    expect(error.code).toBe("mission-conflict");
    expect(error.message).toContain("in flight");
    // The journal has exactly one orient stage afterwards.
    const mission = okOf(fx.service.getMission(s, "mission-1"));
    expect(mission.stages.map((stage) => stage.stage)).toEqual(["orient"]);
  });

  it("two missions in one tenant are independent loops", async () => {
    const fx = cognitionFixture([standardContent(), standardContent()]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput({ missionId: "mission-1" })));
    okOf(fx.service.createMission(s, createMissionInput({ missionId: "mission-2" })));
    const one = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    const two = okOf(await fx.service.runToCompletion(s, "mission-2", { now: now(2) }));
    expect(one.missionId).toBe("mission-1");
    expect(two.missionId).toBe("mission-2");
    expect(fx.kernel.actions.listActions(s).length).toBe(2);
    expect(fx.kernel.actions.getAction(s, "mission-1:action-0").ok).toBe(true);
    expect(fx.kernel.actions.getAction(s, "mission-2:action-0").ok).toBe(true);
  });

  it("tenant isolation: foreign-tenant access is byte-identical to missing", async () => {
    const { fx, s } = seededFixture();
    okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    const other = scope("t2");

    const foreignGet = errOf(fx.service.getMission(other, "mission-1"));
    const missingGet = errOf(fx.service.getMission(s, "mission-404"));
    expect(foreignGet.code).toBe("mission-not-found");
    expect(JSON.stringify(foreignGet)).toBe(JSON.stringify(missingGet));

    const foreignAdvance = errOf(await fx.service.advance(other, "mission-1", { now: now(2) }));
    expect(JSON.stringify(foreignAdvance)).toBe(JSON.stringify(missingGet));

    const foreignTrajectory = errOf(fx.service.missionTrajectory(other, "mission-1"));
    expect(JSON.stringify(foreignTrajectory)).toBe(JSON.stringify(missingGet));

    expect(fx.service.listMissions(other)).toEqual([]);
    // The foreign tenant sees no mission footprint in the shared kernel.
    expect(fx.kernel.memory.listMemory(other, { kind: "topic", id: "invoices" })).toEqual([]);
    expect(fx.kernel.actions.listActions(other)).toEqual([]);
  });

  it("the same mission id may exist in two tenants as independent records", async () => {
    const fx = cognitionFixture([standardContent(), standardContent()]);
    const t1 = scope("t1");
    const t2 = scope("t2");
    for (const tenant of [t1, t2]) {
      seedObservation(fx.kernel, tenant, { observationId: "obs-1" });
      seedObservation(fx.kernel, tenant, { observationId: "obs-2" });
      okOf(fx.service.createMission(tenant, createMissionInput()));
    }
    const inOne = okOf(await fx.service.runToCompletion(t1, "mission-1", { now: now(1) }));
    const inTwo = okOf(fx.service.getMission(t2, "mission-1"));
    expect(inOne.status).toBe("complete");
    expect(inTwo.status).toBe("pending");
    // Cancelling in t2 does not affect t1.
    okOf(
      fx.service.cancelMission(t2, "mission-1", {
        now: now(2),
        actor: personActor("p-1"),
        reason: "not needed here",
      }),
    );
    expect(fx.service.getMission(t1, "mission-1").value.status ?? "").not.toBe("cancelled");
  });
});
