/**
 * Process reconstruction (W005): steps + performers, handoffs, variants,
 * append-only revisions, metric observations, pure analysis (bottleneck,
 * duplication, manual effort, waiting time, errors), validation and tenant
 * isolation. All access through the public contract (../src/index.js).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOTTLENECK_POLICY,
  analyzeProcess,
  createDomainKernel,
  type PersonId,
  type RegisterProcessInput,
  type UnitId,
} from "../src/index.js";
import { errOf, kernel, now, okOf, provenance, scope, systemActor } from "./helpers.js";

const person = (id: string) => ({ kind: "employee", personId: id as PersonId });
const team = (id: string) => ({ kind: "team", unitId: id as UnitId });

function processContent(overrides: Record<string, unknown> = {}) {
  return {
    name: "invoice processing",
    description: "monthly invoice intake to payment",
    steps: [
      {
        stepId: "intake",
        name: "Receive invoice",
        kind: "manual",
        performer: person("p-ops-1"),
      },
      {
        stepId: "validate",
        name: "Validate fields",
        kind: "hybrid",
        performer: { kind: "software", externalRef: "ocr-svc" },
      },
      { stepId: "approve", name: "Approve payment", kind: "manual", performer: team("u-finance") },
      { stepId: "pay", name: "Execute payment", kind: "automated" },
    ],
    handoffs: [
      { fromStepId: "intake", toStepId: "validate", medium: "queue" },
      {
        fromStepId: "validate",
        toStepId: "approve",
        fromPerformer: { kind: "software", externalRef: "ocr-svc" },
        toPerformer: team("u-finance"),
        medium: "ticket",
      },
    ],
    variants: [
      {
        variantId: "standard",
        name: "Standard path",
        stepIds: ["intake", "validate", "approve", "pay"],
        share: 0.7,
      },
      {
        variantId: "low-value",
        name: "Low-value fast path",
        stepIds: ["intake", "pay"],
        share: 0.2,
      },
    ],
    provenance: provenance(systemActor("process-mining"), 0),
    now: now(0),
    ...overrides,
  } as unknown as Omit<RegisterProcessInput, "processId">;
}

describe("process reconstruction", () => {
  it("registers a process with steps, performers, handoffs and variants", () => {
    const k = kernel();
    const s = scope("acme");
    const record = okOf(
      k.processes.registerProcess(s, { processId: "proc-1", ...processContent() }),
    );
    expect(record.currentRevision).toBe(1);
    const revision = record.revisions[0];
    expect(revision?.name).toBe("invoice processing");
    expect(revision?.steps).toHaveLength(4);
    expect(revision?.steps[0]?.performer?.kind).toBe("employee");
    expect(revision?.steps[0]?.performer?.personId).toBe("p-ops-1" as PersonId);
    expect(revision?.steps[2]?.performer?.unitId).toBe("u-finance" as UnitId);
    expect(revision?.handoffs).toHaveLength(2);
    expect(revision?.handoffs[1]?.medium).toBe("ticket");
    expect(revision?.variants).toHaveLength(2);
    expect(revision?.variants[1]?.share).toBe(0.2);
    expect(revision?.provenance.source).toBe("human-entered");
  });

  it("appends revisions without modifying previous ones (append-only)", () => {
    const k = kernel();
    const s = scope("acme");
    const first = okOf(
      k.processes.registerProcess(s, { processId: "proc-1", ...processContent() }),
    );
    const second = okOf(
      k.processes.reviseProcess(s, {
        processId: "proc-1",
        ...processContent({ name: "invoice processing v2" }),
      }),
    );
    expect(second.currentRevision).toBe(2);
    expect(second.revisions).toHaveLength(2);
    expect(second.revisions[0]?.name).toBe("invoice processing");
    expect(second.revisions[1]?.name).toBe("invoice processing v2");
    expect(first.revisions).toHaveLength(1);
    expect(first.revisions[0]?.revisionNumber).toBe(1);
    const fetched = okOf(k.processes.getProcess(s, "proc-1"));
    expect(fetched.revisions[0]).toEqual(first.revisions[0]);
  });

  it("validates step kinds, handoff references and variant references", () => {
    const k = kernel();
    const s = scope("acme");
    const badKind = k.processes.registerProcess(s, {
      processId: "proc-x",
      ...processContent({
        steps: [{ stepId: "s1", name: "Only step", kind: "magic" }],
      }),
    });
    expect(errOf(badKind).code).toBe("validation");
    expect(errOf(badKind).issues.map((i) => i.field)).toContain("steps.0.kind");

    const danglingHandoff = k.processes.registerProcess(s, {
      processId: "proc-x",
      ...processContent({
        handoffs: [{ fromStepId: "intake", toStepId: "nonexistent" }],
      }),
    });
    expect(errOf(danglingHandoff).code).toBe("validation");
    expect(errOf(danglingHandoff).issues.map((i) => i.field)).toContain("handoffs.0.toStepId");

    const danglingVariant = k.processes.registerProcess(s, {
      processId: "proc-x",
      ...processContent({
        variants: [{ variantId: "v1", name: "Ghost path", stepIds: ["ghost-step"] }],
      }),
    });
    expect(errOf(danglingVariant).code).toBe("validation");
    expect(errOf(danglingVariant).issues.map((i) => i.field)).toContain("variants.0.stepIds");

    const emptySteps = k.processes.registerProcess(s, {
      processId: "proc-x",
      ...processContent({ steps: [] }),
    });
    expect(errOf(emptySteps).code).toBe("validation");
    expect(errOf(emptySteps).issues.map((i) => i.field)).toContain("steps");
  });

  it("rejects duplicate process registration and unknown revise targets", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(k.processes.registerProcess(s, { processId: "proc-1", ...processContent() }));
    const duplicate = k.processes.registerProcess(s, { processId: "proc-1", ...processContent() });
    expect(errOf(duplicate).code).toBe("conflict");
    const missing = k.processes.reviseProcess(s, { processId: "proc-404", ...processContent() });
    expect(errOf(missing).code).toBe("not-found");
  });

  it("records metric observations with provenance and freshness", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(k.processes.registerProcess(s, { processId: "proc-1", ...processContent() }));
    const observation = okOf(
      k.processes.recordProcessMetrics(s, {
        observationId: "obs-1",
        processId: "proc-1",
        period: { start: now(1), end: now(2) },
        measurements: [
          {
            stepId: "intake",
            manualEffortMs: 1000,
            waitingTimeMs: 500,
            errorCount: 2,
            utilization: 0.4,
          },
          { stepId: "validate", manualEffortMs: 200, utilization: 0.9 },
        ],
        provenance: provenance(systemActor("metrics-collector"), 2),
        now: now(2),
      }),
    );
    expect(observation.processId).toBe("proc-1" as never);
    expect(observation.revisionNumber).toBe(1);
    expect(observation.measurements).toHaveLength(2);
    expect(observation.freshness.asOf).toBe(now(2));
    expect(k.processes.listProcessMetrics(s, "proc-1")).toHaveLength(1);
    const duplicate = k.processes.recordProcessMetrics(s, {
      observationId: "obs-1",
      processId: "proc-1",
      period: { start: now(1), end: now(2) },
      measurements: [{ stepId: "intake", manualEffortMs: 1 }],
      provenance: provenance(systemActor("metrics-collector"), 3),
      now: now(3),
    });
    expect(errOf(duplicate).code).toBe("conflict");
  });

  it("validates measurement step references, utilization and duplicates", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(k.processes.registerProcess(s, { processId: "proc-1", ...processContent() }));
    const unknownStep = k.processes.recordProcessMetrics(s, {
      observationId: "obs-x",
      processId: "proc-1",
      period: { start: now(1), end: now(2) },
      measurements: [{ stepId: "ghost", manualEffortMs: 1 }],
      provenance: provenance(systemActor("metrics-collector"), 2),
      now: now(2),
    });
    expect(errOf(unknownStep).code).toBe("validation");
    expect(errOf(unknownStep).issues.map((i) => i.field)).toContain("measurements.0.stepId");

    const badUtilization = k.processes.recordProcessMetrics(s, {
      observationId: "obs-x",
      processId: "proc-1",
      period: { start: now(1), end: now(2) },
      measurements: [{ stepId: "intake", utilization: 1.5 }],
      provenance: provenance(systemActor("metrics-collector"), 2),
      now: now(2),
    });
    expect(errOf(badUtilization).code).toBe("validation");
    expect(errOf(badUtilization).issues.map((i) => i.field)).toContain(
      "measurements.0.utilization",
    );

    const foreignDuplicate = k.processes.recordProcessMetrics(s, {
      observationId: "obs-x",
      processId: "proc-1",
      period: { start: now(1), end: now(2) },
      measurements: [{ stepId: "intake", duplicates: ["ghost"] }],
      provenance: provenance(systemActor("metrics-collector"), 2),
      now: now(2),
    });
    expect(errOf(foreignDuplicate).code).toBe("validation");
  });

  it("analyzes exposure: bottleneck, duplication, effort, waiting, errors, variants", () => {
    const k = kernel();
    const s = scope("acme");
    const process = okOf(
      k.processes.registerProcess(s, { processId: "proc-1", ...processContent() }),
    );
    const observation = okOf(
      k.processes.recordProcessMetrics(s, {
        observationId: "obs-1",
        processId: "proc-1",
        period: { start: now(1), end: now(2) },
        measurements: [
          {
            stepId: "intake",
            manualEffortMs: 1000,
            waitingTimeMs: 500,
            errorCount: 2,
            utilization: 0.4,
            duplicates: ["validate"],
          },
          {
            stepId: "validate",
            manualEffortMs: 200,
            waitingTimeMs: 300,
            errorCount: 1,
            utilization: 0.91,
          },
          {
            stepId: "approve",
            manualEffortMs: 3000,
            waitingTimeMs: 20000,
            errorCount: 0,
            utilization: 0.76,
          },
        ],
        provenance: provenance(systemActor("metrics-collector"), 2),
        now: now(2),
      }),
    );
    const analysis = analyzeProcess(process, observation);
    expect(analysis.stepCount).toBe(4);
    expect(analysis.handoffCount).toBe(2);
    expect(analysis.variantCount).toBe(2);
    expect(analysis.variantCoverage).toBeCloseTo(0.9);
    expect(analysis.bottleneckStepId).toBe("validate");
    expect(analysis.bottleneckUtilization).toBe(0.91);
    expect(analysis.totalManualEffortMs).toBe(4200);
    expect(analysis.totalWaitingTimeMs).toBe(20800);
    expect(analysis.totalErrors).toBe(3);
    expect(analysis.duplicatedStepIds).toEqual(["validate"]);
  });

  it("detects no bottleneck below the policy threshold and honors custom policies", () => {
    const k = kernel();
    const s = scope("acme");
    const process = okOf(
      k.processes.registerProcess(s, { processId: "proc-1", ...processContent() }),
    );
    const observation = okOf(
      k.processes.recordProcessMetrics(s, {
        observationId: "obs-1",
        processId: "proc-1",
        period: { start: now(1), end: now(2) },
        measurements: [{ stepId: "intake", utilization: 0.6 }],
        provenance: provenance(systemActor("metrics-collector"), 2),
        now: now(2),
      }),
    );
    expect(analyzeProcess(process, observation).bottleneckStepId).toBeUndefined();
    const sensitive = analyzeProcess(process, observation, { utilizationThreshold: 0.5 });
    expect(sensitive.bottleneckStepId).toBe("intake");
    expect(DEFAULT_BOTTLENECK_POLICY.utilizationThreshold).toBe(0.75);
  });

  it("audits process registration and metric recording", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(k.processes.registerProcess(s, { processId: "proc-1", ...processContent() }));
    okOf(
      k.processes.recordProcessMetrics(s, {
        observationId: "obs-1",
        processId: "proc-1",
        period: { start: now(1), end: now(2) },
        measurements: [{ stepId: "intake", manualEffortMs: 5 }],
        provenance: provenance(systemActor("metrics-collector"), 2),
        now: now(2),
      }),
    );
    const entries = k.audit.queryAudit(s, { subject: { kind: "process", id: "proc-1" } });
    expect(entries.map((e) => e.action)).toEqual([
      "process.registered",
      "process.metrics-recorded",
    ]);
  });

  it("isolates tenants: foreign process ids are uniformly not-found", () => {
    const k = kernel();
    const acme = scope("acme");
    const other = scope("other");
    okOf(k.processes.registerProcess(acme, { processId: "proc-1", ...processContent() }));
    const foreign = k.processes.getProcess(other, "proc-1");
    expect(errOf(foreign).code).toBe("not-found");
    expect(errOf(foreign).message).toBe(errOf(k.processes.getProcess(other, "proc-never")).message);
    expect(k.processes.listProcesses(other)).toHaveLength(0);
    expect(k.processes.listProcessMetrics(other, "proc-1")).toHaveLength(0);
    const fresh = createDomainKernel();
    expect(fresh.processes.getProcess(acme, "proc-1").ok).toBe(false);
  });
});
