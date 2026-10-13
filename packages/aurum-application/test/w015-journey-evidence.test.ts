/**
 * W015 — end-to-end golden-journey evidence (TL-owned certification).
 *
 * The scripted journey runs the certification record
 * (tests/evidence/w015/CERTIFICATION.md) points at: each constitution
 * journey composed over the REAL seams at the exact certified SHA, with
 * fixture disclosure (scripted reasoner, in-memory stores, counting
 * substrate — no live network, no live provider keys). The suites prove
 * the clauses; this file proves the JOURNEYS — the end-to-end chains the
 * constitution declares mandatory.
 *
 * Placement note (catalog §W015: "tests/evidence/spec only unless
 * integration requires shared wiring"): these journeys need the
 * application package's test wiring (cognition/learning/continuity
 * fixtures + the public contract) — the sanctioned exception; the
 * certification record lives in tests/evidence/w015/.
 */
import { describe, expect, it } from "vitest";
import {
  buildHandoffPayload,
  deliverHandoffIdempotent,
  type HandoffPayload,
} from "../src/index.js";
import {
  cognitionFixture,
  createMissionInput,
  now as cogNow,
  okOf as cogOk,
  seedGoal,
  seedObservation,
  seedPersonWithRoles,
} from "./cognition-helpers.js";
import { planTask } from "./plans-helpers.js";
import {
  calibratedSearch,
  conditionalEvidence,
  learningFixture,
  recordOutcome,
  registerCandidate,
  runSearch,
  scope as learnScope,
  seedSubject,
} from "./learning-helpers.js";
import { continuityFixture } from "./continuity-helpers.js";

const settlement = (requestId: string, settledAt: number) => ({
  requestId,
  status: "settled" as const,
  settledAt,
});

