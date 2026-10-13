/**
 * P001 capability area proof: the PG capability graph round-trips with
 * semantics identical to the in-memory reference — capabilities, supplies
 * (proficiency, capacity, availability windows, freshness), requirements
 * (typed sources, priorities) and recomputed gap records with kernel-
 * generated sequential ids on the GLOBAL counter — with the same
 * validation issues, the same not-found/conflict discipline, the same
 * list-filter edge behavior, the same audit side-effects — and every table
 * is append-only by database trigger with gap numbers unique table-wide.
 *
 * Equivalence tests boot a fresh harness per test (the audit id sequence is
 * global, mirroring the kernel-global in-memory counter).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  RegisterCapabilityInput,
  RegisterRequirementInput,
  RegisterSupplyInput,
} from "@aurum/domain";
import { createPgCapabilityGraph } from "../src/domain-storage/adapters/capability-store.js";
import { createPgAuditTrail } from "../src/domain-storage/adapters/audit-store.js";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import {
  errOf,
  expectSameResult,
  memoryKernel,
  now,
  okOf,
  pgHarness,
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

function capabilityInput(overrides: Record<string, unknown> = {}): RegisterCapabilityInput {
  return {
    capabilityId: "cap-1",
    name: "typescript engineering",
    description: "writes and reviews typed code",
    provenance: provenance(systemActor("seed")),
    now: now(0),
    ...overrides,
  } as RegisterCapabilityInput;
}

function supplyInput(overrides: Record<string, unknown> = {}): RegisterSupplyInput {
  return {
    supplyId: "sup-1",
    capabilityId: "cap-1",
    supplier: { kind: "employee", personId: "p-1" },
    level: 4,
    capacityPerPeriod: 10,
    availableFrom: now(0),
    availableUntil: now(10000),
    provenance: provenance(systemActor("seed")),
    now: now(1),
    ...overrides,
  } as RegisterSupplyInput;
}

function requirementInput(overrides: Record<string, unknown> = {}): RegisterRequirementInput {
  return {
    requirementId: "req-1",
    capabilityId: "cap-1",
    source: { kind: "goal", ref: "g-1" },
    requiredLevel: 3,
    requiredCapacityPerPeriod: 8,
    priority: "high",
    provenance: provenance(systemActor("seed")),
    now: now(2),
    ...overrides,
  } as RegisterRequirementInput;
}

describe("PG capability graph equivalence with the in-memory reference", () => {
  it("round-trips capabilities, supplies, requirements and recomputed gaps", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgCapabilityGraph(local.sql);
      const memory = memoryKernel();
      const s = scope("capability-equivalence");

      const capabilities: readonly RegisterCapabilityInput[] = [
        capabilityInput(),
        capabilityInput({
          capabilityId: "cap-2",
          name: "site reliability",
          description: undefined,
        }),
        capabilityInput({ capabilityId: "cap-3", name: "data engineering" }),
      ];
      for (const command of capabilities) {
        expectSameResult(
          await pg.registerCapability(s, command),
          memory.capabilities.registerCapability(s, command),
        );
      }
      const supplies: readonly RegisterSupplyInput[] = [
        supplyInput(),
        supplyInput({
          supplyId: "sup-2",
          supplier: { kind: "agent", externalRef: "agent-body-7" },
          level: 2,
          capacityPerPeriod: undefined,
          availableFrom: undefined,
          availableUntil: undefined,
          freshness: { asOf: now(1), validUntil: now(5000) },
        }),
        supplyInput({ supplyId: "sup-3", capabilityId: "cap-3", level: 5 }),
      ];
      for (const command of supplies) {
        expectSameResult(
          await pg.registerSupply(s, command),
          memory.capabilities.registerSupply(s, command),
        );
      }
      const requirements: readonly RegisterRequirementInput[] = [
        requirementInput(),
        requirementInput({
          requirementId: "req-2",
          capabilityId: "cap-2",
          source: { kind: "process", ref: "pr-9" },
          requiredLevel: 5,
          requiredCapacityPerPeriod: undefined,
          priority: undefined,
        }),
        requirementInput({
          requirementId: "req-3",
          capabilityId: "cap-3",
          source: { kind: "manual", ref: "note-1" },
          requiredLevel: 3,
          priority: "low",
        }),
        requirementInput({
          requirementId: "req-4",
          capabilityId: "cap-1",
          source: { kind: "opportunity", ref: "opp-1" },
          requiredLevel: 4,
          requiredCapacityPerPeriod: 30,
        }),
      ];
      for (const command of requirements) {
        expectSameResult(
          await pg.registerRequirement(s, command),
          memory.capabilities.registerRequirement(s, command),
        );
      }

      // Recompute over all requirements (mixed outcomes) then a single one.
      const recomputeAll = { provenance: provenance(systemActor("seed")), now: now(3) };
      expectSameResult(
        await pg.recomputeGaps(s, recomputeAll),
        memory.capabilities.recomputeGaps(s, recomputeAll),
      );
      const recomputeOne = {
        requirementId: "req-4",
        provenance: provenance(systemActor("seed")),
        now: now(4),
      };
      expectSameResult(
        await pg.recomputeGaps(s, recomputeOne),
        memory.capabilities.recomputeGaps(s, recomputeOne),
      );
      // Fixing a gap appends nothing; the covered assessment returns.
      const fixedSupply = supplyInput({ supplyId: "sup-4", level: 5, capacityPerPeriod: 100 });
      expectSameResult(
        await pg.registerSupply(s, fixedSupply),
        memory.capabilities.registerSupply(s, fixedSupply),
      );
      expectSameResult(
        await pg.recomputeGaps(s, {
          requirementId: "req-4",
          provenance: provenance(systemActor("seed")),
          now: now(5),
        }),
        memory.capabilities.recomputeGaps(s, {
          requirementId: "req-4",
          provenance: provenance(systemActor("seed")),
          now: now(5),
        }),
      );

      // Read-back equivalence across every surface, including the filter
      // edge behavior (empty capabilityId returns ALL on both list calls).
      for (const capabilityId of ["cap-1", "cap-2", "cap-3", "missing"]) {
        expectSameResult(
          await pg.getCapability(s, capabilityId),
          memory.capabilities.getCapability(s, capabilityId),
        );
      }
      expect(await pg.listCapabilities(s)).toEqual(memory.capabilities.listCapabilities(s));
      for (const filter of [
        undefined,
        { capabilityId: "cap-1" },
        { capabilityId: "" },
        { capabilityId: "missing" },
      ] as const) {
        expect(await pg.listSupplies(s, filter)).toEqual(
          memory.capabilities.listSupplies(s, filter),
        );
      }
      for (const filter of [
        undefined,
        { capabilityId: "cap-1" },
        { sourceKind: "goal" },
        { capabilityId: "cap-2", sourceKind: "process" },
        { capabilityId: "" },
      ] as const) {
        expect(await pg.listRequirements(s, filter)).toEqual(
          memory.capabilities.listRequirements(s, filter),
        );
      }
      for (const filter of [
        undefined,
        { requirementId: "req-1" },
        { kind: "level" },
        { requirementId: "req-4", kind: "capacity" },
        { kind: "uncovered" },
      ] as const) {
        expect(await pg.listGaps(s, filter)).toEqual(memory.capabilities.listGaps(s, filter));
      }
    } finally {
      await local.close();
    }
  });

  it("mirrors validation failures issue-for-issue", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgCapabilityGraph(local.sql);
      const memory = memoryKernel();
      const s = scope("capability-validation");

      const badCapabilities: readonly Record<string, unknown>[] = [
        { capabilityId: "" },
        { name: "   " },
        { name: "x".repeat(301) },
        { description: "   " },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of badCapabilities) {
        const input = capabilityInput(overrides);
        expectSameResult(
          await pg.registerCapability(s, input),
          memory.capabilities.registerCapability(s, input),
        );
      }
      okOf(await pg.registerCapability(s, capabilityInput()));
      okOf(memory.capabilities.registerCapability(s, capabilityInput()));

      const badSupplies: readonly Record<string, unknown>[] = [
        { supplyId: "" },
        { capabilityId: "nope" },
        { supplier: { kind: "wizard" } },
        { supplier: { kind: "employee" } },
        { supplier: { kind: "agent" } },
        { supplier: undefined },
        { level: 0 },
        { level: 6 },
        { level: 2.5 },
        { capacityPerPeriod: -1 },
        { availableFrom: -1 },
        { availableUntil: -1 },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of badSupplies) {
        const input = supplyInput(overrides);
        expectSameResult(
          await pg.registerSupply(s, input),
          memory.capabilities.registerSupply(s, input),
        );
      }

      const badRequirements: readonly Record<string, unknown>[] = [
        { requirementId: "" },
        { capabilityId: "nope" },
        { source: { kind: "wish", ref: "r" } },
        { source: { kind: "goal", ref: "" } },
        { source: undefined },
        { requiredLevel: 0 },
        { requiredLevel: 9 },
        { requiredCapacityPerPeriod: -5 },
        { priority: "urgent" },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of badRequirements) {
        const input = requirementInput(overrides);
        expectSameResult(
          await pg.registerRequirement(s, input),
          memory.capabilities.registerRequirement(s, input),
        );
      }
      const badRecompute: readonly Record<string, unknown>[] = [
        { requirementId: "bad id" },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of badRecompute) {
        const input = { provenance: provenance(systemActor("seed")), now: now(0), ...overrides };
        expectSameResult(
          await pg.recomputeGaps(s, input),
          memory.capabilities.recomputeGaps(s, input),
        );
      }
      // Nothing may have been written by a failed command.
      expect(await pg.listCapabilities(s)).toEqual(memory.capabilities.listCapabilities(s));
      expect(await pg.listSupplies(s)).toEqual(memory.capabilities.listSupplies(s));
      expect(await pg.listRequirements(s)).toEqual(memory.capabilities.listRequirements(s));
      expect(await pg.listGaps(s)).toEqual(memory.capabilities.listGaps(s));
      // The only journaled mutation is the successful capability register
      // above — every failed command left the journal untouched.
      expect(
        (await listJournal(local.sql, s.tenantId))
          .filter((row) => row.area === "capability")
          .map((row) => row.journalKey),
      ).toEqual(["capability:register:cap-1"]);
    } finally {
      await local.close();
    }
  });

  it("mirrors not-found/conflict discipline, the global gap counter and tenant isolation", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgCapabilityGraph(local.sql);
      const memory = memoryKernel();
      const s = scope("capability-conflict");
      const other = scope("capability-other");

      okOf(await pg.registerCapability(s, capabilityInput()));
      okOf(memory.capabilities.registerCapability(s, capabilityInput()));
      expectSameResult(
        await pg.registerCapability(s, capabilityInput()),
        memory.capabilities.registerCapability(s, capabilityInput()),
      );
      // Supply/requirement for a missing capability: not-found before the
      // id conflict (even for an id that already exists).
      okOf(await pg.registerSupply(s, supplyInput()));
      okOf(memory.capabilities.registerSupply(s, supplyInput()));
      expectSameResult(
        await pg.registerSupply(s, supplyInput({ capabilityId: "nope" })),
        memory.capabilities.registerSupply(s, supplyInput({ capabilityId: "nope" })),
      );
      expectSameResult(
        await pg.registerSupply(s, supplyInput()),
        memory.capabilities.registerSupply(s, supplyInput()),
      );
      okOf(await pg.registerRequirement(s, requirementInput()));
      okOf(memory.capabilities.registerRequirement(s, requirementInput()));
      expectSameResult(
        await pg.registerRequirement(s, requirementInput({ capabilityId: "nope" })),
        memory.capabilities.registerRequirement(s, requirementInput({ capabilityId: "nope" })),
      );
      expectSameResult(
        await pg.registerRequirement(s, requirementInput()),
        memory.capabilities.registerRequirement(s, requirementInput()),
      );
      const recompute = { provenance: provenance(systemActor("seed")), now: now(3) };
      expectSameResult(
        await pg.recomputeGaps(s, {
          requirementId: "nope",
          provenance: provenance(systemActor("seed")),
          now: now(3),
        }),
        memory.capabilities.recomputeGaps(s, {
          requirementId: "nope",
          provenance: provenance(systemActor("seed")),
          now: now(3),
        }),
      );

      // The gap counter is GLOBAL across tenants (the in-memory closure
      // variable spans tenants): tenant `other` continues the numbering.
      okOf(await pg.registerCapability(other, capabilityInput({ capabilityId: "cap-o" })));
      okOf(
        memory.capabilities.registerCapability(other, capabilityInput({ capabilityId: "cap-o" })),
      );
      okOf(await pg.registerRequirement(other, requirementInput({ capabilityId: "cap-o" })));
      okOf(
        memory.capabilities.registerRequirement(other, requirementInput({ capabilityId: "cap-o" })),
      );
      expectSameResult(
        await pg.recomputeGaps(s, recompute),
        memory.capabilities.recomputeGaps(s, recompute),
      );
      expectSameResult(
        await pg.recomputeGaps(other, recompute),
        memory.capabilities.recomputeGaps(other, recompute),
      );
      expect(await pg.listGaps(s)).toEqual(memory.capabilities.listGaps(s));
      expect(await pg.listGaps(other)).toEqual(memory.capabilities.listGaps(other));

      // Foreign-tenant reads are indistinguishable from missing.
      const foreign = scope("capability-foreign");
      const foreignRead = errOf(await pg.getCapability(foreign, "cap-1"));
      const missingRead = errOf(await pg.getCapability(s, "missing"));
      expect(foreignRead.message).toBe(missingRead.message);
      expect(foreignRead.message).toBe("capability not found");
      expect(await pg.listCapabilities(foreign)).toEqual([]);
      expect(await pg.listSupplies(foreign)).toEqual([]);
      expect(await pg.listRequirements(foreign)).toEqual([]);
      expect(await pg.listGaps(foreign)).toEqual([]);
      // The same id may exist independently in another tenant.
      okOf(await pg.registerCapability(foreign, capabilityInput({ capabilityId: "cap-1" })));
      expectSameResult(
        await pg.getCapability(s, "cap-1"),
        memory.capabilities.getCapability(s, "cap-1"),
      );
    } finally {
      await local.close();
    }
  });

  it("appends matching audit entries (registered, supplies, requirements, gap recomputes)", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgCapabilityGraph(local.sql);
      const pgAudit = createPgAuditTrail(local.sql);
      const memory = memoryKernel();
      const s = scope("capability-audit");

      okOf(await pg.registerCapability(s, capabilityInput()));
      okOf(memory.capabilities.registerCapability(s, capabilityInput()));
      okOf(await pg.registerSupply(s, supplyInput()));
      okOf(memory.capabilities.registerSupply(s, supplyInput()));
      okOf(await pg.registerRequirement(s, requirementInput()));
      okOf(memory.capabilities.registerRequirement(s, requirementInput()));
      okOf(await pg.recomputeGaps(s, { provenance: provenance(systemActor("seed")), now: now(3) }));
      okOf(
        memory.capabilities.recomputeGaps(s, {
          provenance: provenance(systemActor("seed")),
          now: now(3),
        }),
      );
      expect(await pgAudit.queryAudit(s, {})).toEqual(memory.audit.queryAudit(s, {}));
      for (const subject of [
        { kind: "capability", id: "cap-1" },
        { kind: "capability", id: "graph" },
      ] as const) {
        expect(await pgAudit.queryAudit(s, { subject })).toEqual(
          memory.audit.queryAudit(s, { subject }),
        );
      }
    } finally {
      await local.close();
    }
  });
});

describe("PG capability graph database enforcement", () => {
  it("rejects UPDATE and DELETE on every capability table (append-only)", async () => {
    const pg = createPgCapabilityGraph(harness.sql);
    const s = scope("capability-immutable");
    okOf(await pg.registerCapability(s, capabilityInput()));
    okOf(await pg.registerSupply(s, supplyInput()));
    // requiredLevel 5 over the level-4 supply leaves an uncovered level gap,
    // so the gaps table holds a row for this tenant (a row-less UPDATE could
    // never prove the trigger).
    okOf(await pg.registerRequirement(s, requirementInput({ requiredLevel: 5 })));
    okOf(await pg.recomputeGaps(s, { provenance: provenance(systemActor("seed")), now: now(3) }));
    for (const table of [
      "domain_capabilities",
      "domain_capability_supplies",
      "domain_capability_requirements",
      "domain_capability_gaps",
    ] as const) {
      await expect(
        harness.sql.unsafe(`update ${table} set tenant_id = tenant_id where tenant_id = $1`, [
          s.tenantId,
        ]),
      ).rejects.toThrow(/append-only/);
      await expect(
        harness.sql.unsafe(`delete from ${table} where tenant_id = $1`, [s.tenantId]),
      ).rejects.toThrow(/append-only/);
    }
    expect((await pg.listCapabilities(s)).length).toBe(1);
    expect((await pg.listSupplies(s)).length).toBe(1);
    expect((await pg.listRequirements(s)).length).toBe(1);
    expect((await pg.listGaps(s)).length).toBeGreaterThan(0);
  });

  it("journeys every mutation through the write journal with stable keys", async () => {
    // The gap counter is GLOBAL (it spans tenants exactly like the in-memory
    // store instance's closure variable), so this proof boots a fresh
    // database: the first gap ever appended is gap-1, mirroring a fresh
    // in-memory kernel regardless of what earlier shared-harness tests did.
    const local = await pgHarness();
    try {
      const pg = createPgCapabilityGraph(local.sql);
      const s = scope("capability-journal");
      await pg.registerCapability(s, capabilityInput());
      await pg.registerSupply(s, supplyInput());
      await pg.registerRequirement(s, requirementInput({ requiredLevel: 5 }));
      await pg.recomputeGaps(s, { provenance: provenance(systemActor("seed")), now: now(3) });
      const rows = await listJournal(local.sql, s.tenantId);
      expect(rows.filter((row) => row.area === "capability").map((row) => row.journalKey)).toEqual([
        "capability:register:cap-1",
        "capability:register-supply:sup-1",
        "capability:register-requirement:req-1",
        "capability:append-gap:gap-1",
      ]);
    } finally {
      await local.close();
    }
  });

  it("rejects history rewrites and gap-number reuse (database constraints)", async () => {
    const pg = createPgCapabilityGraph(harness.sql);
    const s = scope("capability-constraint");
    okOf(await pg.registerCapability(s, capabilityInput()));
    okOf(await pg.registerRequirement(s, requirementInput({ requiredLevel: 5 })));
    okOf(await pg.recomputeGaps(s, { provenance: provenance(systemActor("seed")), now: now(3) }));
    await expect(
      harness.sql`
        insert into domain_capabilities (tenant_id, capability_id, record)
        values (${s.tenantId}, 'cap-1', '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      harness.sql`
        insert into domain_capability_gaps
          (tenant_id, gap_id, gap_number, requirement_id, kind, computed_at, record)
        values (${s.tenantId}, 'gap-77', 1, 'req-1', 'uncovered', 1, '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      harness.sql`
        insert into domain_capability_gaps
          (tenant_id, gap_id, gap_number, requirement_id, kind, computed_at, record)
        values (${s.tenantId}, 'gap-78', 78, 'req-1', 'sideways', 1, '{}'::jsonb)
      `,
    ).rejects.toThrow(/check/i);
    expect(await pg.listGaps(s)).toHaveLength(1);
  });
});
