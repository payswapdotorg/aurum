/**
 * Scoring weights, context modifiers and the evaluation harness unit proofs:
 * weight vectors sum to 1 and are deterministic functions of the fingerprint;
 * context modifiers (urgency premium, interpretive discount, drift discount)
 * apply exactly where documented; scoring and ranking are deterministic with
 * a stable tiebreak; occupancy realism penalizes ModelOccupancy violations.
 */
import { describe, expect, it } from "vitest";
import {
  tenantScope,
  type CandidateActor,
  type DomainTimestamp,
  type ModelOccupancy,
  type OrganizationCandidate,
} from "@aurum/domain";
import {
  contextFingerprint,
  occupancyRealismOf,
  rankCandidates,
  scoreCandidate,
  weightsForFingerprint,
  contextModifiersForFingerprint,
  type ContextFingerprint,
  type FingerprintInput,
} from "../src/index.js";
import { errOf, okOf, provenance, systemActor } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

function fingerprintOf(overrides: Partial<FingerprintInput>): ContextFingerprint {
  return okOf(
    contextFingerprint({
      goalPriority: "medium",
      horizon: { start: T0, end: T0 + 45 * DAY },
      openUnknowns: 0,
      openContradictions: 0,
      evidenceFreshness: ["current"],
      capabilityDemand: [{ capabilityId: "cap-a", requiredLevel: 4 }],
      ...overrides,
    }),
  );
}

function candidateOf(
  candidateId: string,
  actors: CandidateActor[],
  allocations: OrganizationCandidate["capabilityAllocations"],
  assignments: OrganizationCandidate["assignments"],
  occupancy: ModelOccupancy[] = [],
): OrganizationCandidate {
  const scope = tenantScope("t");
  if (!scope.ok) throw new Error("test setup: invalid tenant");
  return {
    scope: scope.value,
    candidateId: candidateId as OrganizationCandidate["candidateId"],
    contextFingerprint: "deadbeefdeadbeef",
    actors,
    assignments,
    capabilityAllocations: allocations,
    topology: {
      execution: {
        steps: [{ stepId: "step:cap-a", name: "Deliver", automated: false }],
        edges: [],
      },
      information: {
        flows: [
          {
            flowId: "flow:cap-a",
            knowledge: "cap-a status",
            recipientActorIds: [actors[0]?.actorId ?? "actor:x"],
            minimalContext: true,
            reviewRequired: false,
          },
        ],
      },
    },
    modelOccupancy: occupancy,
    environment: [],
    expectedOutcome: { target: 1, confidence: 0.5 },
    risks: [],
    evidenceRefs: [{ kind: "goal", id: "goal-1" }],
    proposedBy: systemActor("test"),
    proposedAt: T0 as OrganizationCandidate["proposedAt"],
    provenance: provenance(systemActor("test")),
  };
}

