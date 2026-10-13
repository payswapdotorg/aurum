/**
 * fabric-storage public contract (P002): the PostgreSQL persistence layer
 * for the W003 provider/agent fabric — the shared-database migration wiring
 * (fabric area registry) plus one adapter factory per fabric store port,
 * composed into the two whole-fabric factories.
 *
 * Composition rule: every factory binds to a `Db` handle (a postgres.js
 * pool) and implements the store port from `@aurum/provider` /
 * `@aurum/agent` with semantics identical to the in-memory doubles
 * (tenant-scoped, append-only/versioned by database trigger + primary
 * keys, journal side-effects inside the put transaction). The record stores
 * are versioned upserts: every put appends the next immutable version and
 * reads derive the current record — the in-memory Map semantics with the
 * full history retained at the database level.
 *
 * Machinery reuse (the P-series rule): the migration runner (per-area
 * registry option), write journal, PGlite harness and pg plumbing come from
 * domain-storage — extended, never duplicated.
 */
export {
  FABRIC_MIGRATIONS_REGISTRY,
  createFabricPgLiteHarness,
  loadFabricMigrations,
  runFabricMigrations,
} from "./fabric-runner.js";

export {
  createPgProtocolStore,
  createPgDefinitionStore,
  createPgAccountStore,
} from "./adapters/provider-core-store.js";

export {
  createPgCatalogStore,
  createPgModelBindingStore,
} from "./adapters/catalog-binding-store.js";

export {
  createPgAvailabilityStore,
  createPgEvidenceStore,
  createPgHealthStore,
} from "./adapters/observation-store.js";

export {
  createPgAgentBodyStore,
  createPgBodyModelBindingStore,
  createPgRoleHistoryStore,
} from "./adapters/agent-store.js";

export {
  type FabricRecord,
  appendVersionedRecord,
  nextMutationSeq,
  readCurrentVersioned,
  readCurrentsVersioned,
  readVersionRows,
  versionedJournalKey,
} from "./adapters/versioned-record.js";

export { createPgAgentFabricStore, createPgProviderFabricStore } from "./stores.js";
