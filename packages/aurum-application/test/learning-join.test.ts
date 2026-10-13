/**
 * W013 acceptance proofs — THE JOIN (catalog deliver: "join outcomes to
 * context, organization, actor allocation, model occupancy, information
 * strategy, environment and cost"): every join dimension is carried
 * verbatim from the records that chose and ran the organization, join
 * integrity fails with typed refusals (never silently), outcomes are
 * append-only, and tenant isolation is uniform (foreign-tenant reads are
 * indistinguishable from never-existing).
 */
import { describe, expect, it } from "vitest";
import {
  candidateInputOf,
  conditionalEvidence,
  errOf,
  learningFixture,
  now,
  okOf,
  outcomeInput,
  personActor,
  recordOutcome,
  registerCandidate,
  runSearch,
  scope,
  seedSubject,
  systemActor,
} from "./learning-helpers.js";
import { COST_PROXY_UNITS } from "../src/index.js";

describe("learning: the outcome join (seven dimensions, verbatim)", () => {
  it("joins the outcome to the evaluation CONTEXT verbatim (P003 join keys)", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);

    const record = recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "achieved",
    });

    expect(record.evaluationId).toBe(run.evaluation.evaluationId);
    expect(record.goalId).toBe("goal-1");
    expect(record.fingerprintDigest).toBe(run.evaluation.fingerprintDigest);
    expect(record.fingerprintAxes).toEqual(run.evaluation.fingerprintAxes);
    expect(record.constraintSet).toEqual(run.evaluation.constraintSet);
    expect(record.weights).toEqual(run.evaluation.weights);
    expect(record.modifiers).toEqual(run.evaluation.modifiers);
    expect(record.rankingRule).toBe(run.evaluation.rankingRule);
    const ranked = run.evaluation.ranked.find((e) => e.candidateId === best.candidateId);
    expect(record.rankAtEvaluation).toBe(ranked?.rank);
    expect(record.weightedScoreAtEvaluation).toBe(ranked?.weightedScore);
    expect(record.strategy).toBe(ranked?.strategy);
  });

  it("joins the ORGANIZATION dimension: candidate id, strategy and shape", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);

    const record = recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "achieved",
    });

    expect(record.candidateId).toBe(best.candidateId);
    expect(record.shape.actorMix).toEqual(
      [
        ...best.actors.reduce((counts, actor) => {
          counts.set(actor.kind, (counts.get(actor.kind) ?? 0) + 1);
          return counts;
        }, new Map<string, number>()),
      ].map(([kind, count]) => ({ kind, count })),
    );
    expect(record.shape.informationFlowCount).toBe(best.topology.information.flows.length);
    expect(record.shape.environmentCount).toBe(0);
    expect(record.observation.status).toBe("achieved");
  });

  it("joins the ACTOR ALLOCATION dimension (counts + effort)", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    // Pick the balanced strategy: its candidate mixes humans and agents.
    const entry = run.result.ranked.find((item) => item.strategy === "balanced");
    if (!entry) throw new Error("test setup: no balanced candidate");
    registerCandidate(fx, s, entry.candidate);

    const record = recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: entry.candidate.candidateId,
      status: "achieved",
    });

    const kinds = entry.candidate.actors.map((actor) => actor.kind);
    expect(record.allocation.actorCount).toBe(kinds.length);
    expect(record.allocation.assignmentCount).toBe(entry.candidate.assignments.length);
    expect(record.allocation.capabilityAllocationCount).toBe(
      entry.candidate.capabilityAllocations.length,
    );
    expect(record.allocation.humanLikeActorCount).toBe(
      kinds.filter((kind) => kind === "human" || kind === "team").length,
    );
    expect(record.allocation.totalEffortShare).toBe(
      Math.round(entry.candidate.assignments.reduce((sum, a) => sum + a.effortShare, 0) * 10000) /
        10000,
    );
  });

  it("joins the MODEL OCCUPANCY dimension for agent-bearing candidates", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const agentLed = run.result.ranked.find((r) => r.strategy === "agent-led");
    if (!agentLed) throw new Error("test setup: no agent-led candidate");
    registerCandidate(fx, s, agentLed.candidate);

    const record = recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: agentLed.candidate.candidateId,
      status: "achieved",
    });

    expect(record.occupancy.agentActorCount).toBeGreaterThan(0);
    expect(record.occupancy.entryCount).toBe(agentLed.candidate.modelOccupancy.length);
    expect(record.occupancy.exclusiveEntryCount).toBe(
      agentLed.candidate.modelOccupancy.filter((entry) => entry.exclusive).length,
    );
    expect(record.occupancy.distinctModelBindings).toBe(
      new Set(agentLed.candidate.modelOccupancy.map((entry) => entry.modelBindingRef)).size,
    );
  });

  it("joins the INFORMATION STRATEGY dimension (flows, review, freshness)", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);

    const record = recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "achieved",
    });

    const flows = best.topology.information.flows;
    expect(record.informationStrategy.flowCount).toBe(flows.length);
    expect(record.informationStrategy.reviewRequiredFlows).toBe(
      flows.filter((flow) => flow.reviewRequired).length,
    );
    expect(record.informationStrategy.minimalContextFlows).toBe(
      flows.filter((flow) => flow.minimalContext).length,
    );
    expect(record.informationStrategy.tightestFreshnessRequirementMs).toBe(
      Math.min(...flows.map((flow) => flow.freshnessMaxAgeMs ?? Number.POSITIVE_INFINITY)),
    );
  });

  it("joins the ENVIRONMENT dimension for external candidates with environments", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    // Derive an external candidate WITH environments from the search's best.
    const external = {
      ...best,
      candidateId: "cand-ext-1" as typeof best.candidateId,
      contextFingerprint: undefined,
      environment: Object.freeze([
        { environmentRef: "browser" },
        { environmentRef: "local" },
        { environmentRef: "browser" },
      ]),
    };
    const evaluation = okOf(
      fx.lab.evaluateOrganizations(s, {
        goalId: "goal-1",
        fingerprint: run.fingerprint,
        candidates: [external],
        now: now(25),
      }),
    );
    registerCandidate(fx, s, external);

    const record = recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: evaluation.evaluationId,
      candidateId: "cand-ext-1",
      status: "achieved",
    });

    // Distinct, sorted environment references.
    expect(record.environments).toEqual(["browser", "local"]);
  });

  it("joins the COST dimension (unit-table estimate + ceiling + actual)", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);
    const premium = run.evaluation.modifiers.urgencyPremium;

    const record = recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "achieved",
      actualCost: 123.5,
    });

    const expected = best.assignments.reduce((total, assignment) => {
      const actor = best.actors.find((item) => item.actorId === assignment.actorId);
      const unit = actor ? (COST_PROXY_UNITS[actor.kind] ?? 50) : 50;
      const humanPremium = actor && (actor.kind === "human" || actor.kind === "team") ? premium : 1;
      return total + unit * assignment.effortShare * humanPremium;
    }, 0);
    expect(record.cost.costProxy).toBe(Math.round(expected * 10000) / 10000);
    expect(record.cost.actualCost).toBe(123.5);
    expect(record.cost.budgetCeiling).toBe(best.budget?.maxTotalCost);
  });

  it("derives the context class on the record (the conditioning key)", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);

    const record = recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "achieved",
    });

    expect(record.contextClass.axes.goalPressure).toBe("standard");
    expect(record.contextClass.axes.timeHorizon).toBe("medium");
    expect(record.contextClass.axes.uncertaintyClass).toBe("known");
    expect(record.contextClass.demandSignature).toBe("cap-design:4,cap-review:3");
    expect(record.contextClass.canonical).toContain("cc:v1|pressure=standard");
    expect(record.contextClass.classKey).toMatch(/^[0-9a-f]{16}$/);
  });

  it("defaults evidence refs to the candidate + goal subjects", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);

    const record = recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "achieved",
    });

    expect(record.evidenceRefs).toEqual([
      { kind: "candidate", id: best.candidateId },
      { kind: "goal", id: "goal-1" },
    ]);
  });
});