describe("context-conditioned weights and modifiers", () => {
  it("weight vectors always sum to exactly 1 and are deterministic", () => {
    const fingerprints = [
      fingerprintOf({}),
      fingerprintOf({ goalPriority: "critical" }),
      fingerprintOf({ openUnknowns: 3 }),
      fingerprintOf({ goalPriority: "low", horizon: { start: T0, end: T0 + 400 * DAY } }),
      fingerprintOf({ goalPriority: "low" }),
    ];
    for (const fingerprint of fingerprints) {
      const weights = weightsForFingerprint(fingerprint);
      const sum =
        weights.coverageFit +
        weights.capacityHeadroom +
        weights.costProxy +
        weights.occupancyRealism;
      expect(sum).toBe(1);
      expect(weightsForFingerprint(fingerprint)).toEqual(weights);
      expect(weights.derivation.length).toBeGreaterThan(0);
    }
  });

  it("urgent pressure selects the urgency table (coverage first, cost deprioritized)", () => {
    const urgent = weightsForFingerprint(fingerprintOf({ goalPriority: "critical" }));
    const standard = weightsForFingerprint(fingerprintOf({}));
    expect(urgent.coverageFit).toBeGreaterThan(standard.coverageFit);
    expect(urgent.costProxy).toBeLessThan(standard.costProxy);
  });

  it("open uncertainty raises capacity headroom weight (slack for surprises)", () => {
    const open = weightsForFingerprint(fingerprintOf({ openUnknowns: 3 }));
    const known = weightsForFingerprint(fingerprintOf({}));
    expect(open.capacityHeadroom).toBeGreaterThan(known.capacityHeadroom);
  });

  it("modifiers: urgent -> human cost premium x3; open/stale -> level discounts on automation", () => {
    const urgent = contextModifiersForFingerprint(fingerprintOf({ goalPriority: "critical" }));
    expect(urgent.urgencyPremium).toBe(3);
    expect(urgent.interpretiveDiscount).toBe(0);

    const open = contextModifiersForFingerprint(fingerprintOf({ openUnknowns: 3 }));
    expect(open.interpretiveDiscount).toBe(1);
    expect(open.urgencyPremium).toBe(1);

    const stale = contextModifiersForFingerprint(fingerprintOf({ evidenceFreshness: ["stale"] }));
    expect(stale.driftDiscount).toBe(1);

    const clean = contextModifiersForFingerprint(fingerprintOf({}));
    expect(clean.urgencyPremium).toBe(1);
    expect(clean.interpretiveDiscount).toBe(0);
    expect(clean.driftDiscount).toBe(0);
  });
});

