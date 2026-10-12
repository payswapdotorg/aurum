/**
 * Deterministic in-process execution substrate double (W009 adapter).
 *
 * Catalog clause 5: "the execution-substrate adapter ... + a deterministic
 * in-process double for tests". This double implements the
 * `ExecutionSubstratePort` directly (no `@aurum/execution` import) — it
 * simulates the W006 Agent Gateway's behavior in-process: idempotent
 * submission (one settlement per submission key), exactly-once settlement,
 * typed errors, deterministic clock.
 *
 * The double MIRRORS the W006 semantics (per `packages/aurum-execution`):
 * - `submitPlanTask` is idempotent per `submissionKey` derived from
 *   `(planId, taskId, attempt)` — a replay returns the SAME settlement.
 * - `cancelPlanTask` settles the task cancelled (or reports already-terminal).
 * - `awaitPlanTaskSettlement` returns the recorded settlement (idempotent).
 *
 * The double is configured with a per-task "script" (a deterministic
 * function from payload → settlement) so tests can drive specific outcomes
 * (settled / cancelled / failed). Defaults to a successful settlement
 * (status `settled`, empty result payload).
 *
 * The real `@aurum/execution` Agent Gateway adapter lives in
 * `w006-substrate-adapter.ts` (a thin pass-through, gated behind CR-W009
 * package wiring).
 */
import { ok, type Result, type TenantScope } from "@aurum/domain";
import { planValidationError, planNotFound, type PlanError } from "../domain/errors.js";
import type { ExecutionSubstratePort, TaskSettlementEcho } from "../domain/ports.js";
import type { PlanEnvironmentClass } from "../domain/vocabulary.js";

/** A deterministic script the double uses to produce a settlement. */
export type SubstrateScript = (input: {
  readonly planId: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly payload: string;
  readonly payloadMediaType: string;
}) => TaskSettlementEcho;

/** Configuration for the in-process double. */
export interface InProcessSubstrateConfig {
  /** Default script applied when no per-task script is registered. */
  readonly defaultScript?: SubstrateScript;
  /** Per-task overrides (keyed by `${planId}\0${taskId}`). */
  readonly scripts?: ReadonlyMap<string, SubstrateScript>;
  /** Optional deterministic clock (epoch ms; defaults to a counter). */
  readonly now?: () => number;
}

/** A submitted task's recorded settlement in the in-process double. */
interface SubmittedTask {
  readonly submissionKey: string;
  readonly requestId: string;
  readonly environmentClass: PlanEnvironmentClass;
  readonly environmentVariant?: string;
  readonly payload: string;
  readonly payloadMediaType: string;
  readonly authority: { readonly actionId?: string; readonly auditRef?: string };
  readonly deadlineEpochMs?: number;
  readonly attempt: number;
  readonly settlement: TaskSettlementEcho;
}

function defaultScript(input: {
  readonly planId: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly payload: string;
  readonly payloadMediaType: string;
}): TaskSettlementEcho {
  return {
    requestId: `req-${input.planId}-${input.taskId}-${input.attempt}`,
    status: "settled",
    settledAt: 0,
  };
}

export class InProcessExecutionSubstrate implements ExecutionSubstratePort {
  private readonly submissions = new Map<string, SubmittedTask>();
  private readonly config: InProcessSubstrateConfig;
  private readonly counter: { value: number };

  constructor(config: InProcessSubstrateConfig = {}) {
    this.config = config;
    this.counter = { value: 0 };
  }

  private nextRequestId(planId: string, taskId: string, attempt: number): string {
    return `req-${planId}-${taskId}-${attempt}`;
  }

  private submissionKeyOf(planId: string, taskId: string, attempt: number): string {
    return `${planId}\0${taskId}\0${attempt}`;
  }

  private scriptFor(planId: string, taskId: string): SubstrateScript {
    const key = `${planId}\0${taskId}`;
    return this.config.scripts?.get(key) ?? this.config.defaultScript ?? defaultScript;
  }

  private now(): number {
    if (this.config.now) return this.config.now();
    this.counter.value += 1;
    return this.counter.value;
  }

