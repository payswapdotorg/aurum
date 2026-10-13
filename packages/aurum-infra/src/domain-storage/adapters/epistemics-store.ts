/**
 * PostgreSQL claims + beliefs ledger (P001, epistemics area) with semantics
 * identical to the in-memory reference — same validation issues, same
 * not-found-before-conflict discipline (observation existence and claim
 * usability verified through the injected async evidence lookup, in array
 * order, exactly the closure the kernel wires in memory), same audit
 * side-effects (claim.retracted carries the reason; belief.revised carries
 * the revision number; claim registration is NOT audited).
 *
 * Storage ruling (migration 0008): claims are immutable base rows with
 * retraction as an appended fact (the retracted value is derived on read,
 * like the in-memory spread); beliefs are one immutable row per revision
 * with currentRevision derived as the max. The evidence lookup is resolved
 * on the pool BEFORE the command transaction — the same ruling as the action
 * area's role resolution (the single-connection harness cannot nest a
 * pooled query inside an open transaction).
 */
import {
  auditInputIssues,
  conflictError,
  createValidator,
  deepFreeze,
  notFound,
  ok,
  provenanceIssues,
  validationError,
} from "@aurum/domain";
import type {
  BeliefId,
  BeliefRecord,
  BeliefRevision,
  ClaimId,
  ClaimRecord,
  EpistemicsStorage,
  ObservationId,
  RegisterClaimInput,
  RetractClaimInput,
  ReviseBeliefInput,
  StorageEvidenceLookup,
  SubjectReference,
  TenantScope,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import {
  CLAIM_SELECT,
  assembleBelief,
  claimValue,
  loadBeliefRows,
  resolveFreshness,
  validateFreshnessStamp,
  validateSubjectRef,
} from "./epistemics-shared.js";
import type { BeliefRow, ClaimRow } from "./epistemics-shared.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** Creates the PostgreSQL claims + beliefs ledger bound to a database handle. */
export function createPgEpistemicsLedger(
  sql: Db,
  options: { evidenceLookup: StorageEvidenceLookup },
): EpistemicsStorage {
  const { evidenceLookup } = options;

  return {
    registerClaim: async (scope, input: RegisterClaimInput) => {
      const v = createValidator();
      const claimId = v.requireIdFormat("claimId", input?.claimId ?? "") as ClaimId;
      const statement = v.requireText("statement", input?.statement ?? "");
      const derivedFrom = v.requireNonEmptyUniqueList("derivedFrom", input?.derivedFrom ?? []);
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      validateFreshnessStamp(v, "freshness", input?.freshness);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      // Observation existence is verified before the conflict check, exactly
      // like the in-memory reference (lookup order is the array order).
      for (const observationId of derivedFrom) {
        if (!(await evidenceLookup.observationExists(scope, observationId))) {
          return { ok: false, error: notFound("observation") };
        }
      }
      const record: ClaimRecord = {
        scope,
        claimId,
        statement,
        derivedFrom: Object.freeze([...derivedFrom]) as readonly ObservationId[],
        provenance: input.provenance,
        freshness: resolveFreshness(input.freshness, input.provenance.recordedAt),
        status: "active",
      };
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_claims
            where tenant_id = ${scope.tenantId} and claim_id = ${claimId}
          `;
          if (existing.length > 0) {
            return { ok: false, error: conflictError("claim already registered in tenant") };
          }
          await tx`
            insert into domain_claims (tenant_id, claim_id, record)
            values (${scope.tenantId}, ${claimId}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `epistemics:register-claim:${claimId}`,
            area: "epistemics",
            operation: "register-claim",
            recordId: claimId,
          });
          return ok(record);
        });
      } catch (error) {
        // Concurrent create on real PostgreSQL: the unique violation resolves
        // as the same conflict Result the in-memory reference produces.
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("claim already registered in tenant") };
        }
        throw error;
      }
    },
    getClaim: async (scope, claimId) => {
      const rows: readonly ClaimRow[] = await CLAIM_SELECT(sql, scope, claimId);
      if (rows.length === 0) return { ok: false, error: notFound("claim") };
      const row = rows[0];
      if (!row) throw new Error("claim row missing after length check");
      return ok(claimValue(row));
    },
    retractClaim: async (scope, claimId, input: RetractClaimInput) => {
      const v = createValidator();
      v.requireIdFormat("claimId", claimId ?? "");
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      v.requireText("reason", input?.reason ?? "", { max: 2000 });
      for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      try {
        return await sql.begin(async (tx) => {
          const rows: readonly ClaimRow[] = await CLAIM_SELECT(tx, scope, claimId.trim());
          const row = rows[0];
          if (!row) return { ok: false, error: notFound("claim") };
          if (row.retracted_at !== null) {
            return { ok: false, error: conflictError("claim already retracted") };
          }
          const base = row.record;
          await tx`
            insert into domain_claim_retractions
              (tenant_id, claim_id, retracted_at, retracted_by, reason)
            values
              (${scope.tenantId}, ${base.claimId}, ${input.now},
               ${jsonbParam(tx, input.audit.actor)}, ${input.reason})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `epistemics:retract-claim:${base.claimId}`,
            area: "epistemics",
            operation: "retract-claim",
            recordId: base.claimId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "claim", id: base.claimId },
            "claim.retracted",
            input.audit,
            Object.freeze({ reason: input.reason }),
          );
          const retracted: ClaimRecord = {
            ...base,
            status: "retracted",
            retractedAt: input.now,
            retractedBy: input.audit.actor,
          };
          return ok(deepFreeze(retracted));
        });
      } catch (error) {
        // Concurrent retraction on real PostgreSQL: the second writer hits
        // the one-retraction-per-claim primary key — the same conflict the
        // in-memory reference reports for an already-retracted claim.
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("claim already retracted") };
        }
        throw error;
      }
    },
    reviseBelief: async (scope, input: ReviseBeliefInput) => {
      const v = createValidator();
      const beliefId = v.requireIdFormat("beliefId", input?.beliefId ?? "") as BeliefId;
      validateSubjectRef(v, "subject", input?.subject as SubjectReference | undefined);
      const statement = v.requireText("statement", input?.statement ?? "");
      const supportingClaimIds = v.requireNonEmptyUniqueList(
        "supportingClaimIds",
        input?.supportingClaimIds ?? [],
      );
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      validateFreshnessStamp(v, "freshness", input?.freshness);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      // Claim usability is verified before the subject-stability check,
      // exactly like the in-memory reference (array order).
      for (const claimId of supportingClaimIds) {
        if (!(await evidenceLookup.claimIsUsable(scope, claimId))) {
          return { ok: false, error: notFound("claim") };
        }
      }
      return sql.begin(async (tx) => {
        const existing = await loadBeliefRows(tx, scope, beliefId);
        if (existing) {
          const first = existing[0];
          const kind = first?.subject_kind;
          const id = first?.subject_id;
          if (kind !== input.subject.kind || id !== input.subject.id) {
            return {
              ok: false,
              error: conflictError("belief subject cannot change between revisions"),
            };
          }
        }
        const revision: BeliefRevision = {
          revisionNumber: existing ? existing.length + 1 : 1,
          statement,
          supportingClaimIds: Object.freeze([...supportingClaimIds]) as readonly ClaimId[],
          provenance: input.provenance,
          freshness: resolveFreshness(input.freshness, input.now),
          createdAt: input.now,
        };
        await tx`
          insert into domain_belief_revisions
            (tenant_id, belief_id, revision_number, subject_kind, subject_id, record)
          values
            (${scope.tenantId}, ${beliefId}, ${revision.revisionNumber},
             ${input.subject.kind}, ${input.subject.id}, ${jsonbParam(tx, revision)})
        `;
        await recordWrite(tx, {
          tenantId: scope.tenantId,
          journalKey: `epistemics:revise-belief:${beliefId}:${revision.revisionNumber}`,
          area: "epistemics",
          operation: "revise-belief",
          recordId: beliefId,
          version: revision.revisionNumber,
        });
        await appendAuditEntry(
          tx,
          scope,
          { kind: "belief", id: beliefId },
          "belief.revised",
          input.audit,
          Object.freeze({ revisionNumber: revision.revisionNumber }),
        );
        const rows = await loadBeliefRows(tx, scope, beliefId);
        return ok(assembleBelief(scope, beliefId, rows ?? []));
      });
    },
    getBelief: async (scope, beliefId) => {
      const rows = await loadBeliefRows(sql, scope, beliefId);
      return rows
        ? ok(assembleBelief(scope, beliefId, rows))
        : { ok: false, error: notFound("belief") };
    },
    listBeliefs: async (scope, subject) => {
      // The in-memory reference compares by strict equality, so only string
      // kind/id values can ever match; anything else is uniformly empty.
      if (typeof subject?.kind !== "string" || typeof subject?.id !== "string") {
        return Object.freeze([]);
      }
      const rows: readonly { belief_id: string }[] = await sql`
        select belief_id from domain_belief_revisions
        where tenant_id = ${scope.tenantId}
          and subject_kind = ${subject.kind}
          and subject_id = ${subject.id}
        order by seq
      `;
      const records: BeliefRecord[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.belief_id)) continue;
        seen.add(row.belief_id);
        const beliefRows = await loadBeliefRows(sql, scope, row.belief_id);
        if (beliefRows) records.push(assembleBelief(scope, row.belief_id, beliefRows));
      }
      return Object.freeze(records);
    },
  };
}
