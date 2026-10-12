/**
 * P001 machinery proof: the WriteJournal records every write with an
 * idempotency key, replays are safe no-ops, journalOnce gives opt-in
 * operation idempotency, and the journal table is append-only by database
 * trigger.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  journalOnce,
  listJournal,
  recordWrite,
} from "../src/domain-storage/journal/write-journal.js";
import { pgHarness, scope } from "./helpers.js";
import type { PgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";

let harness: PgLiteHarness;

beforeAll(async () => {
  harness = await pgHarness();
});

afterAll(async () => {
  await harness.close();
});

describe("recordWrite", () => {
  it("records a write once and reports replays without duplicating", async () => {
    const tenant = scope("journal-tenant");
    const entry = {
      tenantId: tenant.tenantId,
      journalKey: "goals:append-revision:g-1:2",
      area: "goals",
      operation: "append-revision",
      recordId: "g-1",
      version: 2,
    };
    const first = await recordWrite(harness.sql, entry);
    expect(first.replayed).toBe(false);
    const second = await recordWrite(harness.sql, entry);
    expect(second.replayed).toBe(true);
    const rows = await listJournal(harness.sql, tenant.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: tenant.tenantId,
      journalKey: "goals:append-revision:g-1:2",
      area: "goals",
      operation: "append-revision",
      recordId: "g-1",
      version: 2,
    });
  });

  it("scopes keys per tenant", async () => {
    const a = scope("journal-tenant-a");
    const b = scope("journal-tenant-b");
    await recordWrite(harness.sql, {
      tenantId: a.tenantId,
      journalKey: "shared-key",
      area: "evidence",
      operation: "record",
      recordId: "e-1",
    });
    const other = await recordWrite(harness.sql, {
      tenantId: b.tenantId,
      journalKey: "shared-key",
      area: "evidence",
      operation: "record",
      recordId: "e-1",
    });
    expect(other.replayed).toBe(false);
    expect(await listJournal(harness.sql, a.tenantId)).toHaveLength(1);
    expect(await listJournal(harness.sql, b.tenantId)).toHaveLength(1);
  });

  it("rejects malformed entries", async () => {
    const tenant = scope("journal-tenant");
    await expect(
      recordWrite(harness.sql, {
        tenantId: tenant.tenantId,
        journalKey: "",
        area: "goals",
        operation: "append",
        recordId: "g",
      }),
    ).rejects.toThrow(/WriteJournalEntry/);
  });
});

describe("journalOnce", () => {
  it("executes once and replays the stored outcome without re-running the effect", async () => {
    const tenant = scope("journal-once");
    const key = "fabric:ingest:health-observation:obs-42";
    let executions = 0;
    const entry = {
      tenantId: tenant.tenantId,
      journalKey: key,
      area: "fabric",
      operation: "ingest",
      recordId: "obs-42",
    };
    const first = await journalOnce(harness.sql, entry, async () => {
      executions += 1;
      return { status: "recorded" as const, value: 7 };
    });
    expect(first.replayed).toBe(false);
    expect(first.outcome).toEqual({ status: "recorded", value: 7 });
    const second = await journalOnce(harness.sql, entry, async () => {
      executions += 1;
      return { status: "recorded", value: 999 };
    });
    expect(second.replayed).toBe(true);
    expect(second.outcome).toEqual({ status: "recorded", value: 7 });
    expect(executions).toBe(1);
  });

  it("runs the effect for a different key", async () => {
    const tenant = scope("journal-once");
    let executions = 0;
    const base = {
      tenantId: tenant.tenantId,
      area: "fabric",
      operation: "ingest",
      recordId: "obs-43",
    };
    await journalOnce(harness.sql, { ...base, journalKey: "k-1" }, async () => {
      executions += 1;
      return 1;
    });
    const result = await journalOnce(harness.sql, { ...base, journalKey: "k-2" }, async () => {
      executions += 1;
      return 2;
    });
    expect(result.replayed).toBe(false);
    expect(result.outcome).toBe(2);
    expect(executions).toBe(2);
  });
});

describe("write journal database enforcement", () => {
  it("rejects UPDATE and DELETE on the journal table (append-only)", async () => {
    // Fresh tenant: the append-only guard must be proven against a journal
    // containing exactly this test's row (one harness per file, deterministic
    // scope names — a shared name would leak rows from earlier tests).
    const tenant = scope("journal-append-guard");
    await recordWrite(harness.sql, {
      tenantId: tenant.tenantId,
      journalKey: "audit:append:guard",
      area: "audit",
      operation: "append",
      recordId: "audit-1",
    });
    await expect(harness.sql`update domain_write_journal set area = 'tampered'`).rejects.toThrow(
      /append-only/,
    );
    await expect(
      harness.sql`delete from domain_write_journal where tenant_id = ${tenant.tenantId}`,
    ).rejects.toThrow(/append-only/);
    const rows = await listJournal(harness.sql, tenant.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].area).toBe("audit");
  });

  it("lists journal rows in insertion order", async () => {
    const tenant = scope("journal-order");
    for (const version of [1, 2, 3]) {
      await recordWrite(harness.sql, {
        tenantId: tenant.tenantId,
        journalKey: `goals:append-revision:g-order:${version}`,
        area: "goals",
        operation: "append-revision",
        recordId: "g-order",
        version,
      });
    }
    const rows = await listJournal(harness.sql, tenant.tenantId);
    expect(rows.map((row) => row.journalKey)).toEqual([
      "goals:append-revision:g-order:1",
      "goals:append-revision:g-order:2",
      "goals:append-revision:g-order:3",
    ]);
  });
});
