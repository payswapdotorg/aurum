/**
 * In-memory audit trail. Append-only: entries are frozen on write and never
 * removed or modified. Audit ids are kernel-generated sequential values
 * (deterministic, no IO). The audit append itself is intentionally not
 * idempotent — it is a log; command-level idempotency is caller-supplied-id
 * based elsewhere in the kernel.
 */
import { notFound } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import type { TenantScope } from "../core/scope.js";
import type { DomainJsonValue } from "../core/value.js";
import type { SubjectReference } from "../core/refs.js";
import {
  createAuditRecord,
  type AuditActionKind,
  type AuditInput,
  type AuditRecord,
} from "./records.js";
import type { AuditQuery, AuditSink, AuditTrail } from "./ports.js";

export class AuditTrailStore implements AuditSink, AuditTrail {
  private readonly index = new TenantIndex<AuditRecord>();
  private counter = 0;
  append(
    scope: TenantScope,
    subject: SubjectReference,
    action: AuditActionKind,
    input: AuditInput,
    details?: DomainJsonValue,
  ): void {
    this.counter += 1;
    const auditId = `audit-${this.counter}`;
    this.index.put(
      scope,
      auditId,
      createAuditRecord(scope, subject, action, input, auditId, details),
    );
  }

  getAudit(scope: TenantScope, auditId: string): Result<AuditRecord> {
    const record = this.index.get(scope, auditId);
    if (!record) return { ok: false, error: notFound("audit record") };
    return ok(record);
  }

  queryAudit(scope: TenantScope, query: AuditQuery): readonly AuditRecord[] {
    return Object.freeze(
      this.index.list(scope).filter((entry) => {
        if (query.subject) {
          if (entry.subject.kind !== query.subject.kind || entry.subject.id !== query.subject.id) {
            return false;
          }
        }
        if (query.since !== undefined && entry.at < query.since) return false;
        if (query.until !== undefined && entry.at > query.until) return false;
        return true;
      }),
    );
  }
}

/** Factory: one audit trail shared by all kernel stores. */
export function createAuditTrailStore(): AuditTrailStore {
  return new AuditTrailStore();
}