describe("evaluation harness", () => {
  const actorIds = ["actor:agent-1", "actor:agent-2"] as const;

  function scoredCandidate(id: string, level: number, effort = 0.5) {
    return candidateOf(
      id,
      actorIds.map((actorId) => ({ actorId, kind: "agent" as const, agentBodyRef: "body" })),
      [
        {
          allocationId: "alloc-0",
          capabilityId:
            "cap-a" as OrganizationCandidate["capabilityAllocations"][number]["capabilityId"],
          actorIds: [...actorIds],
          level,
          capacityPerPeriod: 100,
        },
      ],
      actorIds.map((actorId, index) => ({
        assignmentId: `assign-${index}`,
        actorId,
        position: "owner",
        effortShare: effort,
      })),
      actorIds.map((actorId) => ({
        actorId,
        modelBindingRef: `binding:${actorId}`,
        window: { start: T0 as DomainTimestamp, end: (T0 + DAY) as DomainTimestamp },
        exclusive: true,
      })),
    );
  }

  it("scoring is deterministic and criteria are inspectable raw values", () => {
    const fingerprint = fingerprintOf({});
    const candidate = scoredCandidate("c-1", 4);
    const context = {
      demand: fingerprint.axes.capabilityDemandProfile,
      weights: weightsForFingerprint(fingerprint),
      modifiers: contextModifiersForFingerprint(fingerprint),
      referenceBudget: 500,
    };
    const first = scoreCandidate(candidate, context);
    const second = scoreCandidate(candidate, context);
    expect(first).toEqual(second);
    for (const value of Object.values(first.criteria)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(first.weightedScore).toBeGreaterThan(0);
  });

  it("interpretive discount drops effective coverage of agent-only allocations", () => {
    const known = fingerprintOf({});
    const open = fingerprintOf({ openUnknowns: 3 });
    const candidate = scoredCandidate("c-1", 4);
    const scoreKnown = scoreCandidate(candidate, {
      demand: known.axes.capabilityDemandProfile,
      weights: weightsForFingerprint(known),
      modifiers: contextModifiersForFingerprint(known),
      referenceBudget: 500,
    });
    const scoreOpen = scoreCandidate(candidate, {
      demand: open.axes.capabilityDemandProfile,
      weights: weightsForFingerprint(open),
      modifiers: contextModifiersForFingerprint(open),
      referenceBudget: 500,
    });
    expect(scoreKnown.criteria.coverageFit).toBe(1);
    expect(scoreOpen.criteria.coverageFit).toBe(0);
  });

  it("ranking is deterministic: score desc, then candidate id asc (codepoint)", () => {
    const a = {
      candidate: scoredCandidate("c-a", 4),
      score: {
        criteria: { coverageFit: 1, capacityHeadroom: 1, costProxy: 1, occupancyRealism: 1 },
        weightedScore: 0.5,
      },
    };
    const b = {
      candidate: scoredCandidate("c-b", 4),
      score: {
        criteria: { coverageFit: 1, capacityHeadroom: 1, costProxy: 1, occupancyRealism: 1 },
        weightedScore: 0.9,
      },
    };
    const c = {
      candidate: scoredCandidate("c-c", 4),
      score: {
        criteria: { coverageFit: 1, capacityHeadroom: 1, costProxy: 1, occupancyRealism: 1 },
        weightedScore: 0.9,
      },
    };
    const ranked = rankCandidates([a, b, c]);
    expect(ranked.map((item) => item.candidate.candidateId)).toEqual(["c-b", "c-c", "c-a"]);
    expect(rankCandidates([c, b, a]).map((item) => item.candidate.candidateId)).toEqual([
      "c-b",
      "c-c",
      "c-a",
    ]);
  });

  it("occupancy realism penalizes missing occupancy, overlaps and non-agent occupancy", () => {
    const agents: CandidateActor[] = [
      { actorId: "actor:agent-1", kind: "agent", agentBodyRef: "b1" },
      { actorId: "actor:agent-2", kind: "agent", agentBodyRef: "b2" },
    ];
    const window = { start: T0 as DomainTimestamp, end: (T0 + DAY) as DomainTimestamp };
    expect(occupancyRealismOf(agents, [])).toBe(0);
    expect(
      occupancyRealismOf(agents, [
        { actorId: "actor:agent-1", modelBindingRef: "m", window, exclusive: true },
        { actorId: "actor:agent-2", modelBindingRef: "m", window, exclusive: true },
      ]),
    ).toBeLessThan(1);
    expect(
      occupancyRealismOf(
        [{ actorId: "actor:human-1", kind: "human", personId: "p" as never }],
        [{ actorId: "actor:human-1", modelBindingRef: "m", window, exclusive: true }],
      ),
    ).toBeLessThan(1);
    expect(
      occupancyRealismOf(agents, [
        { actorId: "actor:agent-1", modelBindingRef: "m1", window, exclusive: true },
        { actorId: "actor:agent-2", modelBindingRef: "m2", window, exclusive: true },
      ]),
    ).toBe(1);
  });

  it("urgency premium raises the human cost proxy (expedite proxy)", () => {
    const humanCandidate = candidateOf(
      "c-human",
      [{ actorId: "actor:p-1", kind: "human", personId: "p-1" as never }],
      [
        {
          allocationId: "alloc-0",
          capabilityId: "cap-a" as never,
          actorIds: ["actor:p-1"],
          level: 4,
          capacityPerPeriod: 50,
        },
      ],
      [{ assignmentId: "assign-0", actorId: "actor:p-1", position: "owner", effortShare: 1 }],
    );
    const calm = fingerprintOf({});
    const urgent = fingerprintOf({ goalPriority: "critical" });
    const scoreCalm = scoreCandidate(humanCandidate, {
      demand: calm.axes.capabilityDemandProfile,
      weights: weightsForFingerprint(calm),
      modifiers: contextModifiersForFingerprint(calm),
      referenceBudget: 1000,
    });
    const scoreUrgent = scoreCandidate(humanCandidate, {
      demand: urgent.axes.capabilityDemandProfile,
      weights: weightsForFingerprint(urgent),
      modifiers: contextModifiersForFingerprint(urgent),
      referenceBudget: 1000,
    });
    expect(scoreUrgent.criteria.costProxy).toBeLessThan(scoreCalm.criteria.costProxy);
  });

  it("fingerprint errors surface typed LabError with issue lists (not bare strings)", () => {
    const error = errOf(
      contextFingerprint({
        goalPriority: "nope",
        horizon: { start: 0, end: 0 },
        openUnknowns: 0,
        openContradictions: 0,
        evidenceFreshness: [],
        capabilityDemand: [],
      }),
    );
    expect(error.name).toBe("LabError");
    expect(error.issues.length).toBeGreaterThan(1);
  });
});
