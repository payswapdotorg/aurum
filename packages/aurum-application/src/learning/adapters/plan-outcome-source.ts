/**
 * Plan outcome source adapter (W013 adapters layer): derives an outcome
 * OBSERVATION from a W009 execution plan plus its task completion records.
 * Pure record mapping — no service handles, no state mutation; the caller
 * pulls the records through the plans contract and passes the values in.
 *
 * Mapping (documented):
 * - a completed plan with at least one FAILED task completion -> status
 *   "failed" (the organization failed to operate — first-class calibration
 *   evidence carrying the failure kind/code verbatim);
 * - a completed plan with all tasks settled and none failed/cancelled ->
 *   status "achieved";
 * - a completed plan with cancelled-but-not-failed tasks -> "partial";
 * - an active or cancelled plan observes NOTHING (null) — in-flight and
 *   abandoned runs have no organization-performance outcome (same ruling
 *   as missions: no fabricated outcomes for unobserved runs).
 */
import type { DomainTimestamp } from "@aurum/domain";
import type { ExecutionPlan, TaskCompletionRecord } from "../../plans/contract.plans.js";
import type { OutcomeObservation } from "../domain/records.js";

export function planOutcomeObservation(
  plan: ExecutionPlan,
  completions: readonly TaskCompletionRecord[],
): OutcomeObservation | null {
  if (plan.lifecycleState !== "completed") return null;
  const own = completions.filter((completion) => completion.planId === plan.planId);
  if (own.length === 0) return null;

  const failed = own.find((completion) => completion.status === "failed");
  const cancelled = own.filter((completion) => completion.status === "cancelled").length;
  const lastCompletion = own.reduce(
    (latest, completion) => (completion.completedAt > latest ? completion.completedAt : latest),
    own[0]?.completedAt ?? 0,
  );
  const lastTransitionAt = plan.lifecycleHistory.reduce(
    (latest, transition) => (transition.at > latest ? transition.at : latest),
    plan.createdAt,
  );
  const observedAt = Math.max(lastCompletion, lastTransitionAt) as DomainTimestamp;

  if (failed !== undefined && failed.failure !== undefined) {
    return {
      status: "failed",
      source: { kind: "plan", ref: plan.planId },
      observedAt,
      observedBy: plan.createdBy,
      failure: {
        kind: failed.failure.kind,
        detail: `${failed.failure.code}: ${failed.failure.message} (task ${failed.taskId}${failed.failure.retryable ? ", retryable" : ""})`,
      },
    };
  }
  if (failed !== undefined) {
    return {
      status: "failed",
      source: { kind: "plan", ref: plan.planId },
      observedAt,
      observedBy: plan.createdBy,
      failure: {
        kind: "task-failed",
        detail: `task ${failed.taskId} settled failed without failure detail`,
      },
    };
  }
  return {
    status: cancelled > 0 ? "partial" : "achieved",
    source: { kind: "plan", ref: plan.planId },
    observedAt,
    observedBy: plan.createdBy,
    ...(cancelled > 0
      ? { notes: `${cancelled} task completion(s) cancelled before plan completion` }
      : {}),
  };
}
