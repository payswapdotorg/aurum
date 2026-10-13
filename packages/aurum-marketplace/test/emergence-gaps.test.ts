/**
 * W014 proofs — gap derivation correctness: pure functions over seeded
 * W013-shaped evidence. Every signal kind derives with verbatim record-id
 * citations; recurrence thresholds gate every signal; failures are
 * first-class (missed + failed) while achieved/partial never feed gap
 * signals; grouping never pools across failure kinds, metric names,
 * context classes, shapes or missions; the derivation is deterministic
 * (byte-identical repeats, gapId ascending); malformed queries are typed
 * validation refusals.
 */
import { describe, expect, it } from "vitest";
import {
  EMERGENCE_THRESHOLDS,
  detectEmergenceGaps,
  emergenceGapIdOf,
  type EmergenceGap,
} from "../src/index.js";
import {
  T0,
  errOf,
  emergenceFixture,
  okOf,
  outcomeEvidence,
  scopeOf,
  seedRecurringFailures,
  unknownSignal,
  type EmergenceFixture,
} from "./emergence-helpers.js";
import type { MarketplaceTenantScope } from "./helpers.js";

const TENANT = scopeOf("tenant-a");
const QUERY = { now: T0 + 1000 };

describe("capability-shortfall: recurring failures grouped by context class x failure kind", () => {
  it("three recurring failures of one kind in one class derive a gap citing the ids VERBATIM", () => {
    const fixture = emergenceFixture();
    const ids = seedRecurringFailures(fixture, TENANT, 3);
    const gaps = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    const gap = gaps.find((candidate) => candidate.signalKind === "capability-shortfall");
    expect(gap).toBeDefined();
    if (!gap) throw new Error("unreachable");
    expect(gap.recurrenceCount).toBe(3);
    expect(gap.outcomeIds).toEqual(ids);
    expect(gap.contextClassKey).toBe("class-a0000001");
    expect(gap.demandSignature).toBe("cap-analysis:3,cap-communication:2");
    expect(gap.demandedCapabilities).toEqual([
      { capabilityId: "cap-analysis", level: 3 },
      { capabilityId: "cap-communication", level: 2 },
    ]);
    expect(gap.failureKind).toBe("capability-missing");
    expect(gap.affectedGoalIds).toEqual(["goal-1"]);
    expect(gap.affectedMissionRefs).toEqual(["mission-1", "mission-2", "mission-3"]);
    expect(gap.derivationRule).toBe("emergence-capability-shortfall-v1");
    expect(gap.detectionQuery).toEqual(QUERY);
  });

  it("below the recurrence threshold NO gap derives; a LOWER caller threshold admits it", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, EMERGENCE_THRESHOLDS.minRecurrence - 1);
    expect(okOf(fixture.emergence.detectGaps(TENANT, QUERY))).toEqual([]);
    const gaps = okOf(
      fixture.emergence.detectGaps(TENANT, { now: QUERY.now, thresholds: { minRecurrence: 2 } }),
    );
    expect(gaps.some((gap) => gap.signalKind === "capability-shortfall")).toBe(true);
  });

  it("failures of DIFFERENT kinds never pool (no signal crosses its grouping dimension)", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 2);
    // A third failure in the same class but a DIFFERENT failure kind, a
    // DIFFERENT shape, NO metric and NO strain: no grouping dimension may
    // pool it with the first two into any signal.
    fixture.evidence.putOutcomeEvidence(
      outcomeEvidence(TENANT, {
        outcomeId: "out-other-kind",
        shape: { shapeKey: "shape-other999" },
        allocation: {
          actorCount: 4,
          humanLikeActorCount: 1,
          automatedActorCount: 3,
          totalEffortShare: 0.5,
        },
        observation: {
          status: "failed",
          source: { kind: "manual", ref: "report-1" },
          observedAt: T0 + 9,
          failure: { kind: "environment-outage", detail: "other kind" },
        },
      }),
    );
    expect(okOf(fixture.emergence.detectGaps(TENANT, QUERY))).toEqual([]);
  });

  it("achieved and partial outcomes NEVER feed the failure-recurrence signals", () => {
    const fixture = emergenceFixture();
    for (const status of ["achieved", "partial"] as const) {
      fixture.evidence.putOutcomeEvidence(
        outcomeEvidence(TENANT, {
          outcomeId: `out-${status}`,
          observation: {
            status,
            source: { kind: "mission", ref: "mission-ok" },
            observedAt: T0,
            failure: { kind: "capability-missing", detail: "failure detail on a non-failure" },
          },
        }),
      );
    }
    expect(okOf(fixture.emergence.detectGaps(TENANT, QUERY))).toEqual([]);
  });

  it("the gap id is the deterministic digest of kind + group key (reproducible)", () => {
    expect(emergenceGapIdOf("capability-shortfall", "class-a0000001|capability-missing")).toBe(
      emergenceGapIdOf("capability-shortfall", "class-a0000001|capability-missing"),
    );
    expect(emergenceGapIdOf("capability-shortfall", "class-a0000001|capability-missing")).not.toBe(
      emergenceGapIdOf("capability-shortfall", "class-a0000001|environment-outage"),
    );
  });
});

