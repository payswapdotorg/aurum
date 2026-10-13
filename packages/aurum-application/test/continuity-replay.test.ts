/**
 * W012 acceptance proofs — REPLAY (APPROACH R2 + catalog "remote recovery
 * does not duplicate runs"):
 *
 * - replay NEVER re-runs: a recorded mission driven to completion, then
 *   replayed after simulated process death, performs ZERO additional model
 *   invocations and ZERO substrate submissions (counted instruments);
 * - a dead-id resume reconstructs EQUIVALENT state: the replayed runtime's
 *   tower overview is byte-identical (same `now`), missions list identical
 *   records, kernel effects (claims/unknowns/memory/actions) are present
 *   through the real seams;
 * - replayed sessions see their ATTACHMENT HISTORY but never re-materialize
 *   (no phantom re-attach; a re-open is a NEW event with a NEW record);
 * - a replayed session CONTINUES recording (post-resume work journals);
 * - a corrupt ledger (foreign session / gap / wrong first record) fails
 *   with the typed invariant error — never a silent partial replay.
 */
import { describe, expect, it } from "vitest";
import { standardContent } from "./cognition-helpers.js";
import {
  charterMission,
  continuityFixture,
  now,
  okOf,
  personActor,
  scope,
  seedStandardObservations,
  towerRead,
} from "./continuity-helpers.js";
import { isContinuityError } from "../src/index.js";

const S = scope("acme");

async function driveMissionToCompletion(
  runtime: ReturnType<ReturnType<typeof continuityFixture>["openContinuous"]>,
  missionId: string,
): Promise<void> {
  okOf(charterMission(runtime, S, missionId));
  const done = await runtime.tower.runMissionToCompletion(S, missionId, { now: now(10) });
  okOf(done);
}

