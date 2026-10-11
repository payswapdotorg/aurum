/**
 * In-memory lab evaluation store (W008 adapters layer): the default
 * implementation of `LabEvaluationStore`. Tenant scoping flows through the
 * seam — cross-tenant reads fail closed as a uniform not-found (no
 * existence leakage). Persistence is the TL-tracked P003 work item; this
 * adapter is the deterministic, IO-free reference behind the same port.
 */
import { err, ok, TenantIndex } from "@aurum/domain";
import { labNotFound } from "../domain/errors.js";
import type { LabEvaluationStore } from "../domain/ports.js";
import type { LabEvaluationRecord } from "../domain/records.js";

export function createInMemoryEvaluationStore(): LabEvaluationStore {
  const records = new TenantIndex<LabEvaluationRecord>();

  return {
    putEvaluation(scope, record) {
      const stored = records.put(scope, record.evaluationId, record);
      return ok(stored);
    },
    getEvaluation(scope, evaluationId) {
      const record = records.get(scope, evaluationId);
      return record ? ok(record) : err(labNotFound("lab evaluation"));
    },
    listEvaluations(scope, filter) {
      const all = records.list(scope);
      if (!filter) return all;
      return all.filter(
        (record) =>
          (filter.goalId === undefined || record.goalId === filter.goalId) &&
          (filter.fingerprintDigest === undefined ||
            record.fingerprintDigest === filter.fingerprintDigest),
      );
    },
  };
}