describe("learning: join integrity (typed refusals, never silent)", () => {
  it("refuses when the candidate was not ranked by that evaluation", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const ranked = run.result.ranked[0]?.candidate;
    if (!ranked) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, ranked);

    const error = errOf(
      fx.learning.recordOutcome(
        s,
        outcomeInput({
          outcomeId: "out-1",
          evaluationId: run.evaluation.evaluationId,
          candidateId: "cand-never-ranked",
          status: "achieved",
        }),
      ),
    );
    expect(error.code).toBe("learning-join-refused");
    expect(error.issues[0]?.field).toBe("candidateId");
  });

  it("refuses when the candidate's fingerprint stamp disagrees with the evaluation", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    // Register the SAME ranked candidate id but with a mismatched stamp.
    const misStamped = { ...best, contextFingerprint: "deadbeefdeadbeef" };
    const registered = fx.kernel.candidates.registerCandidate(s, candidateInputOf(misStamped));
    if (!registered.ok) throw new Error(`test setup: ${registered.error.message}`);

    const error = errOf(
      fx.learning.recordOutcome(
        s,
        outcomeInput({
          outcomeId: "out-1",
          evaluationId: run.evaluation.evaluationId,
          candidateId: best.candidateId,
          status: "achieved",
        }),
      ),
    );
    expect(error.code).toBe("learning-join-refused");
    expect(error.issues[0]?.field).toBe("candidate.contextFingerprint");
  });

  it("fails uniformly when the evaluation does not exist (tenant isolation)", () => {
    const fx = learningFixture();
    const s = scope("acme");
    const other = scope("other");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);

    const neverExisting = errOf(
      fx.learning.recordOutcome(
        s,
        outcomeInput({
          outcomeId: "out-1",
          evaluationId: "lab-eval-999",
          candidateId: best.candidateId,
          status: "achieved",
        }),
      ),
    );
    const foreignTenant = errOf(
      fx.learning.recordOutcome(
        other,
        outcomeInput({
          outcomeId: "out-1",
          evaluationId: run.evaluation.evaluationId,
          candidateId: best.candidateId,
          status: "achieved",
        }),
      ),
    );
    expect(neverExisting.code).toBe("learning-not-found");
    expect(foreignTenant.code).toBe("learning-not-found");
    expect(neverExisting.message).toBe(foreignTenant.message);
  });

  it("fails uniformly when the candidate is not registered in the requesting tenant", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    // NOT registered.

    const error = errOf(
      fx.learning.recordOutcome(
        s,
        outcomeInput({
          outcomeId: "out-1",
          evaluationId: run.evaluation.evaluationId,
          candidateId: best.candidateId,
          status: "achieved",
        }),
      ),
    );
    expect(error.code).toBe("learning-not-found");
  });

  it("refuses duplicate outcome ids (append-only evidence law)", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);

    recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "achieved",
    });
    const error = errOf(
      fx.learning.recordOutcome(
        s,
        outcomeInput({
          outcomeId: "out-1",
          evaluationId: run.evaluation.evaluationId,
          candidateId: best.candidateId,
          status: "failed",
        }),
      ),
    );
    expect(error.code).toBe("learning-conflict");
  });

  it("validates the observation shape with typed issues", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);

    const badStatus = errOf(
      fx.learning.recordOutcome(s, {
        ...outcomeInput({
          outcomeId: "out-1",
          evaluationId: run.evaluation.evaluationId,
          candidateId: best.candidateId,
          status: "achieved",
        }),
        observation: {
          status: "smashing" as never,
          source: { kind: "manual", ref: "run-1" },
          observedAt: now(30),
          observedBy: personActor("boss"),
        },
      }),
    );
    expect(badStatus.code).toBe("learning-validation");

    const failureOnSuccess = errOf(
      fx.learning.recordOutcome(
        s,
        outcomeInput({
          outcomeId: "out-1",
          evaluationId: run.evaluation.evaluationId,
          candidateId: best.candidateId,
          status: "achieved",
          failure: { kind: "should-not-be-here", detail: "x" },
        }),
      ),
    );
    expect(failureOnSuccess.code).toBe("learning-validation");
    expect(failureOnSuccess.issues[0]?.field).toBe("observation.failure");

    const badProvenance = errOf(
      fx.learning.recordOutcome(s, {
        ...outcomeInput({
          outcomeId: "out-1",
          evaluationId: run.evaluation.evaluationId,
          candidateId: best.candidateId,
          status: "achieved",
        }),
        provenance: { actor: systemActor("seed"), source: "nope" as never, recordedAt: now(30) },
      }),
    );
    expect(badProvenance.code).toBe("learning-validation");
  });
});

