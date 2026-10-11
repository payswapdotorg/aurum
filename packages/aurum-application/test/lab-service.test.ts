/**
 * Lab service proofs (service level, through the public contract):
 * search determinism, W005-validity of every produced candidate (usable
 * downstream), constraint inspectability (binding constraints + echoed set),
 * evaluation records carrying the P003 join keys, evaluation-store scoping,
 * standalone evaluation of external candidates, and input validation.
 */
import { describe, expect, it } from "vitest";
import {
  organizationCandidateIssues,
  type OrganizationCandidate,
  type ProvenanceRecord,
} from "@aurum/domain";
import {
  errOf,
  lab,
  now,
  okOf,
  personActor,
  provenance,
  raiseUnknowns,
  scope,
  seedGoal,
  seedMixedPool,
  systemActor,
} from "./helpers.js";

function searchInput(fingerprint: { digest: string }) {
  return {
    goalId: "goal-1",
    fingerprint: fingerprint as never,
    proposedBy: personActor("boss"),
    provenance: provenance(personActor("boss"), 10),
    now: now(10),
  };
}

describe("lab service: search, constraints, evaluations", () => {
  it("fingerprintSituation derives the axes from the domain seams (traceable)", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const { fingerprint, goalRevision } = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    );
    expect(goalRevision).toBe(1);
    expect(fingerprint.axes.goalPressure).toBe("standard");
    expect(fingerprint.axes.timeHorizon).toBe("medium");
    expect(fingerprint.axes.uncertaintyClass).toBe("known");
    expect(fingerprint.axes.freshnessSignal).toBe("current");
    expect(fingerprint.axes.capabilityDemandProfile.map((entry) => entry.capabilityId)).toEqual([
      "cap-design",
      "cap-review",
    ]);
  });

  it("fingerprintSituation reflects epistemic change (unknowns raise uncertainty)", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const before = okOf(service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }));
    raiseUnknowns(kernel, s, "goal-1", 3);
    const after = okOf(service.fingerprintSituation(s, { goalId: "goal-1", now: now(30) }));
    expect(before.fingerprint.axes.uncertaintyClass).toBe("known");
    expect(after.fingerprint.axes.uncertaintyClass).toBe("open");
    expect(after.fingerprint.digest).not.toBe(before.fingerprint.digest);
  });

  it("search is deterministic: identical inputs produce identical ranked results", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprint = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    ).fingerprint;
    const first = okOf(service.searchOrganizations(s, searchInput(fingerprint)));
    const second = okOf(service.searchOrganizations(s, searchInput(fingerprint)));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.ranked.map((entry) => entry.candidate.candidateId)).toEqual(
      second.ranked.map((entry) => entry.candidate.candidateId),
    );
  });

  it("every ranked candidate passes the W005 deep validator (usable downstream)", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprint = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    ).fingerprint;
    const result = okOf(service.searchOrganizations(s, searchInput(fingerprint)));
    expect(result.ranked.length).toBeGreaterThan(0);
    for (const entry of result.ranked) {
      expect(
        organizationCandidateIssues(entry.candidate as unknown as OrganizationCandidate),
      ).toEqual([]);
      expect(entry.candidate.contextFingerprint).toBe(fingerprint.digest);
      expect(entry.candidate.goalId).toBe("goal-1");
    }
  });

  it("a produced candidate registers into the W005 candidate registry unchanged", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprint = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    ).fingerprint;
    const result = okOf(service.searchOrganizations(s, searchInput(fingerprint)));
    const best = result.ranked[0]?.candidate;
    expect(best).toBeDefined();
    const registered = okOf(
      kernel.candidates.registerCandidate(s, {
        candidateId: best.candidateId,
        goalId: "goal-1",
        contextFingerprint: best.contextFingerprint,
        constraints: best.constraints,
        actors: best.actors.map((actor) => ({
          actorId: actor.actorId,
          kind: actor.kind,
          ...(actor.personId ? { personId: actor.personId } : {}),
          ...(actor.unitId ? { unitId: actor.unitId } : {}),
          ...(actor.agentBodyRef ? { agentBodyRef: actor.agentBodyRef } : {}),
          ...(actor.externalRef ? { externalRef: actor.externalRef } : {}),
          ...(actor.displayName ? { displayName: actor.displayName } : {}),
        })),
        assignments: best.assignments.map((assignment) => ({
          assignmentId: assignment.assignmentId,
          actorId: assignment.actorId,
          position: assignment.position,
          ...(assignment.stepRefs ? { stepRefs: [...assignment.stepRefs] } : {}),
          effortShare: assignment.effortShare,
          ...(assignment.period ? { period: assignment.period } : {}),
        })),
        capabilityAllocations: best.capabilityAllocations.map((allocation) => ({
          allocationId: allocation.allocationId,
          capabilityId: allocation.capabilityId,
          ...(allocation.requirementRef ? { requirementRef: allocation.requirementRef } : {}),
          actorIds: [...allocation.actorIds],
          level: allocation.level,
          capacityPerPeriod: allocation.capacityPerPeriod,
          ...(allocation.workloadShare !== undefined
            ? { workloadShare: allocation.workloadShare }
            : {}),
        })),
        topology: best.topology,
        modelOccupancy: [...best.modelOccupancy],
        environment: [...best.environment],
        budget: best.budget,
        expectedOutcome: {
          ...(best.expectedOutcome.goalId ? { goalId: best.expectedOutcome.goalId } : {}),
          ...(best.expectedOutcome.metric ? { metric: best.expectedOutcome.metric } : {}),
          target: best.expectedOutcome.target,
          confidence: best.expectedOutcome.confidence,
        },
        risks: [...best.risks],
        evidenceRefs: [...best.evidenceRefs],
        proposedBy: best.proposedBy,
        provenance: best.provenance,
        now: now(21),
      }),
    );
    expect(registered.candidateId).toBe(best.candidateId);
  });

  it("constraints are inspectable: the applied set is echoed; a tight headcount ceiling binds", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprint = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    ).fingerprint;
    const result = okOf(
      service.searchOrganizations(s, {
        ...searchInput(fingerprint),
        constraints: { staffing: { maxHeadcount: 1 } },
      }),
    );
    expect(result.constraints.staffing).toEqual({ maxHeadcount: 1 });
    const humanLed = result.ranked.find((entry) => entry.strategy === "human-led");
    expect(humanLed).toBeDefined();
    expect(
      humanLed?.bindingConstraints.some((binding) => binding.kind === "staffing.maxHeadcount"),
    ).toBe(true);
    // With the ceiling at 1, the human-led org cannot be purely human:
    const kinds = new Set(humanLed?.candidate.actors.map((actor) => actor.kind));
    expect(kinds.has("human")).toBe(true);
    expect(kinds.size).toBeGreaterThan(1);
  });

  it("every result records weights, modifiers, ranking rule and fingerprint digest (P003 join keys)", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprint = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    ).fingerprint;
    const result = okOf(service.searchOrganizations(s, searchInput(fingerprint)));
    expect(result.fingerprintDigest).toBe(fingerprint.digest);
    expect(result.fingerprintAxes).toEqual(fingerprint.axes);
    expect(result.weights.derivation.length).toBeGreaterThan(0);
    expect(result.modifiers.derivation.length).toBeGreaterThan(0);
    expect(result.rankingRule).toBe("weighted-score-desc-then-candidate-id-asc");
    expect(result.ranked[0]?.rank).toBe(1);
    const evaluation = service.listEvaluations(s, { fingerprintDigest: fingerprint.digest });
    expect(evaluation.length).toBe(1);
    expect(evaluation[0]?.constraintSet).toEqual(result.constraints);
    expect(evaluation[0]?.weights).toEqual(result.weights);
    expect(evaluation[0]?.rankingRule).toBe(result.rankingRule);
  });

  it("evaluation records are retrievable and scoped by tenant (uniform not-found)", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    const other = scope("beta");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprint = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    ).fingerprint;
    okOf(service.searchOrganizations(s, searchInput(fingerprint)));
    const mine = service.listEvaluations(s);
    expect(mine.length).toBe(1);
    const evaluationId = mine[0]?.evaluationId ?? "";
    expect(service.listEvaluations(other)).toEqual([]);
    const foreign = errOf(service.getEvaluation(other, evaluationId));
    expect(foreign.code).toBe("lab-not-found");
    expect(okOf(service.getEvaluation(s, evaluationId)).evaluationId).toBe(evaluationId);
  });

  it("evaluateOrganizations ranks externally-provided candidates deterministically", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprint = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    ).fingerprint;
    const searchResult = okOf(service.searchOrganizations(s, searchInput(fingerprint)));
    const candidates = searchResult.ranked.map((entry) => entry.candidate);
    const first = okOf(service.evaluateOrganizations(s, { fingerprint, candidates, now: now(25) }));
    const second = okOf(
      service.evaluateOrganizations(s, { fingerprint, candidates, now: now(25) }),
    );
    expect(first.ranked.map((entry) => entry.candidateId)).toEqual(
      second.ranked.map((entry) => entry.candidateId),
    );
    expect(first.ranked[0]?.weightedScore).toBe(searchResult.ranked[0]?.score.weightedScore);
  });

  it("refuses tampered fingerprints (digest must match the axes)", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprint = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    ).fingerprint;
    const tampered = { ...fingerprint, digest: "0".repeat(16) };
    const error = errOf(service.searchOrganizations(s, searchInput(tampered)));
    expect(error.code).toBe("lab-validation");
    expect(error.issues[0]?.problem).toContain("does not match");
  });

  it("refuses unknown strategies and missing provenance with typed errors", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprint = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    ).fingerprint;
    const badStrategy = errOf(
      service.searchOrganizations(s, { ...searchInput(fingerprint), strategies: ["vibes"] }),
    );
    expect(badStrategy.code).toBe("lab-validation");
    const badProvenance = errOf(
      service.searchOrganizations(s, {
        ...searchInput(fingerprint),
        provenance: {
          actor: systemActor("x"),
          source: "guessed" as ProvenanceRecord["source"],
          recordedAt: now(1),
        },
      }),
    );
    expect(badProvenance.code).toBe("lab-validation");
  });

  it("fingerprintSituation fails closed for foreign/missing subjects (no existence leaks)", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const other = scope("beta");
    const foreign = errOf(service.fingerprintSituation(other, { goalId: "goal-1", now: now(20) }));
    const missing = errOf(service.fingerprintSituation(s, { goalId: "goal-404", now: now(20) }));
    expect(foreign.code).toBe("lab-subject-not-found");
    expect(missing.code).toBe("lab-subject-not-found");
    expect(foreign.message).toBe(missing.message);
  });
});
