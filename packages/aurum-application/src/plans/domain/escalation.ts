/**
 * Escalation pure functions (W009 domain layer, catalog clause 4).
 *
 * Escalation rules as DATA: when a task's execution settles failed, OR its
 * deadline passes, OR a dependency settles failed, an escalation record is
 * produced. The escalation PROPOSES (who is asked, what decision is
 * requested: retry/replace/cancel-branch/cancel-plan); the authority seams
 * DISPOSE.
 *
 * Escalation records NEVER mutate plans directly (tripwire:
 * `test/plans-escalation.test.ts` — the escalation module has no plan-record
 * imports). They live in their own append-only store; the authority port
 * reads them and resolves them through the W002 action authority.
 *
 * All operations are pure functions returning NEW frozen values; no IO.
 */
import { err, ok, type Result } from "@aurum/domain";
import type {
  ActorReference,
  DomainTimestamp,
  ProvenanceRecord,
  ValidationIssue,
} from "@aurum/domain";
import { planValidationError, type PlanError } from "./errors.js";
import type { EscalationRecord } from "./records.js";
import type { PlanTask } from "./records.js";
import type { EscalationDecision, EscalationTrigger } from "./vocabulary.js";
import {
  isKnownEscalationDecision,
  isKnownEscalationTrigger,
} from "./vocabulary.js";
import type { TaskSettlementEcho } from "./ports.js";

/**
 * The default escalation decision requested for each trigger kind. The plan
 * service MAY override these per-task; this is the default table the
 * escalation evaluator applies when no override is configured.
 *
 * Catalog: "an escalation record is produced (who is asked, what decision is
 * requested: retry/replace/cancel-branch/cancel-plan)".
 */
export const DEFAULT_ESCALATION_DECISIONS: Readonly<Record<EscalationTrigger, EscalationDecision>> =
  Object.freeze({
    "task-failed": "retry",
    "task-deadline-exceeded": "retry",
    "dependency-failed": "cancel-branch",
  });

/**
 * Validates an escalation input before the escalation record is produced.
 * Returns issues, empty when valid.
 */
export function escalationInputIssues(input: {
  readonly trigger: string;
  readonly requestedDecision: string;
  readonly addressedTo: ActorReference;
  readonly reason: string;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isKnownEscalationTrigger(input?.trigger)) {
    issues.push({
      field: "trigger",
      problem: "must be one of " + ["task-failed", "task-deadline-exceeded", "dependency-failed"].join("/"),
    });
  }
  if (!isKnownEscalationDecision(input?.requestedDecision)) {
    issues.push({
      field: "requestedDecision",
      problem: "must be one of " + ["retry", "replace", "cancel-branch", "cancel-plan"].join("/"),
    });
  }
  if (!input?.addressedTo || typeof input.addressedTo !== "object") {
    issues.push({ field: "addressedTo", problem: "must be an actor reference" });
  } else {
    const actor = input.addressedTo;
    if (
      typeof actor.kind !== "string" ||
      !["person", "system", "agent", "external"].includes(actor.kind)
    ) {
      issues.push({ field: "addressedTo.kind", problem: "must be a known actor kind" });
    }
  }
  if (typeof input?.reason !== "string" || input.reason.trim().length === 0) {
    issues.push({ field: "reason", problem: "must be a non-empty string" });
  }
  return issues;
}

/**
 * Builds an escalation record from a failed task settlement. Pure: takes the
 * failing task, the settlement echo, the addressed-to actor, the
 * requested decision, and the provenance; returns a fresh escalation record.
 *
 * The escalation record NEVER mutates the plan — it lives in its own
 * append-only store. The authority port reads escalations and disposes
 * through the W002 action authority (separate records).
 */
export function buildTaskFailedEscalation(input: {
  readonly escalationId: string;
  readonly planId: string;
  readonly task: PlanTask;
  readonly settlement: TaskSettlementEcho;
  readonly addressedTo: ActorReference;
  readonly reason: string;
  readonly requestedDecision?: EscalationDecision;
  readonly raisedAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
}): Result<EscalationRecord, PlanError> {
  if (input.settlement.status !== "failed") {
    return err(
      planValidationError([
        {
          field: "settlement.status",
          problem: `must be 'failed' for trigger 'task-failed' (got '${input.settlement.status}')`,
        },
      ]),
    );
  }
  const requestedDecision = input.requestedDecision ?? DEFAULT_ESCALATION_DECISIONS["task-failed"];
  const issues = escalationInputIssues({
    trigger: "task-failed",
    requestedDecision,
    addressedTo: input.addressedTo,
    reason: input.reason,
  });
  if (issues.length > 0) return err(planValidationError(issues));
  return ok({
    escalationId: input.escalationId,
    planId: input.planId,
    taskId: input.task.taskId,
    trigger: "task-failed",
    requestedDecision,
    addressedTo: input.addressedTo,
    reason: input.reason.trim(),
    failureSettlementRef: {
      requestId: input.settlement.requestId,
      settledAt: input.settlement.settledAt,
    },
    raisedAt: input.raisedAt,
    provenance: input.provenance,
  });
}

