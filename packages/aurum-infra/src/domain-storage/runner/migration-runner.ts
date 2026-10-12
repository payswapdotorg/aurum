/**
 * Domain migration runner (P001 shared machinery, P-series reusable).
 *
 * Migrations are plain SQL files under `migrations/domain/`, named
 * `NNNN-<slug>.sql`; ordering is the lexicographic filename order and is
 * enforced as a strict prefix: the set of applied migrations must always be
 * a prefix of the on-disk list. Every applied migration is recorded with the
 * SHA-256 of its content; content drift on an applied migration is a hard
 * error. Applying is idempotent — an already-current database is a no-op.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { PathLike } from "node:fs";
import path from "node:path";
import postgres from "postgres";
/** One on-disk migration: ordered name, raw SQL content, content hash. */
export interface DomainMigration {
  readonly name: string;
  readonly content: string;
  readonly sha256: string;
}

/** Result of one runner pass. */
export interface MigrationRunOutcome {
  /** Migration names applied by this pass (empty when already current). */
  readonly applied: readonly string[];
  /** Migration names already current before this pass. */
  readonly skipped: readonly string[];
}

export type MigrationsSql = postgres.Sql | postgres.TransactionSql;

const DEFAULT_MIGRATIONS_URL = new URL("../../../migrations/domain/", import.meta.url);
/** SHA-256 of the migration content, hex-encoded. */
export function migrationSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Loads `*.sql` from a migration directory in application order (filename
 * sort — the `NNNN-` prefix convention makes that the intended order).
 */
export async function loadDomainMigrations(
  directory: PathLike = DEFAULT_MIGRATIONS_URL,
): Promise<readonly DomainMigration[]> {
  const entries = await readdir(directory);
  const names = entries.filter((name: string) => name.endsWith(".sql")).sort();
  const base = directory instanceof URL ? directory : new URL(`file://${path.resolve(String(directory))}/`);
  const migrations: DomainMigration[] = [];
  for (const name of names) {
    const content = await readFile(new URL(name, base), "utf8");
    migrations.push({ name, content, sha256: migrationSha256(content) });
  }
  if (migrations.length === 0) {
    throw new Error(`no domain migrations found in ${String(directory)}`);
  }
  return migrations;
}

async function ensureSchemaMigrationsTable(sql: MigrationsSql): Promise<void> {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    sha256 text not null,
    applied_at timestamptz not null default now()
  )`;
}

/**
 * Applies pending migrations in order. Each migration runs in its own
 * transaction together with its `schema_migrations` row, so a crash can
 * never leave a half-applied migration recorded (or applied unrecorded).
 *
 * Fails closed on:
 * - applied set is not a prefix of the on-disk list (insertion/removal in
 *   the middle of history);
 * - content hash drift on an already-applied migration.
 */
export async function runDomainMigrations(
  sql: postgres.Sql,
  migrationsInput?: readonly DomainMigration[],
): Promise<MigrationRunOutcome> {
  const migrations = migrationsInput ?? (await loadDomainMigrations());
  await ensureSchemaMigrationsTable(sql);
  const applied = await sql`select name, sha256 from schema_migrations order by name`;
  const appliedNames: readonly string[] = applied.map((row) => row.name as string);
  const diskNames = migrations.map((migration) => migration.name);

  // The applied set must be an exact ordered prefix of the on-disk list.
  for (const [index, name] of appliedNames.entries()) {
    if (diskNames[index] !== name) {
      throw new Error(
        `applied migration ordering violated: applied "${name}" but on-disk order expects ` +
          `"${diskNames[index] ?? "<end>"}" at position ${index} — migrations may only be appended`,
      );
    }
  }

  // Content drift check for every applied migration.
  const byName = new Map(migrations.map((migration) => [migration.name, migration]));
  for (const row of applied) {
    const migration = byName.get(row.name as string);
    if (!migration) {
      throw new Error(`applied migration "${row.name}" no longer exists on disk`);
    }
    if (migration.sha256 !== (row.sha256 as string)) {
      throw new Error(
        `migration "${row.name}" content drift: applied sha256 ${row.sha256} != on-disk ${migration.sha256}`,
      );
    }
  }

  const pending = migrations.slice(appliedNames.length);
  for (const migration of pending) {
    await sql.begin(async (tx) => {
      await tx.unsafe(migration.content);
      await tx`insert into schema_migrations (name, sha256) values (${migration.name}, ${migration.sha256})`;
    });
  }
  return {
    applied: pending.map((migration) => migration.name),
    skipped: appliedNames,
  };
}
