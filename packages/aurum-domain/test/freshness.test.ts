/**
 * ACCEPTANCE PROOF — freshness classification: explicit temporal validity.
 * Missing as-of information is an explicit "unknown" class, never silently
 * fresh; boundaries follow the policy exactly.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRESHNESS_POLICY,
  classifyFreshness,
  createAuditTrailStore,
  createEvidenceLedger,
  tenantScope,
  type DomainTimestamp,
  type FreshnessPolicy,
} from "../src/index.js";
import { now } from "./helpers.js";

const policy: FreshnessPolicy = { currentWithinMs: 1000, agingWithinMs: 5000 };
const t: DomainTimestamp = now(0);
const at = (ms: number): DomainTimestamp => now(0 + ms / 1000);

describe("freshness classification", () => {
  it("missing stamp or missing asOf is explicitly unknown", () => {
    expect(classifyFreshness(undefined, t, policy)).toBe("unknown");
    expect(classifyFreshness({}, t, policy)).toBe("unknown");
  });

  it("age within currentWithinMs is current (boundary inclusive)", () => {
    expect(classifyFreshness({ asOf: at(-1000) }, t, policy)).toBe("current");
    expect(classifyFreshness({ asOf: at(-1001) }, t, policy)).not.toBe("current");
  });

  it("age beyond current but within aging is aging (boundary inclusive)", () => {
    expect(classifyFreshness({ asOf: at(-1001) }, t, policy)).toBe("aging");
    expect(classifyFreshness({ asOf: at(-5000) }, t, policy)).toBe("aging");
    expect(classifyFreshness({ asOf: at(-5001) }, t, policy)).toBe("stale");
  });

  it("an explicit validUntil in the past makes the record stale regardless of asOf", () => {
    expect(classifyFreshness({ asOf: at(-10), validUntil: at(-1) }, t, policy)).toBe("stale");
    expect(classifyFreshness({ asOf: at(-10), validUntil: at(10) }, t, policy)).toBe("current");
  });

  it("future-dated asOf is unknown, not negative-fresh", () => {
    expect(classifyFreshness({ asOf: at(500) }, t, policy)).toBe("unknown");
  });

  it("the default policy classifies a week-old record as current-ish and a two-month-old as stale", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(classifyFreshness({ asOf: at(-3 * day) }, t)).toBe("current");
    expect(classifyFreshness({ asOf: at(-14 * day) }, t)).toBe("aging");
    expect(classifyFreshness({ asOf: at(-70 * day) }, t)).toBe("stale");
    expect(DEFAULT_FRESHNESS_POLICY.agingWithinMs).toBeGreaterThan(
      DEFAULT_FRESHNESS_POLICY.currentWithinMs,
    );
  });

  it("observations default their freshness to observedAt, keeping unknowns explicit", () => {
    const sink = createAuditTrailStore();
    const ledger = createEvidenceLedger(sink);
    const scopeResult = tenantScope("acme");
    if (!scopeResult.ok) throw new Error("setup");
    const recorded = ledger.recordObservation(scopeResult.value, {
      observationId: "o-1",
      subject: { kind: "topic", id: "t" },
      content: "c",
      observedAt: at(-2000),
      provenance: {
        actor: { kind: "system", name: "x" },
        source: "system-captured",
        recordedAt: t,
      },
    });
    if (!recorded.ok) throw new Error(recorded.error.message);
    expect(recorded.value.freshness.asOf).toBe(at(-2000));
    expect(classifyFreshness(recorded.value.freshness, t, policy)).toBe("aging");
  });
});
