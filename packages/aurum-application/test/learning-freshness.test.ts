/**
 * W013 acceptance proofs — STALE EVIDENCE IS VISIBLE (catalog clause 3).
 * Freshness is classified with the W002 domain vocabulary AT CONSUMPTION
 * TIME (the caller's `now`), so evidence ages naturally: the same records
 * are current today and stale next quarter. Staleness DECAYS the
 * directional weight of the adjustment but NEVER removes the evidence —
 * sample counts, failure counts and outcome ids stay fully visible, and
 * the calibrated search surfaces the per-candidate evidence freshness.
 */
import { describe, expect, it } from "vitest";
import {
  conditionalEvidence,
  daysAfter,
  learningFixture,
  now,
  okOf,
  personActor,
  provenance,
  recordOutcome,
  registerCandidate,
  runSearch,
  scope,
  seedSubject,
} from "./learning-helpers.js";
import { CALIBRATION_LIMITS, outcomeFreshnessOf } from "../src/index.js";

describe("learning: stale evidence is visible (and only decays)", () => {
  it("classifies evidence freshness at consumption time — the same records age", () => {
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
        observedAtSec: 0,
      });
    }

    const fresh = conditionalEvidence(fx, s, run.fingerprint, now(0));
    expect(fresh[0]?.evidenceFreshness).toBe("current");
    expect(fresh[0]?.staleSampleCount).toBe(0);
    expect(fresh[0]?.adjustment).toBe(-0.5);

    // Forty-five days later the SAME records are stale: visible, decayed.
    const stale = conditionalEvidence(fx, s, run.fingerprint, daysAfter(45));
    expect(stale[0]?.evidenceFreshness).toBe("stale");
    expect(stale[0]?.staleSampleCount).toBe(3);
    expect(stale[0]?.sampleCount).toBe(3);
    expect(stale[0]?.failedCount).toBe(3);
    expect(stale[0]?.adjustment).toBe(-0.125);
  });

  it("decays through aging at the documented multipliers", () => {
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
        observedAtSec: 0,
      });
    }

    const aging = conditionalEvidence(fx, s, run.fingerprint, daysAfter(14));
    expect(aging[0]?.evidenceFreshness).toBe("aging");
    expect(aging[0]?.adjustment).toBe(-0.25);
    expect(CALIBRATION_LIMITS.freshnessDecay.aging).toBe(0.5);
    expect(CALIBRATION_LIMITS.freshnessDecay.stale).toBe(0.25);
  });

  it("keeps every count visible when stale — the evidence never disappears", () => {
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
      observedAtSec: 0,
    });
    recordOutcome(fx, s, {
      outcomeId: "out-2",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "failed",
      observedAtSec: 0,
    });

    const stale = conditionalEvidence(fx, s, run.fingerprint, daysAfter(60));
    expect(stale).toHaveLength(1);
    expect(stale[0]?.sampleCount).toBe(2);
    expect(stale[0]?.achievedCount).toBe(1);
    expect(stale[0]?.failedCount).toBe(1);
    expect(stale[0]?.staleSampleCount).toBe(2);
    expect(stale[0]?.outcomeIds).toEqual(["out-1", "out-2"]);
    expect(stale[0]?.lastObservedAt).toBeDefined();
  });

  it("takes the evidence freshness from the most recent observation", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);
    // One ancient outcome (observed at the base time), one recent outcome
    // (observed 44 days in, one day before the query).
    recordOutcome(fx, s, {
      outcomeId: "out-old",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "failed",
      observedAtSec: 0,
    });
    recordOutcome(fx, s, {
      outcomeId: "out-new",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: "achieved",
      observedAtSec: 44 * 24 * 60 * 60,
    });

    const evidence = conditionalEvidence(fx, s, run.fingerprint, daysAfter(45));
    expect(evidence[0]?.evidenceFreshness).toBe("current");
    // The ancient failure stays visible in the stale count.
    expect(evidence[0]?.staleSampleCount).toBe(1);
    expect(evidence[0]?.sampleCount).toBe(2);
  });

  it("surfaces the per-candidate evidence freshness on the calibrated search", () => {
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
        observedAtSec: 0,
      });
    }

    const calibrated = okOf(
      fx.learning.calibratedSearch(s, {
        goalId: "goal-1",
        fingerprint: run.fingerprint,
        proposedBy: personActor("boss"),
        provenance: provenance(personActor("boss"), 10),
        // The search itself runs 45 days after the outcomes were observed.
        now: daysAfter(45),
      }),
    );

    const demoted = calibrated.ranked.find(
      (entry) => entry.candidate.candidateId === best.candidateId,
    );
    expect(demoted?.evidence?.evidenceFreshness).toBe("stale");
    expect(demoted?.evidence?.staleSampleCount).toBe(3);
    expect(demoted?.adjustment).toBe(-0.125);
    expect(demoted?.evidence).not.toBeNull();
  });

  it("treats unknown-freshness observations conservatively (decay, visible)", () => {
    // A record whose observation carries no timestamp classifies as
    // "unknown" with the W002 vocabulary — never silently fresh — and the
    // decay table keeps the unknown class conservative but non-zero.
    const record = {
      observation: { observedAt: undefined },
    } as never as Parameters<typeof outcomeFreshnessOf>[0];
    expect(outcomeFreshnessOf(record, daysAfter(1))).toBe("unknown");
    expect(outcomeFreshnessOf(record, daysAfter(400))).toBe("unknown");
    expect(CALIBRATION_LIMITS.freshnessDecay.unknown).toBe(0.25);
  });
});