/**
 * Builds an escalation record from a deadline-exceeded task. Same shape as
 * the failed-task escalation, but the trigger is `task-deadline-exceeded`
 * and the default requested decision is `retry` (override to `replace` or
 * `cancel-branch`/`cancel-plan` per the plan's escalation policy).
 */
export function buildDeadlineExceededEscalation(input: {
  readonly escalationId: string;
  readonly planId: string;
  readonly task: PlanTask;
  readonly now: number;
  readonly addressedTo: ActorReference;
  readonly reason: string;
  readonly requestedDecision?: EscalationDecision;
  readonly raisedAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
}): Result<EscalationRecord, PlanError> {
  if (typeof input.task.deadlineEpochMs !== "number" || input.task.deadlineEpochMs > input.now) {
    return err(
      planValidationError([
        {
          field: "task.deadlineEpochMs",
          problem: "must be in the past for trigger 'task-deadline-exceeded'",
        },
      ]),
    );
  }
  const requestedDecision =
    input.requestedDecision ?? DEFAULT_ESCALATION_DECISIONS["task-deadline-exceeded"];
  const issues = escalationInputIssues({
    trigger: "task-deadline-exceeded",
    requestedDecision,
    addressedTo: input.addressedTo,
    reason: input.reason,
  });
  if (issues.length > 0) return err(planValidationError(issues));
  return ok({
    escalationId: input.escalationId,
    planId: input.planId,
    taskId: input.task.taskId,
    trigger: "task-deadline-exceeded",
    requestedDecision,
    addressedTo: input.addressedTo,
    reason: input.reason.trim(),
    raisedAt: input.raisedAt,
    provenance: input.provenance,
  });
}

/**
 * Builds an escalation record from a dependency failure. The trigger is
 * `dependency-failed`; the failing dependency task id is recorded. The
 * default requested decision is `cancel-branch` (override per policy).
 */
export function buildDependencyFailedEscalation(input: {
  readonly escalationId: string;
  readonly planId: string;
  readonly task: PlanTask;
  readonly failedDependencyTaskId: string;
  readonly failedDependencySettlement: TaskSettlementEcho;
  readonly addressedTo: ActorReference;
  readonly reason: string;
  readonly requestedDecision?: EscalationDecision;
  readonly raisedAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
}): Result<EscalationRecord, PlanError> {
  if (!input.task.dependsOn.includes(input.failedDependencyTaskId)) {
    return err(
      planValidationError([
        {
          field: "failedDependencyTaskId",
          problem: `must be a declared dependency of task ${input.task.taskId}`,
        },
      ]),
    );
  }
  if (input.failedDependencySettlement.status !== "failed") {
    return err(
      planValidationError([
        {
          field: "failedDependencySettlement.status",
          problem: `must be 'failed' for trigger 'dependency-failed'`,
        },
      ]),
    );
  }
  const requestedDecision =
    input.requestedDecision ?? DEFAULT_ESCALATION_DECISIONS["dependency-failed"];
  const issues = escalationInputIssues({
    trigger: "dependency-failed",
    requestedDecision,
    addressedTo: input.addressedTo,
    reason: input.reason,
  });
  if (issues.length > 0) return err(planValidationError(issues));
  return ok({
    escalationId: input.escalationId,
    planId: input.planId,
    taskId: input.task.taskId,
    trigger: "dependency-failed",
    requestedDecision,
    addressedTo: input.addressedTo,
    reason: input.reason.trim(),
    failedDependencyTaskId: input.failedDependencyTaskId,
    raisedAt: input.raisedAt,
    provenance: input.provenance,
  });
}

/**
 * Recovers the plan from execution-session loss (catalog clause 4: "a plan
 * survives execution-session loss — the W006 recovery planner is substrate;
 * the PLAN's truth is intact — re-dispatch of a task creates a NEW execution
 * session referencing the SAME task id; correlation retained").
 *
 * This pure function computes the next attempt number for a task: the plan's
 * truth is intact (the task still exists on the plan), and the re-dispatch
 * will create a NEW execution session with a fresh request id (the
 * `submissionKey` derives from `(planId, taskId, attempt)` so the substrate
 * deduplicates appropriately). The substrate tracks the latest attempt; the
 * plan never persists the request id.
 */
export function nextAttemptNumber(
  previousAttempts: readonly { readonly attempt: number; readonly requestId: string }[],
): number {
  if (previousAttempts.length === 0) return 1;
  return Math.max(...previousAttempts.map((entry) => entry.attempt)) + 1;
}
