/**
 * In-memory goal ledger. Revisions are append-only: revising appends a new
 * immutable revision and moves the current pointer; every prior revision
 * remains retrievable and unchanged.
 */
import { conflictError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type { GoalId } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import { isKnownSubjectKind } from "../core/refs.js";
import { auditInputIssues } from "../audit/records.js";
import type { AuditSink } from "../audit/ports.js";
import { isKnownIdentityLabel, type IdentityReference } from "../identity/records.js";
import { provenanceIssues, type ProvenanceRecord } from "../evidence/provenance.js";
import type { DomainTimestamp } from "../core/branding.js";
import {
  GOAL_PRIORITIES,
  isKnownGoalPriority,
  type GoalMetric,
  type GoalRecord,
  type GoalRevision,
} from "./records.js";
import type {
  CreateGoalInput,
  GoalFilter,
  GoalLedger,
  GoalRevisionContent,
  ReviseGoalInput,
} from "./ports.js";

function validateRevisionContent(
  v: ReturnType<typeof createValidator>,
  content: GoalRevisionContent | undefined,
): void {
  if (!content) {
    v.add("revision", "is required");
    return;
  }
  v.requireText("objective", content.objective ?? "");
  v.requireText("desiredState", content.desiredState ?? "");
  v.requireNonNegativeNumber("horizonStart", content.horizonStart ?? Number.NaN);
  v.requireNonNegativeNumber("horizonEnd", content.horizonEnd ?? Number.NaN);
  if (
    typeof content.horizonStart === "number" &&
    typeof content.horizonEnd === "number" &&
    Number.isFinite(content.horizonStart) &&
    Number.isFinite(content.horizonEnd) &&
    content.horizonStart > content.horizonEnd
  ) {
    v.add("horizon", "start must not be after end");
  }
  v.requireIdFormat("ownerId", content.ownerId ?? "");
  const ownerLabels = Array.isArray(content.ownerLabels) ? content.ownerLabels : [];
  if (ownerLabels.length === 0) {
    v.add("ownerLabels", "must be a non-empty array");
  }
  for (const label of ownerLabels) {
    if (typeof label !== "string" || !isKnownIdentityLabel(label)) {
      v.add("ownerLabels", `unknown label: ${String(label)}`);
    }
  }
  v.requireVocabulary("priority", String(content.priority ?? ""), GOAL_PRIORITIES);
  const metrics = Array.isArray(content.metrics) ? content.metrics : [];
  for (const [index, metric] of metrics.entries()) {
    v.requireText(`metrics.${index}.name`, metric?.name ?? "");
    v.requireFiniteNumber(`metrics.${index}.target`, metric?.target ?? Number.NaN);
    v.requireFiniteNumber(`metrics.${index}.threshold`, metric?.threshold ?? Number.NaN);
    const direction = String(metric?.direction ?? "");
    if (direction !== "at-least" && direction !== "at-most") {
      v.add(`metrics.${index}.direction`, "must be at-least or at-most");
    }
  }
  const expected = Array.isArray(content.expectedEvidence) ? content.expectedEvidence : [];
  for (const [index, evidence] of expected.entries()) {
    v.requireText(`expectedEvidence.${index}.description`, evidence?.description ?? "");
    const subject = evidence?.subject as { kind?: unknown; id?: unknown } | undefined;
    if (
      !subject ||
      typeof subject.kind !== "string" ||
      !isKnownSubjectKind(subject.kind) ||
      typeof subject.id !== "string" ||
      subject.id.trim().length === 0
    ) {
      v.add(`expectedEvidence.${index}.subject`, "must be a typed subject reference");
    }
  }
  const criteria = Array.isArray(content.successCriteria) ? content.successCriteria : [];
  for (const [index, criterion] of criteria.entries()) {
    v.requireText(`successCriteria.${index}.description`, criterion?.description ?? "");
  }
}

function buildRevision(
  content: GoalRevisionContent,
  revisionNumber: number,
  provenance: ProvenanceRecord,
  now: DomainTimestamp,
): GoalRevision {
  const metrics: GoalMetric[] = (content.metrics ?? []).map((metric) => ({
    name: metric.name.trim(),
    ...(metric.unit !== undefined && metric.unit !== null ? { unit: String(metric.unit) } : {}),
    target: metric.target,
    threshold: metric.threshold,
    direction: metric.direction === "at-most" ? "at-most" : "at-least",
  }));
  const owner: IdentityReference = {
    personId: content.ownerId.trim() as IdentityReference["personId"],
    labels: Object.freeze([...(content.ownerLabels ?? [])]) as IdentityReference["labels"],
  };
  return {
    revisionNumber,
    objective: content.objective.trim(),
    desiredState: content.desiredState.trim(),
    metrics: Object.freeze(metrics),
    horizonStart: content.horizonStart,
    horizonEnd: content.horizonEnd,
    owner,
    priority: isKnownGoalPriority(content.priority) ? content.priority : "medium",
    expectedEvidence: Object.freeze([...(content.expectedEvidence ?? [])]),
    successCriteria: Object.freeze([...(content.successCriteria ?? [])]),
    provenance,
    createdAt: now,
  };
}

export function createGoalLedger(audit: AuditSink): GoalLedger {
  const goals = new TenantIndex<GoalRecord>();

  function revise(
    scope: TenantScope,
    input: CreateGoalInput | ReviseGoalInput,
    mode: "create" | "revise",
  ): Result<GoalRecord> {
    const v = createValidator();
    const goalId = v.requireIdFormat("goalId", input?.goalId ?? "") as GoalId;
    validateRevisionContent(v, input);
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    const existing = goals.get(scope, goalId);
    if (mode === "create" && existing) {
      return { ok: false, error: conflictError("goal already registered in tenant") };
    }
    if (mode === "revise" && !existing) {
      return { ok: false, error: notFound("goal") };
    }
    const revision = buildRevision(
      input,
      existing ? existing.revisions.length + 1 : 1,
      input.provenance,
      input.now,
    );
    const record: GoalRecord = existing
      ? {
          ...existing,
          currentRevision: revision.revisionNumber,
          revisions: Object.freeze([...existing.revisions, revision]),
        }
      : {
          scope,
          goalId,
          currentRevision: 1,
          revisions: Object.freeze([revision]),
        };
    const stored = goals.put(scope, goalId, record);
    audit.append(
      scope,
      { kind: "goal", id: goalId },
      mode === "create" ? "goal.created" : "goal.revised",
      input.audit,
      Object.freeze({ revisionNumber: revision.revisionNumber }),
    );
    return ok(stored);
  }

  return {
    createGoal: (scope, input) => revise(scope, input, "create"),
    reviseGoal: (scope, input) => revise(scope, input, "revise"),
    getGoal: (scope: TenantScope, goalId: string) => {
      const record = goals.get(scope, goalId);
      return record ? ok(record) : { ok: false, error: notFound("goal") };
    },
    getGoalRevision: (
      scope: TenantScope,
      goalId: string,
      revisionNumber: number,
    ): Result<GoalRevision> => {
      const record = goals.get(scope, goalId);
      if (!record) return { ok: false, error: notFound("goal") };
      const revision = record.revisions.find((item) => item.revisionNumber === revisionNumber);
      if (!revision) return { ok: false, error: notFound("goal revision") };
      return ok(revision);
    },
    listGoals: (scope: TenantScope, filter?: GoalFilter) => {
      const all = goals.list(scope);
      if (!filter?.priority) return all;
      return Object.freeze(
        all.filter((record) => {
          const current = record.revisions[record.revisions.length - 1];
          return current?.priority === filter.priority;
        }),
      );
    },
  };
}
