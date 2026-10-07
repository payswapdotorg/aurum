/**
 * Freshness: temporal validity classification (spec/DOMAIN-MAPPING.md).
 * Every evidence-bearing record carries a freshness stamp; classification is
 * an explicit pure function of stamp, policy and the caller-supplied `now`.
 * A missing `asOf` classifies as "unknown" — never silently treated as fresh.
 */
import type { DomainTimestamp } from "../core/branding.js";

export type FreshnessClass = "current" | "aging" | "stale" | "unknown";

/**
 * Freshness policy: age up to `currentWithinMs` counts as current; up to
 * `agingWithinMs` as aging; anything older is stale. Policies are explicit
 * data so different evidence kinds can carry different requirements
 * (spec/ARCHITECTURE.md information strategy: freshness requirement).
 */
export interface FreshnessPolicy {
  readonly currentWithinMs: number;
  readonly agingWithinMs: number;
}

export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = {
  currentWithinMs: 7 * 24 * 60 * 60 * 1000,
  agingWithinMs: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Freshness stamp retained on every evidence-bearing record. `asOf` is when
 * the underlying fact was last known to hold; `validUntil` is an explicit
 * expiry declared by the source, if any.
 */
export interface FreshnessStamp {
  readonly asOf?: DomainTimestamp;
  readonly validUntil?: DomainTimestamp;
}

/** Pure temporal validity classification. */
export function classifyFreshness(
  stamp: FreshnessStamp | undefined,
  now: DomainTimestamp,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): FreshnessClass {
  if (!stamp || stamp.asOf === undefined) return "unknown";
  if (stamp.validUntil !== undefined && stamp.validUntil < now) return "stale";
  const age = now - stamp.asOf;
  if (age < 0) return "unknown";
  if (age <= policy.currentWithinMs) return "current";
  if (age <= policy.agingWithinMs) return "aging";
  return "stale";
}

/**
 * Freshness resolution: a stamp carrying asOf or validUntil is kept verbatim;
 * a missing or empty stamp defaults to asOf = the given fallback time (for
 * observations: observedAt; for claims: the provenance recordedAt). To
 * record genuinely unknown freshness, supply a stamp with only `validUntil`
 * (or none of the defaults) — `classifyFreshness` classifies missing asOf
 * as the explicit "unknown" class.
 */
export function resolveFreshness(
  stamp: FreshnessStamp | undefined,
  fallbackAsOf: number,
): FreshnessStamp {
  if (stamp !== undefined && (stamp.asOf !== undefined || stamp.validUntil !== undefined)) {
    return stamp;
  }
  return { asOf: fallbackAsOf as DomainTimestamp };
}
