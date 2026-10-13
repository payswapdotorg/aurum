/**
 * PostgreSQL workforce insights store (P001, workforce area) with semantics
 * identical to the in-memory reference — same validation issues (id formats,
 * periods, utilization fractions, typed subjects, evidence refs, outcome
 * vocabulary), same conflict discipline and the same audit side-effects
 * (workload-observed / outcome-recorded / explanation-recorded on subject
 * "workforce"). Freshness resolution mirrors the domain-internal
 * resolveFreshness (the evidence-area ruling).
 *
 * Storage ruling (migration 0011): workload observations, work outcomes and
 * alternative explanations are immutable evidence rows with strong person /
 * result columns serving the list filters.
 */
import {
  conflictError,
  createValidator,
  deepFreeze,
  isKnownWorkOutcomeResult,
  ok,
  provenanceIssues,
  validationError,
  WORK_OUTCOME_RESULTS,
} from "@aurum/domain";
import type {
  AlternativeExplanationRecord,
  ExplanationFilter,
  OutcomeFilter,
  PersonId,
  SubjectReference,
  WorkOutcomeRecord,
  WorkforceInsightsStorage,
  WorkloadObservationFilter,
  WorkloadObservationRecord,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import {
  mirrorResolveFreshness,
  mirrorValidateEvidenceRefs,
  mirrorValidatePeriod,
  mirrorValidateSubject,
} from "./workforce-shared.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db } from "../pg/db.js";

/** Creates the PostgreSQL workforce insights store bound to a database handle. */
export function createPgWorkforceInsights(sql: Db): WorkforceInsightsStorage {
  return {
    recordWorkloadObservation: async (scope, input) => {
      const v = createValidator();
      const observationId = v.requireIdFormat("observationId", input?.observationId ?? "");
      v.requireIdFormat("personId", input?.personId ?? "");
      mirrorValidatePeriod(v, "period", input?.period);
      v.requireNonNegativeNumber("observedEffortMs", input?.observedEffortMs ?? Number.NaN);
      if (input?.observedUtilization !== undefined) {
        v.requireFiniteNumber("observedUtilization", input.observedUtilization);
        if (input.observedUtilization < 0) {
          v.add("observedUtilization", "must not be negative");
        }
      }
      if (input?.note !== undefined) v.requireText("note", input.note, { max: 2000 });
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const record: WorkloadObservationRecord = {
        scope,
        observationId,
        personId: input.personId.trim() as PersonId,
        period: input.period,
        observedEffortMs: input.observedEffortMs,
        ...(input.observedUtilization !== undefined
          ? { observedUtilization: input.observedUtilization }
          : {}),
        ...(input.note ? { note: input.note.trim() } : {}),
        provenance: input.provenance,
        freshness: mirrorResolveFreshness(input.freshness, input.now),
        recordedAt: input.now,
      };
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_workload_observations
            where tenant_id = ${scope.tenantId} and observation_id = ${observationId}
          `;
          if (existing.length > 0) {
            return {
              ok: false,
              error: conflictError("workload observation already recorded in tenant"),
            };
          }
          await tx`
            insert into domain_workload_observations
              (tenant_id, observation_id, person_id, record)
            values (${scope.tenantId}, ${observationId}, ${record.personId},
                    ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `workforce:observe-workload:${observationId}`,
            area: "workforce",
            operation: "observe-workload",
            recordId: observationId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "workforce", id: observationId },
            "workforce.workload-observed",
            { actor: input.provenance.actor, at: input.now, reason: "workload observed" },
            Object.freeze({
              personId: record.personId,
              observedEffortMs: record.observedEffortMs,
            }),
          );
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return {
            ok: false,
            error: conflictError("workload observation already recorded in tenant"),
          };
        }
        throw error;
      }
    },
    listWorkloadObservations: async (scope, filter?: WorkloadObservationFilter) => {
      const rows: readonly { record: WorkloadObservationRecord }[] = await sql`
        select record from domain_workload_observations
        where tenant_id = ${scope.tenantId}
        order by seq
      `;
      const all = Object.freeze(rows.map((row) => deepFreeze(row.record)));
      // The reference's truthy guard: an empty personId returns ALL.
      if (!filter?.personId) return all;
      return Object.freeze(all.filter((record) => record.personId === filter.personId));
    },
    recordOutcome: async (scope, input) => {
      const v = createValidator();
      const outcomeId = v.requireIdFormat(
        "outcomeId",
        input?.outcomeId ?? "",
      ) as WorkOutcomeRecord["outcomeId"];
      v.requireIdFormat("personId", input?.personId ?? "");
      mirrorValidatePeriod(v, "period", input?.period);
      if (input?.subject !== undefined) mirrorValidateSubject(v, input.subject, "subject");
      v.requireVocabulary("result", String(input?.result ?? ""), WORK_OUTCOME_RESULTS);
      v.requireText("summary", input?.summary ?? "");
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const record: WorkOutcomeRecord = {
        scope,
        outcomeId,
        personId: input.personId.trim() as PersonId,
        period: input.period,
        ...(input.subject ? { subject: input.subject } : {}),
        result: isKnownWorkOutcomeResult(String(input.result))
          ? (input.result as WorkOutcomeRecord["result"])
          : "partial",
        summary: input.summary.trim(),
        provenance: input.provenance,
        createdAt: input.now,
      };
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_work_outcomes
            where tenant_id = ${scope.tenantId} and outcome_id = ${outcomeId}
          `;
          if (existing.length > 0) {
            return { ok: false, error: conflictError("work outcome already recorded in tenant") };
          }
          await tx`
            insert into domain_work_outcomes (tenant_id, outcome_id, person_id, result, record)
            values (${scope.tenantId}, ${outcomeId}, ${record.personId}, ${record.result},
                    ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `workforce:record-outcome:${outcomeId}`,
            area: "workforce",
            operation: "record-outcome",
            recordId: outcomeId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "workforce", id: outcomeId },
            "workforce.outcome-recorded",
            { actor: input.provenance.actor, at: input.now, reason: "work outcome recorded" },
            Object.freeze({ personId: record.personId, result: record.result }),
          );
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("work outcome already recorded in tenant") };
        }
        throw error;
      }
    },
    listOutcomes: async (scope, filter?: OutcomeFilter) => {
      const rows: readonly { record: WorkOutcomeRecord }[] = await sql`
        select record from domain_work_outcomes
        where tenant_id = ${scope.tenantId}
        order by seq
      `;
      const all = Object.freeze(rows.map((row) => deepFreeze(row.record)));
      // The reference's truthy guard AND undefined-aware filter, mirrored
      // verbatim (an empty personId alone returns ALL).
      if (!filter?.personId && !filter?.result) return all;
      return Object.freeze(
        all.filter(
          (record) =>
            (filter?.personId === undefined || record.personId === filter.personId) &&
            (filter?.result === undefined || record.result === filter.result),
        ),
      );
    },
    recordAlternativeExplanation: async (scope, input) => {
      const v = createValidator();
      const explanationId = v.requireIdFormat(
        "explanationId",
        input?.explanationId ?? "",
      ) as AlternativeExplanationRecord["explanationId"];
      mirrorValidateSubject(v, input?.subject, "subject");
      v.requireText("pattern", input?.pattern ?? "");
      v.requireText("explanation", input?.explanation ?? "");
      mirrorValidateEvidenceRefs(v, input?.evidenceRefs, "evidenceRefs");
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const record: AlternativeExplanationRecord = {
        scope,
        explanationId,
        subject: input.subject as SubjectReference,
        pattern: input.pattern.trim(),
        explanation: input.explanation.trim(),
        evidenceRefs: Object.freeze([
          ...input.evidenceRefs,
        ]) as AlternativeExplanationRecord["evidenceRefs"],
        provenance: input.provenance,
        createdAt: input.now,
      };
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_alternative_explanations
            where tenant_id = ${scope.tenantId} and explanation_id = ${explanationId}
          `;
          if (existing.length > 0) {
            return {
              ok: false,
              error: conflictError("alternative explanation already recorded in tenant"),
            };
          }
          await tx`
            insert into domain_alternative_explanations (tenant_id, explanation_id, record)
            values (${scope.tenantId}, ${explanationId}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `workforce:record-explanation:${explanationId}`,
            area: "workforce",
            operation: "record-explanation",
            recordId: explanationId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "workforce", id: explanationId },
            "workforce.explanation-recorded",
            {
              actor: input.provenance.actor,
              at: input.now,
              reason: "alternative explanation recorded",
            },
            Object.freeze({ explanationId }),
          );
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return {
            ok: false,
            error: conflictError("alternative explanation already recorded in tenant"),
          };
        }
        throw error;
      }
    },
    listAlternativeExplanations: async (scope, filter?: ExplanationFilter) => {
      const rows: readonly { record: AlternativeExplanationRecord }[] = await sql`
        select record from domain_alternative_explanations
        where tenant_id = ${scope.tenantId}
        order by seq
      `;
      const all = Object.freeze(rows.map((row) => deepFreeze(row.record)));
      // The reference's truthy guard: an absent subject returns ALL.
      if (!filter?.subject) return all;
      return Object.freeze(
        all.filter(
          (record) =>
            record.subject.kind === filter.subject?.kind &&
            record.subject.id === filter.subject?.id,
        ),
      );
    },
  };
}
