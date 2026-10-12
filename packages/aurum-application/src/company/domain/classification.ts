/**
 * The company honesty classifier (W004, pure domain layer): the single place
 * that decides how much certainty a company answer may claim. It walks every
 * evidence chain to the BOTTOM — observation by observation — and never lets
 * structural links stand in for usable evidence.
 *
 * THE HONESTY LAWS (catalog W004 acceptance, test-locked in
 * test/company-honesty.test.ts):
 *
 * 1. FOUR PATHS, exactly one per answer: evidenced / partial / unknown /
 *    learning-mission-required. Fabricated certainty is impossible by
 *    construction: "evidenced" requires a belief whose CURRENT support is
 *    re-derived on the read side, not the write side.
 *
 * 2. RETRACTED ENTRIES ARE INVISIBLE TO THE LADDER. The kernel enforced
 *    observation existence and claim usability at WRITE time; retraction
 *    afterwards must not leave zombie assertions. So every status is
 *    re-derived here: an active claim with zero active sources reads as
 *    superseded (never as support), and a belief is asserted only while at
 *    least one supporting claim is active.
 *
 * 3. STRUCTURAL-ONLY CHAINS DO NOT COUNT. A chain whose links exist as
 *    records but whose bottom rung carries no usable evidence classifies as
 *    partial at best — never evidenced.
 *
 * 4. FRESHNESS REFINES THE TOP RUNG. An asserted belief evidences the answer
 *    only when EVERY usable supporting claim is current or aging (aging =
 *    decaying but valid). A chain resting on stale or unknown-freshness
 *    support degrades the answer to partial and is surfaced as a blind spot.
 *
 * 5. MONOTONICITY. Adding usable records never lowers the classification
 *    along unknown -> partial -> evidenced; the consequence annotation
 *    (learning-mission-required) applies only at zero usable evidence.
 *    Retraction is the only path that degrades, and it degrades through the
 *    same ladder — never silently.
 */
import type { EvidenceStatus, FreshnessClass } from "@aurum/domain";
import type {
  AnswerClassification,
  BeliefEntry,
  ClaimSupportStatus,
  MemoryEntry,
  ObservationEntry,
} from "./records.js";

/** Freshness ranking; higher is more current. Pure data, no IO. */
const FRESHNESS_RANK: Record<FreshnessClass, number> = {
  current: 3,
  aging: 2,
  stale: 1,
  unknown: 0,
};

/** The minimum freshness that still evidences an answer (law 4). */
const EVIDENCING_FRESHNESS: readonly FreshnessClass[] = ["current", "aging"];

/** Minimal structural shape claim support is derived from. */
export interface ClaimSupportInput {
  /** The claim's own lifecycle status. */
  readonly status: EvidenceStatus;
  /** Entries for the claim's derivedFrom observations, in claim order. */
  readonly derivedFrom: readonly { readonly status: EvidenceStatus }[];
}

/**
 * Derives a claim's support status (the W004 honesty derivation):
 * - retracted claim → "retracted";
 * - superseded claim → "superseded";
 * - active claim with >= 1 active source → "active";
 * - active claim with zero active sources → "superseded" — the structural
 *   chain exists but the evidence is gone; it must never read as support.
 */
export function claimSupportStatus(input: ClaimSupportInput): ClaimSupportStatus {
  if (input.status === "retracted") return "retracted";
  if (input.status === "superseded") return "superseded";
  const activeSources = input.derivedFrom.filter((source) => source.status === "active");
  return activeSources.length >= 1 ? "active" : "superseded";
}

/** Minimal structural shape belief assertion is derived from. */
export interface BeliefAssertionInput {
  readonly supportingClaims: readonly { readonly support: ClaimSupportStatus }[];
}

/**
 * Read-side belief assertion: asserted only while >= 1 supporting claim is
 * active. Claims retracted after the revision was written degrade the belief
 * here — the kernel never auto-revises beliefs on claim retraction.
 */
export function beliefIsAsserted(input: BeliefAssertionInput): boolean {
  return input.supportingClaims.some((claim) => claim.support === "active");
}

