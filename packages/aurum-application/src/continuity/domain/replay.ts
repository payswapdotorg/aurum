/**
 * Replay validation + summary (W012 domain layer): the PURE half of the
 * replay path. The fold itself lives in the adapters layer (it applies
 * records through real stores); these derivations check the record sequence
 * contract and summarize a replay for callers.
 */
import type { Result } from "@aurum/domain";
import type { ContinuityError } from "./errors.js";
import { continuityInvariant } from "./errors.js";
import type { ContinuityRecord, ReplayReport } from "./records.js";

/**
 * Validates a record sequence for replay: every record must belong to the
 * session, the FIRST record must be `session-opened`, sequence numbers must
 * be contiguous from 0, and record ids must be unique. Returns the
 * `continuity-invariant` error (never a caller-input error) on violation.
 */
export function replayIssues(
  records: readonly ContinuityRecord[],
  sessionId: string,
): Result<void, ContinuityError> {
  if (records.length === 0) {
    return {
      ok: false,
      error: continuityInvariant(`session ${sessionId} has no records to replay`),
    };
  }
  const seenIds = new Set<string>();
  let previousSeq = -1;
  for (const [index, record] of records.entries()) {
    if (record.sessionId !== sessionId) {
      return {
        ok: false,
        error: continuityInvariant(
          `record ${index} belongs to session ${record.sessionId}, not ${sessionId}`,
        ),
      };
    }
    if (seenIds.has(record.recordId)) {
      return {
        ok: false,
        error: continuityInvariant(`duplicate record id ${record.recordId}`),
      };
    }
    seenIds.add(record.recordId);
    if (record.seq !== previousSeq + 1) {
      return {
        ok: false,
        error: continuityInvariant(
          `record ${record.recordId} seq ${record.seq} breaks contiguity (expected ${previousSeq + 1})`,
        ),
      };
    }
    previousSeq = record.seq;
  }
  if (records[0]?.entry.kind !== "session-opened") {
    return {
      ok: false,
      error: continuityInvariant(`session ${sessionId} records do not start with session-opened`),
    };
  }
  return { ok: true, value: undefined };
}

/** Counts a replay's applied records by entry kind (read-only derivation). */
export function replaySummaryOf(
  sessionId: string,
  records: readonly ContinuityRecord[],
): ReplayReport {
  const byKind: Record<string, number> = {};
  for (const record of records) {
    byKind[record.entry.kind] = (byKind[record.entry.kind] ?? 0) + 1;
  }
  return { sessionId, recordsApplied: records.length, byKind };
}
