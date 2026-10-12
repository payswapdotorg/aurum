/**
 * P001 machinery proof: the migration runner is ordered, content-hashed and
 * idempotent to apply, and fails closed on history tampering (drift,
 * mid-history insertion, removal).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadDomainMigrations,
  migrationSha256,
  runDomainMigrations,
} from "../src/domain-storage/runner/migration-runner.js";
import { createPgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";
import type { PgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";

let harness: PgLiteHarness;

beforeAll(async () => {
  harness = await createPgLiteHarness({ skipMigrations: true });
});

afterAll(async () => {
  await harness.close();
});

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "aurum-migrations-"));
}

async function writeMigration(dir: string, name: string, content: string): Promise<void> {
  await writeFile(path.join(dir, name), content, "utf8");
}

describe("migration runner", () => {
  it("applies the shipped domain migrations in filename order on a fresh database", async () => {
    const outcome = await runDomainMigrations(harness.sql);
    const names = (await loadDomainMigrations()).map((migration) => migration.name);
    expect(outcome.applied).toEqual(names);
    expect(outcome.skipped).toEqual([]);
    const recorded = await harness.sql`select name from schema_migrations order by name`;
    expect(recorded.map((row) => row.name)).toEqual(names);
    // The write journal table exists and enforces append-only.
    await harness.sql`insert into domain_write_journal (tenant_id, journal_key, area, operation, record_id)
      values ('t', 'k', 'area', 'op', 'r')`;
    await expect(
      harness.sql`update domain_write_journal set area = 'x'`,
    ).rejects.toThrow(/append-only/);
    await expect(harness.sql`delete from domain_write_journal`).rejects.toThrow(/append-only/);
    await expect(harness.sql`select count(*)::int as n from domain_write_journal`).resolves.toMatchObject(
      [{ n: 1 }],
    );
  });

  it("is idempotent: a second run applies nothing and skips everything", async () => {
    const outcome = await runDomainMigrations(harness.sql);
    expect(outcome.applied).toEqual([]);
    const names = (await loadDomainMigrations()).map((migration) => migration.name);
    expect(outcome.skipped).toEqual(names);
  });

  it("records the sha256 of each migration's content", async () => {
    const migrations = await loadDomainMigrations();
    const rows = await harness.sql`select name, sha256 from schema_migrations order by name`;
    for (const row of rows) {
      const migration = migrations.find((item) => item.name === row.name);
      expect(migration).toBeTruthy();
      expect(row.sha256).toBe(migration?.sha256);
      expect(row.sha256).toBe(migrationSha256(migration?.content ?? ""));
      expect(String(row.sha256)).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("migration runner history discipline (custom directories)", () => {
  it("rejects content drift on an applied migration", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table drift_t (id int)");
      const first = await runDomainMigrations(
        local.sql,
        await loadDomainMigrations(dir),
      );
      expect(first.applied).toEqual(["0001-a.sql"]);
      // Content of an applied migration changes on disk.
      await writeMigration(dir, "0001-a.sql", "create table drift_t (id int, v text)");
      await expect(
        runDomainMigrations(local.sql, await loadDomainMigrations(dir)),
      ).rejects.toThrow(/content drift/);
    } finally {
      await local.close();
    }
  });

  it("rejects a migration removed from the middle of history", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table mid_a (id int)");
      await writeMigration(dir, "0002-b.sql", "create table mid_b (id int)");
      await runDomainMigrations(local.sql, await loadDomainMigrations(dir));
      await rm(path.join(dir, "0002-b.sql"));
      await expect(
        runDomainMigrations(local.sql, await loadDomainMigrations(dir)),
      ).rejects.toThrow(/ordering violated|no longer exists/);
    } finally {
      await local.close();
    }
  });

  it("rejects a migration inserted before already-applied history", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table ins_a (id int)");
      await writeMigration(dir, "0002-b.sql", "create table ins_b (id int)");
      await runDomainMigrations(local.sql, await loadDomainMigrations(dir));
      await writeMigration(dir, "0000-early.sql", "create table ins_early (id int)");
      await expect(
        runDomainMigrations(local.sql, await loadDomainMigrations(dir)),
      ).rejects.toThrow(/ordering violated/);
    } finally {
      await local.close();
    }
  });

  it("applies only newly appended migrations", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table app_a (id int)");
      await runDomainMigrations(local.sql, await loadDomainMigrations(dir));
      await writeMigration(dir, "0002-b.sql", "create table app_b (id int)");
      const outcome = await runDomainMigrations(local.sql, await loadDomainMigrations(dir));
      expect(outcome.applied).toEqual(["0002-b.sql"]);
      expect(outcome.skipped).toEqual(["0001-a.sql"]);
      await local.sql`insert into app_b values (1)`;
      const rows = await local.sql`select count(*)::int as n from app_b`;
      expect(rows[0].n).toBe(1);
    } finally {
      await local.close();
    }
  });

  it("keeps a failing migration unrecorded and earlier ones applied (atomic apply)", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table atom_a (id int)");
      await writeMigration(dir, "0002-b.sql", "create table atom_b (this is not valid sql");
      await expect(
        runDomainMigrations(local.sql, await loadDomainMigrations(dir)),
      ).rejects.toThrow();
      const rows = await local.sql`select name from schema_migrations order by name`;
      expect(rows.map((row) => row.name)).toEqual(["0001-a.sql"]);
      // atom_a committed; atom_b rolled back entirely.
      await local.sql`insert into atom_a values (1)`;
      await expect(local.sql`select 1 from atom_b`).rejects.toThrow();
    } finally {
      await local.close();
    }
  });

  it("loads only .sql files, ordered by filename", async () => {
    const dir = await tempDir();
    await mkdir(path.join(dir, "sub"), { recursive: true });
    await writeMigration(dir, "0002-b.sql", "select 2");
    await writeMigration(dir, "0001-a.sql", "select 1");
    await writeMigration(dir, "notes.txt", "not a migration");
    const migrations = await loadDomainMigrations(dir);
    expect(migrations.map((migration) => migration.name)).toEqual(["0001-a.sql", "0002-b.sql"]);
    await rm(dir, { recursive: true, force: true });
  });
});
