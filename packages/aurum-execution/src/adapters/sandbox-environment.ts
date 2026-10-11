/**
 * The SANDBOX execution environment (W006 adapters): a simulated isolated
 * workspace with realistic latency and deterministic failure injection —
 * the test double for capability class `sandbox`.
 *
 * Isolation: every submission gets its own per-ticket workspace (a private
 * scratch map seeded from the payload input). Steps may declare writes into
 * that workspace; no state ever crosses submissions (observable via
 * `controller.workspaceOf(ticket)`).
 *
 * Realism: a startup latency after acknowledgement, a per-step latency, and
 * a completion latency — all REAL asynchronous delays (default 1ms, so
 * awaited tests stay fast and per-ticket deterministic).
 *
 * Failure injection (deterministic, per environment configuration):
 * - `submitRejection` — submit itself rejects (transport failure path);
 * - `failAtStep` (1-based) — that step fails the execution (platform
 *   failure path — a failed envelope with error detail);
 * - `hangAfterSteps` — execution stops progressing after N completed steps
 *   (with a submission deadline this produces the timeout path).
 */
import {
  AurumBoundaryError,
  mintAurumSubmissionTicket,
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
import type { LocalWorkload, LocalWorkloadStep } from "./local-environment.js";
import { delay } from "./timers.js";

export interface SandboxEnvironmentConfig {
  readonly environmentId?: string;
  readonly variant?: string;
  readonly workloads: ReadonlyMap<string, LocalWorkload>;
  /** Latency between acknowledgement and start (default 1ms). */
  readonly startupLatencyMs?: number;
  /** Latency between steps (default 1ms). */
  readonly stepLatencyMs?: number;
  /** Injected submit rejection (transport failure path). */
  readonly submitRejection?: { readonly message: string };
  /** 1-based step index whose step FAILS (platform failure path). */
  readonly failAtStep?: number;
  /** Execution stops progressing after this many completed steps. */
  readonly hangAfterSteps?: number;
  /** Time source for deadline checks (default: wall clock). */
  readonly now?: () => number;
}

export interface SandboxEnvironmentController {
  /** Current platform state of one ticket (test observability). */
  stateOf(ticket: string): string | undefined;
  /** Isolated workspace snapshot of one ticket (isolation proofs). */
  workspaceOf(ticket: string): ReadonlyMap<string, string> | undefined;
}

type PlatformState = "pending" | "running" | "paused" | "settled" | "cancelled" | "failed";

interface SandboxRecord {
  readonly ticket: AurumSubmissionTicket;
  readonly submissionKey: string | undefined;
  readonly steps: readonly LocalWorkloadStep[];
  readonly deadlineEpochMs: number | undefined;
  readonly workspace: Map<string, string>;
  nextStep: number;
  state: PlatformState;
  output: string[];
  cost: { unit: string; quantity: number }[];
  failureMessage: string | undefined;
  completedSteps: number;
  driver: Promise<void> | undefined;
}

const TERMINAL: ReadonlySet<string> = new Set(["settled", "cancelled", "failed"]);

/** Narrows a platform state to the terminal union (for control outcomes). */
function terminalOf(
  state: "pending" | "running" | "paused" | "settled" | "cancelled" | "failed",
): "settled" | "cancelled" | "failed" | null {
  return state === "settled" || state === "cancelled" || state === "failed" ? state : null;
}

function parsePayload(
  payload: string,
  workloads: ReadonlyMap<string, LocalWorkload>,
  environmentId: string,
): { name: string; input: Record<string, unknown>; steps: readonly LocalWorkloadStep[] } {
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
  const workload = workloads.get(name);
  if (workload === undefined) {
    throw new AurumBoundaryError(
      "aurum-transport/submission-invalid",
      `unknown workload "${name}" for sandbox environment ${environmentId}`,
    );
  }
  const input =
    typeof record["input"] === "object" && record["input"] !== null
      ? (record["input"] as Record<string, unknown>)
      : {};
  const steps = typeof workload === "function" ? workload(input) : workload;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new AurumBoundaryError(
      "aurum-transport/submission-invalid",
      `workload "${name}" resolved to no steps`,
    );
  }
  return { name, input, steps };
}

