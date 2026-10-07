/**
 * evidence area public surface.
 */
export { SOURCE_KINDS, isKnownSourceKind, provenanceIssues } from "./provenance.js";
export type { ProvenanceRecord, SourceKind } from "./provenance.js";
export { DEFAULT_FRESHNESS_POLICY, classifyFreshness } from "./freshness.js";
export type { FreshnessClass, FreshnessPolicy, FreshnessStamp } from "./freshness.js";
export { EVIDENCE_STATUSES, isKnownEvidenceStatus } from "./records.js";
export type { EventRecord, EvidenceStatus, ObservationRecord } from "./records.js";
export { createEventLog, createEvidenceLedger } from "./evidenceStore.js";
export type {
  EvidenceLedger,
  EventLog,
  RecordEventInput,
  RecordObservationInput,
  RetractEvidenceInput,
} from "./ports.js";
