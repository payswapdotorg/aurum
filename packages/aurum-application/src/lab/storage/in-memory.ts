/**
 * Async in-memory adapters (P003): the DB-free implementations of the
 * application storage ports — the deterministic in-memory mode behind the
 * SAME async ports the PostgreSQL adapters (aurum-infra
 * application-storage) implement. Consumers wanting no-DB deterministic
 * tests of the async composition use these; the W008/W013 synchronous
 * in-memory references stay untouched and remain the semantic reference
 * for the untouched lab/learning suites.
 *
 * The doubles delegate to the W008/W013 reference adapters wherever their
 * semantics already match the storage-port contract (everything), except
 * the evaluation append guard: the W008 sync reference upserts by id (an
 * overwrite path unreachable through the lab service — ids are allocated
 * by a fresh module counter per record), while the P003 storage-port
 * contract is append-only by law. The guard therefore pre-checks through
 * the reference's own tenant-scoped read and resolves the same typed
 * refusal the PostgreSQL adapter resolves (duplicate id = typed refusal,
 * never a rewrite).
 */
import { err } from "@aurum/domain";
import { createInMemoryEvaluationStore } from "../adapters/in-memory-evaluation-store.js";
import { createInMemoryOutcomeStore } from "../../learning/contract.learning.js";
import { labEvaluationAppendRefusal } from "./errors.js";
import type { LabEvaluationStorage, OutcomeRecordStorage } from "./ports.js";

/**
 * The in-memory evaluation storage: append-only, tenant-scoped, DB-free —
 * the same-port twin of the PostgreSQL evaluation store.
 */
export function createAsyncInMemoryEvaluationStore(): LabEvaluationStorage {
  const reference = createInMemoryEvaluationStore();
  return {
    async putEvaluation(scope, record) {
      const existing = reference.getEvaluation(scope, record.evaluationId);
      if (existing.ok) return err(labEvaluationAppendRefusal(record.evaluationId));
      return reference.putEvaluation(scope, record);
    },
    getEvaluation(scope, evaluationId) {
      return Promise.resolve(reference.getEvaluation(scope, evaluationId));
    },
    listEvaluations(scope, filter) {
      return Promise.resolve(reference.listEvaluations(scope, filter));
    },
  };
}

/**
 * The in-memory outcome storage: pure delegation — the W013 reference is
 * already append-only with the typed duplicate conflict, so the async twin
 * forwards every call verbatim.
 */
export function createAsyncInMemoryOutcomeStore(): OutcomeRecordStorage {
  const reference = createInMemoryOutcomeStore();
  return {
    putOutcome(scope, record) {
      return Promise.resolve(reference.putOutcome(scope, record));
    },
    getOutcome(scope, outcomeId) {
      return Promise.resolve(reference.getOutcome(scope, outcomeId));
    },
    listOutcomes(scope, filter) {
      return Promise.resolve(reference.listOutcomes(scope, filter));
    },
  };
}