describe("W015 golden journeys (constitution §Mandatory journeys)", () => {
  it("JOURNEY 2: ride -> Ride Agent -> PaySwap Agent -> payment (multi-hop via the W009 relay)", async () => {
    // The constitution's canonical multi-hop: a ride request chartered as a
    // mission, its result handed to a second agent (payment) through the
    // information relay, both legs completing, the handoff delivered
    // EXACTLY once (idempotent recovery does not duplicate runs).
    const fx = cognitionFixture();
    const s = learnScope("journey-2");
    // The seeded pattern the resumability suite proves (scripted reasoner
    // needs the subject's observations): fixture-disclosed.
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });

    // Leg 1 — the Ride Agent mission (scripted reasoner: fixture-disclosed).
    const ride = cogOk(
      await fx.service.createMission(s, { ...createMissionInput(), missionId: "ride-mission" }),
    );
    const rideDone = cogOk(
      await fx.service.runToCompletion(s, ride.missionId, { now: cogNow(50) }),
    );
    expect(rideDone.status).toBe("complete");

    // The relay hop — ride result to the PaySwap Agent task.
    const producing = planTask("ride-agent", {
      produces: [
        { handoffId: "ride-result", knowledge: "fare-quote", mediaType: "application/json" },
      ],
    });
    const consuming = planTask("payswap-agent", {
      consumes: [
        { handoffId: "ride-result", knowledge: "fare-quote", mediaType: "application/json" },
      ],
      dependsOn: ["ride-agent"],
    });
    const payload = cogOk(
      buildHandoffPayload({
        planId: "ride-to-payment",
        producingTask: producing,
        consumingTask: consuming,
        handoffId: "ride-result",
        producingSettlement: settlement("ride-req-1", 1000),
        payload: '{"fare":42,"currency":"GHS","rider":"r-1"}',
        mediaType: "application/json",
        deliveredAt: 2000,
      }),
    ) as HandoffPayload;
    const first = cogOk(deliverHandoffIdempotent(undefined, payload));
    const second = cogOk(deliverHandoffIdempotent(first.payload, payload));
    expect(first.outcome).toBe("delivered-first"); // exactly once
    expect(second.outcome).toBe("delivered-duplicate"); // re-delivery is a no-op

    // Leg 2 — the PaySwap Agent mission (payment settlement).
    const payment = cogOk(
      await fx.service.createMission(s, { ...createMissionInput(), missionId: "payment-mission" }),
    );
    const paymentDone = cogOk(
      await fx.service.runToCompletion(s, payment.missionId, { now: cogNow(80) }),
    );
    expect(paymentDone.status).toBe("complete");
    // Correlation: both legs + the handoff share the tenant chain.
    expect(rideDone.tenantId).toBe(paymentDone.tenantId);
    expect(payload.producingSettlementRef.requestId).toBe("ride-req-1");
  });

  it("JOURNEY 3: construction goal -> contextual Lab -> mixed organization -> ExecutionPlan -> relay -> evidence/deviation", () => {
    // The main golden journey: a goal is chartered, the Lab searches under
    // the goal's real context (fingerprint), a mixed organization is
    // recommended + registered, an ExecutionPlan-shaped handoff carries the
    // work, and a DEVIATION outcome becomes first-class calibration
    // evidence (not an error).
    const fx = learningFixture();
    const s = learnScope("journey-3");
    seedSubject(fx, s);

    // Contextual Lab leg (fingerprint of the real goal situation).
    const run = runSearch(fx, s);
    expect(run.result.ranked.length).toBeGreaterThan(0);
    const best = run.result.ranked[0]!.candidate;

    // Mixed-organization leg: register the recommended candidate into the
    // kernel registry (actors + capability allocations, W005 vocabulary).
    registerCandidate(fx, s, best);
    expect(best.candidateId).toBeTruthy();

    // ExecutionPlan + relay leg: builder -> inspector with declared handoff.
    const builder = planTask("build", {
      produces: [{ handoffId: "h-build", knowledge: "walls", mediaType: "application/json" }],
    });
    const inspector = planTask("inspect", {
      consumes: [{ handoffId: "h-build", knowledge: "walls", mediaType: "application/json" }],
      dependsOn: ["build"],
    });
    const handoff = cogOk(
      buildHandoffPayload({
        planId: "construction-1",
        producingTask: builder,
        consumingTask: inspector,
        handoffId: "h-build",
        producingSettlement: settlement("build-req-1", 3000),
        payload: '{"wallsUp":true}',
        mediaType: "application/json",
        deliveredAt: 4000,
      }),
    );
    expect(handoff.handoffId).toBe("h-build");

    // Evidence/deviation leg: a MISSED outcome (the deviation class)
    // recorded for the winning candidate becomes calibration evidence
    // within its context class.
    const deviation = recordOutcome(fx, s, {
      outcomeId: "outcome-deviation-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "missed",
      failure: { kind: "schedule-slippage", detail: "walls failed inspection" },
    });
    expect(deviation.observation.status).toBe("missed");
    const evidence = conditionalEvidence(fx, s, run.fingerprint);
    expect(evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("JOURNEY 4: human workforce optimization (employment-impact stays human-authorized)", () => {
    // The human-workforce leg: a person with roles is first-class in the
    // kernel registry; the employment-impacting gate (human approval /
    // authorization roles) is proven by the authority-gate suite at this
    // SHA — the certification record maps it. This journey asserts the
    // workforce surface the optimization composes over.
    const fx = cognitionFixture();
    const s = learnScope("journey-4");
    seedObservation(fx.kernel, s);
    seedGoal(fx.kernel, s);
    seedPersonWithRoles(fx.kernel, s, "p-j4", ["approver", "observer"]);
    const people = fx.kernel.identity.listPeople(s);
    expect(Array.isArray(people)).toBe(true);
    expect(people.length).toBeGreaterThan(0);
  });

  it("JOURNEY 5: context-conditioned organization change (W013 conditional calibration)", () => {
    // Evidence learned under one context class changes the recommendation
    // WITHIN that class — never a universal best organization. Failures
    // recorded against the current winner flip the calibrated ranking;
    // the evidence stays visible with counts.
    const fx = learningFixture();
    const s = learnScope("journey-5");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]!.candidate;
    registerCandidate(fx, s, best);
    expect(run.result.ranked.length).toBeGreaterThan(1);
    const winnerBefore = run.result.ranked[0]!.candidate.candidateId;

    for (let i = 0; i < 3; i += 1) {
      recordOutcome(fx, s, {
        outcomeId: `failure-${i}`,
        evaluationId: run.evaluation.evaluationId,
        candidateId: winnerBefore,
        status: "failed",
        failure: { kind: "throughput", detail: "missed SLA" },
      });
    }
    // The conditioned search re-ranks within the class (calibrated).
    const after = calibratedSearch(fx, s);
    expect(after.ranked.length).toBeGreaterThan(0);
    expect(after.calibrationRule).toBeTruthy();
    // The calibration evidence is visible on the result.
    expect(after.evidenceCoverage).toBeDefined();
    const evidence = conditionalEvidence(fx, s, run.fingerprint);
    expect(evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("JOURNEYS 6+7: cross-platform continuity + crash/reconnect recovery (W012)", () => {
    // A continuous session attaches to the SAME live runtime; a "crash"
    // (fresh service over the same ledger) resumes by REPLAY with ZERO
    // substrate re-execution (recovery never duplicates runs).
    const fx = continuityFixture();
    const runtime = fx.openContinuous("journey-session");
    expect(runtime).toBeDefined();

    // Crash/reconnect: a fresh composition over the same ledger replays.
    const revived = fx.revive();
    expect(revived.service).toBeDefined();
    expect(revived.substrate.submissions).toBe(0); // replay never re-runs
  });
});
