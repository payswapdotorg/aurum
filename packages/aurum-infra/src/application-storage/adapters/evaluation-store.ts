/**
 * PostgreSQL lab evaluation store (P003, migration 0001): the
 * `LabEvaluationStorage` port over the `lab_evaluations` table — the
 * append-only evidence of the lab's two production paths (search records
 * and candidate evaluations), carrying the outcome-learning join keys
 * (fingerprint digest + axes, constraint set, weights, modifiers, ranking
 * rule) verbatim through the record jsonb.
 *
 * Semantics mirror the W008 in-memory reference (`AsyncPort` twin):
 * - putEvaluation appends ONE immutable row; a duplicate id is rejected by
 *   the primary key and resolved as the typed append refusal — never a
 *   rewrite. (The reference's overwrite-by-id path is unreachable through
 *   the lab service, which allocates fresh ids per record; the storage
 *   port is append-only by the P003 law — the divergence is documented in
 *   the WORK-NOTES and closes loudly on both async modes.)
 * - getEvaluation resolves the byte-identical `labNotFound("lab
 *   evaluation")` the reference produces; foreign-tenant and missing ids
 *   are indistinguishable (the query is tenant-scoped).
 * - listEvaluations returns insertion order, filters in JavaScript over
 *   the tenant rows (the TenantIndex.list().filter() mirror; the P002
 *   first-insertion-order ruling).
 *
 * The write journal row lands in the SAME transaction as the append
 * (atomicity per command, the P001 ruling). No audit side-effect exists —
 * the in-memory reference records none (audit equivalence).
 */
import { deepFreeze, err, ok } from "@aurum/domain";
import {
  labEvaluationAppendRefusal,
  labNotFound,
  type LabEvaluationStorage,
} from "@aurum/application";
import type { LabEvaluationRecord } from "@aurum/application";
import { recordWrite } from "../../domain-storage/journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../../domain-storage/pg/db.js";
import type { Db } from "../../domain-storage/pg/db.js";

/** Creates the append-only lab evaluation store bound to a Db handle. */
export function createPgLabEvaluationStore(sql: Db): LabEvaluationStorage {
  return {
    async putEvaluation(scope, record) {
      try {
        await sql.begin(async (tx) => {
          await tx`
            insert into lab_evaluations
              (tenant_id, evaluation_id, goal_id, fingerprint_digest, ranking_rule, record)
            values
              (${scope.tenantId}, ${record.evaluationId}, ${record.goalId ?? null},
               ${record.fingerprintDigest}, ${record.rankingRule}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `lab-evaluations:append:${record.evaluationId}:1`,
            area: "lab-evaluations",
            operation: "append",
            recordId: record.evaluationId,
            version: 1,
          });
        });
        return ok(deepFreeze(record));
      } catch (error) {
        if (isUniqueViolation(error)) {
          return err(labEvaluationAppendRefusal(record.evaluationId));
        }
        throw error;
      }
    },

    async getEvaluation(scope, evaluationId) {
      const rows = await sql`
        select record from lab_evaluations
        where tenant_id = ${scope.tenantId} and evaluation_id = ${evaluationId}
      `;
      const row = rows[0] as { record: LabEvaluationRecord } | undefined;
      return row === undefined ? err(labNotFound("lab evaluation")) : ok(deepFreeze(row.record));
    },

    async listEvaluations(scope, filter) {
      const rows = await sql`
        select record from lab_evaluations
        where tenant_id = ${scope.tenantId}
        order by seq
      `;
      const all = (rows as unknown as readonly { record: LabEvaluationRecord }[]).map((row) =>
        deepFreeze(row.record),
      );
      if (!filter) return Object.freeze(all);
      return Object.freeze(
        all.filter(
          (record) =>
            (filter.goalId === undefined || record.goalId === filter.goalId) &&
            (filter.fingerprintDigest === undefined ||
              record.fingerprintDigest === filter.fingerprintDigest),
        ),
      );
    },
  };
}
