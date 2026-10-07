/**
 * Evidence ports: event log and observation ledger.
 */
import type { Result } from "../core/result.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import type { SubjectReference } from "../core/refs.js";
import type { AuditInput } from "../audit/records.js";
import type { EventRecord, ObservationRecord } from "./records.js";
import type { FreshnessStamp } from "./freshness.js";
import type { ProvenanceRecord } from "./provenance.js";

export interface RecordEventInput {
  readonly eventId: string;
  readonly kind: string;
  readonly summary: string;
  readonly occurredAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
  readonly subjects?: readonly SubjectReference[];
  readonly payload?: unknown;
}

export interface RecordObservationInput {
  readonly observationId: string;
  readonly eventId?: string;
  readonly subject: SubjectReference;
  readonly content: string;
  readonly observedAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
  readonly freshness?: FreshnessStamp;
}

export interface RetractEvidenceInput {
  readonly reason: string;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

/** Event log: what happened. */
export interface EventLog {
  recordEvent(scope: TenantScope, input: RecordEventInput): Result<EventRecord>;
  getEvent(scope: TenantScope, eventId: string): Result<EventRecord>;
}

/** Observation ledger: evidence encountered. */
export interface EvidenceLedger {
  recordObservation(scope: TenantScope, input: RecordObservationInput): Result<ObservationRecord>;
  getObservation(scope: TenantScope, observationId: string): Result<ObservationRecord>;
  /** Observations about one subject, in insertion order. */
  listObservations(scope: TenantScope, subject: SubjectReference): readonly ObservationRecord[];
  /** Retraction is a consequential transition: audit input required. */
  retractObservation(
    scope: TenantScope,
    observationId: string,
    input: RetractEvidenceInput,
  ): Result<ObservationRecord>;
}