describe("metric-shortfall: recurring misses keyed by metric name", () => {
  it("three failed outcomes missing the same metric derive a metric gap", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gaps = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    const gap = gaps.find((candidate) => candidate.signalKind === "metric-shortfall");
    expect(gap).toBeDefined();
    if (!gap) throw new Error("unreachable");
    expect(gap.metricName).toBe("time-to-resolution");
    expect(gap.recurrenceCount).toBe(3);
  });

  it("STATUS IS THE AUTHORITY: failed outcomes with the metric MET still count; achieved never do", () => {
    const fixture = emergenceFixture();
    // The outcome status is the failure authority (W013) — emergence never
    // re-interprets metric polarity: three FAILED outcomes whose observed
    // value exceeds the target still evidence the metric recurrence.
    for (let index = 1; index <= 3; index += 1) {
      fixture.evidence.putOutcomeEvidence(
        outcomeEvidence(TENANT, {
          outcomeId: `out-met-${index}`,
          shape: { shapeKey: `shape-met-${index}` },
          allocation: {
            actorCount: 4,
            humanLikeActorCount: 1,
            automatedActorCount: 3,
            totalEffortShare: 0.5,
          },
          observation: {
            status: "failed",
            source: { kind: "mission", ref: `mission-met-${index}` },
            observedAt: T0 + index,
            failure: { kind: "other-cause", detail: "failed with the metric met" },
            metric: { metric: "throughput", observed: 30, target: 24 },
          },
        }),
      );
    }
    const gaps = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    expect(
      gaps.find((gap) => gap.signalKind === "metric-shortfall" && gap.metricName === "throughput"),
    ).toBeDefined();
    // And three ACHIEVED outcomes with the metric missed count for nothing.
    const fixtureB = emergenceFixture();
    for (let index = 1; index <= 3; index += 1) {
      fixtureB.evidence.putOutcomeEvidence(
        outcomeEvidence(TENANT, {
          outcomeId: `out-ach-${index}`,
          observation: {
            status: "achieved",
            source: { kind: "mission", ref: `mission-ach-${index}` },
            observedAt: T0 + index,
            metric: { metric: "throughput", observed: 10, target: 24 },
          },
        }),
      );
    }
    expect(okOf(fixtureB.emergence.detectGaps(TENANT, QUERY))).toEqual([]);
  });
});

describe("shape-underperformance: the W013 (class x shape) cohort discipline, read-only", () => {
  function seedCohort(fixture: EmergenceFixture, statuses: readonly string[]): void {
    statuses.forEach((status, index) => {
      fixture.evidence.putOutcomeEvidence(
        outcomeEvidence(TENANT, {
          outcomeId: `out-cohort-${index + 1}`,
          observation: {
            status: status as "achieved" | "partial" | "missed" | "failed",
            source: { kind: "mission", ref: `mission-cohort-${index + 1}` },
            observedAt: T0 + index,
            ...(status === "failed" || status === "missed"
              ? { failure: { kind: "mixed-causes", detail: "cohort failure" } }
              : {}),
          },
        }),
      );
    });
  }

  it("a cohort at the sample floor with failure rate >= threshold derives a shape gap with cohort counts", () => {
    const fixture = emergenceFixture();
    seedCohort(fixture, ["failed", "failed", "failed", "achieved"]);
    const gaps = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    const gap = gaps.find((candidate) => candidate.signalKind === "shape-underperformance");
    expect(gap).toBeDefined();
    if (!gap) throw new Error("unreachable");
    expect(gap.cohortSamples).toBe(4);
    expect(gap.cohortFailures).toBe(3);
    expect(gap.recurrenceCount).toBe(3);
    expect(gap.shapeKey).toBe("shape-b0000002");
    expect(gap.outcomeIds).toHaveLength(4);
  });

  it("a healthy cohort (failure rate below threshold) derives nothing", () => {
    const fixture = emergenceFixture();
    seedCohort(fixture, ["failed", "achieved", "achieved", "achieved"]);
    expect(okOf(fixture.emergence.detectGaps(TENANT, QUERY))).toEqual([]);
  });

  it("a cohort BELOW the sample floor derives nothing even at 100% failure", () => {
    const fixture = emergenceFixture();
    seedCohort(fixture, ["failed", "failed"]);
    expect(okOf(fixture.emergence.detectGaps(TENANT, QUERY))).toEqual([]);
  });

  it("distinct classes/shapes never pool into one cohort", () => {
    const fixture = emergenceFixture();
    seedCohort(fixture, ["failed", "failed", "failed"]);
    fixture.evidence.putOutcomeEvidence(
      outcomeEvidence(TENANT, {
        outcomeId: "out-other-shape",
        shape: { shapeKey: "shape-other999" },
        observation: {
          status: "failed",
          source: { kind: "mission", ref: "mission-other-shape" },
          observedAt: T0 + 99,
          failure: { kind: "mixed-causes", detail: "other shape" },
        },
      }),
    );
    const gaps = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    const shapeGaps = gaps.filter((gap) => gap.signalKind === "shape-underperformance");
    expect(shapeGaps).toHaveLength(1);
    expect(shapeGaps[0]?.cohortSamples).toBe(3);
  });
});