/** Minimal structural shape the worst-support freshness is derived from. */
export interface SupportFreshnessInput {
  readonly supportingClaims: readonly {
    readonly support: ClaimSupportStatus;
    readonly freshness: FreshnessClass;
  }[];
}

/**
 * The worst freshness among the belief's USABLE (active) supporting claims —
 * conservative by law 4: one expired support expires the whole chain's
 * claim to currency. Undefined when the belief has no active support.
 */
export function worstSupportFreshness(input: SupportFreshnessInput): FreshnessClass | undefined {
  let worst: FreshnessClass | undefined;
  for (const claim of input.supportingClaims) {
    if (claim.support !== "active") continue;
    if (worst === undefined || FRESHNESS_RANK[claim.freshness] < FRESHNESS_RANK[worst]) {
      worst = claim.freshness;
    }
  }
  return worst;
}

/** The assembled read-side input for one subject. */
export interface ClassificationInput {
  /** All observations about the subject (any status; retractions excluded by law 2). */
  readonly observations: readonly ObservationEntry[];
  /** All beliefs about the subject (current revisions, with chains). */
  readonly beliefs: readonly BeliefEntry[];
  /** All memory records about the subject (append-only, never retracted). */
  readonly memories: readonly MemoryEntry[];
  /** True when an open unknown records the consequence of not knowing this subject. */
  readonly consequential: boolean;
  /** Number of open unknowns related to the subject (for the basis text). */
  readonly openUnknownCount?: number;
}

/** The classification outcome with its deterministic, inspectable basis. */
export interface ClassificationOutcome {
  readonly classification: AnswerClassification;
  readonly basis: string;
  /** Present when evidenced: the belief carrying the fresh usable chain. */
  readonly evidencedBeliefId?: string;
}

/**
 * Classifies what the company knows about one subject. Exactly one of the
 * four paths fires; the basis string is deterministic and safe to display.
 * Empty input (no records at all) is the "empty chains" boundary: unknown,
 * or learning-mission-required when the subject is recorded as consequential.
 */
export function classifySubjectKnowledge(input: ClassificationInput): ClassificationOutcome {
  const usableObservations = input.observations.filter((entry) => entry.status === "active");
  const usableMemories = input.memories;
  const asserted = input.beliefs.filter((belief) => beliefIsAsserted(belief));

  // Path 1 — evidenced: an asserted belief whose every usable support is
  // current or aging (law 4).
  for (const belief of asserted) {
    const worst = worstSupportFreshness(belief);
    if (worst !== undefined && EVIDENCING_FRESHNESS.includes(worst)) {
      const activeClaims = belief.supportingClaims.filter((claim) => claim.support === "active");
      return {
        classification: "evidenced",
        basis:
          `belief ${belief.beliefId} revision ${belief.revision} asserted via ` +
          `${activeClaims.length} active claim(s); support freshness ${worst}`,
        evidencedBeliefId: belief.beliefId,
      };
    }
  }

  // Path 2 — partial: usable evidence exists, but no chain can assert.
  if (asserted.length >= 1) {
    const supports = asserted
      .map(
        (belief) => `${belief.beliefId} (worst support ${worstSupportFreshness(belief) ?? "none"})`,
      )
      .join(", ");
    return {
      classification: "partial",
      basis: `asserted belief(s) rest on stale or unknown-freshness support: ${supports}`,
    };
  }
  if (usableObservations.length >= 1 || usableMemories.length >= 1) {
    return {
      classification: "partial",
      basis:
        `${usableObservations.length} usable observation(s), ${usableMemories.length} memory ` +
        `record(s); no asserted understanding chain`,
    };
  }

  // Paths 3/4 — zero usable evidence. Honest unknown, or — when an open
  // unknown records the consequence of not knowing — a required learning
  // mission (W007 consumes these; nothing is fabricated here).
  if (input.consequential) {
    return {
      classification: "learning-mission-required",
      basis:
        `no usable evidence; ${input.openUnknownCount ?? 1} open unknown(s) record the ` +
        `consequence of not knowing this subject`,
    };
  }
  return {
    classification: "unknown",
    basis: "no usable evidence records about the subject",
  };
}
