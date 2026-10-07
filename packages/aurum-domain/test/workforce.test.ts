/**
 * Workforce (W005): roles, capacity bounds, bounded human allocations,
 * workload summaries, workload observations, outcomes and alternative
 * explanations. The acceptance bullet "human allocations have capacity
 * bounds" is proven here: assignments without a covering declaration, or
 * beyond the effort/concurrency bounds, are rejected.
 */
import { describe, expect, it } from "vitest";
import { type PersonId } from "../src/index.js";
import {
  errOf,
  kernel,
  now,
  okOf,
  personActor,
  provenance,
  scope,
  systemActor,
} from "./helpers.js";

function declareWeekCapacity(
  k: ReturnType<typeof kernel>,
  s: ReturnType<typeof scope>,
  personId: string,
  options: { maxEffortMs?: number; maxConcurrent?: number; startOffset?: number } = {},
) {
  return k.workforce.declareCapacity(s, {
    capacityId: `cap-${personId}`,
    personId,
    bounds: {
      period: {
        start: now(options.startOffset ?? 0),
        end: now((options.startOffset ?? 0) + 1000),
      },
      maxEffortMs: options.maxEffortMs ?? 40 * 3600 * 1000,
      maxConcurrentAssignments: options.maxConcurrent ?? 2,
    },
    provenance: provenance(systemActor("capacity-planner"), 0),
    now: now(0),
  });
}