describe("effort-strain: recurring strained failures", () => {
  it("three failed strained outcomes derive an effort gap with the summed strain", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gaps = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    const gap = gaps.find((candidate) => candidate.signalKind === "effort-strain");
    expect(gap).toBeDefined();
    if (!gap) throw new Error("unreachable");
    expect(gap.effortShareSum).toBe(2.85);
    expect(gap.recurrenceCount).toBe(3);
  });

  it("strained but ACHIEVED outcomes and unstrained failures never feed the effort signal", () => {
    const fixture = emergenceFixture();
    for (let index = 1; index <= 3; index += 1) {
      fixture.evidence.putOutcomeEvidence(
        outcomeEvidence(TENANT, {
          outcomeId: `out-achieved-strained-${index}`,
          observation: {
            status: "achieved",
            source: { kind: "mission", ref: `mission-ach-${index}` },
            observedAt: T0 + index,
          },
        }),
      );
    }
    for (let index = 1; index <= 3; index += 1) {
      fixture.evidence.putOutcomeEvidence(
        outcomeEvidence(TENANT, {
          outcomeId: `out-failed-relaxed-${index}`,
          allocation: {
            actorCount: 4,
            humanLikeActorCount: 1,
            automatedActorCount: 3,
            totalEffortShare: 0.5,
          },
          observation: {
            status: "failed",
            source: { kind: "mission", ref: `mission-relaxed-${index}` },
            observedAt: T0 + index,
            failure: { kind: "low-load", detail: "failed under low load" },
          },
        }),
      );
    }
    const gaps = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    expect(gaps.find((gap) => gap.signalKind === "effort-strain")).toBeUndefined();
  });
});

describe("knowledge-gap: recurring cognition unknowns across DISTINCT missions", () => {
  it("the same question on three distinct missions derives a gap citing the unknown ids verbatim", () => {
    const fixture = emergenceFixture();
    const question = "which supplier certifies payload integrity?";
    for (let index = 1; index <= 3; index += 1) {
      fixture.evidence.putUnknownSignal(
        unknownSignal(TENANT, {
          unknownId: `unk-${index}`,
          missionRef: `mission-${index}`,
          question,
        }),
      );
    }
    const gaps = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    const gap = gaps.find((candidate) => candidate.signalKind === "knowledge-gap");
    expect(gap).toBeDefined();
    if (!gap) throw new Error("unreachable");
    expect(gap.unknownIds).toEqual(["unk-1", "unk-2", "unk-3"]);
    expect(gap.outcomeIds).toEqual([]);
    expect(gap.affectedMissionRefs).toEqual(["mission-1", "mission-2", "mission-3"]);
    expect(gap.demandedCapabilities).toEqual([]);
  });

  it("the same question twice on ONE mission (two distinct) does not reach the threshold", () => {
    const fixture = emergenceFixture();
    fixture.evidence.putUnknownSignal(
      unknownSignal(TENANT, { unknownId: "unk-a", missionRef: "mission-1" }),
    );
    fixture.evidence.putUnknownSignal(
      unknownSignal(TENANT, { unknownId: "unk-b", missionRef: "mission-1" }),
    );
    fixture.evidence.putUnknownSignal(
      unknownSignal(TENANT, { unknownId: "unk-c", missionRef: "mission-2" }),
    );
    expect(okOf(fixture.emergence.detectGaps(TENANT, QUERY))).toEqual([]);
  });
});

