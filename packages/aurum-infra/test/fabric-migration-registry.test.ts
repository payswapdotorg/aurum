/**
 * P002 machinery proof: the fabric-area migration registry — the shared
 * P001 runner extended with a per-area registry table (the WORK-NOTES
 * single-registry extension point) so the domain and fabric areas can share
 * one database: names never collide, each area's prefix/content discipline is
 * enforced independently, and the default domain behavior is unchanged (the
 * 9 domain migration-runner proofs stay green untouched).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  migrationSha256,
  loadDomainMigrations,
  runDomainMigrations,
} from "../src/domain-storage/runner/migration-runner.js";
import { createPgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";
import type { PgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";
import {
  FABRIC_MIGRATIONS_REGISTRY,
  createFabricPgLiteHarness,
  loadFabricMigrations,
  runFabricMigrations,
} from "../src/fabric-storage/fabric-runner.js";

let harness: PgLiteHarness;

beforeAll(async () => {
  harness = await createFabricPgLiteHarness();
});

afterAll(async () => {
  await harness.close();
});

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "aurum-fabric-migrations-"));
}

async function writeMigration(dir: string, name: string, content: string): Promise<void> {
  await writeFile(path.join(dir, name), content, "utf8");
}

describe("fabric migration registry (shared database, per-area registries)", () => {
  it("applies the shipped fabric migrations in filename order after the domain area", async () => {
    const names = (await loadFabricMigrations()).map((migration) => migration.name);
    expect(names).toEqual([
      "0001-fabric-provider-core.sql",
      "0002-fabric-catalog-bindings.sql",
      "0003-fabric-observations.sql",
      "0004-fabric-agent.sql",
    ]);
    // The harness ran domain first, then fabric: both registries hold exactly
    // their own areas, independently ordered.
    const fabricRows =
      await harness.sql`select name from ${harness.sql(FABRIC_MIGRATIONS_REGISTRY)} order by name`;
    expect(fabricRows.map((row) => row.name)).toEqual(names);
    const domainRows = await harness.sql`select name from schema_migrations order by name`;
    expect(domainRows.map((row) => row.name)).toEqual(
      (await loadDomainMigrations()).map((migration) => migration.name),
    );
    // Fabric tables exist and are append-only through the SHARED trigger.
    await harness.sql`insert into fabric_protocols (tenant_id, protocol_id, mutation_seq, record)
      values ('t', 'proto:x', 0, '{}'::jsonb)`;
    await expect(harness.sql`update fabric_protocols set record = '{}'::jsonb`).rejects.toThrow(
      /append-only/,
    );
    await expect(harness.sql`delete from fabric_protocols`).rejects.toThrow(/append-only/);
  });

  it("is idempotent per area: a second fabric run applies nothing and the domain registry is untouched", async () => {
    const outcome = await runFabricMigrations(harness.sql);
    expect(outcome.applied).toEqual([]);
    const names = (await loadFabricMigrations()).map((migration) => migration.name);
    expect(outcome.skipped).toEqual(names);
    // Domain area still current through its own default registry:
    const domainOutcome = await runDomainMigrations(harness.sql);
    expect(domainOutcome.applied).toEqual([]);
  });

  it("records the sha256 of each fabric migration in the fabric registry", async () => {
    const migrations = await loadFabricMigrations();
    const rows =
      await harness.sql`select name, sha256 from ${harness.sql(FABRIC_MIGRATIONS_REGISTRY)} order by name`;
    for (const row of rows) {
      const migration = migrations.find((item) => item.name === row.name);
      expect(migration).toBeTruthy();
      expect(row.sha256).toBe(migration?.sha256);
      expect(row.sha256).toBe(migrationSha256(migration?.content ?? ""));
      expect(String(row.sha256)).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("fabric registry history discipline (custom directories)", () => {
  it("same-named domain and fabric migrations coexist on one shared database", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      await runDomainMigrations(local.sql); // domain area, default registry
      const dir = await tempDir();
      await writeMigration(dir, "0001-write-journal.sql", "create table fabric_collide_t (id int)");
      const outcome = await runFabricMigrations(local.sql, await loadFabricMigrations(dir));
      expect(outcome.applied).toEqual(["0001-write-journal.sql"]);
      // Both registries hold the SAME NAME, each its own sha256:
      const fabricRows =
        await local.sql`select name from ${local.sql(FABRIC_MIGRATIONS_REGISTRY)} order by name`;
      const domainRows = await local.sql`select name from schema_migrations order by name`;
      expect(fabricRows.map((row) => row.name)).toEqual(["0001-write-journal.sql"]);
      expect(domainRows.map((row) => row.name)).toContain("0001-write-journal.sql");
      expect(domainRows.length).toBe(12);
      // And both areas remain idempotent afterwards:
      expect((await runDomainMigrations(local.sql)).applied).toEqual([]);
      expect(
        (await runFabricMigrations(local.sql, await loadFabricMigrations(dir))).applied,
      ).toEqual([]);
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });

  it("rejects content drift on an applied fabric migration", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table fdrift_t (id int)");
      const first = await runFabricMigrations(local.sql, await loadFabricMigrations(dir));
      expect(first.applied).toEqual(["0001-a.sql"]);
      await writeMigration(dir, "0001-a.sql", "create table fdrift_t (id int, v text)");
      await expect(runFabricMigrations(local.sql, await loadFabricMigrations(dir))).rejects.toThrow(
        /content drift/,
      );
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });

  it("rejects a fabric migration removed from the middle of history", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table fmid_a (id int)");
      await writeMigration(dir, "0002-b.sql", "create table fmid_b (id int)");
      await runFabricMigrations(local.sql, await loadFabricMigrations(dir));
      await rm(path.join(dir, "0002-b.sql"));
      await expect(runFabricMigrations(local.sql, await loadFabricMigrations(dir))).rejects.toThrow(
        /ordering violated|no longer exists/,
      );
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });

  it("rejects a fabric migration inserted before applied history", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table fins_a (id int)");
      await writeMigration(dir, "0002-b.sql", "create table fins_b (id int)");
      await runFabricMigrations(local.sql, await loadFabricMigrations(dir));
      await writeMigration(dir, "0000-early.sql", "create table fins_early (id int)");
      await expect(runFabricMigrations(local.sql, await loadFabricMigrations(dir))).rejects.toThrow(
        /ordering violated/,
      );
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });

  it("applies only newly appended fabric migrations", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table fapp_a (id int)");
      await runFabricMigrations(local.sql, await loadFabricMigrations(dir));
      await writeMigration(dir, "0002-b.sql", "create table fapp_b (id int)");
      const outcome = await runFabricMigrations(local.sql, await loadFabricMigrations(dir));
      expect(outcome.applied).toEqual(["0002-b.sql"]);
      expect(outcome.skipped).toEqual(["0001-a.sql"]);
      await local.sql`insert into fapp_b values (1)`;
      const rows = await local.sql`select count(*)::int as n from fapp_b`;
      expect(rows[0].n).toBe(1);
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });

  it("keeps a failing fabric migration unrecorded and earlier ones applied (atomic apply)", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table fatom_a (id int)");
      await writeMigration(dir, "0002-b.sql", "create table fatom_b (this is not valid sql");
      await expect(
        runFabricMigrations(local.sql, await loadFabricMigrations(dir)),
      ).rejects.toThrow();
      const rows =
        await local.sql`select name from ${local.sql(FABRIC_MIGRATIONS_REGISTRY)} order by name`;
      expect(rows.map((row) => row.name)).toEqual(["0001-a.sql"]);
      await local.sql`insert into fatom_a values (1)`;
      await expect(local.sql`select 1 from fatom_b`).rejects.toThrow();
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });
});
