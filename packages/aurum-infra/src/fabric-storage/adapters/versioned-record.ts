/**
 * Shared core of the fabric record stores (P002): the versioned-upsert
 * table discipline every fabric record store rides (migrations/fabric 0001,
 * 0002, 0004) — one immutable row per (tenant_id, record_id, mutation_seq),
 * every `put` appends the next version inside one transaction together with
 * its write-journal entry, and every read derives the CURRENT record.
 *
 * The in-memory reference (the W003 `TenantTable`) is a Map keyed by record
 * id: `put` overwrites the value but NEVER moves the key's position, so
 * `list` returns records in FIRST-INSERTION order. The read model below is
 * the exact SQL mirror of that algorithm: current value = highest
 * mutation_seq, order = the row-insertion seq of each record's FIRST
 * version. Filtering happens in JavaScript over the currents (the
 * reference's own `list().filter(...)` shape) — never pre-filtered in SQL,
 * because a record whose filter column changed between versions must keep
 * its original list position (a pre-filter would reorder it).
 *
 * Records are deep-frozen on read (the in-memory double freezes on put; the
 * database cannot freeze JSON at rest, so the adapter re-freezes what it
 * hands out — the P001 read-side discipline).
 */
import { deepFreeze } from "@aurum/domain";
import { recordWrite } from "../../domain-storage/journal/write-journal.js";
import type { WriteJournalEntry } from "../../domain-storage/journal/write-journal.js";
import type { Db, Tx } from "../../domain-storage/pg/db.js";

/** A fabric record as stored: JSON by construction (the ports guarantee it). */
export type FabricRecord = object;

/**
 * The mutation-identity journal key for one appended version. The journal
 * discipline is 1-based (the domain machinery's `version >= 1` check
 * constraint — extended, never modified): version = mutation_seq + 1, and
 * the key suffix carries the same 1-based version so journal rows are
 * self-consistent (the fabric tables' own mutation_seq stays 0-based per
 * the shipped migrations).
 */
export function versionedJournalKey(
  area: string,
  operation: string,
  recordId: string,
  seq: number,
): string {
  return `${area}:${operation}:${recordId}:${seq + 1}`;
}

/**
 * Allocates the next mutation_seq for one (tenant, record) —
 * `coalesce(max, -1) + 1`, so the first version is always 0. Runs inside
 * the put transaction: on the single-connection harness the read and the
 * insert are serial, and on real PostgreSQL the (tenant, record,
 * mutation_seq) primary key rejects any race's colliding insert.
 *
 * `idColumn` is the table's record-id column (protocol_id, definition_id,
 * … — a compile-time literal from the adapter, rendered as a quoted
 * identifier).
 */
export async function nextMutationSeq(
  tx: Tx,
  table: string,
  idColumn: string,
  tenantId: string,
  recordId: string,
): Promise<number> {
  const rows = await tx`
    select coalesce(max(mutation_seq), -1) + 1 as next
    from ${tx(table)}
    where tenant_id = ${tenantId} and ${tx(idColumn)} = ${recordId}
  `;
  return rows[0]?.next as number;
}

/**
 * Appends one version of a record: the caller's insert plus the journal row
 * in ONE transaction (atomicity per put, mirroring the in-memory
 * single-image write). The caller supplies the explicit INSERT for its
 * table — strong columns stay visible in the adapter, values stay bound
 * parameters of a tagged template.
 */
export async function appendVersionedRecord(
  sql: Db,
  args: {
    readonly table: string;
    /** The table's record-id column (protocol_id, definition_id, …). */
    readonly idColumn: string;
    readonly tenantId: string;
    readonly recordId: string;
    /** Journal area, e.g. "fabric-definitions". */
    readonly area: string;
    /** Journal operation, e.g. "put". */
    readonly operation: string;
    /** The table's INSERT, receiving the allocated mutation_seq. */
    readonly insert: (tx: Tx, mutationSeq: number) => Promise<unknown>;
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    const seq = await nextMutationSeq(tx, args.table, args.idColumn, args.tenantId, args.recordId);
    await args.insert(tx, seq);
    const entry: WriteJournalEntry = {
      tenantId: args.tenantId,
      journalKey: versionedJournalKey(args.area, args.operation, args.recordId, seq),
      area: args.area,
      operation: args.operation,
      recordId: args.recordId,
      version: seq + 1,
    };
    await recordWrite(tx, entry);
  });
}

/** Loads the current record for one id (highest mutation_seq) or null. */
export async function readCurrentVersioned<T extends FabricRecord>(
  sql: Db,
  table: string,
  idColumn: string,
  tenantId: string,
  recordId: string,
): Promise<T | null> {
  const rows = await sql`
    select record from ${sql(table)}
    where tenant_id = ${tenantId} and ${sql(idColumn)} = ${recordId}
    order by mutation_seq desc
    limit 1
  `;
  const row = rows[0];
  return row === undefined ? null : deepFreeze(row.record as T);
}

/**
 * Loads every current record of a tenant in FIRST-INSERTION order (the
 * in-memory Map order — see module doc). The window functions derive, per
 * record id, the current value (highest mutation_seq) and the position
 * anchor (the min physical seq of the record's versions); the outer query
 * keeps the currents and sorts by that anchor.
 */
export async function readCurrentsVersioned<T extends FabricRecord>(
  sql: Db,
  table: string,
  idColumn: string,
  tenantId: string,
): Promise<readonly T[]> {
  const rows = await sql`
    select record from (
      select record,
             row_number() over (partition by ${sql(idColumn)} order by mutation_seq desc) as rn,
             min(seq) over (partition by ${sql(idColumn)}) as first_seq
      from ${sql(table)}
      where tenant_id = ${tenantId}
    ) ranked
    where rn = 1
    order by first_seq
  `;
  return Object.freeze(rows.map((row) => deepFreeze(row.record as T)));
}

/** Raw version rows of one record (oldest first) — proof/inspection helper. */
export async function readVersionRows<T extends FabricRecord>(
  sql: Db,
  table: string,
  idColumn: string,
  tenantId: string,
  recordId: string,
): Promise<readonly { readonly mutationSeq: number; readonly record: T }[]> {
  const rows = await sql`
    select mutation_seq, record from ${sql(table)}
    where tenant_id = ${tenantId} and ${sql(idColumn)} = ${recordId}
    order by mutation_seq
  `;
  return rows.map((row) => ({ mutationSeq: row.mutation_seq as number, record: row.record as T }));
}
