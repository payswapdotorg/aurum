/**
 * Concern 7 of 8 — ProviderAvailability: available NOW, as a fact that is
 * SEPARATE from being listed in the catalog.
 *
 * THE LAW: "listed" NEVER equals "available". A model can sit in the catalog
 * with zero availability observations; its availability state is then the
 * EXPLICIT "unknown" — never "available", never absent. Observations age:
 * an availability fact older than its freshness window degrades to
 * "unknown" with `stale: true`, so downstream decisions always see the
 * uncertainty they are carrying.
 */
import { sanitizeAndAssertClean } from "./sanitize.js";
import { validationFailed } from "./errors.js";
import type { ProviderAvailabilityState } from "./vocabulary.js";
/** Subject of an availability fact. */
export type AvailabilitySubject =
  | { readonly kind: "model"; readonly catalogEntryId: string }
  | { readonly kind: "provider-account"; readonly accountId: string }
  | { readonly kind: "provider-definition"; readonly definitionId: string };

export function availabilitySubjectKey(subject: AvailabilitySubject): string {
  switch (subject.kind) {
    case "model":
      return `model:${subject.catalogEntryId}`;
    case "provider-account":
      return `account:${subject.accountId}`;
    case "provider-definition":
      return `definition:${subject.definitionId}`;
  }
}

/** A recorded availability observation (append-only; latest wins). */
export interface AvailabilityObservation {
  readonly subject: AvailabilitySubject;
  readonly state: Exclude<ProviderAvailabilityState, "unknown">;
  readonly reason: string | null;
  readonly observedAt: string;
}

/** The evaluated availability fact for a subject RIGHT NOW. */
export interface ProviderAvailability {
  readonly subject: AvailabilitySubject;
  readonly state: ProviderAvailabilityState;
  readonly reason: string | null;
  readonly lastObservedAt: string | null;
  /** True when the newest observation is older than the freshness window. */
  readonly stale: boolean;
}

export const DEFAULT_AVAILABILITY_FRESHNESS_MS = 60_000;

export interface RecordAvailabilityInput {
  readonly subject: AvailabilitySubject;
  readonly state: Exclude<ProviderAvailabilityState, "unknown">;
  readonly reason?: string;
}

export function buildAvailabilityObservation(
  input: RecordAvailabilityInput,
  now: string,
): AvailabilityObservation {
  if (input.state !== "available" && input.state !== "unavailable") {
    throw validationFailed(
      `availability observation state must be available|unavailable, got ${input.state}`,
    );
  }
  const reason = input.reason === undefined ? null : sanitizeAndAssertClean(input.reason.trim());
  if (reason !== null && reason.length > 300) {
    throw validationFailed("availability reason too long (max 300)");
  }
  return { subject: input.subject, state: input.state, reason, observedAt: now };
}

/**
 * Evaluate availability for a subject from its observation log.
 *
 * - No observations -> explicit `unknown`, `lastObservedAt: null`.
 *   A catalog listing alone can NEVER produce `available`.
 * - Newest observation wins; if older than the freshness window, the state
 *   degrades to `unknown` with `stale: true` and the reason preserved.
 */
export function evaluateAvailability(
  subject: AvailabilitySubject,
  observations: readonly AvailabilityObservation[],
  options: { readonly now: string; readonly freshnessMs?: number },
): ProviderAvailability {
  let newest: AvailabilityObservation | null = null;
  for (const observation of observations) {
    if (newest === null || observation.observedAt > newest.observedAt) {
      newest = observation;
    }
  }
  if (newest === null) {
    return { subject, state: "unknown", reason: null, lastObservedAt: null, stale: false };
  }
  const freshnessMs = options.freshnessMs ?? DEFAULT_AVAILABILITY_FRESHNESS_MS;
  const ageMs = Date.parse(options.now) - Date.parse(newest.observedAt);
  const stale = Number.isFinite(ageMs) && ageMs > freshnessMs;
  return {
    subject,
    state: stale ? "unknown" : newest.state,
    reason: newest.reason,
    lastObservedAt: newest.observedAt,
    stale,
  };
}