describe("learning: outcome listing + tenant isolation", () => {
  it("lists outcomes with filters; cross-tenant reads are uniform not-found", () => {
    const fx = learningFixture();
    const s = scope("acme");
    const other = scope("other");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);
    const record = recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "achieved",
    });

    expect(fx.learning.listOutcomes(s).map((r) => r.outcomeId)).toEqual(["out-1"]);
    expect(fx.learning.listOutcomes(s, { candidateId: best.candidateId })).toHaveLength(1);
    expect(fx.learning.listOutcomes(s, { candidateId: "other" })).toHaveLength(0);
    expect(fx.learning.listOutcomes(other)).toHaveLength(0);
    expect(okOf(fx.learning.getOutcome(s, "out-1")).outcomeId).toBe("out-1");
    const foreign = errOf(fx.learning.getOutcome(other, "out-1"));
    const missing = errOf(fx.learning.getOutcome(s, "out-999"));
    expect(foreign.code).toBe("learning-not-found");
    expect(missing.code).toBe("learning-not-found");
    expect(foreign.message).toBe(missing.message);

    // Class-keyed filter matches the recorded conditioning class.
    expect(
      fx.learning.listOutcomes(s, { contextClassKey: record.contextClass.classKey }),
    ).toHaveLength(1);
    expect(fx.learning.listOutcomes(s, { contextClassKey: "0000000000000000" })).toHaveLength(0);
  });

  it("keeps tenants' learned evidence fully separate", () => {
    const fx = learningFixture();
    const s = scope("acme");
    const other = scope("other");
    seedSubject(fx, s);
    seedSubject(fx, other);
    const runA = runSearch(fx, s);
    const bestA = runA.result.ranked[0]?.candidate;
    if (!bestA) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, bestA);
    recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: runA.evaluation.evaluationId,
      candidateId: bestA.candidateId,
      status: "failed",
    });
    recordOutcome(fx, s, {
      outcomeId: "out-2",
      evaluationId: runA.evaluation.evaluationId,
      candidateId: bestA.candidateId,
      status: "failed",
    });
    recordOutcome(fx, s, {
      outcomeId: "out-3",
      evaluationId: runA.evaluation.evaluationId,
      candidateId: bestA.candidateId,
      status: "failed",
    });

    // Tenant "other" has the same subject but learns NOTHING from acme.
    const evidenceOther = conditionalEvidence(fx, other, runSearch(fx, other).fingerprint);
    expect(evidenceOther).toHaveLength(0);
  });
});
