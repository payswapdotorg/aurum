/**
 * In-memory outcome store (W013 adapters layer): the default implementation
 * of `OutcomeStore`. APPEND-ONLY: putting a duplicate outcome id in the same
 * tenant fails with a typed conflict — recorded outcomes (including
 * failures) are never rewritten. Tenant scoping flows through the seam —
 * cross-tenant reads fail closed as a uniform not-found (no existence
 * leakage). Persistence is the TL-tracked P003 work item; this adapter is
 * the deterministic, IO-free reference behind the same port.
 */
import { err, ok, TenantIndex } from "@aurum/domain";
import { learningConflict, learningNotFound } from "../domain/errors.js";
import type { OutcomeStore } from "../domain/ports.js";
import type { OutcomeFilter, OutcomeJoinRecord } from "../domain/records.js";

export function createInMemoryOutcomeStore(): OutcomeStore {
  const records = new TenantIndex<OutcomeJoinRecord>();

  return {
    putOutcome(scope, record) {
      if (records.get(scope, record.outcomeId) !== undefined) {
        return err(learningConflict(record.outcomeId));
      }
      const stored = records.put(scope, record.outcomeId, record);
      return ok(stored);
    },
    getOutcome(scope, outcomeId) {
      const record = records.get(scope, outcomeId);
      return record ? ok(record) : err(learningNotFound("learning outcome"));
    },
    listOutcomes(scope, filter) {
      const all = records.list(scope);
      if (!filter) return all;
      return all.filter(
        (record) =>
          (filter.goalId === undefined || record.goalId === filter.goalId) &&
          (filter.candidateId === undefined || record.candidateId === filter.candidateId) &&
          (filter.contextClassKey === undefined ||
            record.contextClass.classKey === filter.contextClassKey) &&
          (filter.shapeKey === undefined || record.shape.shapeKey === filter.shapeKey),
      );
    },
  };
}
