/**
 * P001 memory area proof: the PG organizational memory round-trips with
 * semantics identical to the in-memory reference — same version records
 * (append-only histories, per-version provenance and freshness), same
 * validation issues, same conflict/not-found discipline, same audit
 * side-effects ("memory.revised" for record AND revise) — and the version
 * table is append-only by database trigger.
 *
 * Equivalence tests boot a fresh harness per test (the audit id sequence is
 * global, mirroring the kernel-global in-memory counter).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RecordMemoryInput, ReviseMemoryInput } from "@aurum/domain";
import { createPgOrganizationalMemory } from "../src/domain-storage/adapters/memory-store.js";
import { createPgAuditTrail } from "../src/domain-storage/adapters/audit-store.js";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import {
  auditInput,
  errOf,
  expectSameResult,
  memoryKernel,
  now,
  okOf,
  pgHarness,
  personActor,
  provenance,
  scope,
  systemActor,
} from "./helpers.js";
import type { PgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";

let harness: PgLiteHarness;

beforeAll(async () => {
  harness = await pgHarness();
});

afterAll(async () => {
  await harness.close();
});

function memoryContent(overrides: Record<string, unknown> = {}) {
  return {
    content: "knowledge v1",
    provenance: provenance(systemActor("seed")),
    now: now(0),
    audit: auditInput(personActor("p-1"), "record"),
    ...overrides,
  };
}

describe("PG organizational memory equivalence with the in-memory reference", () => {
  it("round-trips record/revise histories with identical records", async () => {
    const local = await pgHarness();
    try {
      const pgMemory = createPgOrganizationalMemory(local.sql);
      const memory = memoryKernel();
      const s = scope("memory-equivalence");

      const records: readonly RecordMemoryInput[] = [
        { memoryId: "m-1", subject: { kind: "topic", id: "t-1" }, ...memoryContent() },
        { memoryId: "m-2", subject: { kind: "topic", id: "t-2" }, ...memoryContent() },
        {
          memoryId: "m-3",
          subject: { kind: "topic", id: "t-1" },
          ...memoryContent({
            content: "with explicit freshness",
            freshness: { asOf: now(1), validUntil: now(2000) },
          }),
        },
      ];
      const revises: readonly ReviseMemoryInput[] = [
        { memoryId: "m-1", ...memoryContent({ content: "knowledge v2" }) },
        {
          memoryId: "m-1",
          ...memoryContent({
            content: "knowledge v3",
            freshness: { validUntil: now(5000) },
            now: now(10),
          }),
        },
      ];
      for (const command of records) {
        expectSameResult(
          await pgMemory.recordMemory(s, command),
          memory.memory.recordMemory(s, command),
        );
      }
      for (const command of revises) {
        expectSameResult(
          await pgMemory.reviseMemory(s, command),
          memory.memory.reviseMemory(s, command),
        );
      }

      for (const memoryId of ["m-1", "m-2", "m-3", "missing"]) {
        expectSameResult(
          await pgMemory.getMemory(s, memoryId),
          memory.memory.getMemory(s, memoryId),
        );
      }
      for (const subject of [
        { kind: "topic", id: "t-1" },
        { kind: "topic", id: "t-2" },
        { kind: "topic", id: "nope" },
      ] as const) {
        expect(await pgMemory.listMemory(s, subject)).toEqual(memory.memory.listMemory(s, subject));
      }
    } finally {
      await local.close();
    }
  });

  it("mirrors validation failures issue-for-issue", async () => {
    const local = await pgHarness();
    try {
      const pgMemory = createPgOrganizationalMemory(local.sql);
      const memory = memoryKernel();
      const s = scope("memory-validation");

      const invalid: readonly Record<string, unknown>[] = [
        { subject: { kind: "warp", id: "x" } },
        { subject: { kind: "topic", id: "  " } },
        { subject: { kind: "topic" } },
        { content: "   " },
        { provenance: undefined },
        { provenance: { ...provenance(systemActor("seed")), recordedAt: -1 } },
        { provenance: { ...provenance(systemActor("seed")), source: "guessed" } },
        { now: -1 },
        { audit: { ...auditInput(personActor("p-1"), "why"), reason: "  " } },
      ];
      for (const overrides of invalid) {
        const input = {
          memoryId: "m-1",
          subject: { kind: "topic", id: "t-1" },
          ...memoryContent(overrides),
        } as RecordMemoryInput;
        expectSameResult(
          await pgMemory.recordMemory(s, input),
          memory.memory.recordMemory(s, input),
        );
      }
      const badId = {
        memoryId: "m 1",
        subject: { kind: "topic", id: "t-1" },
        ...memoryContent(),
      } as RecordMemoryInput;
      expectSameResult(await pgMemory.recordMemory(s, badId), memory.memory.recordMemory(s, badId));
      const controlCharId = {
        memoryId: "m\u00071",
        subject: { kind: "topic", id: "t-1" },
        ...memoryContent(),
      } as RecordMemoryInput;
      expectSameResult(
        await pgMemory.recordMemory(s, controlCharId),
        memory.memory.recordMemory(s, controlCharId),
      );
      // reviseMemory validates the same fields minus subject.
      const badRevise = {
        memoryId: "m-1",
        ...memoryContent({ content: "" }),
      } as ReviseMemoryInput;
      expectSameResult(
        await pgMemory.reviseMemory(s, badRevise),
        memory.memory.reviseMemory(s, badRevise),
      );
      const badReviseId = { memoryId: "m\u00071", ...memoryContent() } as ReviseMemoryInput;
      expectSameResult(
        await pgMemory.reviseMemory(s, badReviseId),
        memory.memory.reviseMemory(s, badReviseId),
      );
      // Nothing may have been written by a failed command (only the valid
      // opaque-id creation landed; space is not a control character).
      expect(await pgMemory.listMemory(s, { kind: "topic", id: "t-1" })).toEqual(
        memory.memory.listMemory(s, { kind: "topic", id: "t-1" }),
      );
      expect(
        (await listJournal(local.sql, s.tenantId))
          .filter((row) => row.area === "memory")
          .map((row) => row.journalKey),
      ).toEqual(["memory:append-version:m 1:1"]);
    } finally {
      await local.close();
    }
  });

  it("mirrors conflict and not-found discipline (including foreign tenants)", async () => {
    const local = await pgHarness();
    try {
      const pgMemory = createPgOrganizationalMemory(local.sql);
      const memory = memoryKernel();
      const s = scope("memory-conflict");
      const foreign = scope("memory-foreign");

      const seed = {
        memoryId: "m-1",
        subject: { kind: "topic", id: "t-1" },
        ...memoryContent(),
      } as RecordMemoryInput;
      okOf(await pgMemory.recordMemory(s, seed));
      okOf(memory.memory.recordMemory(s, seed));
      expectSameResult(
        await pgMemory.recordMemory(s, {
          memoryId: "m-1",
          subject: { kind: "topic", id: "t-1" },
          ...memoryContent(),
        }),
        memory.memory.recordMemory(s, {
          memoryId: "m-1",
          subject: { kind: "topic", id: "t-1" },
          ...memoryContent(),
        }),
      );
      expectSameResult(
        await pgMemory.reviseMemory(s, { memoryId: "nope", ...memoryContent() }),
        memory.memory.reviseMemory(s, { memoryId: "nope", ...memoryContent() }),
      );

      // Foreign-tenant reads are indistinguishable from missing.
      const foreignRead = errOf(await pgMemory.getMemory(foreign, "m-1"));
      const missingRead = errOf(await pgMemory.getMemory(s, "missing"));
      expect(foreignRead.message).toBe(missingRead.message);
      expect(foreignRead.message).toBe("memory record not found");
      expect(await pgMemory.listMemory(foreign, { kind: "topic", id: "t-1" })).toEqual([]);
      // A foreign tenant can register the same memory id independently.
      const foreignSeed = {
        memoryId: "m-1",
        subject: { kind: "topic", id: "t-9" },
        ...memoryContent(),
      } as RecordMemoryInput;
      expectSameResult(
        await pgMemory.recordMemory(foreign, foreignSeed),
        memory.memory.recordMemory(foreign, foreignSeed),
      );
      // The original record survived the duplicate-create attempt untouched.
      expectSameResult(await pgMemory.getMemory(s, "m-1"), memory.memory.getMemory(s, "m-1"));
    } finally {
      await local.close();
    }
  });

  it("appends matching audit entries on the shared global sequence", async () => {
    const local = await pgHarness();
    try {
      const pgMemory = createPgOrganizationalMemory(local.sql);
      const pgAudit = createPgAuditTrail(local.sql);
      const memory = memoryKernel();
      const s = scope("memory-audit");

      okOf(
        await pgMemory.recordMemory(s, {
          memoryId: "m-1",
          subject: { kind: "topic", id: "t-1" },
          ...memoryContent(),
        }),
      );
      okOf(
        memory.memory.recordMemory(s, {
          memoryId: "m-1",
          subject: { kind: "topic", id: "t-1" },
          ...memoryContent(),
        }),
      );
      okOf(await pgMemory.reviseMemory(s, { memoryId: "m-1", ...memoryContent() }));
      okOf(memory.memory.reviseMemory(s, { memoryId: "m-1", ...memoryContent() }));
      // memory.revised (audit-1, version 1) then memory.revised (audit-2,
      // version 2) on both kernels.
      expect(await pgAudit.queryAudit(s, {})).toEqual(memory.audit.queryAudit(s, {}));
    } finally {
      await local.close();
    }
  });
});

describe("PG organizational memory database enforcement", () => {
  it("rejects UPDATE and DELETE on memory versions (append-only)", async () => {
    const pgMemory = createPgOrganizationalMemory(harness.sql);
    const s = scope("memory-immutable");
    const created = okOf(
      await pgMemory.recordMemory(s, {
        memoryId: "m-1",
        subject: { kind: "topic", id: "t-1" },
        ...memoryContent(),
      }),
    );
    await expect(
      harness.sql`update domain_memory_versions set record = jsonb_build_object('content', 'tampered') where tenant_id = ${s.tenantId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.sql`delete from domain_memory_versions where tenant_id = ${s.tenantId}`,
    ).rejects.toThrow(/append-only/);
    const after = okOf(await pgMemory.getMemory(s, "m-1"));
    expect(after).toEqual(created);
    expect(after.versions[0]?.content).toBe("knowledge v1");
  });

  it("journeys every version append through the write journal", async () => {
    const pgMemory = createPgOrganizationalMemory(harness.sql);
    const s = scope("memory-journal");
    await pgMemory.recordMemory(s, {
      memoryId: "m-1",
      subject: { kind: "topic", id: "t-1" },
      ...memoryContent(),
    });
    await pgMemory.reviseMemory(s, { memoryId: "m-1", ...memoryContent({ content: "v2" }) });
    await pgMemory.reviseMemory(s, { memoryId: "m-1", ...memoryContent({ content: "v3" }) });
    const rows = await listJournal(harness.sql, s.tenantId);
    expect(rows.filter((row) => row.area === "memory").map((row) => row.journalKey)).toEqual([
      "memory:append-version:m-1:1",
      "memory:append-version:m-1:2",
      "memory:append-version:m-1:3",
    ]);
  });

  it("rejects version numbers that would rewrite history (database constraint)", async () => {
    const pgMemory = createPgOrganizationalMemory(harness.sql);
    const s = scope("memory-constraint");
    okOf(
      await pgMemory.recordMemory(s, {
        memoryId: "m-1",
        subject: { kind: "topic", id: "t-1" },
        ...memoryContent(),
      }),
    );
    await expect(
      harness.sql`
        insert into domain_memory_versions
          (tenant_id, memory_id, version, subject_kind, subject_id, record)
        values (${s.tenantId}, 'm-1', 1, 'topic', 't-1', '{"version": 1}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    const record = okOf(await pgMemory.getMemory(s, "m-1"));
    expect(record.versions).toHaveLength(1);
  });
});
