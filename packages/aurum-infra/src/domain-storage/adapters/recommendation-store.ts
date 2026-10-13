/**
 * PostgreSQL workforce recommendation store (P001, workforce area) with
 * semantics identical to the in-memory reference — same validation issues
 * (adjustment vocabulary, typed subjects, evidence refs), the same
 * employment-impacting rules (inherently impacting adjustments cannot be
 * proposed as non-impacting; impacting proposals require non-empty evidence),
 * the same human-only decision gate (every non-person decider is forbidden),
 * the same not-found/immutable-decision discipline and the same audit
 * side-effects (recommendation-proposed / recommendation-decided on subject
 * "workforce").
 *
 * Storage ruling (migration 0011): proposals are immutable base rows with the
 * decision pending at insert; deciding is an APPENDED fact in
 * domain_workforce_recommendation_decisions (PK = one decision per
 * recommendation — decisions are immutable) and the decided record value is
 * derived on read exactly like the in-memory `decideRecommendation` spread.
 */
import {
  conflictError,
  createValidator,
  deepFreeze,
  forbiddenError,
  isKnownWorkforceAdjustment,
  isInherentlyEmploymentImpacting,
  notFound,
  ok,
  provenanceIssues,
  validationError,
  WORKFORCE_ADJUSTMENTS,
} from "@aurum/domain";
import type {
  ActorReference,
  DomainTimestamp,
  RecommendationFilter,
  SubjectReference,
  TenantScope,
  WorkforceRecommendationRecord,
  WorkforceRecommendationStorage,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import { mirrorValidateSubject } from "./workforce-shared.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** A recommendation base row joined with its appended decision, when present. */
interface RecommendationRow {
  readonly record: WorkforceRecommendationRecord;
  readonly state: string | null;
  readonly decided_by: ActorReference | null;
  readonly decided_at: number | null;
  readonly reason: string | null;
}

/** Derives the recommendation record value (base + decision spread). */
function recommendationValue(row: RecommendationRow): WorkforceRecommendationRecord {
  if (row.state === null || row.decided_by === null || row.decided_at === null) {
    return deepFreeze(row.record);
  }
  const decided: WorkforceRecommendationRecord = {
    ...row.record,
    decision: {
      state: row.state as WorkforceRecommendationRecord["decision"]["state"],
      decidedBy: row.decided_by,
      // bigint columns arrive as strings over the wire; the domain timestamp is a number.
      decidedAt: Number(row.decided_at) as DomainTimestamp,
      reason: row.reason === null ? undefined : row.reason,
    },
  };
  return deepFreeze(decided);
}

/** Loads every recommendation of the tenant in insertion order, derived. */
async function loadRecommendations(
  sql: Db | Tx,
  scope: TenantScope,
): Promise<readonly WorkforceRecommendationRecord[]> {
  const rows: readonly RecommendationRow[] = await sql`
    select r.record, d.state, d.decided_by, d.decided_at, d.reason
    from domain_workforce_recommendations r
    left join domain_workforce_recommendation_decisions d
      on d.tenant_id = r.tenant_id and d.recommendation_id = r.recommendation_id
    where r.tenant_id = ${scope.tenantId}
    order by r.seq
  `;
  return Object.freeze(rows.map(recommendationValue));
}

/** Loads one recommendation of the tenant (derived), undefined when absent. */
async function loadRecommendation(
  sql: Db | Tx,
  scope: TenantScope,
  recommendationId: string,
): Promise<WorkforceRecommendationRecord | undefined> {
  const rows: readonly RecommendationRow[] = await sql`
    select r.record, d.state, d.decided_by, d.decided_at, d.reason
    from domain_workforce_recommendations r
    left join domain_workforce_recommendation_decisions d
      on d.tenant_id = r.tenant_id and d.recommendation_id = r.recommendation_id
    where r.tenant_id = ${scope.tenantId} and r.recommendation_id = ${recommendationId}
  `;
  const row = rows[0];
  return row ? recommendationValue(row) : undefined;
}

/** Creates the PostgreSQL workforce recommendation store bound to a handle. */
export function createPgWorkforceRecommendations(sql: Db): WorkforceRecommendationStorage {
  return {
    proposeRecommendation: async (scope, input) => {
      const v = createValidator();
      const recommendationId = v.requireIdFormat(
        "recommendationId",
        input?.recommendationId ?? "",
      ) as WorkforceRecommendationRecord["recommendationId"];
      const adjustment = v.requireVocabulary("adjustment", String(input?.adjustment ?? ""), [
        ...WORKFORCE_ADJUSTMENTS,
      ]);
      mirrorValidateSubject(v, input?.subject, "subject");
      v.requireText("rationale", input?.rationale ?? "");
      const evidenceRefs = Array.isArray(input?.evidenceRefs) ? input.evidenceRefs : [];
      evidenceRefs.forEach((ref, index) => {
        mirrorValidateSubject(v, ref, `evidenceRefs.${index}`);
      });
      if (typeof input?.employmentImpacting !== "boolean") {
        v.add("employmentImpacting", "must be a boolean");
      }
      if (!input?.proposedBy || typeof input.proposedBy.kind !== "string") {
        v.add("proposedBy", "is required");
      }
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const employmentImpacting = input.employmentImpacting;
      if (isKnownWorkforceAdjustment(adjustment)) {
        if (isInherentlyEmploymentImpacting(adjustment) && !employmentImpacting) {
          return {
            ok: false,
            error: validationError([
              {
                field: "employmentImpacting",
                problem: `adjustment "${adjustment}" impacts employment by construction and cannot be proposed as non-impacting`,
              },
            ]),
          };
        }
      }
      if (employmentImpacting && evidenceRefs.length === 0) {
        return {
          ok: false,
          error: validationError([
            {
              field: "evidenceRefs",
              problem: "employment-impacting recommendations require non-empty evidence references",
            },
          ]),
        };
      }
      const record: WorkforceRecommendationRecord = {
        scope,
        recommendationId,
        adjustment: isKnownWorkforceAdjustment(adjustment) ? adjustment : "training",
        subject: input.subject as SubjectReference,
        rationale: input.rationale.trim(),
        evidenceRefs: Object.freeze([
          ...evidenceRefs,
        ]) as WorkforceRecommendationRecord["evidenceRefs"],
        employmentImpacting,
        decision: { state: "pending" },
        proposedBy: input.proposedBy,
        proposedAt: input.now,
        provenance: input.provenance,
      };
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_workforce_recommendations
            where tenant_id = ${scope.tenantId} and recommendation_id = ${recommendationId}
          `;
          if (existing.length > 0) {
            return {
              ok: false,
              error: conflictError("workforce recommendation already registered in tenant"),
            };
          }
          await tx`
            insert into domain_workforce_recommendations
              (tenant_id, recommendation_id, adjustment, record)
            values (${scope.tenantId}, ${recommendationId}, ${record.adjustment},
                    ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `workforce:propose-recommendation:${recommendationId}`,
            area: "workforce",
            operation: "propose-recommendation",
            recordId: recommendationId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "workforce", id: recommendationId },
            "workforce.recommendation-proposed",
            {
              actor: input.proposedBy,
              at: input.now,
              reason: "workforce recommendation proposed",
            },
            Object.freeze({
              adjustment: record.adjustment,
              employmentImpacting,
              evidenceCount: evidenceRefs.length,
            }),
          );
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return {
            ok: false,
            error: conflictError("workforce recommendation already registered in tenant"),
          };
        }
        throw error;
      }
    },
    decideRecommendation: async (scope, input) => {
      const v = createValidator();
      v.requireIdFormat("recommendationId", input?.recommendationId ?? "");
      v.requireVocabulary("decision", String(input?.decision ?? ""), [
        "human-approved",
        "human-rejected",
      ]);
      v.requireText("reason", input?.reason ?? "");
      if (!input?.decidedBy || typeof input.decidedBy.kind !== "string") {
        v.add("decidedBy", "is required");
      }
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      // The human-only gate: every non-person decider is forbidden (mirrored
      // before the not-found check, exactly like the reference).
      if (input.decidedBy.kind !== "person") {
        return {
          ok: false,
          error: forbiddenError("workforce recommendations are decided by humans only"),
        };
      }
      return sql.begin(async (tx) => {
        const record = await loadRecommendation(tx, scope, input.recommendationId);
        if (!record) return { ok: false, error: notFound("workforce recommendation") };
        if (record.decision.state !== "pending") {
          return {
            ok: false,
            error: conflictError(
              `recommendation already ${record.decision.state}; decisions are immutable`,
            ),
          };
        }
        await tx`
          insert into domain_workforce_recommendation_decisions
            (tenant_id, recommendation_id, state, decided_at, decided_by, reason)
          values (${scope.tenantId}, ${record.recommendationId}, ${input.decision},
                  ${input.now}, ${jsonbParam(tx, input.decidedBy)}, ${input.reason.trim()})
        `;
        await recordWrite(tx, {
          tenantId: scope.tenantId,
          journalKey: `workforce:decide-recommendation:${record.recommendationId}`,
          area: "workforce",
          operation: "decide-recommendation",
          recordId: record.recommendationId,
        });
        await appendAuditEntry(
          tx,
          scope,
          { kind: "workforce", id: record.recommendationId },
          "workforce.recommendation-decided",
          {
            actor: input.decidedBy,
            at: input.now,
            reason: input.reason,
          },
          Object.freeze({
            recommendationId: record.recommendationId,
            decision: input.decision,
            employmentImpacting: record.employmentImpacting,
          }),
        );
        const decided: WorkforceRecommendationRecord = {
          ...record,
          decision: {
            state: input.decision,
            decidedBy: input.decidedBy,
            decidedAt: input.now,
            reason: input.reason.trim(),
          },
        };
        return ok(deepFreeze(decided));
      });
    },
    getRecommendation: async (scope, recommendationId: string) => {
      const record = await loadRecommendation(sql, scope, recommendationId);
      return record ? ok(record) : { ok: false, error: notFound("workforce recommendation") };
    },
    listRecommendations: async (scope, filter?: RecommendationFilter) => {
      const all = await loadRecommendations(sql, scope);
      // The reference's truthy guard AND undefined-aware filter, mirrored
      // verbatim (an empty adjustment alone returns ALL).
      if (!filter?.adjustment && !filter?.state && filter?.employmentImpacting === undefined) {
        return all;
      }
      return Object.freeze(
        all.filter(
          (record) =>
            (filter?.adjustment === undefined || record.adjustment === filter.adjustment) &&
            (filter?.state === undefined || record.decision.state === filter.state) &&
            (filter?.employmentImpacting === undefined ||
              record.employmentImpacting === filter.employmentImpacting),
        ),
      );
    },
  };
}
