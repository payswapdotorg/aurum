/**
 * Deterministic in-memory implementation of the execution journal (W006
 * adapters): the append-only, tenant-scoped event log of execution-plane
 * "audit events" (request acceptance, acknowledgements, lifecycle controls,
 * settlements, failure records, duplicate suppressions, recovery events).
 *
 * Entries are deep-frozen on append and NEVER rewritten or reordered; reads
 * are tenant-scoped with uniform (empty) results for foreign tenants. This
 * journal is execution-local runtime projection state — it is not the domain
 * audit trail and carries no semantic authority (the caller records that).
 */
import { err, executionInvariant, ok, type ExecutionError, type Result } from "../domain/errors.js";
import type { ExecutionRequestId, ExecutionTenantId } from "../domain/ids.js";
import type { ExecutionJournal, ExecutionJournalEntry } from "../domain/ports.js";
import { isExecutionJournalKind } from "../domain/vocabulary.js";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** Tenant-partitioned append-only journal. */
export class InMemoryExecutionJournal implements ExecutionJournal {
  private readonly partitions = new Map<string, ExecutionJournalEntry[]>();
  private readonly seenJournalIds = new Set<string>();

  append(entry: ExecutionJournalEntry): Result<ExecutionJournalEntry, ExecutionError> {
    if (!isExecutionJournalKind(entry.kind)) {
      return err(executionInvariant(`unknown journal kind "${String(entry.kind)}"`));
    }
    if (this.seenJournalIds.has(entry.journalId)) {
      return err(executionInvariant(`journal id ${entry.journalId} already appended`));
    }
    this.seenJournalIds.add(entry.journalId);
    const key = entry.tenantId as string;
    let log = this.partitions.get(key);
    if (log === undefined) {
      log = [];
      this.partitions.set(key, log);
    }
    const frozen = deepFreeze({ ...entry });
    log.push(frozen);
    return ok(frozen);
  }

  listEntries(
    tenantId: ExecutionTenantId,
    requestId?: ExecutionRequestId,
  ): readonly ExecutionJournalEntry[] {
    const log = this.partitions.get(tenantId as string) ?? [];
    if (requestId === undefined) return [...log];
    return log.filter((entry) => entry.requestId === requestId);
  }
}

/** Composes the reference in-memory journal. */
export function createInMemoryJournal(): ExecutionJournal {
  return new InMemoryExecutionJournal();
}
