/**
 * P001 audit area proof: the PG audit trail round-trips entries with
 * semantics identical to the in-memory AuditTrailStore — same records, same
 * sequential ids, same query filtering, same uniform not-found — and the
 * entries are append-only by database trigger.
 *
 * Equivalence tests boot a fresh harness per test: the audit id sequence is
 * global (mirroring the in-memory kernel-global counter), so identical ids
 * require identical starting states on both sides.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditTrailStore } from "@aurum/domain";
import type { AuditRecord } from "@aurum/domain";
import { createPgAuditTrail } from "../src/domain-storage/adapters/audit-store.js";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import { auditInput, errOf, okOf, pgHarness, personActor, scope, systemActor } from "./helpers.js";
import type { PgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";

let harness: PgLiteHarness;

beforeAll(async () => {
  harness = await pgHarness();
});

afterAll(async () => {
  await harness.close();
});

const subject = { kind: "goal" as const, id: "goal-1" };
const otherSubject = { kind: "person" as const, id: "person-9" };

describe("PG audit trail equivalence with the in-memory reference", () => {
  it("round-trips entries with identical records and sequential ids", async () => {
    const local = await pgHarness();
    try {
      const pgAudit = createPgAuditTrail(local.sql);
      const memoryAudit = createAuditTrailStore();
      const tenant = scope("audit-equivalence");

      const appends = [
        { subject, action: "goal.created" as const, reason: "first", atSeconds: 1 },
        {
          subject: otherSubject,
          action: "membership.granted" as const,
          reason: "second",
          atSeconds: 2,
        },
        { subject, action: "goal.revised" as const, reason: "third", atSeconds: 3 },
      ];
      for (const append of appends) {
        const input = auditInput(personActor("p-1"), append.reason, append.atSeconds);
        await pgAudit.append(tenant, append.subject, append.action, input);
        memoryAudit.append(tenant, append.subject, append.action, input);
      }

      for (const n of [1, 2, 3]) {
        const auditId = `audit-${n}`;
        const pgRecord = okOf(await pgAudit.getAudit(tenant, auditId));
        const memoryRecord = okOf(memoryAudit.getAudit(tenant, auditId));
        expect(pgRecord).toEqual(memoryRecord);
        expect(auditId).toBe(pgRecord.auditId);
      }
    } finally {
      await local.close();
    }
  });

  it("mirrors queryAudit filtering (subject, since, until) exactly", async () => {
    const local = await pgHarness();
    try {
      const pgAudit = createPgAuditTrail(local.sql);
      const memoryAudit = createAuditTrailStore();
      const tenant = scope("audit-query");

      const entries: readonly {
        subject: { kind: "goal" | "person"; id: string };
        action: "goal.created" | "belief.revised" | "unknown.raised";
        atSeconds: number;
      }[] = [
        { subject, action: "goal.created", atSeconds: 1 },
        { subject: otherSubject, action: "belief.revised", atSeconds: 5 },
        { subject, action: "belief.revised", atSeconds: 10 },
        { subject: otherSubject, action: "unknown.raised", atSeconds: 15 },
      ];
      for (const entry of entries) {
        const input = auditInput(systemActor("test"), `at-${entry.atSeconds}`, entry.atSeconds);
        await pgAudit.append(tenant, entry.subject, entry.action, input);
        memoryAudit.append(tenant, entry.subject, entry.action, input);
      }

      const queries = [
        {},
        { subject },
        { subject: otherSubject },
        { since: 6_000 },
        { until: 5_000 },
        { since: 2_000, until: 11_000 },
        { subject, since: 2_000, until: 11_000 },
      ];
      for (const query of queries) {
        const pgRows: readonly AuditRecord[] = await pgAudit.queryAudit(tenant, query);
        const memoryRows = memoryAudit.queryAudit(tenant, query);
        expect(pgRows).toEqual(memoryRows);
      }
    } finally {
      await local.close();
    }
  });

  it("draws audit ids from one global sequence across tenants", async () => {
    const local = await pgHarness();
    try {
      const pgAudit = createPgAuditTrail(local.sql);
      const tenantA = scope("audit-seq-a");
      const tenantB = scope("audit-seq-b");
      await pgAudit.append(tenantA, subject, "goal.created", auditInput(personActor("p"), "a"));
      await pgAudit.append(tenantB, subject, "goal.created", auditInput(personActor("p"), "b"));
      await pgAudit.append(tenantA, subject, "goal.revised", auditInput(personActor("p"), "c"));
      const a1 = okOf(await pgAudit.getAudit(tenantA, "audit-1"));
      const b1 = okOf(await pgAudit.getAudit(tenantB, "audit-2"));
      const a2 = okOf(await pgAudit.getAudit(tenantA, "audit-3"));
      expect(a1.reason).toBe("a");
      expect(b1.reason).toBe("b");
      expect(a2.reason).toBe("c");
    } finally {
      await local.close();
    }
  });
});

describe("PG audit trail tenant isolation", () => {
  it("foreign-tenant reads are indistinguishable from missing (identical errors)", async () => {
    const local = await pgHarness();
    try {
      const pgAudit = createPgAuditTrail(local.sql);
      const owner = scope("audit-owner");
      const foreign = scope("audit-foreign");
      const created = await pgAudit.append(
        owner,
        subject,
        "goal.created",
        auditInput(personActor("p"), "created"),
      );

      const foreignRead = errOf(await pgAudit.getAudit(foreign, "audit-999999"));
      const missingRead = errOf(await pgAudit.getAudit(foreign, created.auditId));
      expect(foreignRead.code).toBe("not-found");
      expect(missingRead.code).toBe("not-found");
      expect(foreignRead.message).toBe(missingRead.message);
      expect(foreignRead.message).toBe("audit record not found");

      const foreignRows = await pgAudit.queryAudit(foreign, {});
      expect(foreignRows).toEqual([]);
    } finally {
      await local.close();
    }
  });
});

describe("PG audit trail database enforcement", () => {
  it("rejects UPDATE and DELETE on audit entries (append-only)", async () => {
    const pgAudit = createPgAuditTrail(harness.sql);
    const tenant = scope("audit-immutable");
    const created = await pgAudit.append(
      tenant,
      subject,
      "goal.created",
      auditInput(personActor("p"), "why"),
    );
    await expect(
      harness.sql`update domain_audit_entries set reason = 'tampered' where tenant_id = ${tenant.tenantId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.sql`delete from domain_audit_entries where tenant_id = ${tenant.tenantId}`,
    ).rejects.toThrow(/append-only/);
    const after = okOf(await pgAudit.getAudit(tenant, created.auditId));
    expect(after).toEqual(created);
  });

  it("journeys every append through the write journal with a stable key", async () => {
    const pgAudit = createPgAuditTrail(harness.sql);
    const tenant = scope("audit-journal");
    const first = await pgAudit.append(
      tenant,
      subject,
      "goal.created",
      auditInput(personActor("p"), "why"),
    );
    const second = await pgAudit.append(
      tenant,
      subject,
      "goal.revised",
      auditInput(personActor("p"), "why2"),
    );
    const rows = await listJournal(harness.sql, tenant.tenantId);
    const auditRows = rows.filter((row) => row.area === "audit");
    expect(auditRows.map((row) => row.journalKey)).toEqual([
      `audit:append:${tenant.tenantId}:${first.auditId}`,
      `audit:append:${tenant.tenantId}:${second.auditId}`,
    ]);
    expect(auditRows.every((row) => row.operation === "append")).toBe(true);
  });
});
