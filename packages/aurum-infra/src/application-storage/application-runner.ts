/**
 * Application-area migration wiring (P003): the lab/learning application
 * migrations under `migrations/application/`, applied through the SHARED
 * P001 migration runner — extended, never duplicated (the runner's
 * per-area registry option is the WORK-NOTES single-registry extension
 * point, the P002 precedent).
 *
 * Shared-database composition (the registered P002 ruling, extended to
 * three areas): the application area rides a database that also carries
 * the domain area — the domain migrations run FIRST (they define
 * `aurum_reject_mutation`, which every application table attaches, plus
 * the write journal the application adapters record into), then the
 * application migrations record into their OWN registry table
 * (`application_schema_migrations`), so no area's names collide and each
 * prefix discipline is checked independently. The fabric area (P002) is an
 * independent sibling: it shares the same domain machinery and composes in
 * either order relative to the application area; `createApplicationPgLite
 * Harness` boots the domain+application composition every application
 * proof file drives (one registry proof additionally composes all three
 * areas on one database).
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

const APPLICATION_MIGRATIONS_URL = new URL("../../migrations/application/", import.meta.url);

/** Registry table recording the application area's applied migrations. */
export const APPLICATION_MIGRATIONS_REGISTRY = "application_schema_migrations";

/** Loads the application migrations (filename order, sha256-hashed). */
export async function loadApplicationMigrations(
  directory: Parameters<typeof loadDomainMigrations>[0] = APPLICATION_MIGRATIONS_URL,
): Promise<readonly DomainMigration[]> {
  return loadDomainMigrations(directory);
}

/**
 * Applies pending application migrations through the shared runner into the
 * application-area registry. Ordered, content-hashed, idempotent —
 * identical discipline to the domain and fabric areas, independently
 * tracked.
 */
export async function runApplicationMigrations(
  sql: postgres.Sql,
  migrations?: readonly DomainMigration[],
): Promise<MigrationRunOutcome> {
  return runDomainMigrations(sql, migrations ?? (await loadApplicationMigrations()), {
    registryTable: APPLICATION_MIGRATIONS_REGISTRY,
  });
}

/**
 * PGlite harness carrying the shared-database composition: domain
 * migrations (machinery: journal, audit, aurum_reject_mutation) followed
 * by the application migrations (application registry). Every application
 * proof file boots one of these.
 */
export async function createApplicationPgLiteHarness(): Promise<PgLiteHarness> {
  const harness = await createPgLiteHarness({ skipMigrations: true });
  try {
    await runDomainMigrations(harness.sql);
    await runApplicationMigrations(harness.sql);
  } catch (error) {
    await harness.close();
    throw error;
  }
  return harness;
}
