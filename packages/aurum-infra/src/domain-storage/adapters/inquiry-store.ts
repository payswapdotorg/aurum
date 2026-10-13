/**
 * PostgreSQL inquiry ledger (P001, epistemics area): contradictions and
 * unknowns with semantics identical to the in-memory reference — same
 * validation issues (including the between-distinctness check), same
 * not-found/conflict discipline, same audit side-effects
 * (contradiction.recorded and unknown.raised carry the provenance actor and
 * the description/question as the reason; the resolutions carry the
 * outcome). The kernel never auto-merges a retained conflict and unknowns
 * never disappear silently — resolutions are explicit, audited facts.
 *
 * Storage ruling (migration 0008): contradictions and unknowns are
 * immutable base rows; resolutions are appended facts (one per record,
 * primary key) and the resolved record values are derived on read. The
 * hypothesis methods live in hypothesis-store.ts and are composed here so
 * one factory returns the whole InquiryStorage port.
 */
import {
  auditInputIssues,
  conflictError,
  createValidator,
  deepFreeze,
  notFound,
  ok,
  provenanceIssues,
  validationError,
} from "@aurum/domain";
import type {
  ContradictionRecord,
  InquiryStorage,
  RaiseUnknownInput,
  RecordContradictionInput,
  ResolveContradictionInput,
  ResolveUnknownInput,
  SubjectReference,
  TenantScope,
  UnknownRecord,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import { createHypothesisMethods } from "./hypothesis-store.js";
import {
  contradictionValue,
  resolveFreshness,
  unknownValue,
  validateFreshnessStamp,
  validateSubjectRef,
} from "./epistemics-shared.js";
import type { ResolutionRow } from "./epistemics-shared.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db } from "../pg/db.js";

/** Creates the PostgreSQL inquiry ledger bound to a database handle. */
export function createPgInquiryLedger(sql: Db): InquiryStorage {
  return {
    ...createHypothesisMethods(sql),
    recordContradiction: async (scope, input: RecordContradictionInput) => {
      const v = createValidator();
      const contradictionId = v.requireIdFormat(
        "contradictionId",
        input?.contradictionId ?? "",
      ) as ContradictionRecord["contradictionId"];
      const description = v.requireText("description", input?.description ?? "");
      const between = Array.isArray(input?.between) ? input.between : [];
      if (between.length < 2) v.add("between", "must reference at least two records");
      between.forEach((subject, index) =>
        validateSubjectRef(v, `between.${index}`, subject as SubjectReference | undefined),
      );
      // Distinctness mirrors the reference verbatim (template-literal keys,
      // including its TypeError on non-object entries — issue-for-issue).
      const seen = new Set(between.map((subject) => `${subject.kind}:${subject.id}`));
      if (seen.size < between.length) v.add("between", "must reference distinct records");
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      validateFreshnessStamp(v, "freshness", input?.freshness);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const record: ContradictionRecord = deepFreeze({
        scope,
        contradictionId,
        between: Object.freeze([...between]),
        description,
        status: "open",
        recordedAt: input.now,
        provenance: input.provenance,
        freshness: resolveFreshness(input.freshness, input.now),
      });
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_contradictions
            where tenant_id = ${scope.tenantId} and contradiction_id = ${contradictionId}
          `;
          if (existing.length > 0) {
            return {
              ok: false,
              error: conflictError("contradiction already registered in tenant"),
            };
          }
          await tx`
            insert into domain_contradictions (tenant_id, contradiction_id, record)
            values (${scope.tenantId}, ${contradictionId}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `epistemics:record-contradiction:${contradictionId}`,
            area: "epistemics",
            operation: "record-contradiction",
            recordId: contradictionId,
          });
          // The description is the "why" for recording a retained conflict.
          await appendAuditEntry(
            tx,
            scope,
            { kind: "contradiction", id: contradictionId },
            "contradiction.recorded",
            {
              actor: input.provenance.actor,
              at: input.now,
              reason: description,
            },
          );
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return {
            ok: false,
            error: conflictError("contradiction already registered in tenant"),
          };
        }
        throw error;
      }
    },
    getContradiction: async (scope, contradictionId) => {
      const rows: readonly ({ record: ContradictionRecord } & ResolutionRow)[] = await sql`
        select c.record, r.resolved_at, r.resolved_by, r.outcome
        from domain_contradictions c
        left join domain_contradiction_resolutions r
          on r.tenant_id = c.tenant_id and r.contradiction_id = c.contradiction_id
        where c.tenant_id = ${scope.tenantId} and c.contradiction_id = ${contradictionId}
      `;
      if (rows.length === 0) return { ok: false, error: notFound("contradiction") };
      const row = rows[0];
      if (!row) throw new Error("contradiction row missing after length check");
      return ok(contradictionValue(row));
    },
    listOpenContradictions: async (scope) => {
      const rows: readonly { record: ContradictionRecord }[] = await sql`
        select c.record from domain_contradictions c
        left join domain_contradiction_resolutions r
          on r.tenant_id = c.tenant_id and r.contradiction_id = c.contradiction_id
        where c.tenant_id = ${scope.tenantId} and r.contradiction_id is null
        order by c.seq
      `;
      return Object.freeze(rows.map((row) => deepFreeze(row.record)));
    },
    resolveContradiction: async (scope, input: ResolveContradictionInput) => {
      const v = createValidator();
      const contradictionId = v.requireIdFormat(
        "contradictionId",
        input?.contradictionId ?? "",
      ) as ContradictionRecord["contradictionId"];
      const outcome = v.requireText("outcome", input?.outcome ?? "");
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      try {
        return await sql.begin(async (tx) => {
          const rows: readonly ({ record: ContradictionRecord } & ResolutionRow)[] = await tx`
            select c.record, r.resolved_at, r.resolved_by, r.outcome
            from domain_contradictions c
            left join domain_contradiction_resolutions r
              on r.tenant_id = c.tenant_id and r.contradiction_id = c.contradiction_id
            where c.tenant_id = ${scope.tenantId} and c.contradiction_id = ${contradictionId}
          `;
          const row = rows[0];
          if (!row) return { ok: false, error: notFound("contradiction") };
          if (row.resolved_at !== null) {
            return { ok: false, error: conflictError("contradiction already resolved") };
          }
          const base = row.record;
          await tx`
            insert into domain_contradiction_resolutions
              (tenant_id, contradiction_id, resolved_at, resolved_by, outcome)
            values
              (${scope.tenantId}, ${base.contradictionId}, ${input.now},
               ${jsonbParam(tx, input.audit.actor)}, ${outcome})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `epistemics:resolve-contradiction:${base.contradictionId}`,
            area: "epistemics",
            operation: "resolve-contradiction",
            recordId: base.contradictionId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "contradiction", id: base.contradictionId },
            "contradiction.resolved",
            input.audit,
            Object.freeze({ outcome }),
          );
          const resolved: ContradictionRecord = deepFreeze({
            ...base,
            status: "resolved",
            resolution: Object.freeze({
              outcome,
              resolvedAt: input.now,
              resolvedBy: input.audit.actor,
            }),
          });
          return ok(resolved);
        });
      } catch (error) {
        // Concurrent resolution on real PostgreSQL: the second writer hits
        // the one-resolution primary key — the same conflict the in-memory
        // reference reports for an already-resolved contradiction.
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("contradiction already resolved") };
        }
        throw error;
      }
    },
    raiseUnknown: async (scope, input: RaiseUnknownInput) => {
      const v = createValidator();
      const unknownId = v.requireIdFormat(
        "unknownId",
        input?.unknownId ?? "",
      ) as UnknownRecord["unknownId"];
      const question = v.requireText("question", input?.question ?? "");
      const consequence = v.requireText("consequence", input?.consequence ?? "");
      const relatedSubjects = Array.isArray(input?.relatedSubjects) ? input.relatedSubjects : [];
      relatedSubjects.forEach((subject, index) =>
        validateSubjectRef(v, `relatedSubjects.${index}`, subject as SubjectReference | undefined),
      );
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      validateFreshnessStamp(v, "freshness", input?.freshness);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const record: UnknownRecord = deepFreeze({
        scope,
        unknownId,
        question,
        consequence,
        relatedSubjects: Object.freeze([...relatedSubjects]),
        status: "open",
        raisedAt: input.now,
        provenance: input.provenance,
        freshness: resolveFreshness(input.freshness, input.now),
      });
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_unknowns
            where tenant_id = ${scope.tenantId} and unknown_id = ${unknownId}
          `;
          if (existing.length > 0) {
            return { ok: false, error: conflictError("unknown already registered in tenant") };
          }
          await tx`
            insert into domain_unknowns (tenant_id, unknown_id, record)
            values (${scope.tenantId}, ${unknownId}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `epistemics:raise-unknown:${unknownId}`,
            area: "epistemics",
            operation: "raise-unknown",
            recordId: unknownId,
          });
          // The question is the "why" for raising an explicit unknown.
          await appendAuditEntry(tx, scope, { kind: "unknown", id: unknownId }, "unknown.raised", {
            actor: input.provenance.actor,
            at: input.now,
            reason: question,
          });
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("unknown already registered in tenant") };
        }
        throw error;
      }
    },
    getUnknown: async (scope, unknownId) => {
      const rows: readonly ({ record: UnknownRecord } & ResolutionRow)[] = await sql`
        select u.record, r.resolved_at, r.resolved_by, r.outcome
        from domain_unknowns u
        left join domain_unknown_resolutions r
          on r.tenant_id = u.tenant_id and r.unknown_id = u.unknown_id
        where u.tenant_id = ${scope.tenantId} and u.unknown_id = ${unknownId}
      `;
      if (rows.length === 0) return { ok: false, error: notFound("unknown") };
      const row = rows[0];
      if (!row) throw new Error("unknown row missing after length check");
      return ok(unknownValue(row));
    },
    listOpenUnknowns: async (scope) => {
      const rows: readonly { record: UnknownRecord }[] = await sql`
        select u.record from domain_unknowns u
        left join domain_unknown_resolutions r
          on r.tenant_id = u.tenant_id and r.unknown_id = u.unknown_id
        where u.tenant_id = ${scope.tenantId} and r.unknown_id is null
        order by u.seq
      `;
      return Object.freeze(rows.map((row) => deepFreeze(row.record)));
    },
    resolveUnknown: async (scope, input: ResolveUnknownInput) => {
      const v = createValidator();
      const unknownId = v.requireIdFormat(
        "unknownId",
        input?.unknownId ?? "",
      ) as UnknownRecord["unknownId"];
      const outcome = v.requireText("outcome", input?.outcome ?? "");
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      try {
        return await sql.begin(async (tx) => {
          const rows: readonly ({ record: UnknownRecord } & ResolutionRow)[] = await tx`
            select u.record, r.resolved_at, r.resolved_by, r.outcome
            from domain_unknowns u
            left join domain_unknown_resolutions r
              on r.tenant_id = u.tenant_id and r.unknown_id = u.unknown_id
            where u.tenant_id = ${scope.tenantId} and u.unknown_id = ${unknownId}
          `;
          const row = rows[0];
          if (!row) return { ok: false, error: notFound("unknown") };
          if (row.resolved_at !== null) {
            return { ok: false, error: conflictError("unknown already resolved") };
          }
          const base = row.record;
          await tx`
            insert into domain_unknown_resolutions
              (tenant_id, unknown_id, resolved_at, resolved_by, outcome)
            values
              (${scope.tenantId}, ${base.unknownId}, ${input.now},
               ${jsonbParam(tx, input.audit.actor)}, ${outcome})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `epistemics:resolve-unknown:${base.unknownId}`,
            area: "epistemics",
            operation: "resolve-unknown",
            recordId: base.unknownId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "unknown", id: base.unknownId },
            "unknown.resolved",
            input.audit,
            Object.freeze({ outcome }),
          );
          const resolved: UnknownRecord = deepFreeze({
            ...base,
            status: "resolved",
            resolution: Object.freeze({
              outcome,
              resolvedAt: input.now,
              resolvedBy: input.audit.actor,
            }),
          });
          return ok(resolved);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("unknown already resolved") };
        }
        throw error;
      }
    },
  };
}
