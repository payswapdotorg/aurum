/**
 * The LOCAL execution environment (W006 adapters): an in-process, REAL-for-
 * tests implementation of the W001 ExecutionTransportPort for capability
 * class `local` (the ZCode local workspace substrate's double — no process
 * is spawned, no IO happens; this is the deterministic in-process stand-in
 * the catalog mandates for W006).
 *
 * Workloads are step scripts supplied at composition:
 *   payload = {"workload": "<name>", "input": <json>} (opaque to the port)
 *   steps   = [{label, output?, cost?, failWith?}]
 * The environment provides REAL port semantics around them: idempotent
 * submission (same submissionKey → same ticket, `replay`, never executes
 * twice), poll/await/cancel, pause/resume between steps, deadline
 * enforcement, typed boundary errors, and deterministic evidence refs.
 *
 * Two drive modes:
 * - "auto" (default): steps advance on a microtask chain — an awaited
 *   submission completes deterministically without test poking;
 * - "manual": steps advance ONLY on `controller.release(n)` — precise
 *   mid-flight control for pause/resume/cancel proofs.
 */
import {
  AurumBoundaryError,
  mintAurumSubmissionTicket,
  type AurumBoundaryErrorCode,
  type AurumExecutionTransportPort,
  type AurumPausableTransportPort,
  type AurumSubmissionTicket,
  type AurumTransportAwaitOptions,
  type AurumTransportControlOutcome,
  type AurumTransportProgressSnapshot,
  type AurumTransportResultEnvelope,
  type AurumTransportSubmissionAck,
  type AurumTransportSubmissionSpec,
} from "@zcode/shared/aurum-boundary";
import type { ExecutionEnvironment } from "../domain/ports.js";
import type { ExecutionEnvironmentDescriptor } from "../domain/vocabulary.js";
import { delay } from "./timers.js";

/** One workload step: output chunk, cost lines, or an injected failure. */
export interface LocalWorkloadStep {
  readonly label: string;
  /** Appended to the result payload when the step completes. */
  readonly output?: string;
  readonly cost?: readonly { readonly unit: string; readonly quantity: number }[];
  /** When present, the step fails the execution with this detail. */
  readonly failWith?: { readonly message: string; readonly code?: AurumBoundaryErrorCode };
}

/** A workload: a step list, or a function deriving one from the input. */
export type LocalWorkload =
  | readonly LocalWorkloadStep[]
  | ((input: unknown) => readonly LocalWorkloadStep[]);

export interface LocalEnvironmentConfig {
  readonly environmentId?: string;
  readonly variant?: string;
  readonly workloads: ReadonlyMap<string, LocalWorkload>;
  /** "auto" (default): microtask advancement; "manual": controller-driven. */
  readonly mode?: "auto" | "manual";
  /** Time source for deadline checks (default: wall clock). */
  readonly now?: () => number;
}

export interface LocalEnvironmentController {
  /** Runs `count` steps (default 1) on every in-flight execution. */
  release(count?: number): void;
  /** Drives every in-flight execution to a terminal state. */
  releaseAll(): void;
  /** Current platform state of one ticket (test observability). */
  stateOf(ticket: string): string | undefined;
}

type PlatformState = "pending" | "running" | "paused" | "settled" | "cancelled" | "failed";

interface LocalExecutionRecord {
  readonly ticket: AurumSubmissionTicket;
  readonly submissionKey: string | undefined;
  readonly steps: readonly LocalWorkloadStep[];
  readonly deadlineEpochMs: number | undefined;
  nextStep: number;
  state: PlatformState;
  output: string[];
  cost: { unit: string; quantity: number }[];
  failureMessage: string | undefined;
  failureCode: AurumBoundaryErrorCode | undefined;
  scheduled: boolean;
}

const TERMINAL: ReadonlySet<string> = new Set(["settled", "cancelled", "failed"]);

/** Narrows a platform state to the terminal union (for control outcomes). */
function terminalOf(
  state: "pending" | "running" | "paused" | "settled" | "cancelled" | "failed",
): "settled" | "cancelled" | "failed" | null {
  return state === "settled" || state === "cancelled" || state === "failed" ? state : null;
}

