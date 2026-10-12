/**
 * WriteJournal (P001 shared machinery, P-series reusable): every storage
 * mutation lands in `domain_write_journal` with a derived idempotency key,
 * in the same transaction as the mutation itself. Replays are safe:
 *
 * - `recordWrite` is INSERT ... ON CONFLICT DO NOTHING keyed on
 *   `(tenant_id, journal_key)` — re-recording the same mutation identity is
 *   a detectable no-op, never a duplicate row and never an error;
 * - `journalOnce` is the opt-in operation-idempotency wrapper for callers
 *   that WANT replay-to-same-outcome semantics (P002 ingest-style writes):
 *   the first execution's outcome snapshot is stored and returned on every
 *   replay without re-running the effect.
 *
 * Design ruling (P001): kernel command semantics stay identical to the
 * in-memory reference — a repeated `reviseGoal` appends a new revision in
 * both kernels. The journal therefore records mutation identities
 * (area + operation + tenant + record id + version), never command
 * identities; command-level idempotency is opt-in via `journalOnce`.
 * The journal table itself is append-only (DB-enforced by trigger).
 */
import postgres from "postgres";
import type { DomainJsonValue } from "@aurum/domain";

/** A journaled write: the mutation identity plus optional outcome snapshot. */
export interface WriteJournalEntry {
  readonly tenantId: string;
  /** Idempotency key: the mutation identity (see module doc). */
  readonly journalKey: string;
  /** Storage area, e.g. "goals", "evidence", "audit". */
  readonly area: string;
  /** Operation, e.g. "append-revision", "record", "transition". */
  readonly operation: string;
  readonly recordId: string;
  /** Revision/version/transition target when applicable. */
  readonly version?: number;
  /** Outcome snapshot for `journalOnce` replays. */
  readonly outcome?: DomainJsonValue;
}

/** Result of recording a write. */
export interface WriteRecordResult {
  /** True when the key was already journaled (a replay). */
  readonly replayed: boolean;
}

export type JournalSql = postgres.Sql | postgres.TransactionSql;

function hasKey(entry: WriteJournalEntry): void {
  if (
    typeof entry.tenantId !== "string" ||
    entry.tenantId.length === 0 ||
    typeof entry.journalKey !== "string" ||
    entry.journalKey.length === 0 ||
    typeof entry.area !== "string" ||
    entry.area.length === 0 ||
    typeof entry.operation !== "string" ||
    entry.operation.length === 0 ||
    typeof entry.recordId !== "string" ||
    entry.recordId.length === 0
  ) {
    throw new TypeError("WriteJournalEntry requires tenantId, journalKey, area, operation, recordId");
  }
}

/**
 * Records a write in the journal. Safe to replay: an existing
 * `(tenant_id, journal_key)` is reported as `replayed` and changes nothing.
 * Call this inside the same transaction as the mutation it describes.
 */
export async function recordWrite(sql: JournalSql, entry: WriteJournalEntry): Promise<WriteRecordResult> {
  hasKey(entry);
  const rows = await sql`
    insert into domain_write_journal
      (tenant_id, journal_key, area, operation, record_id, version, outcome, written_at)
    values
      (${entry.tenantId}, ${entry.journalKey}, ${entry.area}, ${entry.operation},
       ${entry.recordId}, ${entry.version ?? null}, ${entry.outcome ?? null}, now())
    on conflict (tenant_id, journal_key) do nothing
    returning journal_key
  `;
  return { replayed: rows.length === 0 };
}

/** A journal row as persisted (read model for verification and P002/P003). */
export interface WriteJournalRow {
  readonly tenantId: string;
  readonly journalKey: string;
  readonly area: string;
  readonly operation: string;
  readonly recordId: string;
  readonly version: number | null;
  readonly outcome: DomainJsonValue | null;
  readonly writtenAt: string;
}

/** Lists journal rows of one tenant in insertion order. */
export async function listJournal(sql: JournalSql, tenantId: string): Promise<readonly WriteJournalRow[]> {
  const rows = await sql`
    select tenant_id, journal_key, area, operation, record_id, version, outcome, written_at
    from domain_write_journal
    where tenant_id = ${tenantId}
    order by seq
  `;
  return rows.map((row) => ({
    tenantId: row.tenant_id as string,
    journalKey: row.journal_key as string,
    area: row.area as string,
    operation: row.operation as string,
    recordId: row.record_id as string,
    version: (row.version as number | null) ?? null,
    outcome: (row.outcome as DomainJsonValue | null) ?? null,
    writtenAt: new Date(row.written_at as string).toISOString(),
  }));
}

/** Result of a journaled-once operation. */
export interface JournalOnceResult {
  readonly replayed: boolean;
  readonly outcome: DomainJsonValue | undefined;
}

/**
 * Opt-in operation idempotency: executes `exec` only when `journalKey` has
 * not been journaled yet, storing its outcome; replays return the stored
 * outcome without re-running the effect. Note: the journal insert and `exec`
 * below run on the provided `sql` handle — pass a transaction to make them
 * atomic, or a pool to accept a replay-window between check and effect.
 */
export async function journalOnce(
  sql: JournalSql,
  entry: WriteJournalEntry,
  exec: () => Promise<DomainJsonValue>,
): Promise<JournalOnceResult> {
  hasKey(entry);
  const existing = await sql`
    select outcome from domain_write_journal
    where tenant_id = ${entry.tenantId} and journal_key = ${entry.journalKey}
  `;
  const row = existing[0];
  if (row) {
    const outcome = row.outcome as DomainJsonValue | null;
    return { replayed: true, outcome: outcome ?? undefined };
  }
  const outcome = await exec();
  await recordWrite(sql, { ...entry, outcome });
  return { replayed: false, outcome };
}
