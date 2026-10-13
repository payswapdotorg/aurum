/**
 * W012 acceptance proofs — the LEDGERS (APPROACH R1): append-only,
 * identity-stamped, per-session contiguous, foreign-session isolated; the
 * JSON-file ledger round-trips across instances (the cross-process replay
 * source — the CLI evidence run and the desktop host stand on it).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryContinuityLedger,
  createJsonFileContinuityLedger,
  isContinuityError,
} from "../src/index.js";
import { errOf, okOf, personActor } from "./continuity-helpers.js";

const openedEntry = (tenantId = "acme") => ({
  kind: "session-opened" as const,
  tenantId,
  operator: personActor("operator-1"),
  variant: "desktop" as const,
  mode: "continuous" as const,
  composition: "local-control-tower-v1",
  openedAt: 1,
});

const memoryEntry = (id: string) => ({
  kind: "memory-recorded" as const,
  scope: { tenantId: "acme" },
  input: {
    memoryId: id,
    subject: { kind: "topic" as const, id: "invoices" },
    statement: `statement ${id}`,
    actor: personActor("operator-1"),
    now: 2,
  },
});

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempLedgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "aurum-continuity-"));
  tempDirs.push(dir);
  return join(dir, "ledger.json");
}

describe("continuity ledgers: append-only, identity-stamped, isolated", () => {
  it("stamps contiguous sequence numbers and deterministic record ids per session", () => {
    const ledger = createInMemoryContinuityLedger();
    for (let index = 0; index < 3; index += 1) {
      const record = okOf(ledger.append("session-1", memoryEntry(`mem-${index}`)));
      expect(record.seq).toBe(index);
      expect(record.recordId).toBe(`session-1/${index}`);
    }
    // A second session has its OWN contiguous sequence.
    const other = okOf(ledger.append("session-2", openedEntry("globex")));
    expect(other.seq).toBe(0);
    expect(other.recordId).toBe("session-2/0");
  });

  it("never mixes sessions: list() returns only that session's records (foreign-session refusal)", () => {
    const ledger = createInMemoryContinuityLedger();
    okOf(ledger.append("session-1", openedEntry()));
    okOf(ledger.append("session-1", memoryEntry("mem-1")));
    okOf(ledger.append("session-2", openedEntry("globex")));
    const first = ledger.list("session-1");
    const second = ledger.list("session-2");
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
    expect(first.every((record) => record.sessionId === "session-1")).toBe(true);
    expect(second.every((record) => record.sessionId === "session-2")).toBe(true);
    expect(ledger.listSessions()).toEqual(["session-1", "session-2"]);
    // An unknown session lists empty (no fabrication, no leak).
    expect(ledger.list("nope")).toEqual([]);
  });

  it("appends after a LIST never rewrites earlier records (append-only order)", () => {
    const ledger = createInMemoryContinuityLedger();
    okOf(ledger.append("session-1", openedEntry()));
    const before = ledger.list("session-1").map((record) => record.recordId);
    okOf(ledger.append("session-1", memoryEntry("mem-1")));
    const after = ledger.list("session-1").map((record) => record.recordId);
    expect(after.slice(0, before.length)).toEqual(before); // prefix stable
  });

  it("refuses a blank session id with the typed invariant error", () => {
    const ledger = createInMemoryContinuityLedger();
    const error = errOf(ledger.append("  ", openedEntry()));
    expect(isContinuityError(error) && error.code === "continuity-invariant").toBe(true);
  });

  it("JSON-file ledger round-trips across instances (the cross-process source)", () => {
    const path = tempLedgerPath();
    const writer = createJsonFileContinuityLedger(path);
    okOf(writer.append("session-1", openedEntry()));
    okOf(writer.append("session-1", memoryEntry("mem-1")));
    okOf(writer.append("session-1", memoryEntry("mem-2")));
    okOf(writer.append("session-2", openedEntry("globex")));

    // A NEW instance over the same file sees exactly what was written
    // (simulated second process: fresh process, same ledger file).
    const reader = createJsonFileContinuityLedger(path);
    const first = reader.list("session-1");
    expect(first.map((record) => record.recordId)).toEqual([
      "session-1/0",
      "session-1/1",
      "session-1/2",
    ]);
    expect(first[1]?.entry).toStrictEqual(memoryEntry("mem-1"));
    expect(reader.listSessions()).toEqual(["session-1", "session-2"]);

    // And the reader can CONTINUE appending contiguously.
    const continued = okOf(reader.append("session-1", memoryEntry("mem-3")));
    expect(continued.seq).toBe(3);
    const third = createJsonFileContinuityLedger(path);
    expect(third.list("session-1")).toHaveLength(4);
  });

  it("JSON-file ledger starts empty for a missing file (fresh mount)", () => {
    const ledger = createJsonFileContinuityLedger(tempLedgerPath());
    expect(ledger.listSessions()).toEqual([]);
    expect(ledger.list("session-1")).toEqual([]);
  });

  it("JSON-file ledger surfaces a corrupt file as a loud setup error (never silent)", () => {
    const path = tempLedgerPath();
    const writer = createJsonFileContinuityLedger(path);
    okOf(writer.append("session-1", openedEntry()));
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(path, "{ not json", "utf8");
    expect(() => createJsonFileContinuityLedger(path)).toThrow(/unreadable/);
  });
});
