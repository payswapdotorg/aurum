/**
 * W012 acceptance proofs — REMOTE ATTACHMENTS (APPROACH R5): runtime-plane
 * records over the `TowerAttachmentSurface` port. Digests are labeled;
 * materialization failures are typed surface refusals; ids are open-once
 * per session; close is once; the history is the ledger's own projection.
 */
import { describe, expect, it } from "vitest";
import {
  createContinuousTowerSession,
  createContinuityService,
  createInMemoryContinuityLedger,
  createRefusingAttachmentSurface,
  createTowerReplayer,
  fnv1a64Of,
  isContinuityError,
  type ContinuityError,
} from "../src/index.js";
import { continuityFixture, errOf, now, okOf, scope } from "./continuity-helpers.js";

const S = scope("acme");

function isCode(error: ContinuityError, code: ContinuityError["code"]): boolean {
  return isContinuityError(error) && error.code === code;
}

describe("continuity attachments: runtime-plane records over the substrate surface", () => {
  it("openAttachment materializes through the surface and records digest + ref", async () => {
    const { service, openContinuous, surface } = continuityFixture();
    openContinuous("session-1");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const view = okOf(
      await service.openAttachment(S, {
        sessionId: "session-1",
        attachmentId: "att-1",
        name: "brief.txt",
        contentType: "text/plain",
        bytes,
        now: now(5),
      }),
    );
    expect(view.attachmentId).toBe("att-1");
    expect(view.surface).toBe("in-memory");
    expect(view.materializedRef).toBe("mem://session-1/att-1");
    expect(surface.materialized.get("mem://session-1/att-1")).toStrictEqual(bytes);
    // The digest is the labeled SHA-256 of the bytes (WebCrypto on this host).
    expect(view.digest.algorithm).toBe("sha256");
    expect(view.digest.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the fnv1a-64 fallback is pure, deterministic and labeled honestly", () => {
    const a = fnv1a64Of(new Uint8Array([1, 2, 3]));
    const b = fnv1a64Of(new Uint8Array([1, 2, 3]));
    const c = fnv1a64Of(new Uint8Array([1, 2, 4]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("attachment ids are open-once per session (typed conflict on re-use)", async () => {
    const { service, openContinuous } = continuityFixture();
    openContinuous("session-1");
    const input = {
      sessionId: "session-1",
      attachmentId: "att-1",
      name: "brief.txt",
      contentType: "text/plain",
      bytes: new Uint8Array([1]),
      now: now(5),
    };
    okOf(await service.openAttachment(S, input));
    const second = await service.openAttachment(S, input);
    expect(isCode(errOf(second), "continuity-conflict")).toBe(true);
  });

  it("closeAttachment is once; double-close is the typed state error", async () => {
    const { service, openContinuous } = continuityFixture();
    openContinuous("session-1");
    okOf(
      await service.openAttachment(S, {
        sessionId: "session-1",
        attachmentId: "att-1",
        name: "brief.txt",
        contentType: "text/plain",
        bytes: new Uint8Array([1]),
        now: now(5),
      }),
    );
    const closed = okOf(
      service.closeAttachment(S, { sessionId: "session-1", attachmentId: "att-1", now: now(9) }),
    );
    expect(closed.closedAt).toBe(now(9));
    const again = service.closeAttachment(S, {
      sessionId: "session-1",
      attachmentId: "att-1",
      now: now(10),
    });
    expect(isCode(errOf(again), "continuity-state")).toBe(true);
    // Closing an unknown attachment is the uniform not-found.
    expect(
      isCode(
        errOf(
          service.closeAttachment(S, {
            sessionId: "session-1",
            attachmentId: "nope",
            now: now(10),
          }),
        ),
        "continuity-not-found",
      ),
    ).toBe(true);
  });

  it("the history lists opened + closed state in openedAt order", async () => {
    const { service, openContinuous } = continuityFixture();
    openContinuous("session-1");
    for (const id of ["att-1", "att-2", "att-3"]) {
      okOf(
        await service.openAttachment(S, {
          sessionId: "session-1",
          attachmentId: id,
          name: `${id}.txt`,
          contentType: "text/plain",
          bytes: new Uint8Array([1]),
          now: now(5),
        }),
      );
    }
    okOf(
      service.closeAttachment(S, { sessionId: "session-1", attachmentId: "att-2", now: now(9) }),
    );
    const history = okOf(service.listAttachments(S, "session-1"));
    expect(history.map((view) => view.attachmentId)).toEqual(["att-1", "att-2", "att-3"]);
    expect(history[1]?.closedAt).toBe(now(9));
    expect(history[0]?.closedAt).toBeUndefined();
    const info = okOf(service.sessionInfo("session-1"));
    expect(info.attachmentCount).toBe(3);
  });

  it("input validation refuses empty names/bytes and malformed content types", async () => {
    const { service, openContinuous } = continuityFixture();
    openContinuous("session-1");
    const bad = await service.openAttachment(S, {
      sessionId: "session-1",
      name: "  ",
      contentType: "not-a-type",
      bytes: new Uint8Array([]),
      now: now(5),
    });
    const error = errOf(bad);
    expect(isCode(error, "continuity-validation")).toBe(true);
    expect(error.issues.map((issue) => issue.field).sort()).toEqual([
      "bytes",
      "contentType",
      "name",
    ]);
  });

  it("a refusing surface propagates the typed surface-refused error (no record)", async () => {
    const ledger = createInMemoryContinuityLedger();
    const service = createContinuityService({
      ledger,
      surface: createRefusingAttachmentSurface("host has no space"),
      compose: createContinuousTowerSession({ ledger }),
      replay: createTowerReplayer({ ledger }),
    });
    const opened = service.openSession(S, {
      sessionId: "session-1",
      operator: { kind: "system", name: "seed" },
      variant: "web",
      mode: "replay",
      now: now(0),
    });
    expect(opened.ok).toBe(true);
    const recordsBefore = ledger.list("session-1").length;
    const refused = await service.openAttachment(S, {
      sessionId: "session-1",
      attachmentId: "att-1",
      name: "brief.txt",
      contentType: "text/plain",
      bytes: new Uint8Array([1]),
      now: now(5),
    });
    const error = errOf(refused);
    expect(isCode(error, "continuity-surface-refused")).toBe(true);
    expect(error.message).toContain("host has no space");
    expect(ledger.list("session-1")).toHaveLength(recordsBefore); // nothing journaled
  });
});
