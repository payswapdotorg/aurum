/**
 * P001 process area proof: the PG process directory round-trips with
 * semantics identical to the in-memory reference — full revision histories
 * (steps, handoffs, variants, performers), metric observations pinned to the
 * revision they measured, the recordedAt-ordered list with since/until
 * filters — with the same validation issues, the same not-found-before-
 * measurement order, the same conflict discipline, the same audit
 * side-effects — and every table is append-only by database trigger with
 * history rewrites rejected by primary keys.
 *
 * Equivalence tests boot a fresh harness per test (the audit id sequence is
 * global, mirroring the kernel-global in-memory counter).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ProcessRecord,
  RegisterProcessInput,
  ReviseProcessInput,
  StepMeasurement,
} from "@aurum/domain";
import { createPgProcessDirectory } from "../src/domain-storage/adapters/process-store.js";
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

function processContent(overrides: Record<string, unknown> = {}) {
  return {
    name: "order fulfillment",
    description: "from intake to delivery",
    steps: [
      {
        stepId: "s-1",
        name: "intake",
        kind: "manual",
        performer: { kind: "employee", personId: "p-1" },
      },
      { stepId: "s-2", name: "pack", kind: "automated" },
    ],
    handoffs: [
      { fromStepId: "s-1", toStepId: "s-2", medium: "ticket" },
      {
        fromStepId: "s-2",
        toStepId: "s-1",
        fromPerformer: { kind: "software", externalRef: "packer-9000" },
      },
    ],
    variants: [
      { variantId: "v-fast", name: "fast path", stepIds: ["s-1", "s-2"], share: 0.25 },
      { variantId: "v-full", name: "full path", stepIds: ["s-1", "s-2"] },
    ],
    provenance: provenance(systemActor("seed")),
    now: now(0),
    ...overrides,
  };
}

function metricsInput(
  observationId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    observationId,
    processId: "pr-1",
    period: { start: now(0), end: now(3600) },
    measurements: [
      {
        stepId: "s-1",
        manualEffortMs: 1200,
        waitingTimeMs: 300,
        errorCount: 1,
        throughputPerPeriod: 10,
        utilization: 0.5,
        duplicates: ["s-2"],
      },
      { stepId: "s-2" },
    ] satisfies readonly StepMeasurement[],
    provenance: provenance(systemActor("seed")),
    now: now(1),
    ...overrides,
  };
}

describe("PG process directory equivalence with the in-memory reference", () => {
  it("round-trips revision histories and metric observations", async () => {
    const local = await pgHarness();
    try {
      const pgProcesses = createPgProcessDirectory(local.sql);
      const memory = memoryKernel();
      const s = scope("process-equivalence");

      const creates: readonly RegisterProcessInput[] = [
        { processId: "pr-1", ...processContent() } as RegisterProcessInput,
        {
          processId: "pr-2",
          ...processContent({ name: "minimal", description: undefined }),
        } as RegisterProcessInput,
        {
          processId: "pr-3",
          ...processContent({ name: "with freshness stamp on metrics later" }),
        } as RegisterProcessInput,
      ];
      for (const command of creates) {
        expectSameResult(
          await pgProcesses.registerProcess(s, command),
          memory.processes.registerProcess(s, command),
        );
      }
      // Revisions append; older revisions keep their original steps.
      const revises: readonly ReviseProcessInput[] = [
        {
          processId: "pr-1",
          ...processContent({
            name: "order fulfillment v2",
            steps: [{ stepId: "s-1", name: "intake", kind: "hybrid" }],
            handoffs: [],
            variants: [{ variantId: "v-lean", name: "lean", stepIds: ["s-1"], share: 1 }],
          }),
        } as ReviseProcessInput,
        {
          processId: "pr-1",
          ...processContent({ description: "re-described" }),
        } as ReviseProcessInput,
      ];
      for (const command of revises) {
        expectSameResult(
          await pgProcesses.reviseProcess(s, command),
          memory.processes.reviseProcess(s, command),
        );
      }

      // Metric observations: pinned to the current revision at record time,
      // recorded out of recordedAt order to prove the list ordering.
      const observationCommands = [
        metricsInput("obs-1"),
        metricsInput("obs-3", { now: now(30), period: { start: now(20), end: now(40) } }),
        metricsInput("obs-2", { now: now(10) }),
        metricsInput("obs-4", {
          processId: "pr-2",
          now: now(5),
          measurements: [{ stepId: "s-1", utilization: 0.25 }],
          freshness: { asOf: now(5), validUntil: now(5000) },
        }),
      ];
      for (const command of observationCommands) {
        expectSameResult(
          await pgProcesses.recordProcessMetrics(s, command as never),
          memory.processes.recordProcessMetrics(s, command as never),
        );
      }

      // Read-back equivalence across every surface.
      for (const processId of ["pr-1", "pr-2", "pr-3", "missing"]) {
        expectSameResult(
          await pgProcesses.getProcess(s, processId),
          memory.processes.getProcess(s, processId),
        );
      }
      expect(await pgProcesses.listProcesses(s)).toEqual(memory.processes.listProcesses(s));
      for (const filter of [
        undefined,
        { since: now(6) },
        { until: now(9) },
        { since: now(6), until: now(20) },
      ] as const) {
        expect(await pgProcesses.listProcessMetrics(s, "pr-1", filter)).toEqual(
          memory.processes.listProcessMetrics(s, "pr-1", filter),
        );
      }
      expect(await pgProcesses.listProcessMetrics(s, "pr-2")).toEqual(
        memory.processes.listProcessMetrics(s, "pr-2"),
      );
      expect(await pgProcesses.listProcessMetrics(s, "missing")).toEqual(
        memory.processes.listProcessMetrics(s, "missing"),
      );
      const revised = okOf(await pgProcesses.getProcess(s, "pr-1"));
      const memoryRevised: ProcessRecord = okOf(memory.processes.getProcess(s, "pr-1") as never);
      expect(revised.revisions[0]?.steps).toHaveLength(2);
      expect(revised.revisions).toEqual(memoryRevised.revisions);
    } finally {
      await local.close();
    }
  });

  it("mirrors validation failures issue-for-issue", async () => {
    const local = await pgHarness();
    try {
      const pgProcesses = createPgProcessDirectory(local.sql);
      const memory = memoryKernel();
      const s = scope("process-validation");

      const invalid: readonly Record<string, unknown>[] = [
        { name: "   " },
        { name: "x".repeat(301) },
        { description: "   " },
        { steps: [] },
        { steps: [{ stepId: "s-1", name: "x", kind: "sideways" }] },
        {
          steps: [
            { stepId: "s-1", name: "x", kind: "manual" },
            { stepId: "s-1", name: "y", kind: "manual" },
          ],
        },
        { steps: [{ stepId: "", name: "x", kind: "manual" }] },
        { steps: [{ stepId: "s-1", name: "", kind: "manual" }] },
        { steps: [{ stepId: "s-1", name: "x", kind: "manual", performer: { kind: "wizard" } }] },
        { steps: [{ stepId: "s-1", name: "x", kind: "manual", performer: { kind: "employee" } }] },
        {
          steps: [{ stepId: "s-1", name: "x", kind: "manual" }],
          handoffs: [{ fromStepId: "s-1", toStepId: "s-9" }],
        },
        {
          steps: [{ stepId: "s-1", name: "x", kind: "manual" }],
          handoffs: [{ fromStepId: "s-1", toStepId: "s-1" }],
        },
        {
          steps: [{ stepId: "s-1", name: "x", kind: "manual" }],
          handoffs: [{ fromStepId: "s-1", toStepId: "s-1", medium: "x".repeat(121) }],
        },
        {
          steps: [{ stepId: "s-1", name: "x", kind: "manual" }],
          variants: [{ variantId: "v-1", name: "v", stepIds: [] }],
        },
        {
          steps: [{ stepId: "s-1", name: "x", kind: "manual" }],
          variants: [{ variantId: "v-1", name: "v", stepIds: ["s-9"] }],
        },
        {
          steps: [{ stepId: "s-1", name: "x", kind: "manual" }],
          variants: [{ variantId: "v-1", name: "v", stepIds: ["s-1"], share: 1.5 }],
        },
        {
          steps: [{ stepId: "s-1", name: "x", kind: "manual" }],
          variants: [{ variantId: "v-1", name: "v", stepIds: ["s-1"], share: -0.5 }],
        },
        {
          steps: [{ stepId: "s-1", name: "x", kind: "manual" }],
          variants: [
            { variantId: "v-1", name: "v", stepIds: ["s-1"], share: 0.6 },
            { variantId: "v-2", name: "w", stepIds: ["s-1"], share: 0.6 },
          ],
        },
        {
          steps: [{ stepId: "s-1", name: "x", kind: "manual" }],
          variants: [
            { variantId: "v-1", name: "v", stepIds: ["s-1"] },
            { variantId: "v-1", name: "v", stepIds: ["s-1"] },
          ],
        },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of invalid) {
        const input = { processId: "pr-1", ...processContent(overrides) } as RegisterProcessInput;
        expectSameResult(
          await pgProcesses.registerProcess(s, input),
          memory.processes.registerProcess(s, input),
        );
        expectSameResult(
          await pgProcesses.reviseProcess(s, input as ReviseProcessInput),
          memory.processes.reviseProcess(s, input as ReviseProcessInput),
        );
      }
      const badId = { processId: "pr 1", ...processContent() } as RegisterProcessInput;
      expectSameResult(
        await pgProcesses.registerProcess(s, badId),
        memory.processes.registerProcess(s, badId),
      );
      // A non-array `steps` value throws the same TypeError on both kernels
      // (the reference maps over it after the non-empty-array issue is
      // recorded — the throw is part of the mirrored surface).
      const nonArraySteps = {
        processId: "pr-1",
        ...processContent({ steps: "not-an-array" }),
      } as RegisterProcessInput;
      await expect(pgProcesses.registerProcess(s, nonArraySteps)).rejects.toThrow(
        "(content.steps ?? []).map is not a function",
      );
      expect(() => memory.processes.registerProcess(s, nonArraySteps)).toThrow(
        "(content.steps ?? []).map is not a function",
      );
      // "pr 1" is a legal id (space is not a control character): the only
      // journal rows under the process area are its registration, while every
      // failing input wrote nothing.
      expect(await pgProcesses.listProcesses(s)).toEqual(memory.processes.listProcesses(s));
      expect(
        (await listJournal(local.sql, s.tenantId))
          .filter((row) => row.area === "process")
          .map((row) => row.journalKey),
      ).toEqual(["process:append-revision:pr 1:1"]);

      // Metric observation validation (process must exist first).
      okOf(
        await pgProcesses.registerProcess(s, {
          processId: "pr-ok",
          ...processContent(),
        } as RegisterProcessInput),
      );
      okOf(
        memory.processes.registerProcess(s, {
          processId: "pr-ok",
          ...processContent(),
        } as RegisterProcessInput),
      );
      const badMetrics: readonly Record<string, unknown>[] = [
        { observationId: "" },
        { processId: "nope" },
        { measurements: [] },
        { measurements: "not-an-array" },
        { period: { start: now(10), end: now(5) } },
        { period: { start: -1, end: now(5) } },
        { measurements: [{ stepId: "s-9" }] },
        { measurements: [{ stepId: "s-1", manualEffortMs: -1 }] },
        { measurements: [{ stepId: "s-1", utilization: 1.5 }] },
        { measurements: [{ stepId: "s-1", duplicates: ["s-9"] }] },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of badMetrics) {
        const input = metricsInput("obs-x", { processId: "pr-ok", ...overrides });
        expectSameResult(
          await pgProcesses.recordProcessMetrics(s, input as never),
          memory.processes.recordProcessMetrics(s, input as never),
        );
      }
      expect(await pgProcesses.listProcessMetrics(s, "pr-ok")).toEqual(
        memory.processes.listProcessMetrics(s, "pr-ok"),
      );
    } finally {
      await local.close();
    }
  });

  it("mirrors conflict/not-found discipline (including foreign tenants)", async () => {
    const local = await pgHarness();
    try {
      const pgProcesses = createPgProcessDirectory(local.sql);
      const memory = memoryKernel();
      const s = scope("process-conflict");
      const foreign = scope("process-foreign");

      const seed = { processId: "pr-1", ...processContent() } as RegisterProcessInput;
      okOf(await pgProcesses.registerProcess(s, seed));
      okOf(memory.processes.registerProcess(s, seed));
      expectSameResult(
        await pgProcesses.registerProcess(s, { processId: "pr-1", ...processContent() }),
        memory.processes.registerProcess(s, { processId: "pr-1", ...processContent() }),
      );
      expectSameResult(
        await pgProcesses.reviseProcess(s, { processId: "nope", ...processContent() }),
        memory.processes.reviseProcess(s, { processId: "nope", ...processContent() }),
      );

      // Not-found wins over measurement issues (the reference looks the
      // process up before validating measurements against its steps).
      const missingProcess = metricsInput("obs-1", {
        processId: "nope",
        measurements: [{ stepId: "s-9", utilization: 9 }],
      });
      expectSameResult(
        await pgProcesses.recordProcessMetrics(s, missingProcess as never),
        memory.processes.recordProcessMetrics(s, missingProcess as never),
      );
      okOf(await pgProcesses.recordProcessMetrics(s, metricsInput("obs-1") as never));
      okOf(memory.processes.recordProcessMetrics(s, metricsInput("obs-1") as never));
      expectSameResult(
        await pgProcesses.recordProcessMetrics(s, metricsInput("obs-1") as never),
        memory.processes.recordProcessMetrics(s, metricsInput("obs-1") as never),
      );

      // Foreign-tenant reads are indistinguishable from missing.
      const foreignRead = errOf(await pgProcesses.getProcess(foreign, "pr-1"));
      const missingRead = errOf(await pgProcesses.getProcess(s, "missing"));
      expect(foreignRead.message).toBe(missingRead.message);
      expect(foreignRead.message).toBe("process not found");
      expect(await pgProcesses.listProcesses(foreign)).toEqual([]);
      expect(await pgProcesses.listProcessMetrics(foreign, "pr-1")).toEqual([]);
      // The same id may exist independently in another tenant.
      okOf(
        await pgProcesses.registerProcess(foreign, {
          processId: "pr-1",
          ...processContent({ name: "foreign twin" }),
        } as RegisterProcessInput),
      );
      expectSameResult(
        await pgProcesses.getProcess(s, "pr-1"),
        memory.processes.getProcess(s, "pr-1"),
      );
    } finally {
      await local.close();
    }
  });

  it("appends matching audit entries (registered, revised, metrics-recorded)", async () => {
    const local = await pgHarness();
    try {
      const pgProcesses = createPgProcessDirectory(local.sql);
      const pgAudit = createPgAuditTrail(local.sql);
      const memory = memoryKernel();
      const s = scope("process-audit");

      okOf(
        await pgProcesses.registerProcess(s, {
          processId: "pr-1",
          ...processContent(),
        } as RegisterProcessInput),
      );
      okOf(
        memory.processes.registerProcess(s, {
          processId: "pr-1",
          ...processContent(),
        } as RegisterProcessInput),
      );
      okOf(
        await pgProcesses.reviseProcess(s, {
          processId: "pr-1",
          ...processContent({ name: "order fulfillment v2" }),
        } as ReviseProcessInput),
      );
      okOf(
        memory.processes.reviseProcess(s, {
          processId: "pr-1",
          ...processContent({ name: "order fulfillment v2" }),
        } as ReviseProcessInput),
      );
      okOf(await pgProcesses.recordProcessMetrics(s, metricsInput("obs-1") as never));
      okOf(memory.processes.recordProcessMetrics(s, metricsInput("obs-1") as never));
      expect(await pgAudit.queryAudit(s, {})).toEqual(memory.audit.queryAudit(s, {}));
      expect(await pgAudit.queryAudit(s, { subject: { kind: "process", id: "pr-1" } })).toEqual(
        memory.audit.queryAudit(s, { subject: { kind: "process", id: "pr-1" } }),
      );
    } finally {
      await local.close();
    }
  });
});

describe("PG process directory database enforcement", () => {
  it("rejects UPDATE and DELETE on both process tables (append-only)", async () => {
    const pgProcesses = createPgProcessDirectory(harness.sql);
    const s = scope("process-immutable");
    const created = okOf(
      await pgProcesses.registerProcess(s, {
        processId: "pr-1",
        ...processContent(),
      } as RegisterProcessInput),
    );
    okOf(await pgProcesses.recordProcessMetrics(s, metricsInput("obs-1") as never));
    for (const table of [
      "domain_process_revisions",
      "domain_process_metric_observations",
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
    const after = okOf(await pgProcesses.getProcess(s, "pr-1"));
    expect(after).toEqual(created);
    expect(await pgProcesses.listProcessMetrics(s, "pr-1")).toHaveLength(1);
  });

  it("journeys every mutation through the write journal with stable keys", async () => {
    const pgProcesses = createPgProcessDirectory(harness.sql);
    const s = scope("process-journal");
    await pgProcesses.registerProcess(s, {
      processId: "pr-1",
      ...processContent(),
    } as RegisterProcessInput);
    await pgProcesses.reviseProcess(s, {
      processId: "pr-1",
      ...processContent({ name: "v2" }),
    } as ReviseProcessInput);
    await pgProcesses.recordProcessMetrics(s, metricsInput("obs-1") as never);
    await pgProcesses.recordProcessMetrics(s, metricsInput("obs-2", { now: now(9) }) as never);
    const rows = await listJournal(harness.sql, s.tenantId);
    expect(rows.filter((row) => row.area === "process").map((row) => row.journalKey)).toEqual([
      "process:append-revision:pr-1:1",
      "process:append-revision:pr-1:2",
      "process:record-metrics:obs-1",
      "process:record-metrics:obs-2",
    ]);
  });

  it("rejects history rewrites (database constraints)", async () => {
    const pgProcesses = createPgProcessDirectory(harness.sql);
    const s = scope("process-constraint");
    okOf(
      await pgProcesses.registerProcess(s, {
        processId: "pr-1",
        ...processContent(),
      } as RegisterProcessInput),
    );
    okOf(await pgProcesses.recordProcessMetrics(s, metricsInput("obs-1") as never));
    await expect(
      harness.sql`
        insert into domain_process_revisions (tenant_id, process_id, revision_number, created_at, record)
        values (${s.tenantId}, 'pr-1', 1, 1, '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      harness.sql`
        insert into domain_process_metric_observations
          (tenant_id, observation_id, process_id, recorded_at, record)
        values (${s.tenantId}, 'obs-1', 'pr-1', 1, '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    const record = okOf(await pgProcesses.getProcess(s, "pr-1"));
    expect(record.revisions).toHaveLength(1);
    expect(await pgProcesses.listProcessMetrics(s, "pr-1")).toHaveLength(1);
  });
});
