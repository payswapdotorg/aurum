/**
 * P001 goals area proof: the PG goal ledger round-trips with semantics
 * identical to the in-memory reference — same records (revisions verbatim),
 * same validation issues, same conflict/not-found discipline, same audit
 * side-effects on the shared global sequence — and the revision table is
 * append-only by database trigger.
 *
 * Equivalence tests boot a fresh harness per test: the audit id sequence is
 * global (mirroring the in-memory kernel-global counter), so identical ids
 * require identical starting states on both sides.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalInput, GoalRecord, ReviseGoalInput } from "@aurum/domain";
import { createPgGoalLedger } from "../src/domain-storage/adapters/goal-store.js";
import { createPgAuditTrail } from "../src/domain-storage/adapters/audit-store.js";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import {
  auditInput,
  errOf,
  expectSameResult,
  memoryKernel,
  now,
  okOf,
  personActor,
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

function goalContent(overrides: Record<string, unknown> = {}) {
  return {
    objective: "increase delivery reliability",
    desiredState: "95% on-time deliveries",
    horizonStart: now(0),
    horizonEnd: now(90 * 24 * 3600),
    ownerId: "p-1",
    ownerLabels: ["employee"],
    priority: "high",
    metrics: [
      { name: "on-time rate", unit: "%", target: 95, threshold: 85, direction: "at-least" },
      { name: "escalations", target: 0, threshold: 10, direction: "at-most" },
    ],
    expectedEvidence: [
      {
        description: "weekly delivery report",
        subject: { kind: "topic" as const, id: "delivery" },
      },
    ],
    successCriteria: [{ description: "quarter closes at or above target", metric: "on-time rate" }],
    provenance: provenance(systemActor("seed")),
    now: now(0),
    audit: auditInput(personActor("p-1"), "goal created"),
    ...overrides,
  };
}

describe("PG goal ledger equivalence with the in-memory reference", () => {
  it("round-trips create/revise histories with identical records", async () => {
    const local = await pgHarness();
    try {
      const pgGoals = createPgGoalLedger(local.sql);
      const memory = memoryKernel();
      const s = scope("goals-equivalence");

      const creates: readonly CreateGoalInput[] = [
        { goalId: "g-1", ...goalContent() },
        { goalId: "g-2", ...goalContent({ priority: "critical" }) },
        { goalId: "g-3", ...goalContent({ priority: "low" }) },
      ];
      const revises: readonly ReviseGoalInput[] = [
        { goalId: "g-1", ...goalContent({ objective: "safer deliveries", priority: "low" }) },
        { goalId: "g-1", ...goalContent({ desiredState: "99% on-time" }) },
      ];
      for (const command of creates) {
        expectSameResult(await pgGoals.createGoal(s, command), memory.goals.createGoal(s, command));
      }
      for (const command of revises) {
        expectSameResult(await pgGoals.reviseGoal(s, command), memory.goals.reviseGoal(s, command));
      }

      for (const goalId of ["g-1", "g-2", "g-3", "missing"]) {
        expectSameResult(await pgGoals.getGoal(s, goalId), memory.goals.getGoal(s, goalId));
      }
      for (const [goalId, revisionNumber] of [
        ["g-1", 1],
        ["g-1", 2],
        ["g-1", 3],
        ["g-1", 4],
        ["g-2", 1],
        ["g-1", 99],
        ["missing", 1],
      ] as const) {
        expectSameResult(
          await pgGoals.getGoalRevision(s, goalId, revisionNumber),
          memory.goals.getGoalRevision(s, goalId, revisionNumber),
        );
      }
      for (const filter of [
        undefined,
        { priority: "low" },
        { priority: "critical" },
        { priority: "medium" },
      ] as const) {
        expect(await pgGoals.listGoals(s, filter)).toEqual(memory.goals.listGoals(s, filter));
      }
    } finally {
      await local.close();
    }
  });

  it("mirrors validation failures issue-for-issue", async () => {
    const local = await pgHarness();
    try {
      const pgGoals = createPgGoalLedger(local.sql);
      const memory = memoryKernel();
      const s = scope("goals-validation");

      const invalid: readonly Record<string, unknown>[] = [
        { priority: "urgent" },
        { horizonStart: now(10), horizonEnd: now(5) },
        { objective: "   " },
        { metrics: [{ name: "x", target: 1, threshold: 2, direction: "sideways" }] },
        { ownerLabels: [] },
        { ownerLabels: ["employee", "wizard"] },
        { ownerId: "  " },
        { expectedEvidence: [{ description: "d", subject: { kind: "warp", id: "x" } }] },
        { successCriteria: [{ description: "" }] },
        { provenance: undefined },
        { now: -1 },
        { audit: { ...auditInput(personActor("p-1"), "why"), reason: "  " } },
      ];
      for (const overrides of invalid) {
        const input = { goalId: "g-1", ...goalContent(overrides) } as CreateGoalInput;
        expectSameResult(await pgGoals.createGoal(s, input), memory.goals.createGoal(s, input));
        expectSameResult(
          await pgGoals.reviseGoal(s, input as ReviseGoalInput),
          memory.goals.reviseGoal(s, input as ReviseGoalInput),
        );
      }
      const badId = { goalId: "g 1", ...goalContent() } as CreateGoalInput;
      expectSameResult(await pgGoals.createGoal(s, badId), memory.goals.createGoal(s, badId));
      const controlCharId = { goalId: "g\u00071", ...goalContent() } as CreateGoalInput;
      expectSameResult(
        await pgGoals.createGoal(s, controlCharId),
        memory.goals.createGoal(s, controlCharId),
      );
      // Nothing may have been written by a failed command: the only journal
      // row is the one valid opaque-id creation ("g 1" is a legal id — space
      // is not a control character — while every failing input wrote nothing).
      expect(await pgGoals.listGoals(s)).toEqual(memory.goals.listGoals(s));
      expect(
        (await listJournal(local.sql, s.tenantId))
          .filter((row) => row.area === "goals")
          .map((row) => row.journalKey),
      ).toEqual(["goals:append-revision:g 1:1"]);
    } finally {
      await local.close();
    }
  });

  it("mirrors conflict and not-found discipline (including foreign tenants)", async () => {
    const local = await pgHarness();
    try {
      const pgGoals = createPgGoalLedger(local.sql);
      const memory = memoryKernel();
      const s = scope("goals-conflict");
      const foreign = scope("goals-foreign");

      const seed = { goalId: "g-1", ...goalContent() } as CreateGoalInput;
      okOf(await pgGoals.createGoal(s, seed));
      okOf(memory.goals.createGoal(s, seed));
      expectSameResult(
        await pgGoals.createGoal(s, { goalId: "g-1", ...goalContent() }),
        memory.goals.createGoal(s, { goalId: "g-1", ...goalContent() }),
      );
      expectSameResult(
        await pgGoals.reviseGoal(s, { goalId: "nope", ...goalContent() }),
        memory.goals.reviseGoal(s, { goalId: "nope", ...goalContent() }),
      );

      // Foreign-tenant reads are indistinguishable from missing.
      const foreignRead = errOf(await pgGoals.getGoal(foreign, "g-1"));
      const missingRead = errOf(await pgGoals.getGoal(s, "missing"));
      expect(foreignRead.message).toBe(missingRead.message);
      expect(foreignRead.message).toBe("goal not found");
      const foreignRevision = errOf(await pgGoals.getGoalRevision(foreign, "g-1", 1));
      const missingRevision = errOf(await pgGoals.getGoalRevision(s, "missing", 1));
      expect(foreignRevision.message).toBe(missingRevision.message);
      expect(await pgGoals.listGoals(foreign)).toEqual([]);
      // The original record survived the duplicate-create attempt untouched.
      expectSameResult(await pgGoals.getGoal(s, "g-1"), memory.goals.getGoal(s, "g-1"));
    } finally {
      await local.close();
    }
  });

  it("appends matching audit entries on the shared global sequence", async () => {
    const local = await pgHarness();
    try {
      const pgGoals = createPgGoalLedger(local.sql);
      const pgAudit = createPgAuditTrail(local.sql);
      const memory = memoryKernel();
      const s = scope("goals-audit");

      const commands: readonly (CreateGoalInput | ReviseGoalInput)[] = [
        { goalId: "g-1", ...goalContent() },
        { goalId: "g-1", ...goalContent({ objective: "revised objective" }) },
      ];
      okOf(await pgGoals.createGoal(s, commands[0] as CreateGoalInput));
      okOf(memory.goals.createGoal(s, commands[0] as CreateGoalInput));
      okOf(await pgGoals.reviseGoal(s, commands[1] as ReviseGoalInput));
      okOf(memory.goals.reviseGoal(s, commands[1] as ReviseGoalInput));
      // goal.created (audit-1) then goal.revised (audit-2) on both kernels.
      expect(await pgAudit.queryAudit(s, {})).toEqual(memory.audit.queryAudit(s, {}));
    } finally {
      await local.close();
    }
  });
});

describe("PG goal ledger database enforcement", () => {
  it("rejects UPDATE and DELETE on goal revisions (append-only)", async () => {
    const pgGoals = createPgGoalLedger(harness.sql);
    const s = scope("goals-immutable");
    const created: GoalRecord = okOf(
      await pgGoals.createGoal(s, { goalId: "g-1", ...goalContent() }),
    );
    await expect(
      harness.sql`update domain_goal_revisions set record = jsonb_build_object('objective', 'tampered') where tenant_id = ${s.tenantId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.sql`delete from domain_goal_revisions where tenant_id = ${s.tenantId}`,
    ).rejects.toThrow(/append-only/);
    const after = okOf(await pgGoals.getGoal(s, "g-1"));
    expect(after).toEqual(created);
    expect(after.revisions[0]?.objective).toBe("increase delivery reliability");
  });

  it("journeys every revision append through the write journal", async () => {
    const pgGoals = createPgGoalLedger(harness.sql);
    const s = scope("goals-journal");
    await pgGoals.createGoal(s, { goalId: "g-1", ...goalContent() });
    await pgGoals.reviseGoal(s, { goalId: "g-1", ...goalContent({ objective: "second" }) });
    const rows = await listJournal(harness.sql, s.tenantId);
    expect(rows.filter((row) => row.area === "goals").map((row) => row.journalKey)).toEqual([
      "goals:append-revision:g-1:1",
      "goals:append-revision:g-1:2",
    ]);
  });

  it("rejects revision numbers that would rewrite history (database constraint)", async () => {
    const pgGoals = createPgGoalLedger(harness.sql);
    const s = scope("goals-constraint");
    okOf(await pgGoals.createGoal(s, { goalId: "g-1", ...goalContent() }));
    await expect(
      harness.sql`
        insert into domain_goal_revisions
          (tenant_id, goal_id, revision_number, priority, created_at, record)
        values (${s.tenantId}, 'g-1', 1, 'low', 1, '{"revisionNumber": 1}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    const record = okOf(await pgGoals.getGoal(s, "g-1"));
    expect(record.revisions).toHaveLength(1);
  });
});