describe("workforce directory", () => {
  it("registers roles with required capabilities", () => {
    const k = kernel();
    const s = scope("acme");
    const role = okOf(
      k.workforce.registerRole(s, {
        roleId: "role-validator",
        title: "Invoice validator",
        description: "Validates invoices before approval",
        requiredCapabilities: ["cap-1", "cap-2"],
        provenance: provenance(systemActor("seed"), 0),
        now: now(0),
      }),
    );
    expect(role.title).toBe("Invoice validator");
    expect(role.requiredCapabilities).toHaveLength(2);
    expect(role.requiredCapabilities[0]).toBe("cap-1" as never);
    expect(k.workforce.listRoles(s)).toHaveLength(1);
    const duplicate = k.workforce.registerRole(s, {
      roleId: "role-validator",
      title: "Invoice validator",
      provenance: provenance(systemActor("seed"), 0),
      now: now(0),
    });
    expect(errOf(duplicate).code).toBe("conflict");
  });

  it("declares capacity bounds and validates them", () => {
    const k = kernel();
    const s = scope("acme");
    const declaration = okOf(declareWeekCapacity(k, s, "p-1"));
    expect(declaration.personId).toBe("p-1" as PersonId);
    expect(declaration.bounds.maxEffortMs).toBe(40 * 3600 * 1000);
    expect(declaration.bounds.maxConcurrentAssignments).toBe(2);
    expect(okOf(k.workforce.getCapacity(s, "p-1", now(500))).capacityId).toBe("cap-p-1");

    const zeroEffort = k.workforce.declareCapacity(s, {
      capacityId: "cap-x",
      personId: "p-2",
      bounds: {
        period: { start: now(0), end: now(1000) },
        maxEffortMs: 0,
        maxConcurrentAssignments: 1,
      },
      provenance: provenance(systemActor("seed"), 0),
      now: now(0),
    });
    expect(errOf(zeroEffort).code).toBe("validation");
    expect(errOf(zeroEffort).issues.map((i) => i.field)).toContain("bounds.maxEffortMs");

    const inverted = k.workforce.declareCapacity(s, {
      capacityId: "cap-x",
      personId: "p-2",
      bounds: {
        period: { start: now(10), end: now(5) },
        maxEffortMs: 100,
        maxConcurrentAssignments: 1,
      },
      provenance: provenance(systemActor("seed"), 0),
      now: now(0),
    });
    expect(errOf(inverted).code).toBe("validation");
    expect(errOf(inverted).issues.map((i) => i.field)).toContain("bounds.period");
  });

  it("rejects human allocations without covering capacity bounds", () => {
    const k = kernel();
    const s = scope("acme");
    const unbounded = k.workforce.recordAssignment(s, {
      assignmentId: "asg-1",
      personId: "p-1",
      effortMs: 5 * 3600 * 1000,
      period: { start: now(0), end: now(1000) },
      provenance: provenance(systemActor("planner"), 1),
      now: now(1),
    });
    expect(errOf(unbounded).code).toBe("validation");
    expect(errOf(unbounded).issues.map((i) => i.field)).toContain("personId");
  });

  it("rejects allocations exceeding effort and concurrency bounds", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(declareWeekCapacity(k, s, "p-1", { maxEffortMs: 10 * 3600 * 1000, maxConcurrent: 2 }));
    okOf(
      k.workforce.recordAssignment(s, {
        assignmentId: "asg-1",
        personId: "p-1",
        effortMs: 6 * 3600 * 1000,
        period: { start: now(0), end: now(1000) },
        provenance: provenance(systemActor("planner"), 1),
        now: now(1),
      }),
    );
    const overEffort = k.workforce.recordAssignment(s, {
      assignmentId: "asg-2",
      personId: "p-1",
      effortMs: 6 * 3600 * 1000,
      period: { start: now(0), end: now(1000) },
      provenance: provenance(systemActor("planner"), 1),
      now: now(1),
    });
    expect(errOf(overEffort).code).toBe("validation");
    expect(errOf(overEffort).issues.map((i) => i.field)).toContain("effortMs");

    okOf(declareWeekCapacity(k, s, "p-2", { maxEffortMs: 100 * 3600 * 1000, maxConcurrent: 1 }));
    okOf(
      k.workforce.recordAssignment(s, {
        assignmentId: "asg-3",
        personId: "p-2",
        effortMs: 10 * 3600 * 1000,
        period: { start: now(0), end: now(1000) },
        provenance: provenance(systemActor("planner"), 1),
        now: now(1),
      }),
    );
    const overConcurrency = k.workforce.recordAssignment(s, {
      assignmentId: "asg-4",
      personId: "p-2",
      effortMs: 10 * 3600 * 1000,
      period: { start: now(0), end: now(1000) },
      provenance: provenance(systemActor("planner"), 1),
      now: now(1),
    });
    expect(errOf(overConcurrency).code).toBe("validation");
    expect(errOf(overConcurrency).issues.map((i) => i.field)).toContain("assignmentId");
  });

  it("records bounded assignments with role and process references and computes workload", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(declareWeekCapacity(k, s, "p-1", { maxEffortMs: 40 * 3600 * 1000, maxConcurrent: 2 }));
    const assignment = okOf(
      k.workforce.recordAssignment(s, {
        assignmentId: "asg-1",
        personId: "p-1",
        roleId: "role-validator",
        processRef: { processId: "proc-1", stepId: "validate" },
        effortMs: 10 * 3600 * 1000,
        period: { start: now(0), end: now(1000) },
        provenance: provenance(systemActor("planner"), 1),
        now: now(1),
      }),
    );
    expect(assignment.status).toBe("active");
    expect(assignment.roleId).toBe("role-validator" as never);
    expect(assignment.processRef?.stepId).toBe("validate");

    const summary = okOf(k.workforce.workloadOf(s, "p-1", { start: now(0), end: now(1000) }));
    expect(summary.activeAssignmentCount).toBe(1);
    expect(summary.totalAssignedEffortMs).toBe(10 * 3600 * 1000);
    expect(summary.utilization).toBeCloseTo(0.25);
    expect(summary.overCapacity).toBe(false);
  });

  it("ends assignments and stops counting them in workload", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(declareWeekCapacity(k, s, "p-1", { maxEffortMs: 40 * 3600 * 1000, maxConcurrent: 1 }));
    okOf(
      k.workforce.recordAssignment(s, {
        assignmentId: "asg-1",
        personId: "p-1",
        effortMs: 10 * 3600 * 1000,
        period: { start: now(0), end: now(1000) },
        provenance: provenance(systemActor("planner"), 1),
        now: now(1),
      }),
    );
    const ended = okOf(
      k.workforce.endAssignment(s, {
        assignmentId: "asg-1",
        endedBy: personActor("p-9"),
        now: now(2),
        audit: { actor: personActor("p-9"), at: now(2), reason: "rotation" },
      }),
    );
    expect(ended.status).toBe("ended");
    expect(ended.endedAt).toBe(now(2));
    const again = k.workforce.endAssignment(s, {
      assignmentId: "asg-1",
      endedBy: personActor("p-9"),
      now: now(3),
      audit: { actor: personActor("p-9"), at: now(3), reason: "double end" },
    });
    expect(errOf(again).code).toBe("conflict");
    const summary = okOf(k.workforce.workloadOf(s, "p-1", { start: now(3), end: now(999) }));
    expect(summary.activeAssignmentCount).toBe(0);
    expect(k.workforce.listAssignments(s, { status: "ended" })).toHaveLength(1);
  });
});

