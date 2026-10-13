/**
 * PostgreSQL audit trail (P001, audit area): the append-only sink shared by
 * every PG kernel store, mirroring the in-memory AuditTrailStore semantics:
 *
 * - ids are `audit-<n>` drawn from one global sequence — the in-memory
 *   counter is kernel-global (not per-tenant) and the sequence mirrors it;
 * - append never fails as a domain operation (it is a log);
 * - queries are tenant-scoped; a foreign-tenant audit id is uniformly
 *   not-found, exactly like a missing one;
 * - entries are immutable: the database rejects UPDATE/DELETE by trigger.
 *
 * Atomicity ruling: when a kernel command appends audit entries, it does so
 * through `appendAuditEntry(tx, ...)` on the command's own transaction —
 * the entry and the mutation land or vanish together, matching the
 * in-memory single-image semantics. The `append` method on the store runs
 * its own transaction for standalone use.
 */
import { createAuditRecord, deepFreeze, notFound } from "@aurum/domain";
import type {
  AuditActionKind,
  AuditInput,
  AuditRecord,
  DomainJsonValue,
  Result,
  SubjectReference,
  TenantScope,
} from "@aurum/domain";
import { recordWrite } from "../journal/write-journal.js";
import { jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** Query surface for audit entries. */
export interface PgAuditQuery {
  readonly subject?: SubjectReference;
  readonly since?: number;
  readonly until?: number;
}

/** PostgreSQL audit trail: the kernel query surface plus the async sink. */
export interface PgAuditTrail {
  /** Appends one entry (own transaction) and returns the frozen record. */
  append(
    scope: TenantScope,
    subject: SubjectReference,
    action: AuditActionKind,
    input: AuditInput,
    details?: DomainJsonValue,
  ): Promise<AuditRecord>;
  getAudit(scope: TenantScope, auditId: string): Promise<Result<AuditRecord>>;
  queryAudit(scope: TenantScope, query: PgAuditQuery): Promise<readonly AuditRecord[]>;
}

/**
 * Appends one audit entry on an existing transaction (the atomic path used
 * by every kernel command that performs a consequential transition).
 */
export async function appendAuditEntry(
  tx: Tx,
  scope: TenantScope,
  subject: SubjectReference,
  action: AuditActionKind,
  input: AuditInput,
  details?: DomainJsonValue,
): Promise<AuditRecord> {
  const sequence = await tx`select nextval('domain_audit_seq') as n`;
  const nextRow = sequence[0];
  if (!nextRow) throw new Error("audit sequence returned no value");
  const n = Number(nextRow.n);
  const auditId = `audit-${n}`;
  const record = createAuditRecord(scope, subject, action, input, auditId, details);
  await tx`
    insert into domain_audit_entries
      (tenant_id, audit_id, subject_kind, subject_id, action, actor, acted_at, reason, details, record)
    values
      (${scope.tenantId}, ${auditId}, ${subject.kind}, ${subject.id}, ${action},
       ${jsonbParam(tx, input.actor)}, ${input.at}, ${input.reason.trim()},
       ${jsonbParam(tx, details)}, ${jsonbParam(tx, record)})
  `;
  await recordWrite(tx, {
    tenantId: scope.tenantId,
    journalKey: `audit:append:${scope.tenantId}:${auditId}`,
    area: "audit",
    operation: "append",
    recordId: auditId,
  });
  return record;
}

function rowToAuditRecord(row: Record<string, unknown>): AuditRecord {
  return deepFreeze(row.record as AuditRecord);
}

/** Creates the PostgreSQL audit trail bound to a database handle. */
export function createPgAuditTrail(sql: Db): PgAuditTrail {
  return {
    append: async (scope, subject, action, input, details) => {
      let appended: AuditRecord | undefined;
      await sql.begin(async (tx) => {
        appended = await appendAuditEntry(tx, scope, subject, action, input, details);
      });
      if (!appended) throw new Error("audit append returned no record");
      return appended;
    },
    getAudit: async (scope, auditId) => {
      const rows = await sql`
        select record from domain_audit_entries
        where tenant_id = ${scope.tenantId} and audit_id = ${auditId}
      `;
      if (rows.length === 0) return { ok: false, error: notFound("audit record") };
      const row = rows[0];
      if (!row) throw new Error("audit row missing after length check");
      return { ok: true, value: rowToAuditRecord(row) };
    },
    queryAudit: async (scope, query) => {
      const rows = await sql`
        select record from domain_audit_entries
        where tenant_id = ${scope.tenantId}
          and (${query.subject === undefined} or (subject_kind = ${query.subject?.kind ?? ""}
               and subject_id = ${query.subject?.id ?? ""}))
          and (${query.since === undefined} or acted_at >= ${query.since ?? 0})
          and (${query.until === undefined} or acted_at <= ${query.until ?? 0})
        order by seq
      `;
      return Object.freeze(rows.map(rowToAuditRecord));
    },
  };
}
