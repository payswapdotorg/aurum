/**
 * domain-storage public contract (P001): the PostgreSQL persistence layer
 * for the aurum-domain kernel — the shared P-series machinery plus one
 * adapter factory per kernel store.
 *
 * Composition rule: every factory binds to a `Db` handle (a postgres.js
 * pool) and implements the async storage port from `@aurum/domain`'s
 * `DomainStoragePorts` with semantics identical to the in-memory reference
 * (tenant-scoped, append-only by database trigger, journal + audit
 * side-effects inside the command transaction). Consumers compose the
 * stores they need; nothing here is global state.
 *
 * P002/P003 reuse rule: the migration runner, write journal, PGlite
 * harness, audit sink and pg plumbing are the shared machinery — extend
 * them, never duplicate them.
 */
export {
  type DomainMigration,
  type MigrationRunOutcome,
  type MigrationRunnerOptions,
  type MigrationsSql,
  loadDomainMigrations,
  migrationSha256,
  runDomainMigrations,
} from "./runner/migration-runner.js";

export { type Db, type Tx, isUniqueViolation, jsonbParam, mapUniqueViolation } from "./pg/db.js";

export {
  type JournalOnceResult,
  type JournalSql,
  type WriteJournalEntry,
  type WriteJournalRow,
  type WriteRecordResult,
  journalOnce,
  listJournal,
  recordWrite,
} from "./journal/write-journal.js";

export {
  type PgLiteHarness,
  type PgLiteHarnessOptions,
  createPgLiteHarness,
} from "./harness/pglite-harness.js";

export {
  type PgAuditQuery,
  type PgAuditTrail,
  appendAuditEntry,
  createPgAuditTrail,
} from "./adapters/audit-store.js";

export { createPgGoalLedger } from "./adapters/goal-store.js";
export { createPgEventLog, createPgEvidenceLedger } from "./adapters/evidence-store.js";
export { createPgEpistemicsLedger } from "./adapters/epistemics-store.js";
export { createPgInquiryLedger } from "./adapters/inquiry-store.js";
export { createPgIdentityDirectory } from "./adapters/identity-store.js";
export { createPgOrganizationDirectory } from "./adapters/organization-store.js";
export { createPgOrganizationalMemory } from "./adapters/memory-store.js";
export { createPgActionAuthority } from "./adapters/action-store.js";
export { createPgProcessDirectory } from "./adapters/process-store.js";
export { createPgCapabilityGraph } from "./adapters/capability-store.js";
export { createPgWorkforceDirectory } from "./adapters/workforce-store.js";
export { createPgWorkforceInsights } from "./adapters/insights-store.js";
export { createPgWorkforceRecommendations } from "./adapters/recommendation-store.js";
export { createPgCandidateRegistry } from "./adapters/candidate-store.js";
