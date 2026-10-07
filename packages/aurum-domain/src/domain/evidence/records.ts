/**
 * Events and observations: what happened in the organization world, and the
 * evidence Aurum encountered about it. An Observation is *evidence
 * encountered* — not asserted truth (spec/DOMAIN-MAPPING.md). Every
 * evidence-bearing record retains provenance, freshness and status.
 */
import type { DomainTimestamp, EventId, ObservationId } from "../core/branding.js";
import type { TenantScopedRecord } from "../core/scope.js";
import type { ActorReference, SubjectReference } from "../core/refs.js";
import type { DomainJsonValue } from "../core/value.js";
import type { FreshnessStamp } from "./freshness.js";
import type { ProvenanceRecord } from "./provenance.js";

/** Lifecycle of evidence-bearing records. */
export const EVIDENCE_STATUSES = ["active", "superseded", "retracted"] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export function isKnownEvidenceStatus(value: string): value is EvidenceStatus {
  return (EVIDENCE_STATUSES as readonly string[]).includes(value);
}

/** A recorded event: something that happened, with optional structured payload. */
export interface EventRecord extends TenantScopedRecord {
  readonly eventId: EventId;
  /** What kind of event (open vocabulary, non-empty). */
  readonly kind: string;
  readonly summary: string;
  /** When it happened in the world. */
  readonly occurredAt: DomainTimestamp;
  /** When Aurum recorded it. */
  readonly recordedAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
  readonly subjects: readonly SubjectReference[];
  readonly payload?: DomainJsonValue;
}

/**
 * Observation: evidence encountered. The building block for claims and
 * beliefs; never itself an assertion of truth.
 */
export interface ObservationRecord extends TenantScopedRecord {
  readonly observationId: ObservationId;
  readonly eventId?: EventId;
  readonly subject: SubjectReference;
  readonly content: string;
  readonly provenance: ProvenanceRecord;
  readonly freshness: FreshnessStamp;
  readonly status: EvidenceStatus;
  readonly observedAt: DomainTimestamp;
  readonly retractedAt?: DomainTimestamp;
  readonly retractedBy?: ActorReference;
}
