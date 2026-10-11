/**
 * W008 ACCEPTANCE PROOFS (catalog clauses, end-to-end through the public
 * contract and the composed domain kernel):
 *
 * 1. same subject can yield different organizations under different context
 *    (THE CONTEXTUAL RULE — an uncertainty shift moves the best organization
 *    from an automated (agent/software) org to a human-heavy org);
 * 2. humans + agents + software are jointly considered (the result set for
 *    one subject contains human, agent and software candidates; the pool
 *    summary shows the mixed pool per capability);
 * 3. optimization constraints are inspectable (carried on every result);
 * 4. Lab cannot execute (tripwire — see contract-hygiene.test.ts).
 *
 * Tenant isolation through the domain seams' scoping is proven here too.
 */
import { describe, expect, it } from "vitest";
import {
  errOf,
  lab,
  now,
  okOf,
  personActor,
  provenance,
  raiseUnknowns,
  reviseGoalPriority,
  scope,
  seedDemandOnly,
  seedGoal,
  seedMixedPool,
} from "./helpers.js";

function searchInput(fingerprint: { digest: string }, atSeconds = 10) {
  return {
    goalId: "goal-1",
    fingerprint: fingerprint as never,
    proposedBy: personActor("boss"),
    provenance: provenance(personActor("boss"), 10),
    now: now(atSeconds),
  };
}

