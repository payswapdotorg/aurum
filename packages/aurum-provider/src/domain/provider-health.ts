/**
 * Concern 6 of 8 — ProviderHealth: OBSERVED state of a provider subject
 * (an account, definition or specific model endpoint). Health is a log of
 * observations; the latest observation per subject is the current health.
 * "unknown" is an explicit status, never an absent record.
 */
import {
  asProviderHealthObservationId,
  type ProviderHealthObservationId,
  type ProviderEvidenceId,
  type TenantId,
} from "./ids.js";
import { sanitizeAndAssertClean } from "./sanitize.js";
import { validationFailed } from "./errors.js";
import type { ProviderHealthStatus } from "./vocabulary.js";
import type { TenantScoped } from "./ports.js";

/** What a health observation is about. */
export type HealthSubject =
  | { readonly kind: "provider-account"; readonly accountId: string }
  | { readonly kind: "provider-definition"; readonly definitionId: string }
  | { readonly kind: "model-endpoint"; readonly definitionId: string; readonly modelKey: string };

export interface ProviderHealthObservation extends TenantScoped {
  readonly id: ProviderHealthObservationId;
  readonly subject: HealthSubject;
  readonly status: ProviderHealthStatus;
  readonly observedAt: string;
  /** Sanitized free-text detail (e.g. probe outcome summary). */
  readonly detail: string | null;
  readonly evidenceId: ProviderEvidenceId | null;
}

export function subjectKey(subject: HealthSubject): string {
  switch (subject.kind) {
    case "provider-account":
      return `account:${subject.accountId}`;
    case "provider-definition":
      return `definition:${subject.definitionId}`;
    case "model-endpoint":
      return `model:${subject.definitionId}:${subject.modelKey}`;
  }
}

export interface RecordHealthInput {
  readonly subject: HealthSubject;
  readonly status: ProviderHealthStatus;
  readonly detail?: string;
  readonly evidenceId?: string;
}

export function buildHealthObservation(
  tenantId: TenantId,
  input: RecordHealthInput,
  deps: { id: string; now: string },
): ProviderHealthObservation {
  const detail = input.detail === undefined ? null : sanitizeAndAssertClean(input.detail.trim());
  if (detail !== null && detail.length > 500) {
    throw validationFailed("health detail too long (max 500)");
  }
  return {
    id: asProviderHealthObservationId(deps.id),
    tenantId,
    subject: input.subject,
    status: input.status,
    observedAt: deps.now,
    detail,
    evidenceId: (input.evidenceId ?? null) as ProviderEvidenceId | null,
  };
}

/** Latest observation wins; no observations means the subject is unknown. */
export function latestObservation(
  observations: readonly ProviderHealthObservation[],
): ProviderHealthObservation | null {
  let latest: ProviderHealthObservation | null = null;
  for (const observation of observations) {
    if (latest === null || observation.observedAt > latest.observedAt) {
      latest = observation;
    }
  }
  return latest;
}

/** Project the current health of a subject from its observation log. */
export function currentHealthOf(observations: readonly ProviderHealthObservation[]): {
  readonly status: ProviderHealthStatus;
  readonly observedAt: string | null;
} {
  const latest = latestObservation(observations);
  return latest === null
    ? { status: "unknown", observedAt: null }
    : { status: latest.status, observedAt: latest.observedAt };
}
