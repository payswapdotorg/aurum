/**
 * W005 acceptance, end-to-end through the composed kernel and the public
 * contract surface (../src/index.js):
 * 1. employee/team/agent/software/supplier/partner supplies represented;
 * 2. gaps distinguish uncovered/level/capacity;
 * 3. human allocations have capacity bounds;
 * 4. employment-impacting recommendations preserve evidence + human
 *    decision (never auto-decided).
 */
import { describe, expect, it } from "vitest";
import {
  EMPLOYMENT_IMPACTING_ADJUSTMENTS,
  WORKFORCE_ADJUSTMENTS,
  analyzeProcess,
  createDomainKernel,
  type PersonId,
  type UnitId,
} from "../src/index.js";
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

describe("W005 acceptance", () => {
  it("employee/team/agent/software/supplier/partner supplies are represented", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.capabilities.registerCapability(s, {
        capabilityId: "cap-validation",
        name: "invoice validation",
        provenance: provenance(systemActor("seed"), 0),
        now: now(0),
      }),
    );
    const supplies = [
      { supplyId: "sup-emp", supplier: { kind: "employee" as const, personId: "p-1" as PersonId } },
      { supplyId: "sup-team", supplier: { kind: "team" as const, unitId: "u-finance" as UnitId } },
      { supplyId: "sup-agent", supplier: { kind: "agent" as const, externalRef: "agent-body-17" } },
      { supplyId: "sup-software", supplier: { kind: "software" as const, externalRef: "ocr-svc" } },
      { supplyId: "sup-supplier", supplier: { kind: "supplier" as const, externalRef: "bpo-2" } },
      { supplyId: "sup-partner", supplier: { kind: "partner" as const, externalRef: "partner-1" } },
    ];
    for (const input of supplies) {
      okOf(
        k.capabilities.registerSupply(s, {
          capabilityId: "cap-validation",
          level: 4,
          capacityPerPeriod: 50,
          ...input,
          provenance: provenance(systemActor("seed"), 1),
          now: now(1),
        }),
      );
    }
    const registered = k.capabilities.listSupplies(s, { capabilityId: "cap-validation" });
    expect(registered).toHaveLength(6);
    for (const kind of ["employee", "team", "agent", "software", "supplier", "partner"]) {
      expect(registered.some((supply) => supply.supplier.kind === kind)).toBe(true);
    }
    const employee = registered.find((supply) => supply.supplier.kind === "employee");
    expect(employee?.supplier.personId).toBe("p-1" as PersonId);
    const team = registered.find((supply) => supply.supplier.kind === "team");
    expect(team?.supplier.unitId).toBe("u-finance" as UnitId);
  });

  it("gaps distinguish uncovered / level / capacity shortfalls", () => {
    const k = kernel();
    const s = scope("acme");
    for (const capabilityId of ["cap-a", "cap-b", "cap-c", "cap-d"]) {
      okOf(
        k.capabilities.registerCapability(s, {
          capabilityId,
          name: `capability ${capabilityId}`,
          provenance: provenance(systemActor("seed"), 0),
          now: now(0),
        }),
      );
    }
    const requirement = (
      requirementId: string,
      capabilityId: string,
      level: number,
      capacity?: number,
    ) =>
      k.capabilities.registerRequirement(s, {
        requirementId,
        capabilityId,
        source: { kind: "process", ref: "proc-1" },
        requiredLevel: level,
        ...(capacity !== undefined ? { requiredCapacityPerPeriod: capacity } : {}),
        provenance: provenance(systemActor("seed"), 1),
        now: now(1),
      });
    okOf(requirement("req-uncovered", "cap-a", 3));
    okOf(requirement("req-level", "cap-b", 4));
    okOf(requirement("req-capacity", "cap-c", 3, 100));
    okOf(requirement("req-covered", "cap-d", 2, 10));
    okOf(
      k.capabilities.registerSupply(s, {
        supplyId: "sup-b",
        capabilityId: "cap-b",
        supplier: { kind: "employee", personId: "p-1" as PersonId },
        level: 2,
        provenance: provenance(systemActor("seed"), 1),
        now: now(1),
      }),
    );
    okOf(
      k.capabilities.registerSupply(s, {
        supplyId: "sup-c",
        capabilityId: "cap-c",
        supplier: { kind: "agent", externalRef: "agent-body-17" },
        level: 3,
        capacityPerPeriod: 60,
        provenance: provenance(systemActor("seed"), 1),
        now: now(1),
      }),
    );
    okOf(
      k.capabilities.registerSupply(s, {
        supplyId: "sup-d",
        capabilityId: "cap-d",
        supplier: { kind: "software", externalRef: "ocr-svc" },
        level: 4,
        capacityPerPeriod: 40,
        provenance: provenance(systemActor("seed"), 1),
        now: now(1),
      }),
    );
    const assessments = okOf(
      k.capabilities.recomputeGaps(s, {
        provenance: provenance(systemActor("planner"), 2),
        now: now(2),
      }),
    );
    const byRequirement = new Map(assessments.map((a) => [a.requirementId, a]));
    expect(byRequirement.get("req-uncovered" as never)?.status).toBe("uncovered");
    expect(byRequirement.get("req-level" as never)?.status).toBe("level");
    expect(byRequirement.get("req-level" as never)?.levelShortfall).toBe(2);
    expect(byRequirement.get("req-capacity" as never)?.status).toBe("capacity");
    expect(byRequirement.get("req-capacity" as never)?.capacityShortfall).toBe(40);
    expect(byRequirement.get("req-covered" as never)?.status).toBe("covered");

    const gaps = k.capabilities.listGaps(s);
    expect(gaps.map((gap) => gap.kind).sort()).toEqual(["capacity", "level", "uncovered"]);
  });

  it("human allocations have capacity bounds", () => {
    const k = kernel();
    const s = scope("acme");
    const unbounded = k.workforce.recordAssignment(s, {
      assignmentId: "asg-1",
      personId: "p-1",
      effortMs: 10 * 3600 * 1000,
      period: { start: now(0), end: now(1000) },
      provenance: provenance(systemActor("planner"), 1),
      now: now(1),
    });
    expect(errOf(unbounded).code).toBe("validation");

    okOf(
      k.workforce.declareCapacity(s, {
        capacityId: "cap-p-1",
        personId: "p-1",
        bounds: {
          period: { start: now(0), end: now(1000) },
          maxEffortMs: 20 * 3600 * 1000,
          maxConcurrentAssignments: 1,
        },
        provenance: provenance(systemActor("planner"), 0),
        now: now(0),
      }),
    );
    const bounded = okOf(
      k.workforce.recordAssignment(s, {
        assignmentId: "asg-1",
        personId: "p-1",
        effortMs: 10 * 3600 * 1000,
        period: { start: now(0), end: now(1000) },
        provenance: provenance(systemActor("planner"), 1),
        now: now(1),
      }),
    );
    expect(bounded.status).toBe("active");
    const overEffort = k.workforce.recordAssignment(s, {
      assignmentId: "asg-2",
      personId: "p-1",
      effortMs: 15 * 3600 * 1000,
      period: { start: now(0), end: now(1000) },
      provenance: provenance(systemActor("planner"), 1),
      now: now(1),
    });
    expect(errOf(overEffort).code).toBe("validation");
    const summary = okOf(k.workforce.workloadOf(s, "p-1", { start: now(0), end: now(1000) }));
    expect(summary.bounds?.maxEffortMs).toBe(20 * 3600 * 1000);
    expect(summary.utilization).toBeCloseTo(0.5);
  });

  it("employment-impacting recommendations preserve evidence and the human decision", () => {
    const k = kernel();
    const s = scope("acme");
    const noEvidence = k.workforceRecommendations.proposeRecommendation(s, {
      recommendationId: "rec-1",
      adjustment: "agent-replacement",
      subject: { kind: "person", id: "p-1" },
      rationale: "replace manual validation with an agent",
      evidenceRefs: [],
      employmentImpacting: true,
      proposedBy: systemActor("org-lab"),
      provenance: provenance(systemActor("org-lab"), 1),
      now: now(1),
    });
    expect(errOf(noEvidence).code).toBe("validation");
    expect(errOf(noEvidence).issues.map((i) => i.field)).toContain("evidenceRefs");

    okOf(
      k.workforceRecommendations.proposeRecommendation(s, {
        recommendationId: "rec-1",
        adjustment: "agent-replacement",
        subject: { kind: "person", id: "p-1" },
        rationale: "replace manual validation with an agent",
        evidenceRefs: [{ kind: "observation", id: "obs-workload-1" }],
        employmentImpacting: true,
        proposedBy: systemActor("org-lab"),
        provenance: provenance(systemActor("org-lab"), 1),
        now: now(1),
      }),
    );
    const systemDecision = k.workforceRecommendations.decideRecommendation(s, {
      recommendationId: "rec-1",
      decision: "human-approved",
      decidedBy: systemActor("org-lab"),
      reason: "pipeline auto-approval",
      now: now(2),
    });
    expect(errOf(systemDecision).code).toBe("forbidden");
    const agentDecision = k.workforceRecommendations.decideRecommendation(s, {
      recommendationId: "rec-1",
      decision: "human-approved",
      decidedBy: { kind: "agent", name: "agent-body-17" },
      reason: "agent auto-approval",
      now: now(2),
    });
    expect(errOf(agentDecision).code).toBe("forbidden");
    const pending = okOf(k.workforceRecommendations.getRecommendation(s, "rec-1"));
    expect(pending.decision.state).toBe("pending");

    const human = okOf(
      k.workforceRecommendations.decideRecommendation(s, {
        recommendationId: "rec-1",
        decision: "human-approved",
        decidedBy: personActor("p-manager"),
        reason: "approved for a supervised pilot",
        now: now(2),
      }),
    );
    expect(human.decision.state).toBe("human-approved");
    expect(human.decision.decidedBy?.personId).toBe("p-manager" as never);
    expect(human.evidenceRefs).toEqual([{ kind: "observation", id: "obs-workload-1" }]);
    const decidedAudit = k.audit.queryAudit(s, {
      subject: { kind: "workforce", id: "rec-1" },
    });
    expect(decidedAudit[1]?.action).toBe("workforce.recommendation-decided");
    expect(decidedAudit[1]?.actor.kind).toBe("person");
  });

  it("extends the composed kernel and public surface without touching W002 exports", () => {
    const k = createDomainKernel();
    expect(k.processes).toBeTruthy();
    expect(k.capabilities).toBeTruthy();
    expect(k.workforce).toBeTruthy();
    expect(k.workforceInsights).toBeTruthy();
    expect(k.workforceRecommendations).toBeTruthy();
    expect(k.candidates).toBeTruthy();
    // W002 surfaces still present.
    expect(k.identity).toBeTruthy();
    expect(k.organization).toBeTruthy();
    expect(k.events).toBeTruthy();
    expect(k.evidence).toBeTruthy();
    expect(k.epistemics).toBeTruthy();
    expect(k.inquiry).toBeTruthy();
    expect(k.goals).toBeTruthy();
    expect(k.memory).toBeTruthy();
    expect(k.actions).toBeTruthy();
    expect(k.audit).toBeTruthy();
  });

  it("joins process evidence into workforce recommendations through the kernel", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.processes.registerProcess(s, {
        processId: "proc-1",
        name: "invoice processing",
        steps: [
          { stepId: "intake", name: "Receive", kind: "manual" },
          { stepId: "validate", name: "Validate", kind: "manual" },
        ],
        handoffs: [{ fromStepId: "intake", toStepId: "validate" }],
        provenance: provenance(systemActor("process-mining"), 0),
        now: now(0),
      }),
    );
    const observation = okOf(
      k.processes.recordProcessMetrics(s, {
        observationId: "obs-proc-1",
        processId: "proc-1",
        period: { start: now(1), end: now(2) },
        measurements: [
          { stepId: "validate", manualEffortMs: 9000, utilization: 0.95, errorCount: 3 },
        ],
        provenance: provenance(systemActor("metrics-collector"), 2),
        now: now(2),
      }),
    );
    const analysis = analyzeProcess(okOf(k.processes.getProcess(s, "proc-1")), observation);
    expect(analysis.bottleneckStepId).toBe("validate");
    const recommendation = okOf(
      k.workforceRecommendations.proposeRecommendation(s, {
        recommendationId: "rec-bottleneck",
        adjustment: "agent-complement",
        subject: { kind: "process", id: "proc-1" },
        rationale: `validation is the bottleneck at utilization ${analysis.bottleneckUtilization}`,
        evidenceRefs: [{ kind: "process", id: "proc-1" }],
        employmentImpacting: false,
        proposedBy: systemActor("org-lab"),
        provenance: provenance(systemActor("org-lab"), 3),
        now: now(3),
      }),
    );
    expect(recommendation.decision.state).toBe("pending");
    expect(EMPLOYMENT_IMPACTING_ADJUSTMENTS).toEqual([
      "reassignment",
      "hiring",
      "agent-replacement",
      "outsourcing",
    ]);
    expect(WORKFORCE_ADJUSTMENTS).toHaveLength(7);
  });
});
