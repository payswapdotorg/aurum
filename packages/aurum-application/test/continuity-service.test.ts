/**
 * W012 acceptance proofs — the continuity SERVICE semantics (APPROACH R3 +
 * the catalog's "remote recovery does not duplicate runs"):
 *
 * - `openSession` journals `session-opened` as the FIRST record and
 *   registers the session live; open is ONCE (id collision refused);
 * - `attachSession` on a live id returns the SAME runtime reference
 *   (desktop continuity — renderer reloads re-attach, never re-compose);
 * - `resumeSession` on a LIVE id returns that session UNCHANGED (no
 *   replay, no re-execution, no new records);
 * - `resumeSession` on a recorded-but-dead id replays (adapters proofs in
 *   continuity-replay.test.ts) and journals `session-resumed`;
 * - unknown vs foreign-tenant ids fail with the uniform not-found (no
 *   existence leaks);
 * - `ensureSession` is the mount-friendly open-or-attach-or-resume with the
 *   explicit disposition, and the session projections mirror the ledger.
 */
import { describe, expect, it } from "vitest";
import { isContinuityError, type ContinuityError } from "../src/index.js";
import {
  charterMission,
  continuityFixture,
  errOf,
  now,
  okOf,
  personActor,
  scope,
  systemActor,
} from "./continuity-helpers.js";

const S = scope("acme");
const OTHER = scope("rival");

function isCode(error: ContinuityError, code: ContinuityError["code"]): boolean {
  return isContinuityError(error) && error.code === code;
}

