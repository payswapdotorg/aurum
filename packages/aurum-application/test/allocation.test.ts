/**
 * Constrained allocation unit proofs: the W005 validators are the acceptance
 * gate — invalid directives are refused with typed errors carrying the
 * verbatim issue lists; lab-side capacity discipline (per-actor effort and
 * assignment limits) refuses over-committed syntheses; valid syntheses
 * produce frozen, W005-valid assignment/allocation sets.
 */
import { describe, expect, it } from "vitest";
import {
  actorAssignmentIssues,
  capabilityAllocationIssues,
  tenantScope,
  type ActorAssignment,
  type CapabilityAllocation,
  type OrganizationCandidate,
} from "@aurum/domain";
import { synthesizeAllocation } from "../src/index.js";
import { errOf, okOf, provenance, systemActor } from "./helpers.js";

const T0 = 1_700_000_000_000;

function gateCandidate(): OrganizationCandidate {
  const scope = tenantScope("acme");
  if (!scope.ok) throw new Error("test setup: invalid tenant");
  return {
    scope: scope.value,
    candidateId: "c-gate" as OrganizationCandidate["candidateId"],
    actors: [
      { actorId: "actor:a", kind: "human", personId: "p-1" as never },
      { actorId: "actor:b", kind: "agent", agentBodyRef: "body-1" },
    ],
    assignments: [],
    capabilityAllocations: [],
    topology: {
      execution: {
        steps: [
          { stepId: "step:cap-a", name: "Deliver cap-a", actorId: "actor:a", automated: false },
        ],
        edges: [],
      },
      information: {
        flows: [
          {
            flowId: "flow:cap-a",
            knowledge: "cap-a status",
            recipientActorIds: ["actor:a"],
            minimalContext: true,
            reviewRequired: false,
          },
        ],
      },
    },
    modelOccupancy: [],
    environment: [],
    expectedOutcome: { target: 1, confidence: 0.5 },
    risks: [],
    evidenceRefs: [{ kind: "goal", id: "goal-1" }],
    proposedBy: systemActor("test"),
    proposedAt: T0 as OrganizationCandidate["proposedAt"],
    provenance: provenance(systemActor("test")),
  };
}

const validDirectives = {
  assignments: [
    { actorId: "actor:a", position: "owner:cap-a", stepRefs: ["step:cap-a"], effortShare: 0.6 },
  ],
  allocations: [{ capabilityId: "cap-a", actorIds: ["actor:a"], level: 4, capacityPerPeriod: 50 }],
};

