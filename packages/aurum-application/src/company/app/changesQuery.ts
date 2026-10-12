/**
 * Company changes query (W004 app layer): "what changed since?" — the honest
 * change report. Sources, in merge order:
 * - the append-only audit trail (every consequential transition in the
 *   window, tenant-wide or subject-filtered) — this is the canonical change
 *   log, including every retraction;
 * - newly recorded observations about the subject, when a subject filter is
 *   given (evidence recording is provenance-carried, not audited — the
 *   kernel has no tenant-wide evidence seam by design, so new-evidence
 *   enumeration is subject-scoped);
 * - revision enrichment: goal/belief/memory transitions carry the content
 *   of the appended revision, fetched through the versioned-record seams.
 *
 * Entries are deduped by record id and sorted by `at` ascending. The window
 * is inclusive on both ends ([since, until]), matching the audit seam.
 */
import type { DomainTimestamp, SubjectReference, TenantScope } from "@aurum/domain";
import type { AuditRecord } from "@aurum/domain";
import { auditEntry } from "../domain/chain.js";
import type { ChangeEntry, ChangeReport, RevisionEnrichment } from "../domain/records.js";
import type { CompanyDomainViews } from "../domain/ports.js";

/** Input of the changes query. `until` bounds the window (inclusive). */
export interface WhatChangedSinceInput {
  readonly since: DomainTimestamp;
  readonly until: DomainTimestamp;
  readonly subject?: SubjectReference;
}

function isRetraction(action: AuditRecord["action"]): boolean {
  return action === "observation.retracted" || action === "claim.retracted";
}

function numberField(details: unknown, key: string): number | undefined {
  if (details === undefined || details === null) return undefined;
  if (typeof details !== "object") return undefined;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Best-effort revision enrichment; a failed lookup degrades, never errors. */
function enrich(
  views: CompanyDomainViews,
  scope: TenantScope,
  record: AuditRecord,
): RevisionEnrichment | undefined {
  const goalId = record.subject.kind === "goal" ? record.subject.id : undefined;
  const beliefId = record.subject.kind === "belief" ? record.subject.id : undefined;
  const memoryId = record.subject.kind === "memory" ? record.subject.id : undefined;
  if (
    goalId !== undefined &&
    (record.action === "goal.created" || record.action === "goal.revised")
  ) {
    const number = numberField(record.details, "revisionNumber");
    if (number === undefined) return undefined;
    const revision = views.goals.getGoalRevision(scope, goalId, number);
    if (revision.ok) {
      return { kind: "goal", number, statement: revision.value.objective };
    }
    return undefined;
  }
  if (beliefId !== undefined && record.action === "belief.revised") {
    const number = numberField(record.details, "revisionNumber");
    if (number === undefined) return undefined;
    const belief = views.epistemics.getBelief(scope, beliefId);
    if (!belief.ok) return undefined;
    const revision = belief.value.revisions.find((item) => item.revisionNumber === number);
    if (revision === undefined) return undefined;
    return { kind: "belief", number, statement: revision.statement };
  }
  if (memoryId !== undefined && record.action === "memory.revised") {
    const version = numberField(record.details, "version");
    if (version === undefined) return undefined;
    const memory = views.memory.getMemory(scope, memoryId);
    if (!memory.ok) return undefined;
    const found = memory.value.versions.find((item) => item.version === version);
    if (found === undefined) return undefined;
    return { kind: "memory", number: version, statement: found.content };
  }
  return undefined;
}

function changeOfAudit(
  views: CompanyDomainViews,
  scope: TenantScope,
  record: AuditRecord,
): ChangeEntry {
  const entry = auditEntry(record);
  const enrichment = enrich(views, scope, record);
  return {
    recordId: entry.recordId,
    at: entry.at,
    action: entry.action,
    subject: entry.subject,
    actor: entry.actor,
    reason: entry.reason,
    summary: `${entry.action} ${entry.subject.kind}/${entry.subject.id}: ${entry.reason}`,
    retraction: isRetraction(entry.action),
    ...(enrichment !== undefined ? { enrichment } : {}),
  };
}

/** The changes query: audit trail + new evidence, deduped and ordered. */
export function whatChangedSince(
  views: CompanyDomainViews,
  scope: TenantScope,
  input: WhatChangedSinceInput,
): ChangeReport {
  const entries = new Map<string, ChangeEntry>();

  for (const record of views.audit.queryAudit(scope, {
    since: input.since,
    until: input.until,
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
  })) {
    entries.set(record.auditId, changeOfAudit(views, scope, record));
  }

  if (input.subject !== undefined) {
    for (const observation of views.evidence.listObservations(scope, input.subject)) {
      const recordedAt = observation.provenance.recordedAt;
      if (recordedAt < input.since || recordedAt > input.until) continue;
      const actor = observation.provenance.actor;
      const reason =
        observation.provenance.note !== undefined && observation.provenance.note.trim().length > 0
          ? observation.provenance.note
          : "evidence recorded";
      entries.set(observation.observationId, {
        recordId: observation.observationId,
        at: recordedAt,
        action: "observation.recorded",
        subject: observation.subject,
        actor,
        reason,
        summary: `observation.recorded ${observation.subject.kind}/${observation.subject.id}: ${observation.content}`,
        retraction: false,
      });
    }
  }

  const changes = [...entries.values()].sort((left, right) => {
    if (left.at !== right.at) return left.at - right.at;
    return left.recordId.localeCompare(right.recordId);
  });

  return {
    since: input.since,
    until: input.until,
    changes: Object.freeze(changes),
  };
}
