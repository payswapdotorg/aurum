/**
 * In-memory event log and observation ledger. Retraction produces a new
 * record value (status "retracted") — previously handed-out record objects
 * stay untouched; the audit trail preserves who/when/why.
 */
import { conflictError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type { EventId, ObservationId } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import { isKnownSubjectKind } from "../core/refs.js";
import { isDomainJsonValue } from "../core/value.js";
import { auditInputIssues } from "../audit/records.js";
import type { AuditSink } from "../audit/ports.js";
import { provenanceIssues } from "./provenance.js";
import { resolveFreshness, type FreshnessStamp } from "./freshness.js";
import type { EventRecord, ObservationRecord } from "./records.js";
import type { DomainJsonValue } from "../core/value.js";
import type { SubjectReference } from "../core/refs.js";
import type {
  EvidenceLedger,
  EventLog,
  RecordEventInput,
  RecordObservationInput,
  RetractEvidenceInput,
} from "./ports.js";

function validateSubject(
  validator: ReturnType<typeof createValidator>,
  field: string,
  subject: { kind?: unknown; id?: unknown } | undefined,
): void {
  if (!subject || typeof subject.kind !== "string" || !isKnownSubjectKind(subject.kind)) {
    validator.add(field, "must have a known subject kind");
  } else if (typeof subject.id !== "string" || subject.id.trim().length === 0) {
    validator.add(field, "must have a non-empty subject id");
  }
}

function validateFreshness(
  validator: ReturnType<typeof createValidator>,
  field: string,
  stamp: FreshnessStamp | undefined,
): void {
  if (!stamp) return;
  if (stamp.asOf !== undefined) {
    validator.requireNonNegativeNumber(`${field}.asOf`, stamp.asOf);
  }
  if (stamp.validUntil !== undefined) {
    validator.requireNonNegativeNumber(`${field}.validUntil`, stamp.validUntil);
  }
}

export function createEventLog(): EventLog {
  const events = new TenantIndex<EventRecord>();

  function recordEvent(scope: TenantScope, input: RecordEventInput): Result<EventRecord> {
    const v = createValidator();
    const eventId = v.requireIdFormat("eventId", input?.eventId ?? "") as EventId;
    const kind = v.requireText("kind", input?.kind ?? "", { max: 120 });
    const summary = v.requireText("summary", input?.summary ?? "");
    v.requireNonNegativeNumber("occurredAt", input?.occurredAt ?? Number.NaN);
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    if (input?.provenance !== undefined) {
      v.requireNonNegativeNumber("recordedAt", input.provenance.recordedAt ?? Number.NaN);
    }
    const subjects = Array.isArray(input?.subjects) ? input.subjects : [];
    for (const [index, subject] of subjects.entries()) {
      validateSubject(v, `subjects.${index}`, subject as { kind?: unknown; id?: unknown });
    }
    if (
      input?.occurredAt !== undefined &&
      input.provenance?.recordedAt !== undefined &&
      input.occurredAt > input.provenance.recordedAt
    ) {
      v.add("occurredAt", "cannot be after the recordedAt provenance time");
    }
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (events.has(scope, eventId)) {
      return { ok: false, error: conflictError("event already recorded in tenant") };
    }
    if (input.payload !== undefined && !isDomainJsonValue(input.payload)) {
      return {
        ok: false,
        error: validationError([{ field: "payload", problem: "must be JSON data" }]),
      };
    }
    const record: EventRecord = {
      scope,
      eventId,
      kind,
      summary,
      occurredAt: input.occurredAt,
      recordedAt: input.provenance.recordedAt,
      provenance: input.provenance,
      subjects: Object.freeze([...subjects]),
      ...(input.payload !== undefined ? { payload: input.payload as DomainJsonValue } : {}),
    };
    return ok(events.put(scope, eventId, record));
  }

  return {
    recordEvent,
    getEvent: (scope: TenantScope, eventId: string) => {
      const record = events.get(scope, eventId);
      return record ? ok(record) : { ok: false, error: notFound("event") };
    },
  };
}

export function createEvidenceLedger(audit: AuditSink): EvidenceLedger {
  const observations = new TenantIndex<ObservationRecord>();

  function recordObservation(
    scope: TenantScope,
    input: RecordObservationInput,
  ): Result<ObservationRecord> {
    const v = createValidator();
    const observationId = v.requireIdFormat(
      "observationId",
      input?.observationId ?? "",
    ) as ObservationId;
    validateSubject(v, "subject", input?.subject as { kind?: unknown; id?: unknown });
    const content = v.requireText("content", input?.content ?? "");
    v.requireNonNegativeNumber("observedAt", input?.observedAt ?? Number.NaN);
    if (input?.eventId !== undefined) v.requireIdFormat("eventId", input.eventId);
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    if (input?.provenance !== undefined) {
      v.requireNonNegativeNumber(
        "provenance.recordedAt",
        input.provenance.recordedAt ?? Number.NaN,
      );
    }
    validateFreshness(v, "freshness", input?.freshness);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (observations.has(scope, observationId)) {
      return { ok: false, error: conflictError("observation already recorded in tenant") };
    }
    // Freshness: an explicit stamp (asOf or validUntil) wins; otherwise the
    // observation defaults to asOf = when the evidence was encountered.
    const stamp: FreshnessStamp = resolveFreshness(input.freshness, input.observedAt);
    const record: ObservationRecord = {
      scope,
      observationId,
      ...(input.eventId !== undefined && input.eventId.trim().length > 0
        ? { eventId: input.eventId.trim() as EventId }
        : {}),
      subject: input.subject,
      content,
      provenance: input.provenance,
      freshness: stamp,
      status: "active",
      observedAt: input.observedAt,
    };
    return ok(observations.put(scope, observationId, record));
  }

  function retractObservation(
    scope: TenantScope,
    observationId: string,
    input: RetractEvidenceInput,
  ): Result<ObservationRecord> {
    const v = createValidator();
    v.requireIdFormat("observationId", observationId);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    v.requireText("reason", input?.reason ?? "", { max: 2000 });
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    const record = observations.get(scope, observationId.trim());
    if (!record) return { ok: false, error: notFound("observation") };
    if (record.status !== "active") {
      return { ok: false, error: conflictError(`observation already ${record.status}`) };
    }
    const retracted: ObservationRecord = {
      ...record,
      status: "retracted",
      retractedAt: input.now,
      retractedBy: input.audit.actor,
    };
    const stored = observations.put(scope, observationId.trim(), retracted);
    audit.append(
      scope,
      { kind: "observation", id: record.observationId },
      "observation.retracted",
      input.audit,
      Object.freeze({ reason: input.reason }),
    );
    return ok(stored);
  }

  return {
    recordObservation,
    getObservation: (scope: TenantScope, observationId: string) => {
      const record = observations.get(scope, observationId);
      return record ? ok(record) : { ok: false, error: notFound("observation") };
    },
    listObservations: (scope: TenantScope, subject: SubjectReference) =>
      observations
        .list(scope)
        .filter(
          (record) => record.subject.kind === subject.kind && record.subject.id === subject.id,
        ),
    retractObservation,
  };
}
