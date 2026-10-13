/**
 * PostgreSQL evidence area (P001): the event log and the observation ledger
 * with semantics identical to the in-memory reference.
 *
 * Storage ruling: observations are immutable base rows (the record as
 * recorded); retraction is an APPENDED fact in a dedicated table — every
 * table in the area is append-only at the database level, and the
 * one-retraction-per-observation rule is a primary key. The retracted record
 * value is derived on read exactly like the in-memory `retractObservation`
 * spread. `resolveFreshness` is mirrored here because the domain exports it
 * only internally (the public surface exports classifyFreshness).
 */
import {
  auditInputIssues,
  conflictError,
  createValidator,
  deepFreeze,
  isDomainJsonValue,
  isKnownSubjectKind,
  notFound,
  ok,
  provenanceIssues,
  validationError,
} from "@aurum/domain";
import type {
  ActorReference,
  DomainTimestamp,
  DomainJsonValue,
  EventId,
  EventRecord,
  EventStorage,
  EvidenceStorage,
  FreshnessStamp,
  ObservationId,
  ObservationRecord,
  RetractEvidenceInput,
  SubjectReference,
  TenantScope,
  Validator,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** Mirrors the in-memory subject validation (issue-for-issue). */
function validateSubject(v: Validator, field: string, subject: SubjectReference | undefined): void {
  const raw = subject as { kind?: unknown; id?: unknown } | undefined;
  if (!raw || typeof raw.kind !== "string" || !isKnownSubjectKind(raw.kind)) {
    v.add(field, "must have a known subject kind");
  } else if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
    v.add(field, "must have a non-empty subject id");
  }
}

/** Mirrors the in-memory freshness validation. */
function validateFreshness(v: Validator, field: string, stamp: FreshnessStamp | undefined): void {
  if (!stamp) return;
  if (stamp.asOf !== undefined) {
    v.requireNonNegativeNumber(`${field}.asOf`, stamp.asOf);
  }
  if (stamp.validUntil !== undefined) {
    v.requireNonNegativeNumber(`${field}.validUntil`, stamp.validUntil);
  }
}

/** Mirrors the domain-internal resolveFreshness (verbatim stamps win). */
function resolveFreshness(stamp: FreshnessStamp | undefined, fallbackAsOf: number): FreshnessStamp {
  if (stamp !== undefined && (stamp.asOf !== undefined || stamp.validUntil !== undefined)) {
    return stamp;
  }
  return { asOf: fallbackAsOf as DomainTimestamp };
}

