/**
 * PostgreSQL organizational memory (P001, memory area): append-only version
 * history with semantics identical to the in-memory reference — same
 * validation issues, same version building, same audit side-effects
 * ("memory.revised" for both record and revise, version in details).
 *
 * Storage ruling: one row per version, keyed (tenant_id, memory_id,
 * version); currentVersion is derived as the highest number on read.
 * `resolveFreshness` is mirrored (the domain exports it only internally).
 */
import {
  auditInputIssues,
  conflictError,
  createValidator,
  deepFreeze,
  isKnownSubjectKind,
  notFound,
  ok,
  provenanceIssues,
  validationError,
} from "@aurum/domain";
import type {
  DomainTimestamp,
  FreshnessStamp,
  MemoryId,
  MemoryRecord,
  MemoryStorage,
  MemoryVersion,
  ProvenanceRecord,
  RecordMemoryInput,
  Result,
  ReviseMemoryInput,
  SubjectReference,
  TenantScope,
  Validator,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** Mirrors the in-memory subject validation (memory wording). */
function validateSubject(v: Validator, subject: SubjectReference | undefined): void {
  const raw = subject as { kind?: unknown; id?: unknown } | undefined;
  if (
    !raw ||
    typeof raw.kind !== "string" ||
    !isKnownSubjectKind(raw.kind) ||
    typeof raw.id !== "string" ||
    raw.id.trim().length === 0
  ) {
    v.add("subject", "must be a typed subject reference");
  }
}

/** Mirrors the domain-internal resolveFreshness (verbatim stamps win). */
function resolveFreshness(stamp: FreshnessStamp | undefined, fallbackAsOf: number): FreshnessStamp {
  if (stamp !== undefined && (stamp.asOf !== undefined || stamp.validUntil !== undefined)) {
    return stamp;
  }
  return { asOf: fallbackAsOf as DomainTimestamp };
}

function buildVersion(
  version: number,
  content: string,
  provenance: ProvenanceRecord,
  freshness: FreshnessStamp,
  now: DomainTimestamp,
): MemoryVersion {
  return {
    version,
    content,
    provenance,
    freshness,
    createdAt: now,
  };
}

interface MemoryRow {
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly record: MemoryVersion;
}

/** Loads one memory's rows (ordered by version) or null when absent. */
async function loadMemoryRows(
  sql: Tx | Db,
  scope: TenantScope,
  memoryId: string,
): Promise<readonly MemoryRow[] | null> {
  const rows: readonly MemoryRow[] = await sql`
    select subject_kind, subject_id, record from domain_memory_versions
    where tenant_id = ${scope.tenantId} and memory_id = ${memoryId}
    order by version
  `;
  return rows.length === 0 ? null : rows;
}

/** Assembles the MemoryRecord the read paths return (current = highest). */
function assembleMemory(scope: TenantScope, memoryId: string, rows: readonly MemoryRow[]): MemoryRecord {
  const first = rows[0];
  const versions = Object.freeze(rows.map((row) => deepFreeze(row.record)));
  const last = versions[versions.length - 1];
  return deepFreeze({
    scope,
    memoryId: memoryId as MemoryId,
    subject: {
      kind: (first?.subject_kind ?? "unknown") as SubjectReference["kind"],
      id: first?.subject_id ?? "",
    },
    currentVersion: last ? last.version : 0,
    versions,
  });
}

/** Creates the PostgreSQL organizational memory bound to a database handle. */
export function createPgOrganizationalMemory(sql: Db): MemoryStorage {
  async function appendVersion(
    scope: TenantScope,
    memoryId: string,
    subject: SubjectReference | undefined,
    version: MemoryVersion,
  ): Promise<void> {
    await sql.begin(async (tx) => {
      await tx`
        insert into domain_memory_versions
          (tenant_id, memory_id, version, subject_kind, subject_id, record)
        values
          (${scope.tenantId}, ${memoryId}, ${version.version},
           ${subject?.kind ?? "unknown"}, ${subject?.id ?? ""}, ${jsonbParam(tx, version)})
      `;
      await recordWrite(tx, {
        tenantId: scope.tenantId,
        journalKey: `memory:append-version:${memoryId}:${version.version}`,
        area: "memory",
        operation: "append-version",
        recordId: memoryId,
        version: version.version,
      });
    });
  }

  return {
    recordMemory: async (scope, input: RecordMemoryInput) => {
      const v = createValidator();
      const memoryId = v.requireIdFormat("memoryId", input?.memoryId ?? "") as MemoryId;
      validateSubject(v, input?.subject);
      const content = v.requireText("content", input?.content ?? "");
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const existing = await loadMemoryRows(sql, scope, memoryId);
      if (existing) {
        return { ok: false, error: conflictError("memory record already registered in tenant") };
      }
      const version = buildVersion(
        1,
        content,
        input.provenance,
        resolveFreshness(input.freshness, input.now),
        input.now,
      );
      try {
        await appendVersion(scope, memoryId, input.subject, version);
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("memory record already registered in tenant") };
        }
        throw error;
      }
      await appendAuditEntry(
        sql,
        scope,
        { kind: "memory", id: memoryId },
        "memory.revised",
        input.audit,
        Object.freeze({ version: 1 }),
      );
      const rows = await loadMemoryRows(sql, scope, memoryId);
      return ok(assembleMemory(scope, memoryId, rows ?? []));
    },
    reviseMemory: async (scope, input: ReviseMemoryInput) => {
      const v = createValidator();
      const memoryId = v.requireIdFormat("memoryId", input?.memoryId ?? "") as MemoryId;
      const content = v.requireText("content", input?.content ?? "");
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      return sql.begin(async (tx) => {
        const existing = await loadMemoryRows(tx, scope, memoryId);
        if (!existing) return { ok: false, error: notFound("memory record") };
        const version = buildVersion(
          existing.length + 1,
          content,
          input.provenance,
          resolveFreshness(input.freshness, input.now),
          input.now,
        );
        await tx`
          insert into domain_memory_versions
            (tenant_id, memory_id, version, subject_kind, subject_id, record)
          values
            (${scope.tenantId}, ${memoryId}, ${version.version},
             ${existing[0]?.subject_kind ?? "unknown"}, ${existing[0]?.subject_id ?? ""},
             ${jsonbParam(tx, version)})
        `;
        await recordWrite(tx, {
          tenantId: scope.tenantId,
          journalKey: `memory:append-version:${memoryId}:${version.version}`,
          area: "memory",
          operation: "append-version",
          recordId: memoryId,
          version: version.version,
        });
        await appendAuditEntry(
          tx,
          scope,
          { kind: "memory", id: memoryId },
          "memory.revised",
          input.audit,
          Object.freeze({ version: version.version }),
        );
        const rows = await loadMemoryRows(tx, scope, memoryId);
        return ok(assembleMemory(scope, memoryId, rows ?? []));
      });
    },
    getMemory: async (scope, memoryId) => {
      const rows = await loadMemoryRows(sql, scope, memoryId);
      return rows
        ? ok(assembleMemory(scope, memoryId, rows))
        : { ok: false, error: notFound("memory record") };
    },
    listMemory: async (scope, subject) => {
      const rows: readonly { memory_id: string }[] = await sql`
        select memory_id from domain_memory_versions
        where tenant_id = ${scope.tenantId}
          and subject_kind = ${String(subject.kind)}
          and subject_id = ${String(subject.id)}
        order by seq
      `;
      const records: MemoryRecord[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.memory_id)) continue;
        seen.add(row.memory_id);
        const memoryRows = await loadMemoryRows(sql, scope, row.memory_id);
        if (memoryRows) records.push(assembleMemory(scope, row.memory_id, memoryRows));
      }
      return Object.freeze(records);
    },
  };
}

/** Result anchor (keeps the async port type explicit at the module level). */
export type MemoryAreaResult = Result<MemoryRecord>;
