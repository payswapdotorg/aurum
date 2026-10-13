/**
 * PGlite test harness (P001 shared machinery, P-series reusable).
 *
 * Runs an in-process PostgreSQL (PGlite) exposed over a local TCP socket via
 * `@electric-sql/pglite-socket`, and connects the production `postgres`
 * driver to it — so the adapters under test exercise exactly the driver and
 * wire protocol they use against real PostgreSQL. The harness applies the
 * domain migrations (ordered, content-hashed, idempotent) before handing the
 * connection over.
 *
 * Single-connection note: the postgres pool is capped at `max: 1` because
 * PGlite executes one query at a time; concurrent-connection races are
 * structurally out of scope for this harness (same class as prior waves).
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import { runDomainMigrations } from "../runner/migration-runner.js";

/** A ready-to-use harness: a migrated database on the production driver. */
export interface PgLiteHarness {
  /** postgres.js client connected to the in-process PostgreSQL. */
  readonly sql: postgres.Sql;
  /** Closes the client, socket server and PGlite instance. */
  close(): Promise<void>;
}

export interface PgLiteHarnessOptions {
  /** Skip migration application (for runner self-tests). Default false. */
  readonly skipMigrations?: boolean;
}

/** Boots an in-process PostgreSQL, migrates it, and connects the driver. */
export async function createPgLiteHarness(
  options: PgLiteHarnessOptions = {},
): Promise<PgLiteHarness> {
  const db = new PGlite();
  const server = new PGLiteSocketServer({
    db,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 8,
  });
  await server.start();
  const sql = postgres(`postgres://postgres:postgres@${server.getServerConn()}/postgres`, {
    max: 1,
    idle_timeout: 2,
    connect_timeout: 5,
  });
  try {
    if (!options.skipMigrations) await runDomainMigrations(sql);
  } catch (error) {
    await sql.end({ timeout: 3 });
    await server.stop();
    await db.close();
    throw error;
  }
  return {
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
      await server.stop();
      await db.close();
    },
  };
}
