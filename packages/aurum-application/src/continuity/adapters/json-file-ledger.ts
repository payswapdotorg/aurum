/**
 * JSON-file continuity ledger (W012 adapters layer): the persistence-backed
 * `ContinuityLedger` — the cross-process replay source (the CLI evidence
 * run and the desktop session host both stand on it). Same discipline as
 * the in-memory reference: append-only, identity-stamped, no update/delete.
 *
 * HONEST BOUNDS (documented in WORK-NOTES too):
 * - synchronous `node:fs` IO (the port is sync; session journals are small;
 *   the desktop main process is not a hot loop for these writes);
 * - each append rewrites the file through a temp file + rename (atomic on
 *   POSIX; a torn write can lose the LAST append, never corrupt order —
 *   the replay contract's contiguity check catches a torn tail typed);
 * - no cross-process file locking: ONE writer process per ledger file at a
 *   time (the desktop host owns its file; the CLI evidence run is
 *   sequential by construction).
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { err, ok, type Result } from "@aurum/domain";
import { continuityConflict, continuityInvariant } from "../domain/errors.js";
import type { ContinuityError } from "../domain/errors.js";
import type { ContinuityEntry, ContinuityRecord } from "../domain/records.js";
import type { ContinuityLedger } from "../domain/ports.js";

/** The on-disk shape: one append-ordered array + a format version. */
interface LedgerFile {
  readonly format: 1;
  readonly records: readonly ContinuityRecord[];
}

function isLedgerFile(value: unknown): value is LedgerFile {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { format?: unknown; records?: unknown };
  return candidate.format === 1 && Array.isArray(candidate.records);
}

export function createJsonFileContinuityLedger(
  filePath: string,
): ContinuityLedger & { readonly path: string } {
  const file = resolve(filePath);
  let records: ContinuityRecord[] = [];
  const sessionOrder: string[] = [];

  const index = (): void => {
    sessionOrder.length = 0;
    for (const record of records) {
      if (!sessionOrder.includes(record.sessionId)) sessionOrder.push(record.sessionId);
    }
  };

  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isLedgerFile(parsed)) {
      throw new Error("not a continuity ledger file (format !== 1)");
    }
    records = [...parsed.records];
    index();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      records = [];
    } else {
      throw new Error(`continuity ledger ${file} is unreadable: ${(error as Error).message}`);
    }
  }

  const persist = (): void => {
    const payload: LedgerFile = { format: 1, records };
    const temp = `${file}.tmp-${Date.now().toString(36)}`;
    writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(temp, file);
  };

  return {
    append(sessionId: string, entry: ContinuityEntry): Result<ContinuityRecord, ContinuityError> {
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        return err(continuityInvariant("ledger append requires a session id"));
      }
      const seq = records.filter((record) => record.sessionId === sessionId).length;
      const record: ContinuityRecord = { recordId: `${sessionId}/${seq}`, sessionId, seq, entry };
      if (records.some((existing) => existing.recordId === record.recordId)) {
        return err(continuityConflict(`record id ${record.recordId} already exists`));
      }
      records.push(record);
      if (!sessionOrder.includes(sessionId)) sessionOrder.push(sessionId);
      persist();
      return ok(record);
    },

    list(sessionId: string): readonly ContinuityRecord[] {
      return Object.freeze(records.filter((record) => record.sessionId === sessionId));
    },

    listSessions(): readonly string[] {
      return Object.freeze([...sessionOrder]);
    },

    path: file,
  };
}
