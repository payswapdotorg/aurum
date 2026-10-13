/**
 * application-storage public contract (P003): the PostgreSQL persistence
 * layer for the lab/learning application records — the application-area
 * migration wiring (per-area registry, shared-database composition) plus
 * the adapters implementing the application storage ports
 * (`@aurum/application` src/lab/storage — the async twins of the W008 lab
 * evaluation store and the W013 outcome store) and the composed retrieval
 * paths the outcome-learning loop consumes.
 *
 * Machinery reuse (the P-series rule): the migration runner (per-area
 * registry option), write journal, PGlite harness and pg plumbing come
 * from domain-storage — extended, never duplicated. The candidate
 * retrieval path is the P001 candidate registry, composed not duplicated.
 */
export {
  APPLICATION_MIGRATIONS_REGISTRY,
  createApplicationPgLiteHarness,
  loadApplicationMigrations,
  runApplicationMigrations,
} from "./application-runner.js";

export { createPgLabEvaluationStore } from "./adapters/evaluation-store.js";

export { createPgOutcomeRecordStore } from "./adapters/outcome-store.js";

export { createPgApplicationStorage, createPgLearningLoopRetrieval } from "./stores.js";
