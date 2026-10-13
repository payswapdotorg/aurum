/**
 * W013 acceptance proofs — CONDITIONAL PERFORMANCE, NOT A UNIVERSAL BEST
 * ORGANIZATION (catalog clause 1). Evidence is keyed to
 * (context class x organization shape); evidence learned under one context
 * class NEVER influences a search under another (isolation, test-locked);
 * there is NO API surface that returns a global, context-independent
 * ranking (the evidence query REQUIRES a context anchor); the calibrated
 * search preserves the base W008 ranking rule verbatim and records its own
 * calibration rule; everything is deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  errOf,
  learningFixture,
  now,
  okOf,
  personActor,
  provenance,
  raiseOneUnknown,
  recordOutcome,
  registerCandidate,
  runSearch,
  scope,
  seedSubject,
} from "./learning-helpers.js";
import {
  CALIBRATION_LIMITS,
  CONDITIONAL_RANKING_RULE,
  RANKING_RULE,
  applyConditionalCalibration,
  calibrateEvidence,
  contextClassOf,
  makeFingerprint,
  organizationShapeOf,
} from "../src/index.js";

const AXES = {
  goalPressure: "standard",
  timeHorizon: "medium",
  uncertaintyClass: "known",
  freshnessSignal: "current",
  capabilityDemandProfile: [
    { capabilityId: "cap-design", requiredLevel: 4, requiredCapacityPerPeriod: 45 },
    { capabilityId: "cap-review", requiredLevel: 3, requiredCapacityPerPeriod: 30 },
  ],
} as const;

describe("learning: the conditioning key (context class)", () => {
  it("derives a deterministic class from fingerprint axes", () => {
    const first = okOf(contextClassOf(AXES));
    const second = okOf(contextClassOf(AXES));
    expect(first.classKey).toBe(second.classKey);
    expect(first.canonical).toBe(
      "cc:v1|pressure=standard|horizon=medium|uncertainty=known|freshness=current|demand=cap-design:4,cap-review:3",
    );
    expect(first.demandSignature).toBe("cap-design:4,cap-review:3");
    expect(first.classKey).toMatch(/^[0-9a-f]{16}$/);
  });

  it("excludes per-period capacity from the demand signature (ruling)", () => {
    const withCapacity = okOf(contextClassOf(AXES));
    const withoutCapacity = okOf(
      contextClassOf({
        ...AXES,
        capabilityDemandProfile: AXES.capabilityDemandProfile.map((entry) => ({
          capabilityId: entry.capabilityId,
          requiredLevel: entry.requiredLevel,
          requiredCapacityPerPeriod: entry.requiredCapacityPerPeriod * 10,
        })),
      }),
    );
    expect(withoutCapacity.classKey).toBe(withCapacity.classKey);
  });

  it("separates classes on any categorical axis change", () => {
    const base = okOf(contextClassOf(AXES));
    const urgent = okOf(contextClassOf({ ...AXES, goalPressure: "urgent" }));
    const open = okOf(contextClassOf({ ...AXES, uncertaintyClass: "open" }));
    const stale = okOf(contextClassOf({ ...AXES, freshnessSignal: "stale" }));
    const long = okOf(contextClassOf({ ...AXES, timeHorizon: "long" }));
    const otherDemand = okOf(
      contextClassOf({
        ...AXES,
        capabilityDemandProfile: [{ capabilityId: "cap-design", requiredLevel: 5 }],
      }),
    );
    for (const variant of [urgent, open, stale, long, otherDemand]) {
      expect(variant.classKey).not.toBe(base.classKey);
    }
  });

  it("rejects malformed axes with a typed validation error", () => {
    const error = errOf(contextClassOf({ ...AXES, goalPressure: "frantic" as never }));
    expect(error.code).toBe("learning-validation");
    expect(error.issues[0]?.field).toBe("goalPressure");
    expect(errOf(contextClassOf({ ...AXES, capabilityDemandProfile: [] })).issues[0]?.field).toBe(
      "capabilityDemandProfile",
    );
  });
});

describe("learning: the organization shape", () => {
  it("histograms actor kinds, oversight, automation, edges, flows, environments", () => {
    const candidate = {
      actors: [
        { actorId: "a1", kind: "human" },
        { actorId: "a2", kind: "agent" },
        { actorId: "a3", kind: "agent" },
        { actorId: "a4", kind: "supplier" },
      ],
      assignments: [],
      capabilityAllocations: [],
      topology: {
        execution: {
          steps: [
            { stepId: "s1", name: "one", automated: false },
            { stepId: "s2", name: "two", automated: true },
          ],
          edges: [
            { kind: "delegation", fromActorId: "a1", toActorId: "a2" },
            { kind: "delegation", fromActorId: "a1", toActorId: "a3" },
            { kind: "review", fromActorId: "a2", toActorId: "a1" },
          ],
        },
        information: {
          flows: [
            {
              flowId: "f1",
              knowledge: "x",
              recipientActorIds: ["a1"],
              minimalContext: true,
              reviewRequired: true,
            },
            {
              flowId: "f2",
              knowledge: "y",
              recipientActorIds: ["a2"],
              minimalContext: false,
              reviewRequired: false,
            },
          ],
        },
      },
      modelOccupancy: [],
      environment: [
        { environmentRef: "local" },
        { environmentRef: "local" },
        { environmentRef: "browser" },
      ],
    } as never as Parameters<typeof organizationShapeOf>[0];
    const shape = organizationShapeOf(candidate);
    expect(shape.actorMix).toEqual([
      { kind: "agent", count: 2 },
      { kind: "human", count: 1 },
      { kind: "supplier", count: 1 },
    ]);
    expect(shape.humanOversight).toBe(true);
    expect(shape.automationClass).toBe("mixed");
    expect(shape.edgeCounts).toEqual([
      { kind: "delegation", count: 2 },
      { kind: "review", count: 1 },
    ]);
    expect(shape.informationFlowCount).toBe(2);
    expect(shape.reviewRequiredFlows).toBe(1);
    expect(shape.minimalContextFlows).toBe(1);
    expect(shape.environmentCount).toBe(2);
    expect(shape.canonical).toContain("mix=agent:2,human:1,supplier:1");
    expect(shape.shapeKey).toMatch(/^[0-9a-f]{16}$/);
    expect(organizationShapeOf(candidate).shapeKey).toBe(shape.shapeKey);
  });

  it("buckets automation as none/all and flags missing oversight", () => {
    const base = {
      actors: [{ actorId: "a1", kind: "agent" }],
      assignments: [],
      capabilityAllocations: [],
      topology: {
        execution: {
          steps: [
            { stepId: "s1", name: "one", automated: true },
            { stepId: "s2", name: "two", automated: true },
          ],
          edges: [],
        },
        information: { flows: [] },
      },
      modelOccupancy: [],
      environment: [],
    };
    const all = organizationShapeOf(base as never as Parameters<typeof organizationShapeOf>[0]);
    expect(all.automationClass).toBe("all");
    expect(all.humanOversight).toBe(false);
    const none = organizationShapeOf({
      ...base,
      topology: {
        execution: {
          steps: [
            { stepId: "s1", name: "one", automated: false },
            { stepId: "s2", name: "two", automated: false },
          ],
          edges: [],
        },
        information: { flows: [] },
      },
    } as never as Parameters<typeof organizationShapeOf>[0]);
    expect(none.automationClass).toBe("none");
    expect(all.shapeKey).not.toBe(none.shapeKey);
  });
});

describe("learning: conditional evidence aggregation (pure)", () => {
  it("groups by (context class, shape) and computes bounded adjustments", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const balanced = run.result.ranked.find((item) => item.strategy === "balanced");
    const agentLed = run.result.ranked.find((item) => item.strategy === "agent-led");
    if (!balanced || !agentLed) throw new Error("test setup: missing strategies");
    registerCandidate(fx, s, balanced.candidate);
    registerCandidate(fx, s, agentLed.candidate);

    for (const index of [1, 2, 3]) {
      recordOutcome(fx, s, {
        outcomeId: `out-fail-${index}`,
        evaluationId: run.evaluation.evaluationId,
        candidateId: balanced.candidate.candidateId,
        status: "failed",
        failure: { kind: "ops", detail: "delivery collapsed" },
      });
      recordOutcome(fx, s, {
        outcomeId: `out-win-${index}`,
        evaluationId: run.evaluation.evaluationId,
        candidateId: agentLed.candidate.candidateId,
        status: "achieved",
      });
    }

    const evidence = calibrateEvidence(fx.learning.listOutcomes(s), now(40));
    expect(evidence).toHaveLength(2);
    const failed = evidence.find((e) => e.failedCount === 3);
    const won = evidence.find((e) => e.achievedCount === 3);
    expect(failed?.adjustment).toBe(-CALIBRATION_LIMITS.penaltyCap);
    expect(won?.adjustment).toBe(CALIBRATION_LIMITS.boostCap);
    expect(failed?.sampleCount).toBe(3);
    expect(won?.achievedRate).toBe(1);
    expect(failed?.outcomeIds).toEqual(["out-fail-1", "out-fail-2", "out-fail-3"]);
  });

  it("pools evidence across strategies that compose the same shape", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    // agent-led and minimal both compose {agent, agent} over this pool.
    const agentLed = run.result.ranked.find((item) => item.strategy === "agent-led");
    const minimal = run.result.ranked.find((item) => item.strategy === "minimal");
    if (!agentLed || !minimal) throw new Error("test setup: missing strategies");
    expect(organizationShapeOf(agentLed.candidate).shapeKey).toBe(
      organizationShapeOf(minimal.candidate).shapeKey,
    );
    registerCandidate(fx, s, agentLed.candidate);

    for (const index of [1, 2, 3]) {
      recordOutcome(fx, s, {
        outcomeId: `out-${index}`,
        evaluationId: run.evaluation.evaluationId,
        candidateId: agentLed.candidate.candidateId,
        status: "failed",
      });
    }

    const evidence = calibrateEvidence(fx.learning.listOutcomes(s), now(40));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.sampleCount).toBe(3);
    expect(evidence[0]?.failedCount).toBe(3);
  });

  it("scales thin evidence linearly to the sample floor", () => {
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
      status: "failed",
    });

    const evidence = calibrateEvidence(fx.learning.listOutcomes(s), now(40));
    // 1 failure of minSamples 3: raw = -1 * (1/3) * 1 -> -0.3333 (inside caps).
    expect(evidence[0]?.adjustment).toBe(-0.3333);
  });
});

describe("learning: calibrated search (the conditional ranking)", () => {
  it("returns the base ranking unchanged when no evidence exists", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);

    const calibrated = okOf(
      fx.learning.calibratedSearch(s, {
        goalId: "goal-1",
        fingerprint: run.fingerprint,
        proposedBy: personActor("boss"),
        provenance: provenance(personActor("boss"), 10),
        now: now(20),
      }),
    );

    expect(calibrated.rankingRule).toBe(RANKING_RULE);
    expect(calibrated.calibrationRule).toBe(CONDITIONAL_RANKING_RULE);
    expect(calibrated.evidenceCoverage).toEqual({ matched: 0, total: run.result.ranked.length });
    expect(calibrated.ranked.map((entry) => entry.candidate.candidateId)).toEqual(
      run.result.ranked.map((entry) => entry.candidate.candidateId),
    );
    for (const entry of calibrated.ranked) {
      expect(entry.adjustment).toBe(0);
      expect(entry.evidence).toBeNull();
      expect(entry.adjustedScore).toBe(entry.score.weightedScore);
      expect(entry.calibratedRank).toBe(entry.baseRank);
    }
    expect(calibrated.contextClass.classKey).toBe(
      okOf(contextClassOf(run.fingerprint.axes)).classKey,
    );
  });

  it("flips the recommendation within a context class on learned failures", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const top = run.result.ranked[0];
    if (!top) throw new Error("test setup: shallow ranking");
    registerCandidate(fx, s, top.candidate);

    // Learn three failures for the TOP organization's shape under THIS class.
    for (const index of [1, 2, 3]) {
      recordOutcome(fx, s, {
        outcomeId: `out-${index}`,
        evaluationId: run.evaluation.evaluationId,
        candidateId: top.candidate.candidateId,
        status: "failed",
      });
    }

    const calibrated = okOf(
      fx.learning.calibratedSearch(s, {
        goalId: "goal-1",
        fingerprint: run.fingerprint,
        proposedBy: personActor("boss"),
        provenance: provenance(personActor("boss"), 10),
        // The re-search runs AFTER the outcomes were observed (30s): the
        // learned evidence must be current, not "unknown" by negative age.
        now: now(40),
      }),
    );

    const demoted = calibrated.ranked.find(
      (entry) => entry.candidate.candidateId === top.candidate.candidateId,
    );
    if (!demoted) throw new Error("test setup: lost entries");
    expect(demoted.baseRank).toBe(1);
    expect(demoted.adjustment).toBe(-0.5);
    expect(demoted.adjustedScore).toBe(
      Math.round(demoted.score.weightedScore * 0.5 * 10000) / 10000,
    );
    expect(demoted.evidence?.failedCount).toBe(3);

    // The re-ranking rule: adjusted score desc, then candidate id asc —
    // computed independently here from the base search + the shape match.
    const topShapeKey = organizationShapeOf(top.candidate).shapeKey;
    const expected = run.result.ranked
      .map((entry) => ({
        id: entry.candidate.candidateId,
        adjusted:
          Math.round(
            entry.score.weightedScore *
              (organizationShapeOf(entry.candidate).shapeKey === topShapeKey ? 0.5 : 1) *
              10000,
          ) / 10000,
      }))
      .sort((a, b) => (a.adjusted !== b.adjusted ? b.adjusted - a.adjusted : a.id < b.id ? -1 : 1))
      .map((item) => item.id);
    expect(calibrated.ranked.map((entry) => entry.candidate.candidateId)).toEqual(expected);
    expect(calibrated.evidenceCoverage.matched).toBeGreaterThan(0);
    // The learned failure actually moved the recommendation: the previous
    // top organization no longer leads its context class.
    expect(demoted.calibratedRank).toBeGreaterThan(1);
  });

  it("ISOLATION: evidence learned under one context class never crosses to another", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s); // context A: standard / known
    const runA = runSearch(fx, s);
    const topA = runA.result.ranked[0];
    if (!topA) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, topA.candidate);
    for (const index of [1, 2, 3]) {
      recordOutcome(fx, s, {
        outcomeId: `out-${index}`,
        evaluationId: runA.evaluation.evaluationId,
        candidateId: topA.candidate.candidateId,
        status: "failed",
      });
    }

    // Context B: same subject + pool, but ONE open unknown -> bounded class.
    raiseOneUnknown(fx, s);
    const runB = runSearch(fx, s);
    expect(runB.fingerprint.digest).not.toBe(runA.fingerprint.digest);
    expect(okOf(contextClassOf(runB.fingerprint.axes)).classKey).not.toBe(
      okOf(contextClassOf(runA.fingerprint.axes)).classKey,
    );

    const calibratedB = okOf(
      fx.learning.calibratedSearch(s, {
        goalId: "goal-1",
        fingerprint: runB.fingerprint,
        proposedBy: personActor("boss"),
        provenance: provenance(personActor("boss"), 10),
        now: now(20),
      }),
    );
    // The SAME shape exists under B but carries ZERO of A's evidence.
    expect(calibratedB.evidenceCoverage).toEqual({ matched: 0, total: runB.result.ranked.length });
    for (const entry of calibratedB.ranked) {
      expect(entry.adjustment).toBe(0);
      expect(entry.evidence).toBeNull();
    }
    expect(calibratedB.ranked.map((e) => e.candidate.candidateId)).toEqual(
      runB.result.ranked.map((e) => e.candidate.candidateId),
    );

    // And the pure application ignores foreign-class evidence outright.
    const allEvidence = calibrateEvidence(fx.learning.listOutcomes(s), now(40));
    const applied = okOf(applyConditionalCalibration(runB.result, allEvidence));
    expect(applied.evidenceCoverage.matched).toBe(0);
  });

  it("requires a context anchor for conditional evidence (no global evidence API)", () => {
    const fx = learningFixture();
    const s = scope("acme");
    const fingerprint = okOf(
      makeFingerprint({
        goalPriority: "medium",
        horizon: { start: 0, end: 90 * 24 * 60 * 60 * 1000 },
        openUnknowns: 0,
        openContradictions: 0,
        evidenceFreshness: ["current"],
        capabilityDemand: [{ capabilityId: "cap-x", requiredLevel: 2 }],
      }),
    );
    const both = errOf(
      fx.learning.conditionalEvidence(s, {
        fingerprint,
        contextClassKey: "abc",
        now: now(0),
      } as never),
    );
    expect(both.code).toBe("learning-validation");
    const neither = errOf(fx.learning.conditionalEvidence(s, { now: now(0) } as never));
    expect(neither.code).toBe("learning-validation");
  });

  it("scopes the evidence query to the requested class", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const top = run.result.ranked[0];
    if (!top) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, top.candidate);
    recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: top.candidate.candidateId,
      status: "achieved",
    });

    const forFingerprint = okOf(
      fx.learning.conditionalEvidence(s, { fingerprint: run.fingerprint, now: now(40) }),
    );
    expect(forFingerprint).toHaveLength(1);
    const classKey = okOf(contextClassOf(run.fingerprint.axes)).classKey;
    const forKey = okOf(
      fx.learning.conditionalEvidence(s, { contextClassKey: classKey, now: now(40) }),
    );
    expect(forKey).toHaveLength(1);
    expect(forKey[0]?.shapeKey).toBe(forFingerprint[0]?.shapeKey);
    const foreignKey = okOf(
      fx.learning.conditionalEvidence(s, { contextClassKey: "0000000000000000", now: now(40) }),
    );
    expect(foreignKey).toHaveLength(0);
  });

  it("is deterministic: same outcomes + same search -> byte-identical result", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const top = run.result.ranked[0];
    if (!top) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, top.candidate);
    recordOutcome(fx, s, {
      outcomeId: "out-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: top.candidate.candidateId,
      status: "failed",
    });
    recordOutcome(fx, s, {
      outcomeId: "out-2",
      evaluationId: run.evaluation.evaluationId,
      candidateId: top.candidate.candidateId,
      status: "achieved",
    });

    const input = {
      goalId: "goal-1",
      fingerprint: run.fingerprint,
      proposedBy: personActor("boss"),
      provenance: provenance(personActor("boss"), 10),
      now: now(20),
    };
    const first = okOf(fx.learning.calibratedSearch(s, input));
    const second = okOf(fx.learning.calibratedSearch(s, input));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("propagates lab errors through the learning facade verbatim", () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const error = errOf(
      fx.learning.calibratedSearch(s, {
        goalId: "goal-1",
        fingerprint: { axes: AXES, canonical: "tampered", digest: "nope" },
        proposedBy: personActor("boss"),
        provenance: provenance(personActor("boss"), 10),
        now: now(20),
      } as never),
    );
    expect(error.code).toBe("learning-validation");
  });
});
