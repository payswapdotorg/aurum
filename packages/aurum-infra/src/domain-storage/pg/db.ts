/**
 * PostgreSQL adapters' shared database plumbing (P001 shared machinery).
 *
 * - `Db`/`Tx`: the postgres.js handles every adapter accepts (pool outside,
 *   transaction inside commands — atomicity is per command, mirroring the
 *   in-memory kernel's single-image semantics).
 * - `mapUniqueViolation`: PostgreSQL unique-violation (23505) surfaces as
 *   the kernel's typed `conflict` DomainError with the same message the
 *   in-memory reference produces, so races on real PostgreSQL cannot leak
 *   driver errors through the Result discipline.
 */
import postgres from "postgres";
import { DomainError, conflictError, isDomainJsonValue } from "@aurum/domain";
import type { DomainJsonValue } from "@aurum/domain";

/** postgres.js pool handle (or the standalone client the harness creates). */
export type Db = postgres.Sql;
/** postgres.js transaction handle. */
export type Tx = postgres.TransactionSql;

/** Unique-violation marker used by the PostgreSQL wire protocol. */
const UNIQUE_VIOLATION = "23505";

/**
 * Runs `operation`; a PostgreSQL unique violation is translated into the
 * kernel's `conflict` error carrying `message` (mirroring the in-memory
 * conflict text). Everything else rethrows — those are infrastructure
 * failures, not domain results.
 */
export async function mapUniqueViolation<T>(
  operation: () => Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflictError(message);
    }
    throw error;
  }
}

/** True when the error is a PostgreSQL unique violation (23505). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/** Type-only helper: asserts a DomainError-shaped value for narrow scopes. */
export function asDomainError(error: unknown): DomainError | null {
  return error instanceof DomainError ? error : null;
}

/**
 * Bridges a domain JSON value (record, actor, payload) into a postgres.js
 * jsonb parameter. Domain records are plain JSON by construction (the kernel
 * accepts only plain data and deep-freezes it); the runtime guard keeps this
 * bridge honest — a non-JSON value fails loudly instead of corrupting
 * storage. `undefined` maps to SQL NULL (absent optional field).
 *
 * Nested `undefined`-valued properties (e.g. a lifecycle entry's absent
 * `from` state) are JSON-absent by the same rule JSON.stringify applies:
 * they are dropped for the guard and by serialization, so reads see the key
 * absent — exactly the in-memory `undefined` under Result equality.
 */
export function jsonbParam(sql: Db | Tx, value: unknown): postgres.Parameter | null {
  if (value === undefined) return null;
  if (!isJsonBridgeable(value)) {
    throw new TypeError("jsonb parameter is not a domain JSON value");
  }
  return sql.json(value);
}

/** Recursively drops undefined-valued properties (JSON.stringify semantics). */
function jsonAbsent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonAbsent);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = jsonAbsent(item);
    }
    return out;
  }
  return value;
}

/** The guard: a value is bridgeable when its JSON-normalized form is JSON. */
function isJsonBridgeable(value: unknown): value is DomainJsonValue {
  return isDomainJsonValue(jsonAbsent(value));
}
