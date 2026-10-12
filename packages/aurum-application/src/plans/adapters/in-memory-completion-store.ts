/**
 * In-memory task completion store (W009 adapter). Records task completions
 * (each citing the settling execution envelope — catalog clause 3). P-series
 * debt: PostgreSQL storage.
 *
 * Truth law: completions live in their OWN store; they are NOT stored on
 * `ExecutionPlan`. The plan is semantic truth; completions are
 * substrate-side records (correlation identities only). The truth-law
 * tripwire scans the plan record's source file and finds no
 * execution-session-shaped fields ON the plan.
 */
import { type Result } from "@aurum/domain";
import { planInvariant, planNotFound, type PlanError } from "../domain/errors.js";
import type { TaskCompletionRecord } from "../domain/records.js";
import type { TaskCompletionStore } from "../domain/ports.js";

export class InMemoryTaskCompletionStore implements TaskCompletionStore {
  private readonly completions = new Map<string, TaskCompletionRecord>();

  private keyOf(planId: string, taskId: string): string {
    return `${planId}\0${taskId}`;
  }

  recordCompletion(completion: TaskCompletionRecord): Result<TaskCompletionRecord, PlanError> {
    if (!completion || typeof completion !== "object") {
      return {
        ok: false,
        error: planInvariant("completion must be an object"),
      };
    }
    const key = this.keyOf(completion.planId, completion.taskId);
    const existing = this.completions.get(key);
    if (existing !== undefined) {
      // Idempotency: a re-completion with the same envelope is suppressed
      // (catalog: idempotent delivery observed exactly once).
      if (JSON.stringify(existing) === JSON.stringify(completion)) {
        return { ok: true, value: existing };
      }
      // Divergent re-completion refused (never rewrite a completion).
      return {
        ok: false,
        error: planInvariant(`task ${completion.taskId} already has a divergent completion`),
      };
    }
    this.completions.set(key, completion);
    return { ok: true, value: completion };
  }

  getCompletion(planId: string, taskId: string): Result<TaskCompletionRecord, PlanError> {
    const record = this.completions.get(this.keyOf(planId, taskId));
    if (!record) return { ok: false, error: planNotFound("task completion") };
    return { ok: true, value: record };
  }

  listCompletions(planId: string): readonly TaskCompletionRecord[] {
    return Object.freeze([...this.completions.values()].filter((c) => c.planId === planId));
  }
}

export function createInMemoryTaskCompletionStore(): InMemoryTaskCompletionStore {
  return new InMemoryTaskCompletionStore();
}
