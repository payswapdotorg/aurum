/**
 * ContextFingerprint unit proofs: determinism (same situation -> identical
 * fingerprint), axis sensitivity (each of the five axes alone changes the
 * digest), validation refusals, and serializability.
 */
import { describe, expect, it } from "vitest";
import { contextFingerprint, fingerprintIssues, type FingerprintInput } from "../src/index.js";
import { errOf, okOf } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

function baseInput(): FingerprintInput {
  return {
    goalPriority: "medium",
    horizon: { start: T0, end: T0 + 45 * DAY },
    openUnknowns: 0,
    openContradictions: 0,
    evidenceFreshness: ["current", "aging"],
    capabilityDemand: [
      { capabilityId: "cap-a", requiredLevel: 4, requiredCapacityPerPeriod: 45 },
      { capabilityId: "cap-b", requiredLevel: 3 },
    ],
  };
}

describe("ContextFingerprint", () => {
  it("is deterministic: the same situation produces the identical fingerprint", () => {
    const first = okOf(contextFingerprint(baseInput()));
    const second = okOf(contextFingerprint(baseInput()));
    expect(first.digest).toBe(second.digest);
    expect(first.canonical).toBe(second.canonical);
    expect(first.axes).toEqual(second.axes);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("is invariant to demand entry ORDER (canonicalized by capability id)", () => {
    const input = baseInput();
    const reordered = okOf(
      contextFingerprint({
        ...input,
        capabilityDemand: [...input.capabilityDemand].reverse(),
      }),
    );
    expect(reordered.digest).toBe(okOf(contextFingerprint(input)).digest);
  });

  it("axis sensitivity: goal pressure alone changes the digest", () => {
    const base = okOf(contextFingerprint(baseInput()));
    const urgent = okOf(contextFingerprint({ ...baseInput(), goalPriority: "critical" }));
    expect(urgent.axes.goalPressure).toBe("urgent");
    expect(urgent.digest).not.toBe(base.digest);
  });

  it("axis sensitivity: time horizon alone changes the digest (bucketing)", () => {
    const base = okOf(contextFingerprint(baseInput()));
    const immediate = okOf(
      contextFingerprint({ ...baseInput(), horizon: { start: T0, end: T0 + 6 * 60 * 60 * 1000 } }),
    );
    expect(immediate.axes.timeHorizon).toBe("immediate");
    expect(base.axes.timeHorizon).toBe("medium");
    expect(immediate.digest).not.toBe(base.digest);
  });

  it("axis sensitivity: uncertainty alone changes the digest (thresholds)", () => {
    const known = okOf(contextFingerprint(baseInput()));
    const bounded = okOf(contextFingerprint({ ...baseInput(), openUnknowns: 1 }));
    const open = okOf(contextFingerprint({ ...baseInput(), openUnknowns: 3 }));
    const contradiction = okOf(contextFingerprint({ ...baseInput(), openContradictions: 1 }));
    expect(known.axes.uncertaintyClass).toBe("known");
    expect(bounded.axes.uncertaintyClass).toBe("bounded");
    expect(open.axes.uncertaintyClass).toBe("open");
    expect(contradiction.axes.uncertaintyClass).toBe("open");
    expect(new Set([known, bounded, open, contradiction].map((fp) => fp.digest)).size).toBe(3);
    expect(open.digest).toBe(contradiction.digest); // both classify as "open"
  });

  it("axis sensitivity: freshness signal aggregates the WORST evidence class", () => {
    const stale = okOf(
      contextFingerprint({ ...baseInput(), evidenceFreshness: ["current", "stale"] }),
    );
    const unknown = okOf(contextFingerprint({ ...baseInput(), evidenceFreshness: [] }));
    expect(stale.axes.freshnessSignal).toBe("stale");
    expect(unknown.axes.freshnessSignal).toBe("unknown");
    expect(stale.digest).not.toBe(unknown.digest);
  });

  it("axis sensitivity: capability demand profile alone changes the digest", () => {
    const base = okOf(contextFingerprint(baseInput()));
    const higher = okOf(
      contextFingerprint({
        ...baseInput(),
        capabilityDemand: [
          { capabilityId: "cap-a", requiredLevel: 5, requiredCapacityPerPeriod: 45 },
          { capabilityId: "cap-b", requiredLevel: 3 },
        ],
      }),
    );
    expect(higher.digest).not.toBe(base.digest);
  });

  it("refuses invalid inputs with typed validation errors carrying issues", () => {
    const cases: FingerprintInput[] = [
      { ...baseInput(), goalPriority: "whenever" },
      { ...baseInput(), horizon: { start: T0 + DAY, end: T0 } },
      { ...baseInput(), openUnknowns: -1 },
      { ...baseInput(), evidenceFreshness: ["fresh"] },
      { ...baseInput(), capabilityDemand: [] },
      { ...baseInput(), capabilityDemand: [{ capabilityId: "", requiredLevel: 3 }] },
      { ...baseInput(), capabilityDemand: [{ capabilityId: "x", requiredLevel: 9 }] },
      {
        ...baseInput(),
        capabilityDemand: [
          { capabilityId: "cap-a", requiredLevel: 3 },
          { capabilityId: "cap-a", requiredLevel: 4 },
        ],
      },
    ];
    for (const input of cases) {
      const error = errOf(contextFingerprint(input));
      expect(error.name).toBe("LabError");
      expect(error.code).toBe("lab-validation");
      expect(error.issues.length).toBeGreaterThan(0);
      expect(fingerprintIssues(input).length).toBeGreaterThan(0);
    }
  });

  it("is serializable: JSON round-trip preserves axes, canonical form and digest", () => {
    const fingerprint = okOf(contextFingerprint(baseInput()));
    const roundTripped = JSON.parse(JSON.stringify(fingerprint)) as typeof fingerprint;
    expect(roundTripped).toEqual(fingerprint);
    expect(contextFingerprint(baseInput()).ok).toBe(true);
  });

  it("canonical form is stable, versioned and human-readable", () => {
    const fingerprint = okOf(contextFingerprint(baseInput()));
    expect(fingerprint.canonical).toContain("fp:v1");
    expect(fingerprint.canonical).toContain("pressure=standard");
    expect(fingerprint.canonical).toContain("demand=cap-a:4:45,cap-b:3");
    expect(fingerprint.digest).toMatch(/^[0-9a-f]{16}$/);
  });
});
