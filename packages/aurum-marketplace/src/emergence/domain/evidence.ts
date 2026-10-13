/**
 * Emergence evidence intake (W014 domain layer): the STRUCTURAL MIRROR of
 * the W013 learning evidence shapes. This is how outcome-learning evidence
 * enters the emergence area WITHOUT an `@aurum/application` import (the
 * marketplace module cannot depend on the application package — the W011
 * tripwire law + the architecture policy's requires list; see
 * spec/contract-requests/CR-W014-emergence-evidence-wiring.md).
 *
 * MIRROR LAW (the W011 `primitives.ts` law, applied to the W013 records):
 * every field here is a STRUCTURAL PICK of the upstream W013
 * `OutcomeJoinRecord` / `OutcomeObservation` / `ContextClass` /
 * `OrganizationShape` / `AllocationJoin` shapes — SAME field names, subset
 * of fields. A REAL W013 record (which has MORE fields) is therefore
 * assignable to the intake shape with ZERO mapping code: the host
 * composition feeds its outcome store straight into the port. The mirror
 * is guarded EXACT against the upstream source files by content scan
 * (test/emergence-tripwires.test.ts — the W011 vocabulary-equality
 * precedent).
 *
 * COPIED-VERBATIM LAW (no second evidence system): the context class key,
 * demand signature, organization shape key, effort totals and failure
 * details are CARRIED from the intake records — never re-derived here.
 * Gap detection GROUPS on these carried keys; it does not invent a second
 * conditioning vocabulary (W013 ruling 3, read-only).
 */
import type { MarketplaceTenantScopedRecord } from "../../marketplace/contract.marketplace.js";

/** The outcome statuses (mirrors W013 OUTCOME_STATUSES, frozen). */
export const EMERGENCE_OUTCOME_STATUSES = ["achieved", "partial", "missed", "failed"] as const;

export type EmergenceOutcomeStatus = (typeof EMERGENCE_OUTCOME_STATUSES)[number];

export function isKnownEmergenceOutcomeStatus(value: string): value is EmergenceOutcomeStatus {
  return (EMERGENCE_OUTCOME_STATUSES as readonly string[]).includes(value);
}

/** missed + failed are failures (mirrors the W013 isFailedOutcomeStatus law). */
export function isFailedEmergenceOutcomeStatus(status: EmergenceOutcomeStatus): boolean {
  return status === "missed" || status === "failed";
}

/** The outcome observation, as emergence consumes it (W013 structural pick). */
export interface EmergenceOutcomeObservation {
  readonly status: EmergenceOutcomeStatus;
  /** Where the outcome was observed (W013: mission/plan/manual + ref). */
  readonly source: { readonly kind: string; readonly ref: string };
  /** When the outcome was observed (epoch ms; drives recurrence windows). */
  readonly observedAt: number;
  /** First-class failure detail (present for failed/missed outcomes). */
  readonly failure?: { readonly kind: string; readonly detail: string };
  /** Observed metric vs target (present when a metric was tracked). */
  readonly metric?: {
    readonly metric: string;
    readonly observed: number;
    readonly target: number;
  };
}

/**
 * The actor-allocation join dimension, as emergence consumes it (W013
 * AllocationJoin structural pick — the effort/strain signals).
 */
export interface EmergenceAllocationJoin {
  readonly actorCount: number;
  /** human + team actors (in-house oversight capacity). */
  readonly humanLikeActorCount: number;
  /** agent + agent-team + software + automation actors. */
  readonly automatedActorCount: number;
  /** Sum of assignment effort shares (the allocation strain signal). */
  readonly totalEffortShare: number;
}

/**
 * The conditioning class, as emergence consumes it (W013 `ContextClass`
 * structural pick — NESTED, exactly where the upstream record carries it,
 * so a real OutcomeJoinRecord assigns without mapping code).
 */
export interface EmergenceContextClassPick {
  /** 16-hex deterministic class digest (carried, never re-derived). */
  readonly classKey: string;
  /** Sorted `capabilityId:level` pairs, comma-joined (carried verbatim). */
  readonly demandSignature: string;
}

/** The organization shape, as emergence consumes it (W013 pick). */
export interface EmergenceShapePick {
  /** 16-hex deterministic shape digest (carried, never re-derived). */
  readonly shapeKey: string;
}

/**
 * One W013 outcome join record, as emergence consumes it. Fields carried
 * verbatim: ids (outcome/evaluation/candidate/goal), the conditioning keys
 * (contextClass.classKey + demandSignature, shape.shapeKey), the
 * observation (status, source, failure, metric), the allocation strain and
 * the record stamp.
 */
export interface EmergenceOutcomeEvidence extends MarketplaceTenantScopedRecord {
  readonly outcomeId: string;
  readonly evaluationId: string;
  readonly candidateId: string;
  readonly goalId?: string;
  /** The W013 conditioning class (nested pick; carried, never re-derived). */
  readonly contextClass: EmergenceContextClassPick;
  /** The W013 organization shape (nested pick; carried, never re-derived). */
  readonly shape: EmergenceShapePick;
  readonly observation: EmergenceOutcomeObservation;
  readonly allocation: EmergenceAllocationJoin;
  readonly recordedAt: number;
}

/**
 * One cognition unknown signal (the W007 `UnknownEffect` essence: a
 * question + its consequence, per mission run — mirroring the W013
 * mission-source discipline that maps knowledge gaps to first-class
 * failures). Optional supplementary demand signal: unknowns that recur
 * across DISTINCT missions evidence a standing knowledge/capability gap.
 */
export interface EmergenceUnknownSignal extends MarketplaceTenantScopedRecord {
  readonly unknownId: string;
  readonly question: string;
  readonly consequence: string;
  /** The mission run that surfaced the unknown (W013 source ref shape). */
  readonly missionRef: string;
  readonly goalId?: string;
  readonly observedAt: number;
}

/** Parses a W013 demand signature into demanded capabilities. Pure. */
export function demandedCapabilitiesOf(
  demandSignature: string,
): readonly { capabilityId: string; level: number }[] {
  const trimmed = typeof demandSignature === "string" ? demandSignature.trim() : "";
  if (trimmed.length === 0) return [];
  const parsed: { capabilityId: string; level: number }[] = [];
  for (const pair of trimmed.split(",")) {
    const separator = pair.lastIndexOf(":");
    if (separator <= 0) continue;
    const capabilityId = pair.slice(0, separator).trim();
    const level = Number(pair.slice(separator + 1));
    if (capabilityId.length === 0 || !Number.isInteger(level) || level < 0 || level > 5) continue;
    parsed.push({ capabilityId, level });
  }
  return Object.freeze(parsed.sort((a, b) => (a.capabilityId < b.capabilityId ? -1 : 1)));
}
