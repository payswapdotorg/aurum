/**
 * Audit ports: the internal append-only sink used by every store, and the
 * query surface exposed through the kernel contract.
 */
import type { Result } from "../core/result.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { SubjectReference } from "../core/refs.js";
import type { TenantScope } from "../core/scope.js";
import type { DomainJsonValue } from "../core/value.js";
import type { AuditActionKind, AuditInput, AuditRecord } from "./records.js";

/**
 * Internal append-only audit sink handed to every store. Entries are derived
 * from the already-validated command context; append never fails.
 */
export interface AuditSink {
  append(
    scope: TenantScope,
    subject: SubjectReference,
    action: AuditActionKind,
    input: AuditInput,
    details?: DomainJsonValue,
  ): void;
}

export interface AuditQuery {
  /** Only entries about this subject. */
  readonly subject?: SubjectReference;
  /** Only entries recorded at or after this time. */
  readonly since?: DomainTimestamp;
  /** Only entries recorded at or before this time. */
  readonly until?: DomainTimestamp;
}

/** Public query surface over the append-only audit trail. */
export interface AuditTrail {
  getAudit(scope: TenantScope, auditId: string): Result<AuditRecord>;
  queryAudit(scope: TenantScope, query: AuditQuery): readonly AuditRecord[];
}
