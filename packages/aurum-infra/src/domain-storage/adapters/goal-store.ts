/**
 * PostgreSQL goal ledger (P001, goals area): append-only revision history
 * with semantics identical to the in-memory reference — the same validation
 * (issue-for-issue), the same revision building (trims, normalization,
 * freezing), the same conflict/not-found discipline, and the same audit
 * side-effects on the shared global audit sequence.
 *
 * Storage ruling: one row per revision, keyed (tenant_id, goal_id,
 * revision_number); the current revision is derived as the highest number on
 * read (the in-memory pointer only ever moves forward). Every mutation lands
 * in the same transaction as its write-journal entry and its audit entry —
 * atomicity is per command, mirroring the in-memory single image.
 */
import {
  GOAL_PRIORITIES,
  auditInputIssues,
  conflictError,
  createValidator,
  deepFreeze,
  isKnownGoalPriority,
  isKnownIdentityLabel,
  isKnownSubjectKind,
  notFound,
  ok,
  provenanceIssues,
  validationError,
} from "@aurum/domain";
import type {
  CreateGoalInput,
  DomainTimestamp,
  GoalId,
  GoalMetric,
  GoalRecord,
  GoalRevision,
  GoalRevisionContent,
  GoalStorage,
  IdentityReference,
  ProvenanceRecord,
  Result,
  ReviseGoalInput,
  TenantScope,
  Validator,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import { recordWrite } from "../journal/write-journal.js";
import { jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** Mirrors the in-memory revision content validation (issue-for-issue). */
function validateRevisionContent(v: Validator, content: GoalRevisionContent | undefined): void {
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

/** Mirrors the in-memory revision building (normalization + freezing). */
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

/** Loads one goal's revisions (ordered) or null when absent in the tenant. */
async function loadGoalRevisions(
  sql: Tx | Db,
  scope: TenantScope,
  goalId: string,
): Promise<readonly GoalRevision[] | null> {
  const rows: readonly { revision_number: number; record: GoalRevision }[] = await sql`
    select revision_number, record from domain_goal_revisions
    where tenant_id = ${scope.tenantId} and goal_id = ${goalId}
    order by revision_number
  `;
  if (rows.length === 0) return null;
  return Object.freeze(rows.map((row) => deepFreeze(row.record)));
}

/** Assembles the GoalRecord the read paths return (current = highest). */
function assembleGoal(
  scope: TenantScope,
  goalId: string,
  revisions: readonly GoalRevision[],
): GoalRecord {
  const last = revisions[revisions.length - 1];
  const current = last ? last.revisionNumber : 0;
  return deepFreeze({
    scope,
    goalId: goalId as GoalId,
    currentRevision: current,
    revisions,
  });
}

/** Creates the PostgreSQL goal ledger bound to a database handle. */
export function createPgGoalLedger(sql: Db): GoalStorage {
  async function revise(
    scope: TenantScope,
    input: CreateGoalInput | ReviseGoalInput,
    mode: "create" | "revise",
  ): Promise<Result<GoalRecord>> {
    const v = createValidator();
    const goalId = v.requireIdFormat("goalId", input?.goalId ?? "") as GoalId;
    validateRevisionContent(v, input);
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    return sql.begin(async (tx) => {
      const existing = await loadGoalRevisions(tx, scope, goalId);
      if (mode === "create" && existing) {
        return { ok: false, error: conflictError("goal already registered in tenant") };
      }
      if (mode === "revise" && !existing) {
        return { ok: false, error: notFound("goal") };
      }
      const revision = buildRevision(
        input,
        existing ? existing.length + 1 : 1,
        input.provenance,
        input.now,
      );
      await tx`
        insert into domain_goal_revisions
          (tenant_id, goal_id, revision_number, priority, created_at, record)
        values
          (${scope.tenantId}, ${goalId}, ${revision.revisionNumber},
           ${revision.priority}, ${revision.createdAt}, ${jsonbParam(tx, revision)})
      `;
      await recordWrite(tx, {
        tenantId: scope.tenantId,
        journalKey: `goals:append-revision:${goalId}:${revision.revisionNumber}`,
        area: "goals",
        operation: "append-revision",
        recordId: goalId,
        version: revision.revisionNumber,
      });
      await appendAuditEntry(
        tx,
        scope,
        { kind: "goal", id: goalId },
        mode === "create" ? "goal.created" : "goal.revised",
        input.audit,
        Object.freeze({ revisionNumber: revision.revisionNumber }),
      );
      const stored = await loadGoalRevisions(tx, scope, goalId);
      const revisions = stored ?? [revision];
      return ok(assembleGoal(scope, goalId, revisions));
    });
  }

  return {
    createGoal: (scope, input) => revise(scope, input, "create"),
    reviseGoal: (scope, input) => revise(scope, input, "revise"),
    getGoal: async (scope, goalId) => {
      const revisions = await loadGoalRevisions(sql, scope, goalId);
      return revisions
        ? ok(assembleGoal(scope, goalId, revisions))
        : { ok: false, error: notFound("goal") };
    },
    getGoalRevision: async (scope, goalId, revisionNumber) => {
      const revisions = await loadGoalRevisions(sql, scope, goalId);
      if (!revisions) return { ok: false, error: notFound("goal") };
      const revision = revisions.find((item) => item.revisionNumber === revisionNumber);
      if (!revision) return { ok: false, error: notFound("goal revision") };
      return ok(revision);
    },
    listGoals: async (scope, filter) => {
      const rows: readonly { goal_id: string; record: GoalRevision }[] = await sql`
        select goal_id, record from domain_goal_revisions
        where tenant_id = ${scope.tenantId}
        order by seq
      `;
      const byGoal = new Map<string, GoalRevision[]>();
      for (const row of rows) {
        const bucket = byGoal.get(row.goal_id) ?? [];
        bucket.push(deepFreeze(row.record));
        byGoal.set(row.goal_id, bucket);
      }
      const all = Object.freeze(
        [...byGoal.entries()].map(([goalId, revisions]) =>
          assembleGoal(scope, goalId, Object.freeze(revisions)),
        ),
      );
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
