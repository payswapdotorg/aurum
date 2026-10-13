/**
 * PostgreSQL hypothesis lifecycle (P001, epistemics area, inquiry side) with
 * semantics identical to the in-memory reference — same validation issues,
 * same not-found/invariant discipline (missing before illegal-move), same
 * audit side-effects (hypothesis.status-changed carries from/to; the
 * opening itself is NOT audited, exactly like the reference).
 *
 * Storage ruling (migration 0008): one immutable row per lifecycle mutation
 * keyed (tenant, hypothesis, mutation_seq) — mutation 0 is the opening
 * (from_status null, to_status 'open') and mutations 1..n are the status
 * transitions in order; the current record is the highest mutation on read.
 * The table's check constraints make the shape self-enforcing: only
 * mutation 0 may target 'open', and every later row must carry a from
 * status distinct from its target.
 */
import {
  HYPOTHESIS_STATUSES,
  auditInputIssues,
  conflictError,
  createValidator,
  deepFreeze,
  hypothesisTransitionAllowed,
  invariantError,
  notFound,
  ok,
  provenanceIssues,
  validationError,
} from "@aurum/domain";
import type {
  HypothesisRecord,
  HypothesisStatus,
  HypothesisStatusEntry,
  InquiryStorage,
  OpenHypothesisInput,
  SubjectReference,
  TenantScope,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import {
  resolveFreshness,
  validateFreshnessStamp,
  validateSubjectRef,
} from "./epistemics-shared.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** Loads the current hypothesis record (the highest mutation) or null. */
async function loadCurrentHypothesis(
  sql: Tx | Db,
  scope: TenantScope,
  hypothesisId: string,
): Promise<HypothesisRecord | null> {
  const rows: readonly { record: HypothesisRecord }[] = await sql`
    select record from domain_hypotheses
    where tenant_id = ${scope.tenantId} and hypothesis_id = ${hypothesisId}
    order by mutation_seq desc
    limit 1
  `;
  const row = rows[0];
  return row ? deepFreeze(row.record) : null;
}

/**
 * The hypothesis methods of the inquiry ledger (composed by
 * `createPgInquiryLedger`; internal to the epistemics area).
 */
export function createHypothesisMethods(
  sql: Db,
): Pick<InquiryStorage, "openHypothesis" | "recordHypothesisStatus" | "getHypothesis"> {
  return {
    openHypothesis: async (scope, input: OpenHypothesisInput) => {
      const v = createValidator();
      const hypothesisId = v.requireIdFormat(
        "hypothesisId",
        input?.hypothesisId ?? "",
      ) as HypothesisRecord["hypothesisId"];
      const statement = v.requireText("statement", input?.statement ?? "");
      const explains = Array.isArray(input?.explains) ? input.explains : [];
      if (explains.length === 0) v.add("explains", "must be a non-empty array");
      explains.forEach((subject, index) =>
        validateSubjectRef(v, `explains.${index}`, subject as SubjectReference | undefined),
      );
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      validateFreshnessStamp(v, "freshness", input?.freshness);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const entry: HypothesisStatusEntry = {
        status: "open",
        at: input.now,
        provenance: input.provenance,
      };
      const record: HypothesisRecord = deepFreeze({
        scope,
        hypothesisId,
        statement,
        explains: Object.freeze([...explains]),
        status: "open",
        statusHistory: Object.freeze([entry]),
        provenance: input.provenance,
        freshness: resolveFreshness(input.freshness, input.now),
      });
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_hypotheses
            where tenant_id = ${scope.tenantId} and hypothesis_id = ${hypothesisId}
          `;
          if (existing.length > 0) {
            return { ok: false, error: conflictError("hypothesis already registered in tenant") };
          }
          await tx`
            insert into domain_hypotheses
              (tenant_id, hypothesis_id, mutation_seq, from_status, to_status, record)
            values (${scope.tenantId}, ${hypothesisId}, 0, null, 'open', ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `epistemics:open-hypothesis:${hypothesisId}`,
            area: "epistemics",
            operation: "open-hypothesis",
            recordId: hypothesisId,
          });
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("hypothesis already registered in tenant") };
        }
        throw error;
      }
    },
    recordHypothesisStatus: async (scope, input) => {
      const v = createValidator();
      const hypothesisId = v.requireIdFormat(
        "hypothesisId",
        input?.hypothesisId ?? "",
      ) as HypothesisRecord["hypothesisId"];
      const status = v.requireVocabulary(
        "status",
        String(input?.status ?? ""),
        HYPOTHESIS_STATUSES,
      );
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      return sql.begin(async (tx) => {
        const record = await loadCurrentHypothesis(tx, scope, hypothesisId);
        if (!record) return { ok: false, error: notFound("hypothesis") };
        if (!hypothesisTransitionAllowed(record.status, status as HypothesisStatus)) {
          return {
            ok: false,
            error: invariantError(`hypothesis cannot move from ${record.status} to ${status}`),
          };
        }
        const entry: HypothesisStatusEntry = {
          status: status as HypothesisStatus,
          at: input.now,
          provenance: input.provenance,
        };
        const updated: HypothesisRecord = deepFreeze({
          ...record,
          status: status as HypothesisStatus,
          statusHistory: Object.freeze([...record.statusHistory, entry]),
        });
        await tx`
          insert into domain_hypotheses
            (tenant_id, hypothesis_id, mutation_seq, from_status, to_status, record)
          values
            (${scope.tenantId}, ${hypothesisId}, ${updated.statusHistory.length - 1},
             ${record.status}, ${status}, ${jsonbParam(tx, updated)})
        `;
        await recordWrite(tx, {
          tenantId: scope.tenantId,
          journalKey: `epistemics:hypothesis-status:${hypothesisId}:${updated.statusHistory.length - 1}`,
          area: "epistemics",
          operation: "hypothesis-status",
          recordId: hypothesisId,
          version: updated.statusHistory.length - 1,
        });
        await appendAuditEntry(
          tx,
          scope,
          { kind: "hypothesis", id: hypothesisId },
          "hypothesis.status-changed",
          input.audit,
          Object.freeze({ from: record.status, to: status }),
        );
        return ok(updated);
      });
    },
    getHypothesis: async (scope, hypothesisId) => {
      const record = await loadCurrentHypothesis(sql, scope, hypothesisId);
      return record ? ok(record) : { ok: false, error: notFound("hypothesis") };
    },
  };
}
