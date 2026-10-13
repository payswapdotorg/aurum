/**
 * Session + attachment view derivations (W012 app layer): pure folds over
 * ledger records behind the continuity service's read methods. Read-only
 * projections of the append-only journal — they decide nothing (R1).
 */
import type {
  AttachmentView,
  ContinuityEntry,
  ContinuityRecord,
  SessionInfo,
} from "../domain/records.js";

interface OpenedEntry {
  readonly tenantId: string;
  readonly operator: SessionInfo["operator"];
  readonly variant: SessionInfo["variant"];
  readonly mode: SessionInfo["mode"];
  readonly composition: string;
  readonly openedAt: number;
}

export function openedOf(record: ContinuityRecord | undefined): OpenedEntry | null {
  const entry: ContinuityEntry | undefined = record?.entry;
  if (!entry || entry.kind !== "session-opened") return null;
  return {
    tenantId: entry.tenantId,
    operator: entry.operator,
    variant: entry.variant,
    mode: entry.mode,
    composition: entry.composition,
    openedAt: entry.openedAt,
  };
}

/** Derives the read-only lifecycle view of one session from its records. */
export function sessionInfoOf(
  records: readonly ContinuityRecord[],
  live: boolean,
): SessionInfo | null {
  const opened = openedOf(records[0]);
  if (opened === null) return null;
  const resumes: {
    readonly resumedAt: number;
    readonly cause: string;
    readonly recordsReplayed: number;
  }[] = [];
  let attachmentCount = 0;
  for (const record of records) {
    const entry = record.entry;
    if (entry.kind === "session-resumed") {
      resumes.push({
        resumedAt: entry.resumedAt,
        cause: entry.cause,
        recordsReplayed: entry.recordsReplayed,
      });
    } else if (entry.kind === "attachment-opened") {
      attachmentCount += 1;
    }
  }
  return {
    sessionId: records[0]?.sessionId ?? "",
    tenantId: opened.tenantId,
    operator: opened.operator,
    variant: opened.variant,
    mode: opened.mode,
    composition: opened.composition,
    openedAt: opened.openedAt,
    live,
    resumes,
    recordCount: records.length,
    attachmentCount,
  };
}

/** Folds a session's attachment records into runtime-plane views (R5). */
export function attachmentsOf(records: readonly ContinuityRecord[]): AttachmentView[] {
  const views = new Map<string, AttachmentView>();
  for (const record of records) {
    const entry = record.entry;
    if (entry.kind === "attachment-opened") {
      views.set(entry.attachmentId, {
        attachmentId: entry.attachmentId,
        name: entry.name,
        contentType: entry.contentType,
        digest: entry.digest,
        surface: entry.surface,
        materializedRef: entry.materializedRef,
        openedAt: entry.openedAt,
      });
    } else if (entry.kind === "attachment-closed") {
      const view = views.get(entry.attachmentId);
      if (view !== undefined) views.set(entry.attachmentId, { ...view, closedAt: entry.closedAt });
    }
  }
  return [...views.values()].sort((left, right) => left.openedAt - right.openedAt);
}
