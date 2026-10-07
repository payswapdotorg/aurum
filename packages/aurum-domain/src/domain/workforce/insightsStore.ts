/**
 * In-memory workforce insights store (W005): workload observations, work
 * outcomes and alternative explanations — all append-only evidence records
 * with provenance and freshness. Every consequential transition lands in
 * the shared audit trail.
 */
import { conflictError, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type { AlternativeExplanationId, PersonId, WorkOutcomeId } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import type { AuditSink } from "../audit/ports.js";
import { provenanceIssues } from "../evidence/provenance.js";
import { resolveFreshness } from "../evidence/freshness.js";
import {
  WORK_OUTCOME_RESULTS,
  isKnownWorkOutcomeResult,
  type AlternativeExplanationRecord,
  type WorkOutcomeRecord,
  type WorkloadObservationRecord,
} from "./records.js";
import { validateEvidenceRefs, validatePeriod, validateSubject } from "./shared.js";
import type {
  ExplanationFilter,
  OutcomeFilter,
  RecordAlternativeExplanationInput,
  RecordOutcomeInput,
  RecordWorkloadObservationInput,
  WorkforceInsights,
  WorkloadObservationFilter,
} from "./ports.js";

export function createWorkforceInsights(audit: AuditSink): WorkforceInsights {
  const observations = new TenantIndex<WorkloadObservationRecord>();
  const outcomes = new TenantIndex<WorkOutcomeRecord>();
  const explanations = new TenantIndex<AlternativeExplanationRecord>();

  function recordWorkloadObservation(
    scope: TenantScope,
    input: RecordWorkloadObservationInput,
  ): Result<WorkloadObservationRecord> {
    const v = createValidator();
    const observationId = v.requireIdFormat("observationId", input?.observationId ?? "");
    v.requireIdFormat("personId", input?.personId ?? "");
    validatePeriod(v, "period", input?.period);
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
    if (observations.has(scope, observationId)) {
      return { ok: false, error: conflictError("workload observation already recorded in tenant") };
    }
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
      freshness: resolveFreshness(input.freshness, input.now),
      recordedAt: input.now,
    };
    const stored = observations.put(scope, observationId, record);
    audit.append(
      scope,
      { kind: "workforce", id: observationId },
      "workforce.workload-observed",
      { actor: input.provenance.actor, at: input.now, reason: "workload observed" },
      Object.freeze({ personId: record.personId, observedEffortMs: record.observedEffortMs }),
    );
    return ok(stored);
  }

  function recordOutcome(scope: TenantScope, input: RecordOutcomeInput): Result<WorkOutcomeRecord> {
    const v = createValidator();
    const outcomeId = v.requireIdFormat("outcomeId", input?.outcomeId ?? "") as WorkOutcomeId;
    v.requireIdFormat("personId", input?.personId ?? "");
    validatePeriod(v, "period", input?.period);
    if (input?.subject !== undefined) validateSubject(v, input.subject, "subject");
    v.requireVocabulary("result", String(input?.result ?? ""), WORK_OUTCOME_RESULTS);
    v.requireText("summary", input?.summary ?? "");
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    if (outcomes.has(scope, outcomeId)) {
      return { ok: false, error: conflictError("work outcome already recorded in tenant") };
    }
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
    const stored = outcomes.put(scope, outcomeId, record);
    audit.append(
      scope,
      { kind: "workforce", id: outcomeId },
      "workforce.outcome-recorded",
      { actor: input.provenance.actor, at: input.now, reason: "work outcome recorded" },
      Object.freeze({ personId: record.personId, result: record.result }),
    );
    return ok(stored);
  }

  function recordAlternativeExplanation(
    scope: TenantScope,
    input: RecordAlternativeExplanationInput,
  ): Result<AlternativeExplanationRecord> {
    const v = createValidator();
    const explanationId = v.requireIdFormat(
      "explanationId",
      input?.explanationId ?? "",
    ) as AlternativeExplanationId;
    validateSubject(v, input?.subject, "subject");
    v.requireText("pattern", input?.pattern ?? "");
    v.requireText("explanation", input?.explanation ?? "");
    validateEvidenceRefs(v, input?.evidenceRefs, "evidenceRefs");
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    if (explanations.has(scope, explanationId)) {
      return {
        ok: false,
        error: conflictError("alternative explanation already recorded in tenant"),
      };
    }
    const record: AlternativeExplanationRecord = {
      scope,
      explanationId,
      subject: input.subject,
      pattern: input.pattern.trim(),
      explanation: input.explanation.trim(),
      evidenceRefs: Object.freeze([...input.evidenceRefs]),
      provenance: input.provenance,
      createdAt: input.now,
    };
    const stored = explanations.put(scope, explanationId, record);
    audit.append(
      scope,
      { kind: "workforce", id: explanationId },
      "workforce.explanation-recorded",
      { actor: input.provenance.actor, at: input.now, reason: "alternative explanation recorded" },
      Object.freeze({ explanationId }),
    );
    return ok(stored);
  }

  return {
    recordWorkloadObservation,
    listWorkloadObservations: (scope: TenantScope, filter?: WorkloadObservationFilter) => {
      const all = observations.list(scope);
      if (!filter?.personId) return all;
      return Object.freeze(all.filter((record) => record.personId === filter.personId));
    },
    recordOutcome,
    listOutcomes: (scope: TenantScope, filter?: OutcomeFilter) => {
      const all = outcomes.list(scope);
      if (!filter?.personId && !filter?.result) return all;
      return Object.freeze(
        all.filter(
          (record) =>
            (filter?.personId === undefined || record.personId === filter.personId) &&
            (filter?.result === undefined || record.result === filter.result),
        ),
      );
    },
    recordAlternativeExplanation,
    listAlternativeExplanations: (scope: TenantScope, filter?: ExplanationFilter) => {
      const all = explanations.list(scope);
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
