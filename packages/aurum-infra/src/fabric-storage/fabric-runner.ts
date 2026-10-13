/**
 * Fabric-area migration wiring (P002): the provider/agent fabric migrations
 * under `migrations/fabric/`, applied through the SHARED P001 migration
 * runner — extended, never duplicated (the runner's per-area registry option
 * is the WORK-NOTES single-registry extension point).
 *
 * Shared-database composition (the registered P002 ruling): the fabric area
 * rides a database that also carries the domain area — the domain migrations
 * run FIRST (they define `aurum_reject_mutation`, which every fabric table
 * attaches, plus the write journal the fabric adapters record into), then the
 * fabric migrations record into their OWN registry table
 * (`fabric_schema_migrations`), so the two areas' names never collide and
 * each prefix discipline is checked independently. `createFabricPgLiteHarness`
 * boots exactly that composition for proofs.
 */
import type postgres from "postgres";
import type {
  DomainMigration,
  MigrationRunOutcome,
} from "../domain-storage/runner/migration-runner.js";
import {
  loadDomainMigrations,
  runDomainMigrations,
} from "../domain-storage/runner/migration-runner.js";
import { createPgLiteHarness } from "../domain-storage/harness/pglite-harness.js";
import type { PgLiteHarness } from "../domain-storage/harness/pglite-harness.js";

const FABRIC_MIGRATIONS_URL = new URL("../../migrations/fabric/", import.meta.url);

/** Registry table recording the fabric area's applied migrations. */
export const FABRIC_MIGRATIONS_REGISTRY = "fabric_schema_migrations";

/** Loads the fabric migrations (filename order, sha256-hashed). */
export async function loadFabricMigrations(
  directory: Parameters<typeof loadDomainMigrations>[0] = FABRIC_MIGRATIONS_URL,
): Promise<readonly DomainMigration[]> {
  return loadDomainMigrations(directory);
}

/**
 * Applies pending fabric migrations through the shared runner into the
 * fabric-area registry. Ordered, content-hashed, idempotent — identical
 * discipline to the domain area, independently tracked.
 */
export async function runFabricMigrations(
  sql: postgres.Sql,
  migrations?: readonly DomainMigration[],
): Promise<MigrationRunOutcome> {
  return runDomainMigrations(sql, migrations ?? (await loadFabricMigrations()), {
    registryTable: FABRIC_MIGRATIONS_REGISTRY,
  });
}

/**
 * PGlite harness carrying the shared-database composition: domain migrations
 * (machinery: journal, audit, aurum_reject_mutation) followed by the fabric
 * migrations (fabric registry). Every fabric proof file boots one of these.
 */
export async function createFabricPgLiteHarness(): Promise<PgLiteHarness> {
  const harness = await createPgLiteHarness({ skipMigrations: true });
  try {
    await runDomainMigrations(harness.sql);
    await runFabricMigrations(harness.sql);
  } catch (error) {
    await harness.close();
    throw error;
  }
  return harness;
}