describe("workforce insights", () => {
  it("records workload observations that may exceed declared bounds (evidence, not allocation)", () => {
    const k = kernel();
    const s = scope("acme");
    const observation = okOf(
      k.workforceInsights.recordWorkloadObservation(s, {
        observationId: "wl-obs-1",
        personId: "p-1",
        period: { start: now(0), end: now(1000) },
        observedEffortMs: 60 * 3600 * 1000,
        provenance: provenance(systemActor("time-tracking"), 2),
        now: now(2),
      }),
    );
    expect(observation.observedEffortMs).toBe(60 * 3600 * 1000);
    expect(observation.freshness.asOf).toBe(now(2));
    expect(k.workforceInsights.listWorkloadObservations(s, { personId: "p-1" })).toHaveLength(1);
  });

  it("records outcomes and alternative explanations with evidence references", () => {
    const k = kernel();
    const s = scope("acme");
    const outcome = okOf(
      k.workforceInsights.recordOutcome(s, {
        outcomeId: "out-1",
        personId: "p-1",
        period: { start: now(0), end: now(1000) },
        subject: { kind: "goal", id: "goal-1" },
        result: "partial",
        summary: "validation throughput below target during peak",
        provenance: provenance(systemActor("outcome-collector"), 2),
        now: now(2),
      }),
    );
    expect(outcome.result).toBe("partial");
    expect(k.workforceInsights.listOutcomes(s, { result: "partial" })).toHaveLength(1);

    const surge = okOf(
      k.workforceInsights.recordAlternativeExplanation(s, {
        explanationId: "expl-1",
        subject: { kind: "person", id: "p-1" },
        pattern: "validation queue growth on Mondays",
        explanation: "invoice volume surge from weekend intake",
        evidenceRefs: [
          { kind: "observation", id: "obs-vol" },
          { kind: "claim", id: "claim-season" },
        ],
        provenance: provenance(systemActor("analysis"), 3),
        now: now(3),
      }),
    );
    expect(surge.evidenceRefs).toHaveLength(2);
    const friction = okOf(
      k.workforceInsights.recordAlternativeExplanation(s, {
        explanationId: "expl-2",
        subject: { kind: "person", id: "p-1" },
        pattern: "validation queue growth on Mondays",
        explanation: "handoff friction between intake and validation",
        evidenceRefs: [{ kind: "observation", id: "obs-handoff" }],
        provenance: provenance(systemActor("analysis"), 3),
        now: now(3),
      }),
    );
    expect(friction.explanation).toContain("friction");
    const both = k.workforceInsights.listAlternativeExplanations(s, {
      subject: { kind: "person", id: "p-1" },
    });
    expect(both).toHaveLength(2);

    const badResult = k.workforceInsights.recordOutcome(s, {
      outcomeId: "out-x",
      personId: "p-1",
      period: { start: now(0), end: now(1000) },
      result: "spectacular",
      summary: "x",
      provenance: provenance(systemActor("outcome-collector"), 2),
      now: now(2),
    });
    expect(errOf(badResult).code).toBe("validation");
    expect(errOf(badResult).issues.map((i) => i.field)).toContain("result");
  });

  it("isolates tenants across workforce stores", () => {
    const k = kernel();
    const acme = scope("acme");
    const other = scope("other");
    okOf(declareWeekCapacity(k, acme, "p-1"));
    expect(errOf(k.workforce.getCapacity(other, "p-1", now(500))).code).toBe("not-found");
    expect(k.workforce.listAssignments(other)).toHaveLength(0);
    expect(k.workforceInsights.listWorkloadObservations(other, { personId: "p-1" })).toHaveLength(
      0,
    );
    const foreignAssignment = k.workforce.recordAssignment(other, {
      assignmentId: "asg-x",
      personId: "p-1",
      effortMs: 3600 * 1000,
      period: { start: now(0), end: now(1000) },
      provenance: provenance(systemActor("planner"), 1),
      now: now(1),
    });
    expect(errOf(foreignAssignment).code).toBe("validation");
  });
});
