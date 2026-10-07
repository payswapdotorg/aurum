/**
 * The frozen shared organizational vocabulary (W005):
 * OrganizationCandidate with mixed human/agent/software/external actors,
 * ActorAssignment, CapabilityAllocation, execution + information topology
 * (delegation/review/escalation/handoffs), model occupancy, environment,
 * budget, expected outcome, risks and mandatory evidence. Deep validation,
 * immutability and tenant isolation.
 */
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_ACTOR_KINDS,
  TOPOLOGY_EDGE_KINDS,
  organizationCandidateIssues,
  type RegisterCandidateInput,
} from "../src/index.js";
import { errOf, kernel, now, okOf, provenance, scope, systemActor } from "./helpers.js";

function candidateInput(overrides: Record<string, unknown> = {}): RegisterCandidateInput {
  return {
    candidateId: "cand-1",
    goalId: "goal-1",
    contextFingerprint: "ctx-7f3a",
    constraints: {
      season: "peak",
      window: { start: now(0), end: now(90 * 24 * 3600) },
      duration: 30 * 24 * 3600 * 1000,
      staffing: { minHeadcount: 2, maxHeadcount: 5 },
      minExperience: 2,
      workload: 120,
      geography: "EU",
      budget: { maxCost: 50000, currency: "EUR" },
      sla: { maxDurationMs: 48 * 3600 * 1000, successRate: 0.95 },
      quality: { minLevel: 3 },
      inspectionIntensity: "medium",
      riskTolerance: "low",
      environmentCapabilities: ["workspace", "browser"],
      evidenceFreshness: { maxAgeMs: 14 * 24 * 3600 * 1000 },
    },
    actors: [
      { actorId: "a-human", kind: "human", personId: "p-1", displayName: "Senior validator" },
      { actorId: "a-agent", kind: "agent", agentBodyRef: "agent-body-17" },
      { actorId: "a-agent-team", kind: "agent-team", agentBodyRef: "agent-team-3" },
      { actorId: "a-software", kind: "software", externalRef: "ocr-svc" },
      { actorId: "a-automation", kind: "automation", externalRef: "flow-bot-1" },
      { actorId: "a-supplier", kind: "supplier", externalRef: "bpo-vendor-2" },
      { actorId: "a-partner", kind: "partner", externalRef: "partner-ops" },
      { actorId: "a-external", kind: "external-service", externalRef: "api-weather" },
      { actorId: "a-team", kind: "team", unitId: "u-finance" },
    ],
    assignments: [
      {
        assignmentId: "asg-validator",
        actorId: "a-human",
        position: "validation lead",
        stepRefs: ["s-intake", "s-approve"],
        effortShare: 0.6,
        period: { start: now(0), end: now(90 * 24 * 3600) },
      },
      {
        assignmentId: "asg-agent",
        actorId: "a-agent",
        position: "first-pass validator",
        stepRefs: ["s-validate"],
        effortShare: 1.0,
      },
    ],
    capabilityAllocations: [
      {
        allocationId: "alloc-validation",
        capabilityId: "cap-1",
        requirementRef: "req-1",
        actorIds: ["a-human", "a-agent"],
        level: 4,
        capacityPerPeriod: 100,
        workloadShare: 0.8,
      },
    ],
    topology: {
      execution: {
        steps: [
          { stepId: "s-intake", name: "Receive", actorId: "a-human", automated: false },
          { stepId: "s-validate", name: "Validate", actorId: "a-agent", automated: true },
          { stepId: "s-approve", name: "Approve", actorId: "a-human", automated: false },
        ],
        edges: [
          {
            kind: "delegation",
            fromActorId: "a-human",
            toActorId: "a-agent",
            onStepRef: "s-validate",
          },
          { kind: "review", fromActorId: "a-human", toActorId: "a-agent" },
          {
            kind: "escalation",
            fromActorId: "a-agent",
            toActorId: "a-human",
            note: "flag anomalies",
          },
          { kind: "handoff", fromActorId: "a-agent", toActorId: "a-human", onStepRef: "s-approve" },
        ],
      },
      information: {
        flows: [
          {
            flowId: "flow-anomalies",
            knowledge: "anomalous invoice patterns",
            sourceActorId: "a-agent",
            ownerActorId: "a-human",
            recipientActorIds: ["a-human", "a-team"],
            freshnessMaxAgeMs: 24 * 3600 * 1000,
            minimalContext: true,
            reviewRequired: true,
            escalationActorId: "a-human",
            handoffOnStepRefs: ["s-approve"],
          },
        ],
      },
    },
    modelOccupancy: [
      {
        actorId: "a-agent",
        modelBindingRef: "binding-gpt-x",
        window: { start: now(0), end: now(90 * 24 * 3600) },
        exclusive: false,
      },
    ],
    environment: [
      { environmentRef: "env-workspace", requiredCapabilities: ["workspace"] },
      { environmentRef: "env-browser" },
    ],
    budget: {
      maxTotalCost: 50000,
      currency: "EUR",
      humanCost: 20000,
      agentCost: 12000,
      softwareCost: 3000,
      externalCost: 5000,
    },
    expectedOutcome: {
      goalId: "goal-1",
      metric: "validation cycle time",
      target: 48 * 3600 * 1000,
      confidence: 0.8,
    },
    risks: [
      {
        kind: "capability",
        description: "agent quality degrades on handwritten invoices",
        severity: "medium",
        mitigation: "route low-confidence to human review",
      },
      { kind: "continuity", description: "single senior validator", severity: "high" },
    ],
    evidenceRefs: [
      { kind: "observation", id: "obs-workload-1" },
      { kind: "claim", id: "claim-cap-demand" },
    ],
    proposedBy: systemActor("org-lab"),
    provenance: provenance(systemActor("org-lab"), 1),
    now: now(1),
    ...overrides,
  } as RegisterCandidateInput;
}