describe("constrained allocation gate", () => {
  it("accepts valid directives and returns frozen W005-valid sets", () => {
    const result = okOf(synthesizeAllocation(gateCandidate(), validDirectives));
    expect(result.assignments).toHaveLength(1);
    expect(result.allocations).toHaveLength(1);
    expect(Object.isFrozen(result.assignments)).toBe(true);
    expect(Object.isFrozen(result.allocations)).toBe(true);
    const actorIds = new Set(["actor:a", "actor:b"]);
    const stepIds = new Set(["step:cap-a"]);
    for (const assignment of result.assignments as readonly ActorAssignment[]) {
      expect(actorAssignmentIssues(assignment, actorIds, stepIds)).toEqual([]);
    }
    for (const allocation of result.allocations as readonly CapabilityAllocation[]) {
      expect(capabilityAllocationIssues(allocation, actorIds)).toEqual([]);
    }
    expect(result.committedEffort.get("actor:a")).toBe(0.6);
  });

  it("refuses dangling actor references with the verbatim W005 issue", () => {
    const error = errOf(
      synthesizeAllocation(gateCandidate(), {
        ...validDirectives,
        assignments: [{ actorId: "actor:ghost", position: "owner", effortShare: 1 }],
      }),
    );
    expect(error.name).toBe("LabError");
    expect(error.code).toBe("lab-allocation-refused");
    expect(
      error.issues.some((issue) => issue.problem.includes("must reference a declared actor")),
    ).toBe(true);
  });

  it("refuses invalid effort shares with the W005 issue text", () => {
    const error = errOf(
      synthesizeAllocation(gateCandidate(), {
        ...validDirectives,
        assignments: [{ actorId: "actor:a", position: "owner", effortShare: 1.5 }],
      }),
    );
    expect(error.code).toBe("lab-allocation-refused");
    expect(error.issues.some((issue) => issue.problem.includes("fraction in (0, 1]"))).toBe(true);
  });

  it("refuses allocations with empty actor lists or out-of-range levels", () => {
    const emptyActors = errOf(
      synthesizeAllocation(gateCandidate(), {
        ...validDirectives,
        allocations: [{ capabilityId: "cap-a", actorIds: [], level: 4, capacityPerPeriod: 10 }],
      }),
    );
    expect(emptyActors.code).toBe("lab-allocation-refused");
    expect(emptyActors.issues.some((issue) => issue.problem.includes("non-empty array"))).toBe(
      true,
    );

    const badLevel = errOf(
      synthesizeAllocation(gateCandidate(), {
        ...validDirectives,
        allocations: [
          { capabilityId: "cap-a", actorIds: ["actor:a"], level: 9, capacityPerPeriod: 10 },
        ],
      }),
    );
    expect(badLevel.issues.some((issue) => issue.problem.includes("integer level in 1..5"))).toBe(
      true,
    );
  });

  it("refuses dangling step references in assignments", () => {
    const error = errOf(
      synthesizeAllocation(gateCandidate(), {
        ...validDirectives,
        assignments: [
          { actorId: "actor:a", position: "owner", stepRefs: ["step:nowhere"], effortShare: 1 },
        ],
      }),
    );
    expect(error.code).toBe("lab-allocation-refused");
    expect(
      error.issues.some((issue) =>
        issue.problem.includes("must reference a declared execution step"),
      ),
    ).toBe(true);
  });

  it("refuses over-committed actors (lab capacity discipline beyond W005 shape checks)", () => {
    const error = errOf(
      synthesizeAllocation(gateCandidate(), {
        assignments: [
          { actorId: "actor:a", position: "owner:cap-a", effortShare: 0.6 },
          { actorId: "actor:a", position: "owner:cap-b", effortShare: 0.6 },
        ],
        allocations: [
          { capabilityId: "cap-a", actorIds: ["actor:a"], level: 4, capacityPerPeriod: 50 },
          { capabilityId: "cap-b", actorIds: ["actor:a"], level: 4, capacityPerPeriod: 50 },
        ],
      }),
    );
    expect(error.code).toBe("lab-allocation-refused");
    expect(error.issues.some((issue) => issue.problem.includes("exceeds the limit"))).toBe(true);
  });

  it("refuses assignments exceeding the per-actor assignment limit", () => {
    const error = errOf(
      synthesizeAllocation(
        gateCandidate(),
        {
          assignments: [
            { actorId: "actor:a", position: "p1", effortShare: 0.1 },
            { actorId: "actor:a", position: "p2", effortShare: 0.1 },
          ],
          allocations: [
            { capabilityId: "cap-a", actorIds: ["actor:a"], level: 4, capacityPerPeriod: 50 },
          ],
        },
        { maxAssignmentsPerActor: 1, maxActorsPerAllocation: 3, maxTotalEffortPerActor: 1 },
      ),
    );
    expect(error.code).toBe("lab-allocation-refused");
    expect(error.issues.some((issue) => issue.problem.includes("assignments (limit 1)"))).toBe(
      true,
    );
  });

  it("refuses structurally missing directives with validation errors", () => {
    const empty = errOf(
      synthesizeAllocation(gateCandidate(), { assignments: [], allocations: [] }),
    );
    expect(empty.code).toBe("lab-validation");
    expect(empty.issues.length).toBe(2);
  });
});
