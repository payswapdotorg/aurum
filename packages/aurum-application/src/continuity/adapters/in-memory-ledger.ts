/**
 * In-memory continuity ledger (W012 adapters layer): the reference
 * implementation of the append-only `ContinuityLedger` port. Dumb by design
 * (APPROACH R1): it stamps identity (`<sessionId>/<seq>`) + per-session
 * order, refuses duplicate record ids, and lists back what was appended —
 * no update, no delete, no command path. Persistence-backed variant:
 * `json-file-ledger.ts` (same port, same discipline).
 */
import { err, ok, type Result } from "@aurum/domain";
import { continuityConflict, continuityInvariant } from "../domain/errors.js";
import type { ContinuityError } from "../domain/errors.js";
import type { ContinuityEntry, ContinuityRecord } from "../domain/records.js";
import type { ContinuityLedger } from "../domain/ports.js";

interface LedgerState {
  /** Append-ordered records per session (never rewritten). */
  readonly bySession: Map<string, ContinuityRecord[]>;
  /** First-seen session order for deterministic listing. */
  readonly sessionOrder: string[];
}

export function createInMemoryContinuityLedger(): ContinuityLedger & {
  /** Test/introspection hook: the raw append-ordered state (frozen copy). */
  readonly snapshot: () => readonly ContinuityRecord[];
} {
  const state: LedgerState = { bySession: new Map(), sessionOrder: [] };

  const bucket = (sessionId: string): ContinuityRecord[] => {
    let records = state.bySession.get(sessionId);
    if (records === undefined) {
      records = [];
      state.bySession.set(sessionId, records);
      state.sessionOrder.push(sessionId);
    }
    return records;
  };

  return {
    append(sessionId: string, entry: ContinuityEntry): Result<ContinuityRecord, ContinuityError> {
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        return err(continuityInvariant("ledger append requires a session id"));
      }
      const records = bucket(sessionId);
      const seq = records.length;
      const record: ContinuityRecord = {
        recordId: `${sessionId}/${seq}`,
        sessionId,
        seq,
        entry,
      };
      if (records.some((existing) => existing.recordId === record.recordId)) {
        return err(continuityConflict(`record id ${record.recordId} already exists`));
      }
      records.push(record);
      return ok(record);
    },

    list(sessionId: string): readonly ContinuityRecord[] {
      const records = state.bySession.get(sessionId);
      return records === undefined ? [] : Object.freeze([...records]);
    },

    listSessions(): readonly string[] {
      return Object.freeze([...state.sessionOrder]);
    },

    snapshot(): readonly ContinuityRecord[] {
      const all: ContinuityRecord[] = [];
      for (const sessionId of state.sessionOrder) {
        all.push(...(state.bySession.get(sessionId) ?? []));
      }
      return Object.freeze(all);
    },
  };
}
