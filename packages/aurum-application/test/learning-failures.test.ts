/**
 * W013 acceptance proofs — FAILED OUTCOMES BECOME CALIBRATION EVIDENCE
 * (catalog clause 2). Failures are recorded as first-class outcome records
 * carrying typed failure detail, counted into the conditional evidence
 * (never discarded), and reflected in the calibrated ranking — with
 * asymmetric caps (failures bite harder than successes help).
 */
import { describe, expect, it } from "vitest";
import {
  conditionalEvidence,
  daysAfter,
  errOf,
  learningFixture,
  now,
  okOf,
  outcomeInput,
  personActor,
  provenance,
  recordOutcome,
  registerCandidate,
  runSearch,
  scope,
  seedSubject,
} from "./learning-helpers.js";
import { CALIBRATION_LIMITS, outcomeFreshnessOf } from "../src/index.js";

describe("learning: failed outcomes are first-class calibration evidence", () => {
  it("records the failure detail verbatim on the join record", () => {
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
      status: "failed",
      failure: { kind: "execution-collapse", detail: "agent gateway lost connectivity" },
      metric: { metric: "capability-coverage", observed: 0, target: 2 },
    });

    expect(record.observation.status).toBe("failed");
    expect(record.observation.failure).toEqual({
      kind: "execution-collapse",
      detail: "agent gateway lost connectivity",
    });
    expect(record.observation.metric).toEqual({
      metric: "capability-coverage",
      observed: 0,
      target: 2,
    });
  });

  it("counts missed + failed as failures and keeps their ids in the evidence chain", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);

    recordOutcome(fx, s, {
      outcomeId: "out-missed",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "missed",
      failure: { kind: "target-missed", detail: "coverage below target" },
    });
    recordOutcome(fx, s, {
      outcomeId: "out-failed",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "failed",
      failure: { kind: "ops", detail: "collapsed" },
    });
    recordOutcome(fx, s, {
      outcomeId: "out-partial",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "partial",
    });

    const evidence = conditionalEvidence(fx, s, run.fingerprint);
    expect(evidence).toHaveLength(1);
    const group = evidence[0];
    expect(group?.sampleCount).toBe(3);
    expect(group?.failedCount).toBe(2);
    expect(group?.partialCount).toBe(1);
    expect(group?.achievedCount).toBe(0);
    expect(group?.achievedRate).toBe(0);
    // Failure ids are retained — never discarded from the evidence chain.
    expect(group?.outcomeIds).toEqual(["out-missed", "out-failed", "out-partial"]);
  });

  it("penalizes proven failures at the asymmetric cap and demotes the shape", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);
    for (const index of [1, 2, 3]) {
      recordOutcome(fx, s, {
        outcomeId: `out-${index}`,
        evaluationId: run.evaluation.evaluationId,
        candidateId: best.candidateId,
        status: "failed",
        failure: { kind: "ops", detail: `failure ${index}` },
      });
    }

    const evidence = conditionalEvidence(fx, s, run.fingerprint);
    expect(evidence[0]?.adjustment).toBe(-CALIBRATION_LIMITS.penaltyCap);
    expect(evidence[0]?.evidenceFreshness).toBe("current");

    // And the calibrated search reflects it on the recommendation itself.
    // The re-search runs AFTER the outcomes were observed (30s): the
    // learned evidence must be current, not "unknown" by negative age.
    const calibrated = okOf(
      fx.learning.calibratedSearch(s, {
        goalId: "goal-1",
        fingerprint: run.fingerprint,
        proposedBy: personActor("boss"),
        provenance: provenance(personActor("boss"), 10),
        now: now(40),
      }),
    );
    const demoted = calibrated.ranked.find(
      (entry) => entry.candidate.candidateId === best.candidateId,
    );
    expect(demoted?.adjustment).toBe(-0.5);
    expect(demoted?.evidence?.failedCount).toBe(3);
    expect(demoted?.evidence?.outcomeIds).toContain("out-2");
  });

  it("boosts proven successes at the (smaller) success cap — asymmetric by design", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);
    for (const index of [1, 2, 3]) {
      recordOutcome(fx, s, {
        outcomeId: `out-${index}`,
        evaluationId: run.evaluation.evaluationId,
        candidateId: best.candidateId,
        status: "achieved",
      });
    }

    const evidence = conditionalEvidence(fx, s, run.fingerprint);
    expect(evidence[0]?.adjustment).toBe(CALIBRATION_LIMITS.boostCap);
    expect(CALIBRATION_LIMITS.penaltyCap).toBeGreaterThan(CALIBRATION_LIMITS.boostCap);
  });

  it("mixes successes and failures proportionally (rate-driven adjustment)", () => {
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
    recordOutcome(fx, s, {
      outcomeId: "out-2",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "failed",
    });
    recordOutcome(fx, s, {
      outcomeId: "out-3",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "failed",
    });

    const evidence = conditionalEvidence(fx, s, run.fingerprint);
    // achievedRate = 1/3 -> raw = (2/3 - 1) * 1 * 1 = -0.3333.
    expect(evidence[0]?.achievedRate).toBe(0.3333);
    expect(evidence[0]?.adjustment).toBe(-0.3333);
  });

  it("keeps partial outcomes visible but outside the success rate", () => {
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
      status: "partial",
    });

    const evidence = conditionalEvidence(fx, s, run.fingerprint);
    expect(evidence[0]?.sampleCount).toBe(1);
    expect(evidence[0]?.partialCount).toBe(1);
    expect(evidence[0]?.achievedCount).toBe(0);
    expect(evidence[0]?.failedCount).toBe(0);
    expect(evidence[0]?.adjustment).toBe(-0.3333);
  });

  it("refuses a failure detail on non-failure statuses (typed shape law)", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);

    const error = errOf(
      fx.learning.recordOutcome(
        s,
        outcomeInput({
          outcomeId: "out-1",
          evaluationId: run.evaluation.evaluationId,
          candidateId: best.candidateId,
          status: "partial",
          failure: { kind: "x", detail: "not allowed on partial" },
        }),
      ),
    );
    expect(error.code).toBe("learning-validation");
  });

  it("classifies outcome freshness with the W002 vocabulary (pure)", () => {
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
      observedAtSec: 0,
    });

    expect(outcomeFreshnessOf(record, daysAfter(1))).toBe("current");
    expect(outcomeFreshnessOf(record, daysAfter(14))).toBe("aging");
    expect(outcomeFreshnessOf(record, daysAfter(45))).toBe("stale");
  });
});