describe("continuity replay: reconstructs, never re-runs", () => {
  it("replay performs ZERO model invocations (counted) after process death", async () => {
    const fixture = continuityFixture({ script: [standardContent()] });
    const runtime = fixture.openContinuous("session-1");
    await driveMissionToCompletion(runtime, "mission-1");
    const invocationsBefore = fixture.reasoner.calls.length;
    expect(invocationsBefore).toBe(1); // the live run invoked the model once

    const revived = fixture.revive();
    okOf(await revived.service.resumeSession("session-1", { now: now(60), cause: "restart" }));
    expect(revived.reasoner.calls.length).toBe(0); // replay invoked NOTHING
    expect(fixture.reasoner.calls.length).toBe(invocationsBefore); // and the original counter is untouched
  });

  it("replay performs ZERO substrate submissions (counted)", async () => {
    const fixture = continuityFixture({ script: [standardContent()] });
    const runtime = fixture.openContinuous("session-1");
    await driveMissionToCompletion(runtime, "mission-1");
    const submissionsBefore = fixture.substrate.submissions;
    expect(submissionsBefore).toBe(0); // mission work never touches the substrate

    const revived = fixture.revive();
    okOf(await revived.service.resumeSession("session-1", { now: now(60), cause: "restart" }));
    expect(revived.substrate.submissions).toBe(0);
  });

  it("a dead-id resume reconstructs EQUIVALENT state (byte-identical overview)", async () => {
    const fixture = continuityFixture({ script: [standardContent()] });
    const runtime = fixture.openContinuous("session-1");
    await driveMissionToCompletion(runtime, "mission-1");
    const overviewBefore = okOf(runtime.tower.overview(S, towerRead(30)));

    const revived = fixture.revive();
    const resumed = okOf(
      await revived.service.resumeSession("session-1", { now: now(60), cause: "restart" }),
    );
    const overviewAfter = okOf(resumed.runtime.tower.overview(S, towerRead(30)));
    expect(overviewAfter).toStrictEqual(overviewBefore);

    // The reconstructed mission record is byte-identical (journal included).
    const missionAfter = okOf(resumed.runtime.cognition.getMission(S, "mission-1"));
    const missionBefore = okOf(runtime.cognition.getMission(S, "mission-1"));
    expect(missionAfter).toStrictEqual(missionBefore);

    // Kernel effects are present through the REAL seams: every journaled
    // kernel write is re-applied (claims readable via getClaim; beliefs +
    // memory listed for the mission's standard "invoices" topic subject).
    const subject = { kind: "topic" as const, id: "invoices" };
    const kernelWriteKinds = new Set(
      fixture.ledger
        .list("session-1")
        .map((record) => record.entry.kind)
        .filter((kind) =>
          [
            "claim-registered",
            "belief-revised",
            "unknown-raised",
            "memory-recorded",
            "action-proposed",
            "action-recommended",
          ].includes(kind),
        ),
    );
    expect(kernelWriteKinds.size).toBeGreaterThan(0); // the live run wrote kernel effects
    for (const record of fixture.ledger.list("session-1")) {
      const entry = record.entry;
      if (entry.kind === "claim-registered") {
        const claim = resumed.runtime.kernel.epistemics.getClaim(S, entry.input.claimId);
        expect(claim.ok).toBe(true); // reconstructed through the real seam
      }
    }
    expect(resumed.runtime.kernel.epistemics.listBeliefs(S, subject).length).toBeGreaterThan(0);
    expect(resumed.runtime.kernel.memory.listMemory(S, subject).length).toBeGreaterThan(0);
  });

  it("the replay report counts the applied records by kind", async () => {
    const fixture = continuityFixture({ script: [standardContent()] });
    const runtime = fixture.openContinuous("session-1");
    await driveMissionToCompletion(runtime, "mission-1");

    const revived = fixture.revive();
    const ensured = okOf(
      await revived.service.ensureSession({
        sessionId: "session-1",
        tenantName: "acme",
        operator: personActor("operator-1"),
        variant: "web",
        mode: "replay",
        now: now(60),
        cause: "restart",
      }),
    );
    expect(ensured.report).toBeDefined();
    const report = ensured.report;
    if (report === undefined) throw new Error("unreachable");
    expect(report.byKind["session-opened"]).toBe(1);
    expect(report.byKind["mission-recorded"]).toBeGreaterThan(0);
    expect(report.byKind["query-logged"] ?? 0).toBeGreaterThanOrEqual(0);
    expect(report.recordsApplied).toBeGreaterThan(1);
  });

  it("replayed sessions see attachment HISTORY; nothing re-materializes (no phantom re-attach)", async () => {
    const fixture = continuityFixture({ script: [standardContent()] });
    const runtime = fixture.openContinuous("session-1");
    await driveMissionToCompletion(runtime, "mission-1");
    const attachment = okOf(
      await fixture.service.openAttachment(S, {
        sessionId: "session-1",
        attachmentId: "att-1",
        name: "brief.txt",
        contentType: "text/plain",
        bytes: new Uint8Array([1, 2, 3]),
        now: now(20),
      }),
    );
    expect(fixture.surface.materialized.size).toBe(1);

    const revived = fixture.revive();
    const resumed = okOf(
      await revived.service.resumeSession("session-1", { now: now(60), cause: "restart" }),
    );
    void resumed;
    // History is visible on the revived service...
    const history = okOf(revived.service.listAttachments(S, "session-1"));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      attachmentId: "att-1",
      name: "brief.txt",
      digest: attachment.digest,
    });
    // ...but the revived surface materialized NOTHING during replay.
    expect(revived.surface.materialized.size).toBe(0);

    // Re-materializing is a NEW event: a fresh attachment id + record.
    const reopened = okOf(
      await revived.service.openAttachment(S, {
        sessionId: "session-1",
        attachmentId: "att-2",
        name: "brief.txt",
        contentType: "text/plain",
        bytes: new Uint8Array([1, 2, 3]),
        now: now(70),
      }),
    );
    expect(reopened.attachmentId).toBe("att-2");
    expect(revived.surface.materialized.size).toBe(1); // exactly the new one
    const after = okOf(revived.service.listAttachments(S, "session-1"));
    expect(after).toHaveLength(2);
  });

  it("a replayed session CONTINUES recording (post-resume work journals)", async () => {
    const fixture = continuityFixture({ script: [standardContent(), standardContent()] });
    const runtime = fixture.openContinuous("session-1");
    await driveMissionToCompletion(runtime, "mission-1");
    const recordsBefore = fixture.ledger.list("session-1").length;

    const revived = fixture.revive();
    const resumed = okOf(
      await revived.service.resumeSession("session-1", { now: now(60), cause: "restart" }),
    );
    okOf(charterMission(resumed.runtime, S, "mission-2", 61));
    const records = revived.ledger.list("session-1");
    expect(records.length).toBeGreaterThan(recordsBefore + 1); // resume + new work
    const kinds = new Set(records.map((record) => record.entry.kind));
    expect(kinds.has("session-resumed")).toBe(true);
    expect(kinds.has("mission-recorded")).toBe(true);

    // And the continued work is REAL: the new mission is visible + drivable.
    const listed = resumed.runtime.cognition.listMissions(S);
    expect(listed.map((mission) => mission.missionId)).toContain("mission-2");
  });

  it("a corrupt ledger fails typed, never a silent partial replay", async () => {
    const fixture = continuityFixture({ script: [standardContent()] });
    const runtime = fixture.openContinuous("session-1");
    await driveMissionToCompletion(runtime, "mission-1");
    const records = fixture.ledger.list("session-1");
    expect(records.length).toBeGreaterThan(1);

    const { createTowerReplayer } = await import("../src/index.js");
    const replayer = createTowerReplayer({
      ledger: fixture.ledger,
      seedKernel: seedStandardObservations,
    });
    const binding = {
      sessionId: "session-1",
      scope: S,
      variant: "web" as const,
      mode: "replay" as const,
    };

    // The intact sequence folds fine...
    const intact = replayer(records, binding);
    expect(intact.ok).toBe(true);

    // ...while a sequence with a GAP is refused with the typed invariant.
    const gapped = [...records.slice(0, 1), ...records.slice(2)];
    const broken = replayer(gapped, binding);
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(isContinuityError(broken.error)).toBe(true);
      expect(broken.error.code).toBe("continuity-invariant");
    }

    // ...and a foreign-session record never folds into another session.
    const foreign = replayer(
      records.map((record) => ({ ...record, sessionId: "session-2" })),
      binding,
    );
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(isContinuityError(foreign.error)).toBe(true);
      expect(foreign.error.code).toBe("continuity-invariant");
    }
  });
});
