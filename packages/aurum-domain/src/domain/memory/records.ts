/**
 * Organizational memory foundations (spec/DOMAIN-MAPPING.md Intelligence).
 * This is organizational knowledge — explicitly NOT model runtime memory.
 * Knowledge records are versioned with provenance; versions are append-only.
 */
import type { DomainTimestamp, MemoryId } from "../core/branding.js";
import type { TenantScopedRecord } from "../core/scope.js";
import type { SubjectReference } from "../core/refs.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { FreshnessStamp } from "../evidence/freshness.js";

/** One immutable knowledge version. */
export interface MemoryVersion {
  readonly version: number;
  /** Knowledge content descriptor (structured summary of what is known). */
  readonly content: string;
  readonly provenance: ProvenanceRecord;
  readonly freshness: FreshnessStamp;
  readonly createdAt: DomainTimestamp;
}

/** Versioned organizational knowledge record about one subject. */
export interface MemoryRecord extends TenantScopedRecord {
  readonly memoryId: MemoryId;
  readonly subject: SubjectReference;
  readonly currentVersion: number;
  readonly versions: readonly MemoryVersion[];
}
