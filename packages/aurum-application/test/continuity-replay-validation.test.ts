/**
 * W012 domain proofs — the replay contract of the continuity records
 * (APPROACH R1/R2). These lock the PURE derivations: what makes a record
 * sequence legal to fold, and what a replay summary reports. The fold itself
 * (applying records through real stores) is proven in
 * continuity-replay.test.ts at the adapters layer; the no-second-body and
 * ledger append-only tripwires live in continuity-contract-hygiene.test.ts.
 *
 * Every fixture here is synthetic — no kernel, no model, no substrate: the
 * domain layer of this area is IO-free by construction.
 */
import { describe, expect, it } from "vitest";
import type { ActorReference, TenantScope } from "@aurum/domain";
import {
  CONTINUITY_COMPOSITION_ID,
  isContinuityError,
  replayIssues,
  replaySummaryOf,
  type ContinuityEntry,
  type ContinuityRecord,
} from "../src/index.js";

const SCOPE: TenantScope = { tenantId: "acme" } as TenantScope;
const OPERATOR: ActorReference = { kind: "person", personId: "p-1" as never };

function recordAt(sessionId: string, seq: number, entry: ContinuityEntry): ContinuityRecord {
  return { recordId: `${sessionId}/${seq}`, sessionId, seq, entry };
}

function openedEntry(
  variant: "desktop" | "web" | "mobile" | "cli" = "web",
  mode: "continuous" | "replay" = "replay",
): ContinuityEntry {
  return {
    kind: "session-opened",
    tenantId: SCOPE.tenantId,
    operator: OPERATOR,
    variant,
    mode,
    composition: CONTINUITY_COMPOSITION_ID,
    openedAt: 1_700_000_000_000,
  };
}

const kernelWrite: ContinuityEntry = {
  kind: "memory-recorded",
  scope: SCOPE,
  input: {
    memoryId: "mem-1",
    subject: { kind: "topic", id: "invoices" },
    statement: "Invoice cycles improved after the overhaul",
    actor: OPERATOR,
    now: 1_700_000_000_000,
  } as never,
};

describe("continuity replay validation (domain, pure)", () => {
  it("accepts a sequence that starts with session-opened and is contiguous", () => {
    const records = [
      recordAt("s-1", 0, openedEntry()),
      recordAt("s-1", 1, kernelWrite),
      recordAt("s-1", 2, {
        kind: "session-resumed",
        resumedAt: 1,
        cause: "reload",
        recordsReplayed: 0,
      }),
    ];
    const result = replayIssues(records, "s-1");
    expect(result.ok).toBe(true);
  });

  it("refuses an empty sequence with the typed invariant error", () => {
    const result = replayIssues([], "s-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isContinuityError(result.error)).toBe(true);
    expect(result.error.code).toBe("continuity-invariant");
    expect(result.error.message).toContain("s-1");
  });

  it("refuses a sequence whose first record is not session-opened", () => {
    const records = [recordAt("s-1", 0, kernelWrite)];
    const result = replayIssues(records, "s-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("continuity-invariant");
    expect(result.error.message).toContain("session-opened");
  });

  it("refuses records that belong to a different session", () => {
    const records = [recordAt("s-1", 0, openedEntry()), recordAt("s-2", 1, kernelWrite)];
    const result = replayIssues(records, "s-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("s-2");
  });

  it("refuses duplicate record ids (append-only, no double-apply)", () => {
    const first = recordAt("s-1", 0, openedEntry());
    const records = [first, { ...first }, recordAt("s-1", 1, kernelWrite)];
    const result = replayIssues(records, "s-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("duplicate record id s-1/0");
  });

  it("refuses a sequence-number gap (the fold is order-preserving)", () => {
    const records = [recordAt("s-1", 0, openedEntry()), recordAt("s-1", 2, kernelWrite)];
    const result = replayIssues(records, "s-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("continuity-invariant");
    expect(result.error.message).toContain("seq 2");
    expect(result.error.message).toContain("expected 1");
  });

  it("refuses a sequence that restarts numbering", () => {
    const records = [recordAt("s-1", 0, openedEntry()), recordAt("s-1", 0, kernelWrite)];
    const result = replayIssues(records, "s-1");
    expect(result.ok).toBe(false);
  });

  it("summarizes a replay by entry kind with the total applied", () => {
    const records = [
      recordAt("s-1", 0, openedEntry()),
      recordAt("s-1", 1, kernelWrite),
      recordAt("s-1", 2, kernelWrite),
      recordAt("s-1", 3, {
        kind: "attachment-opened",
        attachmentId: "att-1",
        name: "brief.txt",
        contentType: "text/plain",
        digest: { algorithm: "sha256", value: "abc" },
        surface: "in-memory",
        materializedRef: "mem://att-1",
        openedAt: 5,
      }),
    ];
    const report = replaySummaryOf("s-1", records);
    expect(report.sessionId).toBe("s-1");
    expect(report.recordsApplied).toBe(4);
    expect(report.byKind["session-opened"]).toBe(1);
    expect(report.byKind["memory-recorded"]).toBe(2);
    expect(report.byKind["attachment-opened"]).toBe(1);
  });

  it("reports zero counts for an empty ledger read (no fabrication)", () => {
    const report = replaySummaryOf("s-none", []);
    expect(report.recordsApplied).toBe(0);
    expect(Object.keys(report.byKind)).toHaveLength(0);
  });

  it("keeps the composition identity stable (the replayed runtime must be the same composition)", () => {
    // The composition id is part of every session-opened record; a replay
    // composes the SAME canonical local runtime the live session used. The
    // constant is frozen vocabulary — changing it is a ledger-format change.
    expect(CONTINUITY_COMPOSITION_ID).toBe("local-control-tower-v1");
    expect(openedEntry().composition).toBe(CONTINUITY_COMPOSITION_ID);
  });

  it("records the EXPLICIT mode + variant on session-opened (never inferred)", () => {
    const desktop = openedEntry("desktop", "continuous");
    expect(desktop.kind === "session-opened" && desktop.mode).toBe("continuous");
    expect(desktop.kind === "session-opened" && desktop.variant).toBe("desktop");
    const web = openedEntry("web", "replay");
    expect(web.kind === "session-opened" && web.mode).toBe("replay");
    expect(web.kind === "session-opened" && web.variant).toBe("web");
  });
});
