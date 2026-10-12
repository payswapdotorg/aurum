/**
 * ACCEPTANCE (catalog W004, clause "no fabricated certainty"): THE HONESTY
 * RULES, PROVED ON THE PURE CLASSIFIER.
 *
 * This file locks the four classification paths and their boundaries:
 * - claim support derivation (active claim + zero active sources →
 *   superseded — never support);
 * - read-side belief assertion (>= 1 active claim), re-derived here because
 *   the kernel never auto-revises beliefs on claim retraction;
 * - worst-support freshness (one expired support expires the chain);
 * - the four paths: evidenced / partial / unknown / learning-mission-required;
 * - boundaries: empty chains, structural-only chains, retracted entries,
 *   monotonicity (adding usable evidence never degrades; retraction is the
 *   only degrading path and it degrades through the same ladder).
 *
 * Imports follow the module boundary rules: the company surface comes from
 * the PUBLIC application contract (../src/index.js) — the same boundary
 * other modules use.
 */
import { describe, expect, it } from "vitest";
import { personActor } from "@aurum/domain";
import {
  beliefIsAsserted,
  claimSupportStatus,
  classifySubjectKnowledge,
  worstSupportFreshness,
} from "../src/index.js";
import type {
  BeliefEntry,
  ClaimEntry,
  ClassificationInput,
  MemoryEntry,
  ObservationEntry,
} from "../src/index.js";

const T0 = 1_700_000_000_000;

const observation = (over: Partial<ObservationEntry> = {}): ObservationEntry => ({
  recordId: "obs-1",
  kind: "observation",
  observationId: "obs-1" as ObservationEntry["observationId"],
  content: "obs content",
  status: "active",
  observedAt: T0 as ObservationEntry["observedAt"],
  provenance: { actor: personActor("boss"), source: "human-entered", recordedAt: T0 },
  freshness: "current",
  ...over,
});

const claim = (over: Partial<ClaimEntry> = {}): ClaimEntry => ({
  recordId: "claim-1",
  kind: "claim",
  claimId: "claim-1" as ClaimEntry["claimId"],
  statement: "claim statement",
  support: "active",
  derivedFrom: [observation()],
  provenance: { actor: personActor("boss"), source: "human-entered", recordedAt: T0 },
  freshness: "current",
  ...over,
});

const belief = (over: Partial<BeliefEntry> = {}): BeliefEntry => ({
  recordId: "belief-1",
  kind: "belief",
  beliefId: "belief-1" as BeliefEntry["beliefId"],
  subject: { kind: "topic", id: "t-1" },
  statement: "belief statement",
  revision: 1,
  asserted: true,
  supportingClaims: [claim()],
  provenance: { actor: personActor("boss"), source: "human-entered", recordedAt: T0 },
  freshness: "current",
  ...over,
});

const memory = (over: Partial<MemoryEntry> = {}): MemoryEntry => ({
  recordId: "mem-1",
  kind: "memory",
  memoryId: "mem-1" as MemoryEntry["memoryId"],
  subject: { kind: "topic", id: "t-1" },
  content: "memory content",
  version: 1,
  provenance: { actor: personActor("boss"), source: "human-entered", recordedAt: T0 },
  freshness: "current",
  ...over,
});

const input = (over: Partial<ClassificationInput> = {}): ClassificationInput => ({
  observations: [],
  beliefs: [],
  memories: [],
  consequential: false,
  ...over,
});

describe("claim support derivation (the honesty rule)", () => {
  it("an active claim with at least one active source is active support", () => {
    const status = claimSupportStatus({
      status: "active",
      derivedFrom: [observation({ status: "retracted" }), observation({ recordId: "obs-2" })],
    });
    expect(status).toBe("active");
  });

  it("an active claim with zero active sources reads as superseded, never as support", () => {
    const status = claimSupportStatus({
      status: "active",
      derivedFrom: [observation({ status: "retracted" }), observation({ status: "superseded" })],
    });
    expect(status).toBe("superseded");
  });

  it("lifecycle statuses are carried verbatim (retracted/superseded)", () => {
    expect(claimSupportStatus({ status: "retracted", derivedFrom: [] })).toBe("retracted");
    expect(claimSupportStatus({ status: "superseded", derivedFrom: [] })).toBe("superseded");
  });

  it("an empty chain (no sources at all) is the empty-chains boundary: superseded", () => {
    expect(claimSupportStatus({ status: "active", derivedFrom: [] })).toBe("superseded");
  });
});

describe("read-side belief assertion", () => {
  it("a belief with >= 1 active supporting claim is asserted", () => {
    expect(beliefIsAsserted({ supportingClaims: [claim({ support: "active" })] })).toBe(true);
  });

  it("a belief whose claims were all retracted after the revision was written is NOT asserted", () => {
    const degraded = belief({
      asserted: true,
      supportingClaims: [
        claim({ support: "retracted" }),
        claim({ support: "superseded", recordId: "claim-2" }),
      ],
    });
    expect(beliefIsAsserted(degraded)).toBe(false);
  });

  it("a belief with no supporting claims at all is not asserted", () => {
    expect(beliefIsAsserted({ supportingClaims: [] })).toBe(false);
  });
});

describe("worst support freshness (one expired support expires the chain)", () => {
  it("mixed fresh and stale active support reads as stale (conservative)", () => {
    const mixed = belief({
      supportingClaims: [
        claim({ recordId: "c-fresh", freshness: "current" }),
        claim({ recordId: "c-stale", freshness: "stale", support: "active" }),
      ],
    });
    expect(worstSupportFreshness(mixed)).toBe("stale");
  });

  it("all-current support reads as current; unknown freshness reads as unknown", () => {
    const fresh = belief({ supportingClaims: [claim({ freshness: "current" })] });
    expect(worstSupportFreshness(fresh)).toBe("current");
    const unknownFresh = belief({
      supportingClaims: [claim({ freshness: "unknown", support: "active" })],
    });
    expect(worstSupportFreshness(unknownFresh)).toBe("unknown");
  });

  it("no active support yields undefined", () => {
    const none = belief({ supportingClaims: [claim({ support: "retracted" })] });
    expect(worstSupportFreshness(none)).toBeUndefined();
  });
});