  async submitPlanTask(
    scope: TenantScope,
    request: {
      readonly planId: string;
      readonly taskId: string;
      readonly environmentClass: PlanEnvironmentClass;
      readonly environmentVariant?: string;
      readonly payload: string;
      readonly payloadMediaType: string;
      readonly authority: { readonly actionId?: string; readonly auditRef?: string };
      readonly deadlineEpochMs?: number;
      readonly attempt: number;
    },
  ): Promise<
    Result<
      { readonly requestId: string; readonly settlement: TaskSettlementEcho },
      PlanError
    >
  > {
    if (!request?.planId || !request?.taskId) {
      return {
        ok: false,
        error: planValidationError([
          { field: "planId", problem: "planId and taskId are required" },
        ]),
      };
    }
    const submissionKey = this.submissionKeyOf(
      request.planId,
      request.taskId,
      request.attempt,
    );
    const existing = this.submissions.get(submissionKey);
    if (existing !== undefined) {
      // Idempotent duplicate: same submission key returns the same settlement
      // (mirrors the W006 gateway's exactly-once settlement law).
      return ok({ requestId: existing.requestId, settlement: existing.settlement });
    }
    const script = this.scriptFor(request.planId, request.taskId);
    const settlement = script({
      planId: request.planId,
      taskId: request.taskId,
      attempt: request.attempt,
      payload: request.payload,
      payloadMediaType: request.payloadMediaType,
    });
    // Override the requestId to be deterministic from (planId, taskId, attempt).
    const fixedSettlement: TaskSettlementEcho = {
      ...settlement,
      requestId: this.nextRequestId(request.planId, request.taskId, request.attempt),
      settledAt: settlement.settledAt || this.now(),
    };
    const submitted: SubmittedTask = {
      submissionKey,
      requestId: fixedSettlement.requestId,
      environmentClass: request.environmentClass,
      ...(request.environmentVariant ? { environmentVariant: request.environmentVariant } : {}),
      payload: request.payload,
      payloadMediaType: request.payloadMediaType,
      authority: request.authority,
      ...(request.deadlineEpochMs ? { deadlineEpochMs: request.deadlineEpochMs } : {}),
      attempt: request.attempt,
      settlement: fixedSettlement,
    };
    this.submissions.set(submissionKey, submitted);
    return ok({ requestId: submitted.requestId, settlement: fixedSettlement });
  }

  async awaitPlanTaskSettlement(
    scope: TenantScope,
    request: {
      readonly planId: string;
      readonly taskId: string;
      readonly attempt: number;
    },
  ): Promise<Result<TaskSettlementEcho, PlanError>> {
    const submissionKey = this.submissionKeyOf(
      request.planId,
      request.taskId,
      request.attempt,
    );
    const existing = this.submissions.get(submissionKey);
    if (!existing) {
      return { ok: false, error: planNotFound("task submission") };
    }
    return ok(existing.settlement);
  }

  async cancelPlanTask(
    scope: TenantScope,
    request: {
      readonly planId: string;
      readonly taskId: string;
      readonly attempt: number;
    },
  ): Promise<Result<TaskSettlementEcho, PlanError>> {
    const submissionKey = this.submissionKeyOf(
      request.planId,
      request.taskId,
      request.attempt,
    );
    const existing = this.submissions.get(submissionKey);
    if (!existing) {
      return { ok: false, error: planNotFound("task submission") };
    }
    // Already terminal? Idempotent: return the existing settlement.
    if (
      existing.settlement.status === "settled" ||
      existing.settlement.status === "cancelled" ||
      existing.settlement.status === "failed"
    ) {
      return ok(existing.settlement);
    }
    // Settle cancelled.
    const cancelled: TaskSettlementEcho = {
      requestId: existing.requestId,
      status: "cancelled",
      settledAt: this.now(),
    };
    const updated: SubmittedTask = { ...existing, settlement: cancelled };
    this.submissions.set(submissionKey, updated);
    return ok(cancelled);
  }
}

export function createInProcessExecutionSubstrate(
  config?: InProcessSubstrateConfig,
): InProcessExecutionSubstrate {
  return new InProcessExecutionSubstrate(config);
}

/**
 * Helper for tests: a script that produces a settled settlement with an
 * opaque result payload.
 */
export function settledScript(result: string): SubstrateScript {
  return (input) => ({
    requestId: `req-${input.planId}-${input.taskId}-${input.attempt}`,
    status: "settled",
    settledAt: 0,
    ...(result ? { result } : {}),
  });
}

/** Helper for tests: a script that produces a failed settlement. */
export function failedScript(
  failure: { readonly kind: string; readonly code: string; readonly message: string; readonly retryable: boolean },
): SubstrateScript {
  return (input) => ({
    requestId: `req-${input.planId}-${input.taskId}-${input.attempt}`,
    status: "failed",
    settledAt: 0,
    failure,
  });
}

/** Helper for tests: a script that produces a cancelled settlement. */
export function cancelledScript(): SubstrateScript {
  return (input) => ({
    requestId: `req-${input.planId}-${input.taskId}-${input.attempt}`,
    status: "cancelled",
    settledAt: 0,
  });
}