describe("determinism + no-fabrication + query validation (pure laws)", () => {
  it("the same evidence + query produce byte-identical gaps, gapId ascending (repeated)", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const first = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    const second = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    for (let index = 1; index < first.length; index += 1) {
      expect(first[index - 1]!.gapId < first[index]!.gapId).toBe(true);
    }
  });

  it("the PURE derivation equals the service derivation over the same records", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const viaService = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    const viaPure = okOf(
      detectEmergenceGaps(
        fixture.evidence.listOutcomeEvidence(TENANT),
        fixture.evidence.listUnknownSignals(TENANT),
        QUERY,
      ),
    );
    expect(JSON.stringify(viaPure)).toBe(JSON.stringify(viaService));
  });

  it("every cited id exists verbatim among the seeded records (no fabrication)", () => {
    const fixture = emergenceFixture();
    const ids = seedRecurringFailures(fixture, TENANT, 3);
    const gaps = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    const seeded = new Set(ids);
    for (const gap of gaps) {
      for (const id of gap.outcomeIds) expect(seeded.has(id)).toBe(true);
      for (const id of gap.unknownIds ?? []) expect(seeded.has(id)).toBe(true);
    }
  });

  it("empty evidence derives zero gaps (an ok empty list, not an error)", () => {
    const fixture = emergenceFixture();
    expect(okOf(fixture.emergence.detectGaps(TENANT, QUERY))).toEqual([]);
  });

  it("malformed queries are typed validation refusals (now + every threshold field)", () => {
    const fixture = emergenceFixture();
    const badNow = errOf(fixture.emergence.detectGaps(TENANT, { now: -1 }));
    expect(badNow.code).toBe("emergence-validation");
    expect(badNow.issues.map((issue) => issue.field)).toContain("now");
    const badRecurrence = errOf(
      fixture.emergence.detectGaps(TENANT, { now: QUERY.now, thresholds: { minRecurrence: 0 } }),
    );
    expect(badRecurrence.code).toBe("emergence-validation");
    expect(badRecurrence.issues.map((issue) => issue.field)).toContain("thresholds.minRecurrence");
    const badRate = errOf(
      fixture.emergence.detectGaps(TENANT, {
        now: QUERY.now,
        thresholds: { shapeFailureRate: 1.5 },
      }),
    );
    expect(badRate.issues.map((issue) => issue.field)).toContain("thresholds.shapeFailureRate");
    const badStrain = errOf(
      fixture.emergence.detectGaps(TENANT, { now: QUERY.now, thresholds: { effortStrain: 0 } }),
    );
    expect(badStrain.issues.map((issue) => issue.field)).toContain("thresholds.effortStrain");
    const badSamples = errOf(
      fixture.emergence.detectGaps(TENANT, { now: QUERY.now, thresholds: { minShapeSamples: 0 } }),
    );
    expect(badSamples.issues.map((issue) => issue.field)).toContain("thresholds.minShapeSamples");
  });
});

describe("tenant isolation: foreign-tenant evidence never feeds a derivation", () => {
  it("tenant B's evidence is invisible to tenant A's detection (and vice versa)", () => {
    const fixture = emergenceFixture();
    const tenantB = scopeOf("tenant-b");
    seedRecurringFailures(fixture, tenantB, 3);
    expect(okOf(fixture.emergence.detectGaps(TENANT, QUERY))).toEqual([]);
    const gapsB = okOf(fixture.emergence.detectGaps(tenantB, QUERY));
    expect(gapsB.length).toBeGreaterThan(0);
    for (const gap of gapsB) {
      expect(gap.affectedMissionRefs.every((ref) => ref.startsWith("mission-"))).toBe(true);
    }
    expect(fixture.evidence.allOutcomeEvidence()).toHaveLength(3);
  });

  it("two tenants' evidence pools NEVER mix: same-shape failures in both tenants stay separate", () => {
    const fixture = emergenceFixture();
    const tenantB = scopeOf("tenant-b");
    seedRecurringFailures(fixture, TENANT, 3);
    seedRecurringFailures(fixture, tenantB, 2);
    const gapsA = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
    const gapA = gapsA.find((gap) => gap.signalKind === "capability-shortfall");
    expect(gapA?.recurrenceCount).toBe(3);
    const gapsB = okOf(fixture.emergence.detectGaps(tenantB, QUERY));
    expect(gapsB.find((gap) => gap.signalKind === "capability-shortfall")).toBeUndefined();
  });
});

/** Compile-time fixture typing guard (used by the tests above). */
export type { EmergenceFixture, EmergenceGap, MarketplaceTenantScope };