describe("continuity service: open / attach / resume semantics", () => {
  it("openSession journals session-opened FIRST and registers the session live", async () => {
    const { service, ledger, openContinuous } = continuityFixture();
    const runtime = openContinuous("session-1");
    expect(runtime).toBeDefined();
    const records = ledger.list("session-1");
    expect(records).toHaveLength(1);
    expect(records[0]?.entry.kind).toBe("session-opened");
    const info = okOf(service.sessionInfo("session-1"));
    expect(info.live).toBe(true);
    expect(info.variant).toBe("desktop");
    expect(info.mode).toBe("continuous");
    expect(info.tenantId).toBe("acme");
    expect(info.recordCount).toBe(1);
  });

  it("openSession is ONCE: a second open of the same id is a typed conflict", async () => {
    const { service, openContinuous } = continuityFixture();
    openContinuous("session-1");
    const second = service.openSession(S, {
      sessionId: "session-1",
      operator: personActor("operator-1"),
      variant: "web",
      mode: "replay",
      now: now(5),
    });
    expect(isCode(errOf(second), "continuity-conflict")).toBe(true);
  });

  it("openSession validates its input (typed continuity-validation issues)", async () => {
    const { service } = continuityFixture();
    const bad = service.openSession(S, {
      sessionId: "   ",
      operator: { kind: "mystery" } as never,
      variant: "toaster" as never,
      mode: "sometimes" as never,
      now: -1,
    });
    const error = errOf(bad);
    expect(isCode(error, "continuity-validation")).toBe(true);
    expect(error.issues.map((issue) => issue.field).sort()).toEqual(
      ["mode", "now", "operator", "sessionId", "variant"].sort(),
    );
  });

  it("attachSession returns the SAME live runtime (reference-equal) — desktop continuity", async () => {
    const { service, openContinuous } = continuityFixture();
    const opened = openContinuous("session-1");
    const attached = okOf(service.attachSession("session-1"));
    expect(attached.runtime).toBe(opened); // reference equality — R3
    const attachedAgain = okOf(service.attachSession("session-1"));
    expect(attachedAgain.runtime).toBe(opened);
  });

  it("attachSession refuses a recorded-but-dead id with the typed state error", async () => {
    const { openContinuous, revive } = continuityFixture();
    openContinuous("session-1");
    const revived = revive(); // process death: fresh service, same ledger
    const attached = revived.service.attachSession("session-1");
    expect(isCode(errOf(attached), "continuity-state")).toBe(true);
  });

  it("attachSession refuses an unknown id with the uniform not-found", async () => {
    const { service } = continuityFixture();
    expect(isCode(errOf(service.attachSession("nope")), "continuity-not-found")).toBe(true);
  });

  it("resumeSession on a LIVE id returns that session UNCHANGED (no replay, no new records)", async () => {
    const { service, ledger, openContinuous } = continuityFixture();
    const runtime = openContinuous("session-1");
    okOf(charterMission(runtime, S, "mission-1"));
    const recordsBefore = ledger.list("session-1").length;
    const resumed = await service.resumeSession("session-1", {
      now: now(60),
      cause: "renderer reload",
    });
    const session = okOf(resumed);
    expect(session.runtime).toBe(runtime); // SAME reference, unchanged
    expect(session.mode).toBe("continuous");
    expect(ledger.list("session-1")).toHaveLength(recordsBefore); // nothing appended
    const info = okOf(service.sessionInfo("session-1"));
    expect(info.resumes).toHaveLength(0); // no phantom resume record
  });

  it("resumeSession on a dead id replays, journals session-resumed and registers live", async () => {
    const { ledger, openContinuous, revive } = continuityFixture();
    const runtime = openContinuous("session-1");
    okOf(charterMission(runtime, S, "mission-1"));
    const revived = revive();
    const before = ledger.list("session-1").length;
    const resumed = await revived.service.resumeSession("session-1", {
      now: now(60),
      cause: "process restart",
    });
    const session = okOf(resumed);
    expect(session.mode).toBe("replay");
    expect(session.runtime).toBeDefined();
    const records = ledger.list("session-1");
    expect(records).toHaveLength(before + 1);
    const last = records[records.length - 1]?.entry;
    expect(last?.kind).toBe("session-resumed");
    if (last?.kind === "session-resumed") {
      expect(last.cause).toBe("process restart");
      expect(last.recordsReplayed).toBeGreaterThan(0);
    }
    const info = okOf(revived.service.sessionInfo("session-1"));
    expect(info.live).toBe(true);
    expect(info.resumes).toHaveLength(1);
    // and the revived session is now ATTACHABLE (same reference law)
    expect(okOf(revived.service.attachSession("session-1")).runtime).toBe(session.runtime);
  });

  it("resumeSession refuses an unknown id with the uniform not-found (no existence leak)", async () => {
    const { service } = continuityFixture();
    const resumed = await service.resumeSession("nope", { now: now(1), cause: "test" });
    expect(isCode(errOf(resumed), "continuity-not-found")).toBe(true);
  });

  it("resumeSession is idempotent on the revived live session (second resume = unchanged)", async () => {
    const { openContinuous, revive } = continuityFixture();
    openContinuous("session-1");
    const revived = revive();
    const first = okOf(
      await revived.service.resumeSession("session-1", { now: now(60), cause: "restart" }),
    );
    const second = okOf(
      await revived.service.resumeSession("session-1", { now: now(90), cause: "reload" }),
    );
    expect(second.runtime).toBe(first.runtime); // live id: unchanged
  });

  it("listSessions projects the ledger (first-seen order, honest counts)", async () => {
    const { service, openContinuous } = continuityFixture();
    openContinuous("session-a");
    openContinuous("session-b", { tenant: "globex" });
    const infos = service.listSessions();
    expect(infos.map((info) => info.sessionId)).toEqual(["session-a", "session-b"]);
    expect(infos[1]?.tenantId).toBe("globex");
    expect(infos.every((info) => info.live)).toBe(true);
  });

  it("ensureSession opens / attaches / resumes by disposition (the mount entry point)", async () => {
    const { service, openContinuous, revive } = continuityFixture();
    const opened = okOf(
      await service.ensureSession({
        sessionId: "session-1",
        tenantName: "acme",
        operator: systemActor("web-mount"),
        variant: "web",
        mode: "replay",
        now: now(0),
        cause: "page load",
      }),
    );
    expect(opened.disposition).toBe("opened");
    const attached = okOf(
      await service.ensureSession({
        sessionId: "session-1",
        tenantName: "acme",
        operator: systemActor("web-mount"),
        variant: "web",
        mode: "replay",
        now: now(1),
        cause: "page reload",
      }),
    );
    expect(attached.disposition).toBe("attached");
    expect(attached.report).toBeUndefined();

    openContinuous("session-2");
    const revived = revive();
    const replayed = okOf(
      await revived.service.ensureSession({
        sessionId: "session-2",
        tenantName: "acme",
        operator: systemActor("web-mount"),
        variant: "web",
        mode: "replay",
        now: now(2),
        cause: "process restart",
      }),
    );
    expect(replayed.disposition).toBe("replayed");
    expect(replayed.report?.recordsApplied).toBeGreaterThan(0);
  });

  it("attachments are tenant-fenced: a foreign tenant sees the uniform not-found", async () => {
    const { service, openContinuous } = continuityFixture();
    openContinuous("session-1");
    const listed = service.listAttachments(OTHER, "session-1");
    const listedError = errOf(listed);
    expect(isCode(listedError, "continuity-not-found")).toBe(true);
    const opened = await service.openAttachment(OTHER, {
      sessionId: "session-1",
      name: "brief.txt",
      contentType: "text/plain",
      bytes: new Uint8Array([1, 2, 3]),
      now: now(3),
    });
    expect(isCode(errOf(opened), "continuity-not-found")).toBe(true);
    // ...and the not-found is code-identical for a never-existing session
    // (no existence leak: foreign-tenant and unknown are indistinguishable).
    const missing = service.listAttachments(OTHER, "never-existed");
    expect(isCode(errOf(missing), "continuity-not-found")).toBe(true);
    expect(errOf(missing).name).toBe(listedError.name);
  });
});