describe("W008 acceptance", () => {
  it("THE CONTEXTUAL RULE: an uncertainty shift flips the best organization (automated -> human-heavy)", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);

    // Context A: known uncertainty, fresh evidence.
    const fpA = okOf(service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }));
    expect(fpA.fingerprint.axes.uncertaintyClass).toBe("known");
    const resultA = okOf(service.searchOrganizations(s, searchInput(fpA.fingerprint)));
    const bestA = resultA.ranked[0];
    expect(bestA).toBeDefined();

    // Context B: same subject, same pool, same constraints — only the
    // epistemic context changed (three open unknowns against the goal).
    raiseUnknowns(kernel, s, "goal-1", 3);
    const fpB = okOf(service.fingerprintSituation(s, { goalId: "goal-1", now: now(30) }));
    expect(fpB.fingerprint.digest).not.toBe(fpA.fingerprint.digest);
    const resultB = okOf(service.searchOrganizations(s, searchInput(fpB.fingerprint)));
    const bestB = resultB.ranked[0];
    expect(bestB).toBeDefined();

    // Clause 1: different best organizations.
    expect(bestB?.candidate.candidateId).not.toBe(bestA?.candidate.candidateId);

    // Under known uncertainty the winner is automated (agent and/or software
    // actors only): agents cover the demand and are the cheap option.
    const kindsA = new Set(bestA?.candidate.actors.map((actor) => actor.kind));
    expect(kindsA.has("human")).toBe(false);
    expect(kindsA.has("agent") || kindsA.has("software") || kindsA.has("supplier")).toBe(true);

    // Under open uncertainty the winner is human-heavy: the interpretive
    // discount drops agent/software allocation levels below the demand.
    const kindsB = new Set(bestB?.candidate.actors.map((actor) => actor.kind));
    expect(kindsB.has("human")).toBe(true);
    expect(bestB?.candidate.actors.length).toBeGreaterThan(0);
    // The automation-heavy organizations lose coverage under context B:
    const agentLedB = resultB.ranked.find((entry) => entry.strategy === "agent-led");
    const agentLedA = resultA.ranked.find((entry) => entry.strategy === "agent-led");
    expect(agentLedB?.score.criteria.coverageFit).toBeLessThan(
      agentLedA?.score.criteria.coverageFit ?? 1,
    );
  });

  it("CONTEXTUAL RULE (second axis): stale evidence (drift discount) also flips the optimum to humans", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s, 10);

    // Fresh: supplies' evidence is current.
    const fresh = okOf(service.fingerprintSituation(s, { goalId: "goal-1", now: now(11) }));
    expect(fresh.fingerprint.axes.freshnessSignal).toBe("current");
    const bestFresh = okOf(service.searchOrganizations(s, searchInput(fresh.fingerprint, 11)))
      .ranked[0];

    // Forty days later the same supplies' evidence has aged past stale —
    // same subject, same pool, only the freshness context moved. (Forty, not
    // sixty: the search window must stay inside the goal's horizon.)
    const staleAt = 40 * 24 * 60 * 60;
    const stale = okOf(service.fingerprintSituation(s, { goalId: "goal-1", now: now(staleAt) }));
    expect(stale.fingerprint.axes.freshnessSignal).toBe("stale");
    const bestStale = okOf(service.searchOrganizations(s, searchInput(stale.fingerprint, staleAt)))
      .ranked[0];

    expect(bestStale?.candidate.candidateId).not.toBe(bestFresh?.candidate.candidateId);
    expect(new Set(bestFresh?.candidate.actors.map((actor) => actor.kind)).has("human")).toBe(
      false,
    );
    expect(new Set(bestStale?.candidate.actors.map((actor) => actor.kind)).has("human")).toBe(true);
  });

  it("CONTEXTUAL RULE (catalog example axis): rising urgency flips the optimum from human-heavy to automated", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    // Lightly loaded, high-capacity humans: cheap and relaxed in a calm
    // context — but the x3 expedite premium prices them out under urgency.
    seedGoal(kernel, s);
    seedMixedPool(kernel, s, 10, { design: 375, review: 250 });

    // Context A (calm, standard pressure): the human-heavy org is the optimum.
    const calm = okOf(service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }));
    expect(calm.fingerprint.axes.goalPressure).toBe("standard");
    expect(calm.goalRevision).toBe(1);
    const bestCalm = okOf(service.searchOrganizations(s, searchInput(calm.fingerprint))).ranked[0];
    expect(new Set(bestCalm?.candidate.actors.map((actor) => actor.kind)).has("human")).toBe(true);

    // The SAME subject's priority is revised to critical — same pool, same
    // constraints, only the goal-pressure context moved.
    reviseGoalPriority(kernel, s, "goal-1", "critical", 25);
    const urgent = okOf(service.fingerprintSituation(s, { goalId: "goal-1", now: now(30) }));
    expect(urgent.goalRevision).toBe(2);
    expect(urgent.fingerprint.axes.goalPressure).toBe("urgent");
    expect(urgent.fingerprint.digest).not.toBe(calm.fingerprint.digest);
    const bestUrgent = okOf(service.searchOrganizations(s, searchInput(urgent.fingerprint, 30)))
      .ranked[0];

    // Clause 1 (catalog example direction): different best organizations —
    // the expedite premium flips the optimum from human-heavy to automated.
    expect(bestUrgent?.candidate.candidateId).not.toBe(bestCalm?.candidate.candidateId);
    const urgentKinds = new Set(bestUrgent?.candidate.actors.map((actor) => actor.kind));
    expect(urgentKinds.has("human")).toBe(false);
    expect(urgentKinds.has("agent") || urgentKinds.has("software")).toBe(true);
    // The urgency premium is visible in the recorded evidence: the calm
    // winner's cost proxy collapses under the urgent context.
    const calmWinnerUnderUrgency = okOf(
      service.searchOrganizations(s, searchInput(urgent.fingerprint, 30)),
    ).ranked.find((entry) => entry.strategy === bestCalm?.strategy);
    expect(calmWinnerUnderUrgency?.score.criteria.costProxy ?? 0).toBeLessThan(
      bestCalm?.score.criteria.costProxy ?? 1,
    );
  });

  it("MIXED POOL: humans + agents + software are jointly considered for the same subject", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprint = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    ).fingerprint;
    const result = okOf(service.searchOrganizations(s, searchInput(fingerprint)));

    // The pool summary shows the joint pool per capability.
    const design = result.poolSummary.find((entry) => entry.capabilityId === "cap-design");
    expect(design?.supplierKinds).toEqual(["employee", "agent", "supplier"]);
    expect(design?.eligibleSupplyCount).toBe(3);
    const review = result.poolSummary.find((entry) => entry.capabilityId === "cap-review");
    expect(review?.supplierKinds).toEqual(["employee", "agent", "software"]);

    // The ranked result set contains human-only, agent-only and software-
    // containing candidates for the SAME subject.
    const kindSets = result.ranked.map(
      (entry) => new Set(entry.candidate.actors.map((actor) => actor.kind)),
    );
    expect(kindSets.some((kinds) => kinds.has("human") && kinds.size === 1)).toBe(true);
    expect(kindSets.some((kinds) => kinds.has("agent") && !kinds.has("human"))).toBe(true);
    expect(kindSets.some((kinds) => kinds.has("software"))).toBe(true);
    expect(result.ranked.length).toBeGreaterThanOrEqual(4);
  });

  it("MIXED POOL: a single best organization can blend humans with automated actors", () => {
    const { kernel, service } = lab();
    const s = scope("acme");
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprint = okOf(
      service.fingerprintSituation(s, { goalId: "goal-1", now: now(20) }),
    ).fingerprint;
    // A staffing ceiling of one forces every human-led blueprint to blend
    // the one human with automated actors (mixed organization by design).
    const result = okOf(
      service.searchOrganizations(s, {
        ...searchInput(fingerprint),
        constraints: { staffing: { maxHeadcount: 1 } },
      }),
    );
    const humanLed = result.ranked.find((entry) => entry.strategy === "human-led");
    const kinds = new Set(humanLed?.candidate.actors.map((actor) => actor.kind));
    expect(kinds.has("human")).toBe(true);
    expect(kinds.has("agent") || kinds.has("software") || kinds.has("supplier")).toBe(true);
    // The blended org carries a binding constraint explaining the blend.
    expect(
      humanLed?.bindingConstraints.some((binding) => binding.kind === "staffing.maxHeadcount"),
    ).toBe(true);
  });

  it("TENANT ISOLATION: tenant B's lab cannot see tenant A's pool, subjects or evaluations", () => {
    const { kernel, service } = lab();
    const acme = scope("acme");
    const beta = scope("beta");
    seedGoal(kernel, acme);
    seedMixedPool(kernel, acme);
    // Beta has its own goal and its OWN demand — but an empty supply pool.
    seedGoal(kernel, beta);
    seedDemandOnly(kernel, beta, "cap-beta-only");

    const fingerprintBeta = okOf(
      service.fingerprintSituation(beta, { goalId: "goal-1", now: now(20) }),
    );
    // Beta's demand is its own requirement; Acme's cap-design/cap-review
    // requirements are invisible across the tenant seam.
    expect(
      fingerprintBeta.fingerprint.axes.capabilityDemandProfile.map((entry) => entry.capabilityId),
    ).toEqual(["cap-beta-only"]);

    const acmeFingerprint = okOf(
      service.fingerprintSituation(acme, { goalId: "goal-1", now: now(20) }),
    );
    const acmeResult = okOf(
      service.searchOrganizations(acme, searchInput(acmeFingerprint.fingerprint)),
    );
    expect(acmeResult.ranked.length).toBeGreaterThan(0);

    const betaResult = okOf(
      service.searchOrganizations(beta, {
        ...searchInput(fingerprintBeta.fingerprint),
        strategies: ["human-led", "agent-led"],
      }),
    );
    expect(betaResult.ranked).toEqual([]);
    expect(
      betaResult.excluded.every((entry) => entry.reason.includes("no eligible supplies")),
    ).toBe(true);

    // Beta cannot read Acme's evaluation records: its list holds only its own
    // (empty-ranked) search evaluation, never Acme's.
    const betaEvaluations = service.listEvaluations(beta);
    expect(betaEvaluations.length).toBe(1);
    expect(betaEvaluations.every((record) => record.scope.tenantId === "beta")).toBe(true);
    const acmeEvalId = service.listEvaluations(acme)[0]?.evaluationId ?? "";
    expect(errOf(service.getEvaluation(beta, acmeEvalId)).code).toBe("lab-not-found");
  });

  it("CONSTRAINT INSPECTABILITY: results carry the exact constraint set applied", () => {
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
        constraints: {
          budget: { maxCost: 1000, currency: "credits" },
          quality: { minLevel: 3 },
          staffing: { minHeadcount: 2 },
        },
      }),
    );
    expect(result.constraints.budget).toEqual({ maxCost: 1000, currency: "credits" });
    expect(result.constraints.quality).toEqual({ minLevel: 3 });
    expect(result.constraints.staffing).toEqual({ minHeadcount: 2 });
    // Candidates embed the same constraints (self-describing values).
    for (const entry of result.ranked) {
      expect(entry.candidate.constraints?.budget?.maxCost).toBe(1000);
    }
    // The human-led org sits at the staffing floor -> binding constraint.
    const humanLed = result.ranked.find((entry) => entry.strategy === "human-led");
    expect(
      humanLed?.bindingConstraints.some((binding) => binding.kind === "staffing.minHeadcount"),
    ).toBe(true);
  });
});