/** Builds the sandbox environment bundle (environment + test controller). */
export function createSandboxEnvironment(
  config: SandboxEnvironmentConfig,
): { environment: ExecutionEnvironment; controller: SandboxEnvironmentController } {
  const environmentId = config.environmentId ?? "sandbox-env-1";
  const variant = config.variant ?? "default";
  const startupLatencyMs = config.startupLatencyMs ?? 1;
  const stepLatencyMs = config.stepLatencyMs ?? 1;
  const now = config.now ?? (() => Date.now());
  const records = new Map<string, SandboxRecord>();
  const bySubmissionKey = new Map<string, AurumSubmissionTicket>();
  let submissionCounter = 0;

  const descriptor: ExecutionEnvironmentDescriptor = {
    environmentId,
    environmentClass: "sandbox",
    variant,
    control: { cancellable: true, pausable: true, resumable: true },
    wired: true,
    notes: "simulated isolated workspace with latency + deterministic failure injection",
  };

  function ticketUnknown(ticket: string): never {
    throw new AurumBoundaryError(
      "aurum-transport/ticket-unknown",
      `no submission under ticket ${ticket} (sandbox environment ${environmentId})`,
    );
  }

  function evidenceRefOf(record: SandboxRecord): string {
    return `sandbox-env:${environmentId}:${record.ticket as string}`;
  }

  function envelopeOf(record: SandboxRecord): AurumTransportResultEnvelope {
    const cost = record.cost.length === 0 ? undefined : record.cost;
    if (record.state === "failed") {
      return {
        ticket: record.ticket,
        status: "failed",
        error: {
          code: "aurum-transport/internal" as const,
          message: record.failureMessage ?? "sandbox workload failed",
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
        evidenceRef: evidenceRefOf(record),
      };
    }
    return {
      ticket: record.ticket,
      status: record.state,
      ...(cost === undefined ? {} : { cost }),
      evidenceRef: evidenceRefOf(record),
    };
  }

  async function drive(record: SandboxRecord): Promise<void> {
    await delay(startupLatencyMs);
    if (record.state === "pending") record.state = "running";
    while (record.state === "running" && record.nextStep < record.steps.length) {
      if (record.deadlineEpochMs !== undefined && now() >= record.deadlineEpochMs) {
        return; // awaitCompletion enforces the deadline rejection
      }
      if (
        config.hangAfterSteps !== undefined &&
        record.completedSteps >= config.hangAfterSteps
      ) {
        return; // injected hang: no further progress
      }
      const step = record.steps[record.nextStep] as LocalWorkloadStep;
      await delay(stepLatencyMs);
      if (record.state !== "running") return; // paused/cancelled during latency
      if (config.failAtStep !== undefined && record.nextStep + 1 === config.failAtStep) {
        record.state = "failed";
        record.failureMessage = `injected sandbox failure at step ${config.failAtStep} (${step.label})`;
        return;
      }
      if (step.output !== undefined) record.output.push(step.output);
      for (const line of step.cost ?? []) record.cost.push({ ...line });
      record.nextStep += 1;
      record.completedSteps += 1;
    }
    if (record.state === "running") record.state = "settled";
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
      if (config.submitRejection !== undefined) {
        throw new AurumBoundaryError(
          "aurum-transport/transport-closed",
          config.submitRejection.message,
        );
      }
      const parsed = parsePayload(spec.payload, config.workloads, environmentId);
      submissionCounter += 1;
      const ticket = mintAurumSubmissionTicket(`sandbox:${environmentId}:${submissionCounter}`);
      const workspace = new Map<string, string>();
      for (const [key, value] of Object.entries(parsed.input)) {
        workspace.set(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      const record: SandboxRecord = {
        ticket,
        submissionKey: spec.submissionKey,
        steps: parsed.steps,
        deadlineEpochMs: spec.deadlineEpochMs,
        workspace,
        nextStep: 0,
        state: "pending",
        output: [],
        cost: [],
        failureMessage: undefined,
        completedSteps: 0,
        driver: undefined,
      };
      records.set(ticket as string, record);
      if (spec.submissionKey !== undefined) {
        bySubmissionKey.set(spec.submissionKey, ticket);
      }
      record.driver = drive(record);
      return { ticket, state: "pending", replay: false };
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
      const pollIntervalMs = Math.max(1, options?.pollIntervalMs ?? 2);
      for (;;) {
        if (TERMINAL.has(record.state)) return envelopeOf(record);
        if (options?.signal?.aborted) {
          throw new AurumBoundaryError(
            "aurum-transport/await-aborted",
            "await aborted by signal",
          );
        }
        if (record.deadlineEpochMs !== undefined && now() >= record.deadlineEpochMs) {
          throw new AurumBoundaryError(
            "aurum-transport/deadline-exceeded",
            `deadline ${record.deadlineEpochMs} passed before settlement`,
          );
        }
        await delay(pollIntervalMs);
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
      record.driver = drive(record);
      return { outcome: "applied", state: "running" };
    },
  };

  const controller: SandboxEnvironmentController = {
    stateOf(ticket: string): string | undefined {
      return records.get(ticket)?.state;
    },
    workspaceOf(ticket: string): ReadonlyMap<string, string> | undefined {
      return records.get(ticket)?.workspace;
    },
  };

  return {
    environment: { descriptor, transport, pausable },
    controller,
  };
}