describe("the four classification paths", () => {
  it("path 1 — evidenced: asserted belief, every usable support current or aging", () => {
    const outcome = classifySubjectKnowledge(
      input({
        beliefs: [belief({ supportingClaims: [claim({ freshness: "aging" })] })],
      }),
    );
    expect(outcome.classification).toBe("evidenced");
    expect(outcome.evidencedBeliefId).toBe("belief-1");
    expect(outcome.basis).toContain("belief-1 revision 1");
    expect(outcome.basis).toContain("aging");
  });

  it("path 2a — partial: asserted belief resting on stale support", () => {
    const outcome = classifySubjectKnowledge(
      input({
        beliefs: [
          belief({
            supportingClaims: [claim({ freshness: "stale", support: "active" })],
          }),
        ],
      }),
    );
    expect(outcome.classification).toBe("partial");
    expect(outcome.basis).toContain("stale or unknown-freshness support");
  });

  it("path 2b — partial: usable observations but no asserted chain", () => {
    const outcome = classifySubjectKnowledge(
      input({
        observations: [observation(), observation({ recordId: "obs-2", status: "retracted" })],
        memories: [memory()],
      }),
    );
    expect(outcome.classification).toBe("partial");
    expect(outcome.basis).toContain("1 usable observation");
    expect(outcome.basis).toContain("1 memory");
  });

  it("path 3 — unknown: no usable evidence at all (empty chains boundary)", () => {
    const outcome = classifySubjectKnowledge(input());
    expect(outcome.classification).toBe("unknown");
    expect(outcome.basis).toBe("no usable evidence records about the subject");
  });

  it("path 4 — learning-mission-required: no usable evidence, consequence recorded", () => {
    const outcome = classifySubjectKnowledge(input({ consequential: true, openUnknownCount: 2 }));
    expect(outcome.classification).toBe("learning-mission-required");
    expect(outcome.basis).toContain("2 open unknown(s)");
  });

  it("the classification and basis are pure functions of the input (determinism)", () => {
    const subject = input({ observations: [observation()] });
    const again = input({ observations: [observation()] });
    expect(classifySubjectKnowledge(subject)).toEqual(classifySubjectKnowledge(again));
  });
});

describe("boundaries: structural-only chains and retracted entries", () => {
  it("structural-only chains do not count: beliefs exist but none can assert, no observations", () => {
    const outcome = classifySubjectKnowledge(
      input({
        beliefs: [
          belief({
            asserted: false,
            supportingClaims: [claim({ support: "superseded" })],
          }),
        ],
      }),
    );
    expect(outcome.classification).toBe("unknown");
  });

  it("retracted observations are invisible to the ladder (reported, never supporting)", () => {
    const outcome = classifySubjectKnowledge(
      input({
        observations: [observation({ status: "retracted" }), observation({ status: "superseded" })],
        memories: [],
      }),
    );
    expect(outcome.classification).toBe("unknown");
  });

  it("a memory alone (no observations, no beliefs) is partial, never evidenced", () => {
    const outcome = classifySubjectKnowledge(input({ memories: [memory()] }));
    expect(outcome.classification).toBe("partial");
  });
});

describe("monotonicity (adding usable evidence never degrades)", () => {
  const zero = input();
  const raw = input({ observations: [observation()] });
  const assertedStale = input({
    observations: [observation()],
    beliefs: [belief({ supportingClaims: [claim({ freshness: "stale", support: "active" })] })],
  });
  const evidenced = input({
    observations: [observation()],
    beliefs: [belief({ supportingClaims: [claim({ freshness: "current" })] })],
  });

  it("unknown upgrades to partial when a usable observation arrives", () => {
    expect(classifySubjectKnowledge(zero).classification).toBe("unknown");
    expect(classifySubjectKnowledge(raw).classification).toBe("partial");
  });

  it("partial upgrades to evidenced when a fresh usable chain arrives", () => {
    expect(classifySubjectKnowledge(assertedStale).classification).toBe("partial");
    expect(classifySubjectKnowledge(evidenced).classification).toBe("evidenced");
  });

  it("evidenced is sticky: adding more evidence never degrades it", () => {
    const more = input({
      observations: [observation(), observation({ recordId: "obs-x", freshness: "stale" })],
      memories: [memory({ freshness: "stale" })],
      beliefs: [
        belief({ supportingClaims: [claim({ freshness: "current" })] }),
        belief({
          recordId: "belief-2",
          beliefId: "belief-2" as BeliefEntry["beliefId"],
          asserted: false,
          supportingClaims: [claim({ support: "retracted", recordId: "claim-9" })],
        }),
      ],
    });
    expect(classifySubjectKnowledge(more).classification).toBe("evidenced");
  });

  it("consequence annotations apply only at zero usable evidence", () => {
    const flagged = input({ consequential: true, openUnknownCount: 3 });
    expect(classifySubjectKnowledge(flagged).classification).toBe("learning-mission-required");
    const flaggedWithEvidence = input({
      consequential: true,
      openUnknownCount: 3,
      observations: [observation()],
    });
    expect(classifySubjectKnowledge(flaggedWithEvidence).classification).toBe("partial");
    expect(classifySubjectKnowledge(flaggedWithEvidence).classification).not.toBe(
      "learning-mission-required",
    );
  });
});