/** Creates the PostgreSQL event log bound to a database handle. */
export function createPgEventLog(sql: Db): EventStorage {
  return {
    recordEvent: async (scope, input) => {
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
        validateSubject(v, `subjects.${index}`, subject as SubjectReference);
      }
      if (
        input?.occurredAt !== undefined &&
        input.provenance?.recordedAt !== undefined &&
        input.occurredAt > input.provenance.recordedAt
      ) {
        v.add("occurredAt", "cannot be after the recordedAt provenance time");
      }
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      // Conflict is checked before the payload check (in-memory order).
      const existing = await sql`
        select 1 from domain_events where tenant_id = ${scope.tenantId} and event_id = ${eventId}
      `;
      if (existing.length > 0) {
        return { ok: false, error: conflictError("event already recorded in tenant") };
      }
      if (input.payload !== undefined && !isDomainJsonValue(input.payload)) {
        return {
          ok: false,
          error: validationError([{ field: "payload", problem: "must be JSON data" }]),
        };
      }
      const record: EventRecord = deepFreeze({
        scope,
        eventId,
        kind,
        summary,
        occurredAt: input.occurredAt,
        recordedAt: input.provenance.recordedAt,
        provenance: input.provenance,
        subjects: Object.freeze([...subjects]),
        ...(input.payload !== undefined ? { payload: input.payload as DomainJsonValue } : {}),
      });
      try {
        await sql.begin(async (tx) => {
          await tx`
            insert into domain_events (tenant_id, event_id, kind, summary, occurred_at, record)
            values
              (${scope.tenantId}, ${eventId}, ${kind}, ${summary},
               ${input.occurredAt}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `evidence:record-event:${eventId}`,
            area: "evidence",
            operation: "record-event",
            recordId: eventId,
          });
        });
      } catch (error) {
        // Concurrent create on real PostgreSQL: the unique violation resolves
        // as the same conflict Result the in-memory reference produces.
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("event already recorded in tenant") };
        }
        throw error;
      }
      return ok(record);
    },
    getEvent: async (scope, eventId) => {
      const rows: readonly { record: EventRecord }[] = await sql`
        select record from domain_events
        where tenant_id = ${scope.tenantId} and event_id = ${eventId}
      `;
      if (rows.length === 0) return { ok: false, error: notFound("event") };
      const row = rows[0];
      if (!row) throw new Error("event row missing after length check");
      return ok(deepFreeze(row.record));
    },
  };
}

interface ObservationRow {
  readonly record: ObservationRecord;
  readonly retracted_at: number | null;
  readonly retracted_by: ActorReference | null;
}

/** Derives the observation record value (base + retraction spread). */
function observationValue(row: ObservationRow): ObservationRecord {
  if (row.retracted_at === null || row.retracted_by === null) {
    return deepFreeze(row.record);
  }
  const retracted: ObservationRecord = {
    ...row.record,
    status: "retracted",
    retractedAt: Number(row.retracted_at) as DomainTimestamp,
    retractedBy: row.retracted_by,
  };
  return deepFreeze(retracted);
}

const OBSERVATION_SELECT = async (
  sql: Tx | Db,
  scope: TenantScope,
  observationId: string,
): Promise<readonly ObservationRow[]> => sql`
  select o.record, r.retracted_at, r.retracted_by
  from domain_observations o
  left join domain_observation_retractions r
    on r.tenant_id = o.tenant_id and r.observation_id = o.observation_id
  where o.tenant_id = ${scope.tenantId} and o.observation_id = ${observationId}
`;

/** Creates the PostgreSQL observation ledger bound to a database handle. */
export function createPgEvidenceLedger(sql: Db): EvidenceStorage {
  return {
    recordObservation: async (scope, input) => {
      const v = createValidator();
      const observationId = v.requireIdFormat(
        "observationId",
        input?.observationId ?? "",
      ) as ObservationId;
      validateSubject(v, "subject", input?.subject);
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

      const existing = await sql`
        select 1 from domain_observations
        where tenant_id = ${scope.tenantId} and observation_id = ${observationId}
      `;
      if (existing.length > 0) {
        return { ok: false, error: conflictError("observation already recorded in tenant") };
      }
      // Freshness: an explicit stamp (asOf or validUntil) wins; otherwise the
      // observation defaults to asOf = when the evidence was encountered.
      const stamp = resolveFreshness(input.freshness, input.observedAt);
      const linkedEventId =
        input.eventId !== undefined && input.eventId.trim().length > 0
          ? input.eventId.trim()
          : null;
      const record: ObservationRecord = deepFreeze({
        scope,
        observationId,
        ...(linkedEventId !== null ? { eventId: linkedEventId as EventId } : {}),
        subject: input.subject,
        content,
        provenance: input.provenance,
        freshness: stamp,
        status: "active",
        observedAt: input.observedAt,
      });
      try {
        await sql.begin(async (tx) => {
          await tx`
            insert into domain_observations
              (tenant_id, observation_id, subject_kind, subject_id, observed_at, event_id, record)
            values
              (${scope.tenantId}, ${observationId}, ${input.subject.kind}, ${input.subject.id},
               ${input.observedAt}, ${linkedEventId}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `evidence:record-observation:${observationId}`,
            area: "evidence",
            operation: "record-observation",
            recordId: observationId,
          });
        });
      } catch (error) {
        // Concurrent create on real PostgreSQL: same conflict Result as the
        // in-memory reference.
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("observation already recorded in tenant") };
        }
        throw error;
      }
      return ok(record);
    },
    getObservation: async (scope, observationId) => {
      const rows: readonly ObservationRow[] = await OBSERVATION_SELECT(sql, scope, observationId);
      if (rows.length === 0) return { ok: false, error: notFound("observation") };
      const row = rows[0];
      if (!row) throw new Error("observation row missing after length check");
      return ok(observationValue(row));
    },
    listObservations: async (scope, subject) => {
      const rows: readonly ObservationRow[] = await sql`
        select o.record, r.retracted_at, r.retracted_by
        from domain_observations o
        left join domain_observation_retractions r
          on r.tenant_id = o.tenant_id and r.observation_id = o.observation_id
        where o.tenant_id = ${scope.tenantId}
          and o.subject_kind = ${subject.kind}
          and o.subject_id = ${subject.id}
        order by o.seq
      `;
      return Object.freeze(rows.map(observationValue));
    },
    retractObservation: async (scope, observationId, input: RetractEvidenceInput) => {
      const v = createValidator();
      v.requireIdFormat("observationId", observationId);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      v.requireText("reason", input?.reason ?? "", { max: 2000 });
      for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      return sql.begin(async (tx) => {
        const rows: readonly ObservationRow[] = await OBSERVATION_SELECT(
          tx,
          scope,
          observationId.trim(),
        );
        const row = rows[0];
        if (!row) return { ok: false, error: notFound("observation") };
        if (row.retracted_at !== null) {
          return { ok: false, error: conflictError("observation already retracted") };
        }
        const base = row.record;
        await tx`
          insert into domain_observation_retractions
            (tenant_id, observation_id, retracted_at, retracted_by, reason)
          values
            (${scope.tenantId}, ${base.observationId}, ${input.now},
             ${jsonbParam(tx, input.audit.actor)}, ${input.reason})
        `;
        await recordWrite(tx, {
          tenantId: scope.tenantId,
          journalKey: `evidence:retract-observation:${base.observationId}`,
          area: "evidence",
          operation: "retract-observation",
          recordId: base.observationId,
        });
        await appendAuditEntry(
          tx,
          scope,
          { kind: "observation", id: base.observationId },
          "observation.retracted",
          input.audit,
          Object.freeze({ reason: input.reason }),
        );
        const stored: ObservationRecord = {
          ...base,
          status: "retracted",
          retractedAt: input.now,
          retractedBy: input.audit.actor,
        };
        return ok(deepFreeze(stored));
      });
    },
  };
}
