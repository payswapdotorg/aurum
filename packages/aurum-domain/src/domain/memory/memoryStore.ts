/**
 * In-memory organizational memory. Versions are append-only; each version
 * carries its own provenance and freshness.
 */
import { conflictError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import { isKnownSubjectKind } from "../core/refs.js";
import type { MemoryId } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import { auditInputIssues } from "../audit/records.js";
import type { AuditSink } from "../audit/ports.js";
import { provenanceIssues } from "../evidence/provenance.js";
import { resolveFreshness } from "../evidence/freshness.js";
import type { MemoryRecord, MemoryVersion } from "./records.js";
import type { OrganizationalMemory, RecordMemoryInput, ReviseMemoryInput } from "./ports.js";

function validateSubject(
  v: ReturnType<typeof createValidator>,
  subject: { kind?: unknown; id?: unknown } | undefined,
): void {
  if (
    !subject ||
    typeof subject.kind !== "string" ||
    !isKnownSubjectKind(subject.kind) ||
    typeof subject.id !== "string" ||
    subject.id.trim().length === 0
  ) {
    v.add("subject", "must be a typed subject reference");
  }
}

export function createOrganizationalMemory(audit: AuditSink): OrganizationalMemory {
  const memories = new TenantIndex<MemoryRecord>();

  function recordMemory(scope: TenantScope, input: RecordMemoryInput): Result<MemoryRecord> {
    const v = createValidator();
    const memoryId = v.requireIdFormat("memoryId", input?.memoryId ?? "") as MemoryId;
    validateSubject(v, input?.subject as { kind?: unknown; id?: unknown } | undefined);
    const content = v.requireText("content", input?.content ?? "");
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (memories.has(scope, memoryId)) {
      return { ok: false, error: conflictError("memory record already registered in tenant") };
    }
    const version: MemoryVersion = {
      version: 1,
      content,
      provenance: input.provenance,
      freshness: resolveFreshness(input.freshness, input.now),
      createdAt: input.now,
    };
    const record: MemoryRecord = {
      scope,
      memoryId,
      subject: input.subject,
      currentVersion: 1,
      versions: Object.freeze([version]),
    };
    const stored = memories.put(scope, memoryId, record);
    audit.append(
      scope,
      { kind: "memory", id: memoryId },
      "memory.revised",
      input.audit,
      Object.freeze({ version: 1 }),
    );
    return ok(stored);
  }

  function reviseMemory(scope: TenantScope, input: ReviseMemoryInput): Result<MemoryRecord> {
    const v = createValidator();
    const memoryId = v.requireIdFormat("memoryId", input?.memoryId ?? "") as MemoryId;
    const content = v.requireText("content", input?.content ?? "");
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    const existing = memories.get(scope, memoryId);
    if (!existing) return { ok: false, error: notFound("memory record") };
    const version: MemoryVersion = {
      version: existing.versions.length + 1,
      content,
      provenance: input.provenance,
      freshness: resolveFreshness(input.freshness, input.now),
      createdAt: input.now,
    };
    const record: MemoryRecord = {
      ...existing,
      currentVersion: version.version,
      versions: Object.freeze([...existing.versions, version]),
    };
    const stored = memories.put(scope, memoryId, record);
    audit.append(
      scope,
      { kind: "memory", id: memoryId },
      "memory.revised",
      input.audit,
      Object.freeze({ version: version.version }),
    );
    return ok(stored);
  }

  return {
    recordMemory,
    reviseMemory,
    getMemory: (scope: TenantScope, memoryId: string) => {
      const record = memories.get(scope, memoryId);
      return record ? ok(record) : { ok: false, error: notFound("memory record") };
    },
    listMemory: (scope: TenantScope, subject: { kind: unknown; id: unknown }) =>
      memories
        .list(scope)
        .filter(
          (record) => record.subject.kind === subject.kind && record.subject.id === subject.id,
        ),
  };
}
