/**
 * Organizational memory port: versioned knowledge records with provenance.
 */
import type { Result } from "../core/result.js";
import type { TenantScope } from "../core/scope.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { SubjectReference } from "../core/refs.js";
import type { AuditInput } from "../audit/records.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { FreshnessStamp } from "../evidence/freshness.js";
import type { MemoryRecord } from "./records.js";

export interface RecordMemoryInput {
  readonly memoryId: string;
  readonly subject: SubjectReference;
  readonly content: string;
  readonly provenance: ProvenanceRecord;
  readonly freshness?: FreshnessStamp;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

export interface ReviseMemoryInput {
  readonly memoryId: string;
  readonly content: string;
  readonly provenance: ProvenanceRecord;
  readonly freshness?: FreshnessStamp;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

/** Organizational memory surface (knowledge references, not runtime memory). */
export interface OrganizationalMemory {
  /** Creates a memory record with version 1. */
  recordMemory(scope: TenantScope, input: RecordMemoryInput): Result<MemoryRecord>;
  /** Appends the next version; previous versions are never modified. */
  reviseMemory(scope: TenantScope, input: ReviseMemoryInput): Result<MemoryRecord>;
  getMemory(scope: TenantScope, memoryId: string): Result<MemoryRecord>;
  /** Memory records about one subject in the requesting tenant. */
  listMemory(scope: TenantScope, subject: SubjectReference): readonly MemoryRecord[];
}
