/**
 * Company changes query (W004 app layer): "what changed since?" — the honest
 * change report. Sources, in merge order:
 * - the append-only audit trail (every consequential transition in the
 *   window) — this is the canonical change log, including every retraction;
 * - newly recorded observations about the subject, when a subject filter is
 *   given (evidence recording is provenance-carried, not audited — the
 *   kernel has no tenant-wide evidence seam by design, so new-evidence
 *   enumeration is subject-scoped);
 * - revision enrichment: goal/belief/memory transitions carry the content
 *   of the appended revision, fetched through the versioned-record seams.
 *
 * Subject filtering is semantic, not syntactic: an audit entry about a
 * record that is itself ABOUT the subject (its observation, the sources of
 * its claim, its belief subject, its memory subject) is relevant to the
 * subject — so retracting an observation about X shows up in "what changed
 * about X" even though the audit entry's own subject is the observation.
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

/** True when the entry's subject IS the filter subject. */
function directMatch(
  subject: { readonly kind: string; readonly id: string },
  filter: { readonly kind: string; readonly id: string },
): boolean {
  return subject.kind === filter.kind && subject.id === filter.id;
}

/**
 * True when the entry's subject is a RECORD that is itself about the filter
 * subject: the observation it retracted, the sources of the claim it
 * retracted, the belief's subject, the memory's subject.
 */
function recordSubjectMatches(
  views: CompanyDomainViews,
  scope: TenantScope,
  entrySubject: { readonly kind: string; readonly id: string },
  filter: { readonly kind: string; readonly id: string },
): boolean {
  if (entrySubject.kind === "observation") {
    const observation = views.evidence.getObservation(scope, entrySubject.id);
    return observation.ok && directMatch(observation.value.subject, filter);
  }
  if (entrySubject.kind === "claim") {
    const claim = views.epistemics.getClaim(scope, entrySubject.id);
    if (!claim.ok) return false;
    return claim.value.derivedFrom.some((observationId) => {
      const observation = views.evidence.getObservation(scope, observationId);
      return observation.ok && directMatch(observation.value.subject, filter);
    });
  }
  if (entrySubject.kind === "belief") {
    const belief = views.epistemics.getBelief(scope, entrySubject.id);
    return belief.ok && directMatch(belief.value.subject, filter);
  }
  if (entrySubject.kind === "memory") {
    const memory = views.memory.getMemory(scope, entrySubject.id);
    return memory.ok && directMatch(memory.value.subject, filter);
  }
  return false;
}

function numberField(details: unknown, key: string): number | undefined {
  if (details === undefined || details === null) return undefined;
  if (typeof details !== "object") return undefined;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(details: unknown, key: string): string | undefined {
  if (details === undefined || details === null) return undefined;
  if (typeof details !== "object") return undefined;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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
  // Retractions carry why the evidence was removed (details.reason) on top
  // of the audit transition reason — the honest "why" for removed evidence.
  const retractionReason = isRetraction(entry.action)
    ? stringField(record.details, "reason")
    : undefined;
  const summary =
    `${entry.action} ${entry.subject.kind}/${entry.subject.id}: ${entry.reason}` +
    (retractionReason !== undefined ? ` (${retractionReason})` : "");
  return {
    recordId: entry.recordId,
    at: entry.at,
    action: entry.action,
    subject: entry.subject,
    actor: entry.actor,
    reason: entry.reason,
    summary,
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
  const filter = input.subject;

  for (const record of views.audit.queryAudit(scope, {
    since: input.since,
    until: input.until,
  })) {
    if (filter !== undefined) {
      const relevant =
        directMatch(record.subject, filter) ||
        recordSubjectMatches(views, scope, record.subject, filter);
      if (!relevant) continue;
    }
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