/** Builds the local environment bundle (environment + test controller). */
export function createLocalEnvironment(config: LocalEnvironmentConfig): {
  environment: ExecutionEnvironment;
  controller: LocalEnvironmentController;
} {
  const environmentId = config.environmentId ?? "local-env-1";
  const variant = config.variant ?? "default";
  const mode = config.mode ?? "auto";
  const now = config.now ?? (() => Date.now());
  const records = new Map<string, LocalExecutionRecord>();
  const bySubmissionKey = new Map<string, AurumSubmissionTicket>();
  let submissionCounter = 0;

  const descriptor: ExecutionEnvironmentDescriptor = {
    environmentId,
    environmentClass: "local",
    variant,
    control: { cancellable: true, pausable: true, resumable: true },
    wired: true,
    notes: "in-process local workspace double (deterministic step scripts)",
  };

  function ticketUnknown(ticket: string): never {
    throw new AurumBoundaryError(
      "aurum-transport/ticket-unknown",
      `no submission under ticket ${ticket} (local environment ${environmentId})`,
    );
  }

  function parsePayload(payload: string): {
    name: string;
    input: unknown;
    steps: readonly LocalWorkloadStep[];
  } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      throw new AurumBoundaryError(
        "aurum-transport/submission-invalid",
        `payload is not valid JSON: ${String(error)}`,
      );
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new AurumBoundaryError(
        "aurum-transport/submission-invalid",
        "payload must be a JSON object {workload, input}",
      );
    }
    const record = parsed as Record<string, unknown>;
    const name = record["workload"];
    if (typeof name !== "string" || name.length === 0) {
      throw new AurumBoundaryError(
        "aurum-transport/submission-invalid",
        "payload.workload must be a non-empty string",
      );
    }
    const workload = config.workloads.get(name);
    if (workload === undefined) {
      throw new AurumBoundaryError(
        "aurum-transport/submission-invalid",
        `unknown workload "${name}" for local environment ${environmentId}`,
      );
    }
    const input = record["input"];
    const steps = typeof workload === "function" ? workload(input) : workload;
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new AurumBoundaryError(
        "aurum-transport/submission-invalid",
        `workload "${name}" resolved to no steps`,
      );
    }
    return { name, input, steps };
  }

  function schedule(record: LocalExecutionRecord): void {
    if (record.scheduled || mode === "manual" || record.state !== "running") return;
    record.scheduled = true;
    void Promise.resolve().then(() => {
      record.scheduled = false;
      runNextStep(record);
    });
  }

  function runNextStep(record: LocalExecutionRecord): void {
    if (record.state !== "running") return;
    if (record.nextStep >= record.steps.length) {
      record.state = "settled";
      return;
    }
    const step = record.steps[record.nextStep] as LocalWorkloadStep;
    if (step.failWith !== undefined) {
      record.state = "failed";
      record.failureMessage = step.failWith.message;
      record.failureCode = step.failWith.code ?? "aurum-transport/internal";
      return;
    }
    if (step.output !== undefined) record.output.push(step.output);
    for (const line of step.cost ?? []) record.cost.push({ ...line });
    record.nextStep += 1;
    if (record.nextStep >= record.steps.length) {
      record.state = "settled";
      return;
    }
    schedule(record);
  }

  function envelopeOf(record: LocalExecutionRecord): AurumTransportResultEnvelope {
    const evidenceRef = `local-env:${environmentId}:${record.ticket as string}`;
    const cost = record.cost.length === 0 ? undefined : record.cost;
    if (record.state === "failed") {
      return {
        ticket: record.ticket,
        status: "failed",
        error: {
          code: record.failureCode ?? "aurum-transport/internal",
          message: record.failureMessage ?? "local workload failed",
          retryable: false,
        },
      };
    }
    if (record.state === "settled") {
      const result = record.output.join("");
      return {
        ticket: record.ticket,
        status: "settled",
        ...(result === "" ? {} : { result }),
        ...(cost === undefined ? {} : { cost }),
        evidenceRef,
      };
    }
    return {
      ticket: record.ticket,
      status: record.state,
      ...(cost === undefined ? {} : { cost }),
      evidenceRef,
    };
  }

  const transport: AurumExecutionTransportPort = {
    async submit(spec: AurumTransportSubmissionSpec): Promise<AurumTransportSubmissionAck> {
      if (spec.submissionKey !== undefined) {
        const existing = bySubmissionKey.get(spec.submissionKey);
        if (existing !== undefined) {
          const record = records.get(existing as string);
          return { ticket: existing, state: record?.state ?? "pending", replay: true };
        }
      }
      const parsed = parsePayload(spec.payload);
      submissionCounter += 1;
      const ticket = mintAurumSubmissionTicket(`local:${environmentId}:${submissionCounter}`);
      const record: LocalExecutionRecord = {
        ticket,
        submissionKey: spec.submissionKey,
        steps: parsed.steps,
        deadlineEpochMs: spec.deadlineEpochMs,
        nextStep: 0,
        state: mode === "auto" ? "running" : "pending",
        output: [],
        cost: [],
        failureMessage: undefined,
        failureCode: undefined,
        scheduled: false,
      };
      records.set(ticket as string, record);
      if (spec.submissionKey !== undefined) {
        bySubmissionKey.set(spec.submissionKey, ticket);
      }
      schedule(record);
      return { ticket, state: record.state, replay: false };
    },

    async poll(ticket: AurumSubmissionTicket): Promise<AurumTransportProgressSnapshot> {
      const record = records.get(ticket as string);
      if (record === undefined) ticketUnknown(ticket as string);
      return {
        ticket,
        state: record.state,
        ...(TERMINAL.has(record.state) ? { envelope: envelopeOf(record) } : {}),
      };
    },

    async awaitCompletion(
      ticket: AurumSubmissionTicket,
      options?: AurumTransportAwaitOptions,
    ): Promise<AurumTransportResultEnvelope> {
      const record = records.get(ticket as string);
      if (record === undefined) ticketUnknown(ticket as string);
      const pollIntervalMs = options?.pollIntervalMs ?? 5;
      for (;;) {
        if (TERMINAL.has(record.state)) return envelopeOf(record);
        if (options?.signal?.aborted) {
          throw new AurumBoundaryError("aurum-transport/await-aborted", "await aborted by signal");
        }
        if (record.deadlineEpochMs !== undefined && now() >= record.deadlineEpochMs) {
          throw new AurumBoundaryError(
            "aurum-transport/deadline-exceeded",
            `deadline ${record.deadlineEpochMs} passed before settlement`,
          );
        }
        await delay(Math.max(1, pollIntervalMs));
      }
    },

    async cancel(ticket: AurumSubmissionTicket): Promise<AurumTransportControlOutcome> {
      const record = records.get(ticket as string);
      if (record === undefined) ticketUnknown(ticket as string);
      const cancelledTerminal = terminalOf(record.state);
      if (cancelledTerminal !== null) {
        return { outcome: "already-terminal", state: cancelledTerminal };
      }
      record.state = "cancelled";
      return { outcome: "applied", state: "cancelled" };
    },
  };

  const pausable: AurumPausableTransportPort = {
    async pause(ticket: AurumSubmissionTicket): Promise<AurumTransportControlOutcome> {
      const record = records.get(ticket as string);
      if (record === undefined) ticketUnknown(ticket as string);
      const pausedTerminal = terminalOf(record.state);
      if (pausedTerminal !== null) {
        return { outcome: "already-terminal", state: pausedTerminal };
      }
      record.state = "paused";
      return { outcome: "applied", state: "paused" };
    },
    async resume(ticket: AurumSubmissionTicket): Promise<AurumTransportControlOutcome> {
      const record = records.get(ticket as string);
      if (record === undefined) ticketUnknown(ticket as string);
      const resumedTerminal = terminalOf(record.state);
      if (resumedTerminal !== null) {
        return { outcome: "already-terminal", state: resumedTerminal };
      }
      if (record.state !== "paused") {
        throw new AurumBoundaryError(
          "aurum-transport/control-unsupported",
          "resume requires a paused submission",
        );
      }
      record.state = "running";
      schedule(record);
      return { outcome: "applied", state: "running" };
    },
  };

  const controller: LocalEnvironmentController = {
    release(count = 1): void {
      for (const record of records.values()) {
        if (record.state === "pending") {
          record.state = "running";
        }
        if (record.state !== "running") continue;
        for (let i = 0; i < count; i += 1) {
          if (record.state !== "running") break;
          runNextStep(record);
        }
        schedule(record);
      }
    },
    releaseAll(): void {
      for (const record of records.values()) {
        if (record.state === "pending") record.state = "running";
      }
      let guard = 0;
      let progressed = true;
      while (progressed && guard < 10_000) {
        progressed = false;
        guard += 1;
        for (const record of records.values()) {
          if (record.state === "running" && record.nextStep < record.steps.length) {
            runNextStep(record);
            progressed = true;
          }
        }
      }
    },
    stateOf(ticket: string): string | undefined {
      return records.get(ticket)?.state;
    },
  };

  return {
    environment: { descriptor, transport, pausable },
    controller,
  };
}
