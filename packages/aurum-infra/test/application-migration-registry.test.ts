/**
 * P003 machinery proof: the application-area migration registry — the
 * shared P001 runner extended with a per-area registry table (the P002
 * precedent) so the domain, fabric and application areas can share ONE
 * database: names never collide, each area's prefix/content discipline is
 * enforced independently, and the default domain behavior is unchanged
 * (the 9 domain migration-runner proofs + the 9 fabric registry proofs
 * stay green untouched).
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
import { runFabricMigrations } from "../src/fabric-storage/fabric-runner.js";
import {
  APPLICATION_MIGRATIONS_REGISTRY,
  createApplicationPgLiteHarness,
  loadApplicationMigrations,
  runApplicationMigrations,
} from "../src/application-storage/application-runner.js";

let harness: PgLiteHarness;

beforeAll(async () => {
  harness = await createApplicationPgLiteHarness();
});

afterAll(async () => {
  await harness.close();
});

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "aurum-application-migrations-"));
}

async function writeMigration(dir: string, name: string, content: string): Promise<void> {
  await writeFile(path.join(dir, name), content, "utf8");
}

describe("application migration registry (shared database, per-area registries)", () => {
  it("applies the shipped application migrations in filename order after the domain area", async () => {
    const names = (await loadApplicationMigrations()).map((migration) => migration.name);
    expect(names).toEqual([
      "0001-application-lab-evaluations.sql",
      "0002-application-outcomes.sql",
    ]);
    // The harness ran domain first, then application: both registries hold
    // exactly their own areas, independently ordered.
    const applicationRows =
      await harness.sql`select name from ${harness.sql(APPLICATION_MIGRATIONS_REGISTRY)} order by name`;
    expect(applicationRows.map((row) => row.name)).toEqual(names);
    const domainRows = await harness.sql`select name from schema_migrations order by name`;
    expect(domainRows.map((row) => row.name)).toEqual(
      (await loadDomainMigrations()).map((migration) => migration.name),
    );
    // Application tables exist and are append-only through the SHARED trigger.
    await harness.sql`insert into lab_evaluations
      (tenant_id, evaluation_id, fingerprint_digest, ranking_rule, record)
      values ('t', 'lab-eval-1', 'fp', 'rule', '{}'::jsonb)`;
    await expect(harness.sql`update lab_evaluations set record = '{}'::jsonb`).rejects.toThrow(
      /append-only/,
    );
    await expect(harness.sql`delete from lab_evaluations`).rejects.toThrow(/append-only/);
  });

  it("is idempotent per area: a second application run applies nothing and the domain registry is untouched", async () => {
    const outcome = await runApplicationMigrations(harness.sql);
    expect(outcome.applied).toEqual([]);
    const names = (await loadApplicationMigrations()).map((migration) => migration.name);
    expect(outcome.skipped).toEqual(names);
    // Domain area still current through its own default registry:
    const domainOutcome = await runDomainMigrations(harness.sql);
    expect(domainOutcome.applied).toEqual([]);
  });

  it("records the sha256 of each application migration in the application registry", async () => {
    const migrations = await loadApplicationMigrations();
    const rows =
      await harness.sql`select name, sha256 from ${harness.sql(APPLICATION_MIGRATIONS_REGISTRY)} order by name`;
    for (const row of rows) {
      const migration = migrations.find((item) => item.name === row.name);
      expect(migration).toBeTruthy();
      expect(row.sha256).toBe(migration?.sha256);
      expect(row.sha256).toBe(migrationSha256(migration?.content ?? ""));
      expect(String(row.sha256)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("composes all THREE areas on one shared database (domain -> fabric -> application)", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      await runDomainMigrations(local.sql);
      await runFabricMigrations(local.sql);
      const outcome = await runApplicationMigrations(local.sql);
      expect(outcome.applied).toEqual([
        "0001-application-lab-evaluations.sql",
        "0002-application-outcomes.sql",
      ]);
      // Each area's registry holds exactly its own set:
      const domainRows = await local.sql`select name from schema_migrations order by name`;
      const fabricRows = await local.sql`select name from fabric_schema_migrations order by name`;
      const applicationRows =
        await local.sql`select name from ${local.sql(APPLICATION_MIGRATIONS_REGISTRY)} order by name`;
      expect(domainRows.length).toBe(12);
      expect(fabricRows.length).toBe(4);
      expect(applicationRows.length).toBe(2);
      // Every area stays idempotent afterwards, in any order:
      expect((await runApplicationMigrations(local.sql)).applied).toEqual([]);
      expect((await runFabricMigrations(local.sql)).applied).toEqual([]);
      expect((await runDomainMigrations(local.sql)).applied).toEqual([]);
    } finally {
      await local.close();
    }
  });
});

describe("application registry history discipline (custom directories)", () => {
  it("same-named domain and application migrations coexist on one shared database", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      await runDomainMigrations(local.sql); // domain area, default registry
      const dir = await tempDir();
      await writeMigration(dir, "0001-write-journal.sql", "create table app_collide_t (id int)");
      const outcome = await runApplicationMigrations(
        local.sql,
        await loadApplicationMigrations(dir),
      );
      expect(outcome.applied).toEqual(["0001-write-journal.sql"]);
      // Both registries hold the SAME NAME, each its own sha256:
      const applicationRows =
        await local.sql`select name from ${local.sql(APPLICATION_MIGRATIONS_REGISTRY)} order by name`;
      const domainRows = await local.sql`select name from schema_migrations order by name`;
      expect(applicationRows.map((row) => row.name)).toEqual(["0001-write-journal.sql"]);
      expect(domainRows.map((row) => row.name)).toContain("0001-write-journal.sql");
      expect(domainRows.length).toBe(12);
      // And both areas remain idempotent afterwards:
      expect((await runDomainMigrations(local.sql)).applied).toEqual([]);
      expect(
        (await runApplicationMigrations(local.sql, await loadApplicationMigrations(dir))).applied,
      ).toEqual([]);
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });

  it("rejects content drift on an applied application migration", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table adrift_t (id int)");
      const first = await runApplicationMigrations(local.sql, await loadApplicationMigrations(dir));
      expect(first.applied).toEqual(["0001-a.sql"]);
      await writeMigration(dir, "0001-a.sql", "create table adrift_t (id int, v text)");
      await expect(
        runApplicationMigrations(local.sql, await loadApplicationMigrations(dir)),
      ).rejects.toThrow(/content drift/);
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });

  it("rejects an application migration removed from the middle of history", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table amid_a (id int)");
      await writeMigration(dir, "0002-b.sql", "create table amid_b (id int)");
      await runApplicationMigrations(local.sql, await loadApplicationMigrations(dir));
      await rm(path.join(dir, "0002-b.sql"));
      await expect(
        runApplicationMigrations(local.sql, await loadApplicationMigrations(dir)),
      ).rejects.toThrow(/ordering violated|no longer exists/);
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });

  it("rejects an application migration inserted before applied history", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table ains_a (id int)");
      await writeMigration(dir, "0002-b.sql", "create table ains_b (id int)");
      await runApplicationMigrations(local.sql, await loadApplicationMigrations(dir));
      await writeMigration(dir, "0000-early.sql", "create table ains_early (id int)");
      await expect(
        runApplicationMigrations(local.sql, await loadApplicationMigrations(dir)),
      ).rejects.toThrow(/ordering violated/);
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });

  it("applies only newly appended application migrations", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table aapp_a (id int)");
      await runApplicationMigrations(local.sql, await loadApplicationMigrations(dir));
      await writeMigration(dir, "0002-b.sql", "create table aapp_b (id int)");
      const outcome = await runApplicationMigrations(
        local.sql,
        await loadApplicationMigrations(dir),
      );
      expect(outcome.applied).toEqual(["0002-b.sql"]);
      expect(outcome.skipped).toEqual(["0001-a.sql"]);
      await local.sql`insert into aapp_b values (1)`;
      const rows = await local.sql`select count(*)::int as n from aapp_b`;
      expect(rows[0].n).toBe(1);
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });

  it("keeps a failing application migration unrecorded and earlier ones applied (atomic apply)", async () => {
    const local = await createPgLiteHarness({ skipMigrations: true });
    try {
      const dir = await tempDir();
      await writeMigration(dir, "0001-a.sql", "create table aatom_a (id int)");
      await writeMigration(dir, "0002-b.sql", "create table aatom_b (this is not valid sql");
      await expect(
        runApplicationMigrations(local.sql, await loadApplicationMigrations(dir)),
      ).rejects.toThrow();
      const rows =
        await local.sql`select name from ${local.sql(APPLICATION_MIGRATIONS_REGISTRY)} order by name`;
      expect(rows.map((row) => row.name)).toEqual(["0001-a.sql"]);
      await local.sql`insert into aatom_a values (1)`;
      await expect(local.sql`select 1 from aatom_b`).rejects.toThrow();
      await rm(dir, { recursive: true, force: true });
    } finally {
      await local.close();
    }
  });
});
