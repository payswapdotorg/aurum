/**
 * PostgreSQL learning outcome store (P003, migration 0002): the
 * `OutcomeRecordStorage` port over the `learning_outcomes` table — the
 * W013 append-only outcome join records (the seven join dimensions carried
 * verbatim).
 *
 * Semantics mirror the W013 in-memory reference exactly (`AsyncPort`
 * twin): a duplicate outcome id resolves the byte-identical
 * `learningConflict(outcomeId)` typed conflict; a missing (or
 * foreign-tenant) id resolves `learningNotFound("learning outcome")`;
 * listing returns insertion order with the reference's AND-filter in
 * JavaScript over the tenant rows (goalId / candidateId /
 * contextClassKey / shapeKey — the anchor and class retrieval paths the
 * learning loop consumes). The write journal row lands in the same
 * transaction as the append. No audit side-effect exists (the reference
 * records none).
 */
import { deepFreeze, err, ok } from "@aurum/domain";
import { learningConflict, learningNotFound, type OutcomeRecordStorage } from "@aurum/application";
import type { OutcomeJoinRecord } from "@aurum/application";
import { recordWrite } from "../../domain-storage/journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../../domain-storage/pg/db.js";
import type { Db } from "../../domain-storage/pg/db.js";

/** Creates the append-only learning outcome store bound to a Db handle. */
export function createPgOutcomeRecordStore(sql: Db): OutcomeRecordStorage {
  return {
    async putOutcome(scope, record) {
      try {
        await sql.begin(async (tx) => {
          await tx`
            insert into learning_outcomes
              (tenant_id, outcome_id, evaluation_id, candidate_id, goal_id,
               fingerprint_digest, context_class_key, shape_key, record)
            values
              (${scope.tenantId}, ${record.outcomeId}, ${record.evaluationId},
               ${record.candidateId}, ${record.goalId ?? null},
               ${record.fingerprintDigest}, ${record.contextClass.classKey},
               ${record.shape.shapeKey}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `learning-outcomes:append:${record.outcomeId}:1`,
            area: "learning-outcomes",
            operation: "append",
            recordId: record.outcomeId,
            version: 1,
          });
        });
        return ok(deepFreeze(record));
      } catch (error) {
        if (isUniqueViolation(error)) {
          return err(learningConflict(record.outcomeId));
        }
        throw error;
      }
    },

    async getOutcome(scope, outcomeId) {
      const rows = await sql`
        select record from learning_outcomes
        where tenant_id = ${scope.tenantId} and outcome_id = ${outcomeId}
      `;
      const row = rows[0] as { record: OutcomeJoinRecord } | undefined;
      return row === undefined
        ? err(learningNotFound("learning outcome"))
        : ok(deepFreeze(row.record));
    },

    async listOutcomes(scope, filter) {
      const rows = await sql`
        select record from learning_outcomes
        where tenant_id = ${scope.tenantId}
        order by seq
      `;
      const all = (rows as unknown as readonly { record: OutcomeJoinRecord }[]).map((row) =>
        deepFreeze(row.record),
      );
      if (!filter) return Object.freeze(all);
      return Object.freeze(
        all.filter(
          (record) =>
            (filter.goalId === undefined || record.goalId === filter.goalId) &&
            (filter.candidateId === undefined || record.candidateId === filter.candidateId) &&
            (filter.contextClassKey === undefined ||
              record.contextClass.classKey === filter.contextClassKey) &&
            (filter.shapeKey === undefined || record.shape.shapeKey === filter.shapeKey),
        ),
      );
    },
  };
}
