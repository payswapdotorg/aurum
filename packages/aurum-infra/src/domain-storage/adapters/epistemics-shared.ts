/**
 * Shared mirrors and row derivations for the P001 epistemics area adapters
 * (claims, beliefs, hypotheses, contradictions, unknowns). Pure helpers —
 * no database handles, no factories; the per-store adapters import these to
 * keep every file under the architecture line budget without duplicating the
 * domain-internal validation semantics they mirror.
 */
import { deepFreeze, isKnownSubjectKind } from "@aurum/domain";
import type {
  ActorReference,
  BeliefId,
  BeliefRecord,
  BeliefRevision,
  ClaimRecord,
  ContradictionRecord,
  DomainTimestamp,
  FreshnessStamp,
  SubjectReference,
  TenantScope,
  UnknownRecord,
  Validator,
} from "@aurum/domain";
import type { Db, Tx } from "../pg/db.js";

/** Mirrors the domain-internal subject validation (epistemics wording). */
export function validateSubjectRef(
  v: Validator,
  field: string,
  subject: SubjectReference | undefined,
): void {
  const raw = subject as { kind?: unknown; id?: unknown } | undefined;
  if (
    !raw ||
    typeof raw.kind !== "string" ||
    !isKnownSubjectKind(raw.kind) ||
    typeof raw.id !== "string" ||
    raw.id.trim().length === 0
  ) {
    v.add(field, "must be a typed subject reference");
  }
}

/** Mirrors the domain-internal freshness validation. */
export function validateFreshnessStamp(
  v: Validator,
  field: string,
  stamp: FreshnessStamp | undefined,
): void {
  if (!stamp) return;
  if (stamp.asOf !== undefined) v.requireNonNegativeNumber(`${field}.asOf`, stamp.asOf);
  if (stamp.validUntil !== undefined) {
    v.requireNonNegativeNumber(`${field}.validUntil`, stamp.validUntil);
  }
}

/** Mirrors the domain-internal resolveFreshness (verbatim stamps win). */
export function resolveFreshness(
  stamp: FreshnessStamp | undefined,
  fallbackAsOf: number,
): FreshnessStamp {
  if (stamp !== undefined && (stamp.asOf !== undefined || stamp.validUntil !== undefined)) {
    return stamp;
  }
  return { asOf: fallbackAsOf as DomainTimestamp };
}

export interface ClaimRow {
  readonly record: ClaimRecord;
  readonly retracted_at: number | null;
  readonly retracted_by: ActorReference | null;
}

/** Derives the claim record value (base + retraction spread). */
export function claimValue(row: ClaimRow): ClaimRecord {
  if (row.retracted_at === null || row.retracted_by === null) {
    return deepFreeze(row.record);
  }
  const retracted: ClaimRecord = {
    ...row.record,
    status: "retracted",
    retractedAt: Number(row.retracted_at) as DomainTimestamp,
    retractedBy: row.retracted_by,
  };
  return deepFreeze(retracted);
}

/** The claim base-row + retraction-fact select shared by every read path. */
export const CLAIM_SELECT = async (
  sql: Tx | Db,
  scope: TenantScope,
  claimId: string,
): Promise<readonly ClaimRow[]> => sql`
  select c.record, r.retracted_at, r.retracted_by
  from domain_claims c
  left join domain_claim_retractions r
    on r.tenant_id = c.tenant_id and r.claim_id = c.claim_id
  where c.tenant_id = ${scope.tenantId} and c.claim_id = ${claimId}
`;

export interface BeliefRow {
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly record: BeliefRevision;
}

/** Loads one belief's revision rows (ordered) or null when absent. */
export async function loadBeliefRows(
  sql: Tx | Db,
  scope: TenantScope,
  beliefId: string,
): Promise<readonly BeliefRow[] | null> {
  const rows: readonly BeliefRow[] = await sql`
    select subject_kind, subject_id, record from domain_belief_revisions
    where tenant_id = ${scope.tenantId} and belief_id = ${beliefId}
    order by revision_number
  `;
  return rows.length === 0 ? null : rows;
}

/** Assembles the BeliefRecord the read paths return (current = highest). */
export function assembleBelief(
  scope: TenantScope,
  beliefId: string,
  rows: readonly BeliefRow[],
): BeliefRecord {
  const first = rows[0];
  const revisions = Object.freeze(rows.map((row) => deepFreeze(row.record)));
  const last = revisions[revisions.length - 1];
  return deepFreeze({
    scope,
    beliefId: beliefId as BeliefId,
    subject: {
      kind: (first?.subject_kind ?? "unknown") as SubjectReference["kind"],
      id: first?.subject_id ?? "",
    },
    currentRevision: last ? last.revisionNumber : 0,
    revisions,
  });
}

export interface ResolutionRow {
  readonly resolved_at: number | null;
  readonly resolved_by: ActorReference | null;
  readonly outcome: string | null;
}

/** Derives the contradiction record value (base + resolution spread). */
export function contradictionValue(
  row: { record: ContradictionRecord } & ResolutionRow,
): ContradictionRecord {
  if (row.resolved_at === null || row.resolved_by === null || row.outcome === null) {
    return deepFreeze(row.record);
  }
  return deepFreeze({
    ...row.record,
    status: "resolved",
    resolution: Object.freeze({
      outcome: row.outcome,
      resolvedAt: Number(row.resolved_at) as DomainTimestamp,
      resolvedBy: row.resolved_by,
    }),
  });
}

/** Derives the unknown record value (base + resolution spread). */
export function unknownValue(row: { record: UnknownRecord } & ResolutionRow): UnknownRecord {
  if (row.resolved_at === null || row.resolved_by === null || row.outcome === null) {
    return deepFreeze(row.record);
  }
  return deepFreeze({
    ...row.record,
    status: "resolved",
    resolution: Object.freeze({
      outcome: row.outcome,
      resolvedAt: Number(row.resolved_at) as DomainTimestamp,
      resolvedBy: row.resolved_by,
    }),
  });
}