describe("organization candidate vocabulary", () => {
  it("registers a full mixed-organization candidate with every vocabulary element", () => {
    const k = kernel();
    const s = scope("acme");
    const candidate = okOf(k.candidates.registerCandidate(s, candidateInput()));
    expect(candidate.candidateId).toBe("cand-1" as never);
    expect(candidate.actors).toHaveLength(9);
    expect(candidate.actors.map((actor) => actor.kind)).toEqual([
      "human",
      "agent",
      "agent-team",
      "software",
      "automation",
      "supplier",
      "partner",
      "external-service",
      "team",
    ]);
    expect(candidate.assignments[0]?.position).toBe("validation lead");
    expect(candidate.capabilityAllocations[0]?.capabilityId).toBe("cap-1" as never);
    expect(candidate.topology.execution.edges.map((edge) => edge.kind)).toEqual([
      "delegation",
      "review",
      "escalation",
      "handoff",
    ]);
    expect(candidate.topology.information.flows[0]?.minimalContext).toBe(true);
    expect(candidate.modelOccupancy[0]?.modelBindingRef).toBe("binding-gpt-x");
    expect(candidate.environment).toHaveLength(2);
    expect(candidate.budget?.agentCost).toBe(12000);
    expect(candidate.expectedOutcome.target).toBe(48 * 3600 * 1000);
    expect(candidate.risks).toHaveLength(2);
    expect(candidate.evidenceRefs).toHaveLength(2);
    expect(candidate.contextFingerprint).toBe("ctx-7f3a");
    expect(CANDIDATE_ACTOR_KINDS).toHaveLength(9);
    expect(TOPOLOGY_EDGE_KINDS).toEqual(["delegation", "review", "escalation", "handoff"]);
  });

  it("deeply validates cross references: dangling actors, occupancy, evidence", () => {
    const k = kernel();
    const s = scope("acme");
    const danglingAssignment = k.candidates.registerCandidate(
      s,
      candidateInput({
        assignments: [
          { assignmentId: "asg-ghost", actorId: "a-ghost", position: "x", effortShare: 1 },
        ],
      }),
    );
    expect(errOf(danglingAssignment).code).toBe("validation");
    expect(errOf(danglingAssignment).issues.map((i) => i.field)).toContain("assignments.0.actorId");

    const occupancyOnHuman = k.candidates.registerCandidate(
      s,
      candidateInput({
        modelOccupancy: [
          {
            actorId: "a-human",
            modelBindingRef: "binding-x",
            window: { start: now(0), end: now(1) },
            exclusive: true,
          },
        ],
      }),
    );
    expect(errOf(occupancyOnHuman).code).toBe("validation");
    expect(errOf(occupancyOnHuman).issues.map((i) => i.field)).toContain(
      "modelOccupancy.0.actorId",
    );

    const noEvidence = k.candidates.registerCandidate(s, candidateInput({ evidenceRefs: [] }));
    expect(errOf(noEvidence).code).toBe("validation");
    expect(errOf(noEvidence).issues.map((i) => i.field)).toContain("evidenceRefs");

    const badShare = k.candidates.registerCandidate(
      s,
      candidateInput({
        assignments: [
          { assignmentId: "asg-1", actorId: "a-human", position: "x", effortShare: 1.5 },
        ],
      }),
    );
    expect(errOf(badShare).code).toBe("validation");
    expect(errOf(badShare).issues.map((i) => i.field)).toContain("assignments.0.effortShare");

    const selfEdge = k.candidates.registerCandidate(
      s,
      candidateInput({
        topology: {
          execution: {
            steps: [{ stepId: "s1", name: "One", actorId: "a-human", automated: false }],
            edges: [{ kind: "review", fromActorId: "a-human", toActorId: "a-human" }],
          },
          information: {
            flows: [
              {
                flowId: "f1",
                knowledge: "k",
                recipientActorIds: ["a-human"],
                minimalContext: true,
                reviewRequired: false,
              },
            ],
          },
        },
      }),
    );
    expect(errOf(selfEdge).code).toBe("validation");

    const duplicateActors = k.candidates.registerCandidate(
      s,
      candidateInput({
        actors: [
          { actorId: "a-1", kind: "human", personId: "p-1" },
          { actorId: "a-1", kind: "human", personId: "p-2" },
        ],
      }),
    );
    expect(errOf(duplicateActors).code).toBe("validation");
    expect(errOf(duplicateActors).issues.map((i) => i.field)).toContain("actors.1.actorId");
  });

  it("exposes the pure deep validator for external producers (Lab, W008)", () => {
    const input = candidateInput();
    const shape = {
      ...input,
      scope: scope("acme"),
      candidateId: "cand-1" as never,
      actors: input.actors,
      assignments: input.assignments,
      capabilityAllocations: input.capabilityAllocations,
      evidenceRefs: input.evidenceRefs,
      proposedAt: input.now,
    } as never;
    expect(organizationCandidateIssues(shape)).toEqual([]);
    const empty = organizationCandidateIssues(undefined);
    expect(empty).toHaveLength(1);
    expect(empty[0]?.field).toBe("candidate");
  });

  it("rejects invalid risk/outcome/constraint shapes", () => {
    const k = kernel();
    const s = scope("acme");
    const badRisk = k.candidates.registerCandidate(
      s,
      candidateInput({
        risks: [{ kind: "existential", description: "x", severity: "apocalyptic" }],
      }),
    );
    expect(errOf(badRisk).code).toBe("validation");
    expect(errOf(badRisk).issues.map((i) => i.field)).toContain("risks.0.kind");

    const badOutcome = k.candidates.registerCandidate(
      s,
      candidateInput({ expectedOutcome: { target: 10, confidence: 1.5 } }),
    );
    expect(errOf(badOutcome).code).toBe("validation");
    expect(errOf(badOutcome).issues.map((i) => i.field)).toContain("expectedOutcome.confidence");

    const badConstraints = k.candidates.registerCandidate(
      s,
      candidateInput({
        constraints: { riskTolerance: "extreme", staffing: { minHeadcount: 5, maxHeadcount: 2 } },
      }),
    );
    expect(errOf(badConstraints).code).toBe("validation");
    expect(errOf(badConstraints).issues.map((i) => i.field)).toContain("constraints.riskTolerance");
    expect(errOf(badConstraints).issues.map((i) => i.field)).toContain("constraints.staffing");
  });

  it("freezes registered candidates (immutability) and audits registration", () => {
    const k = kernel();
    const s = scope("acme");
    const candidate = okOf(k.candidates.registerCandidate(s, candidateInput()));
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(() => {
      (candidate as unknown as { candidateId: string }).candidateId = "tampered";
    }).toThrow(TypeError);
    const entries = k.audit.queryAudit(s, { subject: { kind: "candidate", id: "cand-1" } });
    expect(entries.map((e) => e.action)).toEqual(["candidate.registered"]);
    expect(entries[0]?.details).toEqual({
      candidateId: "cand-1",
      actorCount: 9,
      assignmentCount: 2,
      allocationCount: 1,
      evidenceCount: 2,
    });
  });

  it("rejects duplicate registration and isolates tenants", () => {
    const k = kernel();
    const acme = scope("acme");
    const other = scope("other");
    okOf(k.candidates.registerCandidate(acme, candidateInput()));
    const duplicate = k.candidates.registerCandidate(acme, candidateInput());
    expect(errOf(duplicate).code).toBe("conflict");
    expect(errOf(k.candidates.getCandidate(other, "cand-1")).code).toBe("not-found");
    expect(errOf(k.candidates.getCandidate(other, "cand-1")).message).toBe(
      errOf(k.candidates.getCandidate(other, "cand-none")).message,
    );
    expect(k.candidates.listCandidates(other)).toHaveLength(0);
    okOf(k.candidates.registerCandidate(other, candidateInput()));
    expect(k.candidates.listCandidates(other)).toHaveLength(1);
  });
});
