/**
 * In-memory company query log (W004 adapters layer): the default
 * implementation of `CompanyQueryLog`. Tenant scoping flows through the
 * seam — cross-tenant reads fail closed as a uniform not-found (no existence
 * leakage). Persistence is a later work item; this adapter is the
 * deterministic, IO-free reference behind the same port.
 */
import { err, ok, TenantIndex } from "@aurum/domain";
import { companyNotFound } from "../domain/errors.js";
import type { CompanyQueryLog } from "../domain/ports.js";
import type { CompanyQueryLogRecord } from "../domain/records.js";

export function createInMemoryQueryLog(): CompanyQueryLog {
  const records = new TenantIndex<CompanyQueryLogRecord>();

  return {
    appendQueryLog(scope, record) {
      const stored = records.put(scope, record.queryId, record);
      return ok(stored);
    },
    getQueryLog(scope, queryId) {
      const record = records.get(scope, queryId);
      return record ? ok(record) : err(companyNotFound("company query log"));
    },
    listQueryLogs(scope) {
      return records.list(scope);
    },
  };
}
