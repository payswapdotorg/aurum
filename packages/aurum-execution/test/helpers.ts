/**
 * W006 test helpers: deterministic composition for the execution plane.
 *
 * Imports follow the module boundary rules: the execution surface comes from
 * the PUBLIC package contract (../src/index.js) — the same boundary other
 * modules will use. The W001 boundary types used by assertions come from
 * @zcode/shared/aurum-boundary (the declared platform seam, requires:
 * [shared]). The real domain kernel is imported ONLY by the authority-law
 * proof (authority-law.test.ts) as the semantic-state oracle — production
 * src has zero domain imports (tripwire-locked there).
 */
import { expect } from "vitest";
import type { AurumSeamRegistry } from "@zcode/shared/aurum-boundary";
import {
  createAgentGateway,
  createInMemoryJournal,
  createInMemorySessionStore,
  createInProcessEnvironmentRegistry,
  createLocalEnvironment,
  createSandboxEnvironment,
  createStandardStubEnvironments,
  executionScope,
  asExecutionRequestId,
  SequentialIdGenerator,
  SteppingEpochClock,
  type AgentGateway,
  type ExecutionEnvironmentRegistry,
  type ExecutionJournal,
  type ExecutionRequest,
  type ExecutionScope,
  type ExecutionSession,
  type ExecutionSessionStore,
  type LocalEnvironmentController,
  type LocalWorkload,
  type SandboxEnvironmentConfig,
  type SandboxEnvironmentController,
} from "../src/index.js";
import type { ExecutionError } from "../src/index.js";

export const T0 = 1_700_000_000_000;

/** Standard deterministic workloads shared by the suites. */
export const WORKLOADS: ReadonlyMap<string, LocalWorkload> = new Map<string, LocalWorkload>([
  ["echo", [{ label: "echo", output: "echoed" }]],
  [
    "multi",
    [
      { label: "one", output: "a", cost: [{ unit: "cpu-ms", quantity: 10 }] },
      { label: "two", output: "b", cost: [{ unit: "cpu-ms", quantity: 15 }] },
      { label: "three", output: "c" },
    ],
  ],
  ["boom", [{ label: "will-fail", failWith: { message: "injected boom" } }]],
  ["inputEcho", (input: unknown) => [{ label: "echo-input", output: JSON.stringify(input) ?? "" }]],
  [
    "isolated",
    (input: unknown) => {
      const record = (input ?? {}) as Record<string, unknown>;
      const slot = typeof record["slot"] === "string" ? record["slot"] : "default";
      return [{ label: "write", output: `wrote:${slot}` }];
    },
  ],
]);

/** Builds a workload payload (the opaque JSON convention of the doubles). */
export function payloadOf(workload: string, input: unknown = {}): string {
  return JSON.stringify({ workload, input });
}

export function scopeOf(tenantId: string): ExecutionScope {
  const result = executionScope(tenantId);
  if (!result.ok) throw new Error(`test setup: invalid tenant ${tenantId}`);
  return result.value;
}

export function requestIdOf(value: string): ReturnType<typeof asExecutionRequestId> {
  const result = asExecutionRequestId(value);
  if (!result.ok) throw new Error(`test setup: invalid request id ${value}`);
  return result.value;
}

/** Narrowing helpers (assert + return, keeps suites terse). */
export function okOf<T>(result: { ok: true; value: T } | { ok: false; error: ExecutionError }): T {
  expect(result.ok, `expected ok, got: ${result.ok ? "" : result.error.message}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

export function errOf<T>(
  result: { ok: true; value: T } | { ok: false; error: ExecutionError },
): ExecutionError {
  expect(result.ok, `expected error, got: ${JSON.stringify(result.ok ? result.value : "")}`).toBe(
    false,
  );
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

/** A standard execution request citing domain authority. */
export function requestOf(
  requestId: string,
  options: {
    workload?: string;
    input?: unknown;
    environmentClass?: ExecutionRequest["environmentClass"];
    variant?: string;
    authority?: { actionId?: string; auditRef?: string };
    modelBindingRef?: string;
    deadlineEpochMs?: number;
  } = {},
): ExecutionRequest {
  return {
    requestId: requestIdOf(requestId),
    authority: options.authority ?? { actionId: "act-1", auditRef: "audit-9" },
    environmentClass: options.environmentClass ?? "local",
    ...(options.variant === undefined ? {} : { variant: options.variant }),
    payload: payloadOf(options.workload ?? "multi", options.input ?? {}),
    payloadMediaType: "application/json",
    ...(options.modelBindingRef === undefined
      ? {}
      : { occupancy: { modelBindingRef: options.modelBindingRef } }),
    ...(options.deadlineEpochMs === undefined ? {} : { deadlineEpochMs: options.deadlineEpochMs }),
  };
}

export interface ExecutionHarness {
  readonly gateway: AgentGateway;
  readonly sessions: ExecutionSessionStore;
  readonly journal: ExecutionJournal;
  readonly registry: ExecutionEnvironmentRegistry;
  readonly seam: AurumSeamRegistry;
  readonly clock: SteppingEpochClock;
  readonly local: LocalEnvironmentController | null;
  readonly sandbox: SandboxEnvironmentController | null;
}

/** Composes a gateway over the local double (+ the four fail-closed stubs). */
export function localHarness(options: { mode?: "auto" | "manual" } = {}): ExecutionHarness {
  const local = createLocalEnvironment({
    environmentId: "local-1",
    workloads: WORKLOADS,
    mode: options.mode ?? "auto",
  });
  const sandbox = createSandboxEnvironment({
    environmentId: "sandbox-1",
    workloads: WORKLOADS,
  });
  const { registry, seam } = createInProcessEnvironmentRegistry([
    local.environment,
    sandbox.environment,
    ...createStandardStubEnvironments(),
  ]);
  const sessions = createInMemorySessionStore();
  const journal = createInMemoryJournal();
  const clock = new SteppingEpochClock(T0, 1000);
  const gateway = createAgentGateway({
    environments: registry,
    seam,
    sessions,
    journal,
    clock,
    ids: new SequentialIdGenerator("journal"),
  });
  return {
    gateway,
    sessions,
    journal,
    registry,
    seam,
    clock,
    local: local.controller,
    sandbox: sandbox.controller,
  };
}

/** Composes a gateway whose SANDBOX double is the wired sandbox capability. */
export function sandboxHarness(config: SandboxEnvironmentConfig = {}): ExecutionHarness {
  const local = createLocalEnvironment({
    environmentId: "local-1",
    workloads: WORKLOADS,
  });
  const sandbox = createSandboxEnvironment({
    environmentId: "sandbox-1",
    workloads: WORKLOADS,
    ...config,
  });
  const { registry, seam } = createInProcessEnvironmentRegistry([
    local.environment,
    sandbox.environment,
    ...createStandardStubEnvironments(),
  ]);
  const sessions = createInMemorySessionStore();
  const journal = createInMemoryJournal();
  const clock = new SteppingEpochClock(T0, 1000);
  const gateway = createAgentGateway({
    environments: registry,
    seam,
    sessions,
    journal,
    clock,
    ids: new SequentialIdGenerator("journal"),
  });
  return {
    gateway,
    sessions,
    journal,
    registry,
    seam,
    clock,
    local: local.controller,
    sandbox: sandbox.controller,
  };
}

/** Journal kinds recorded for one request, in order. */
export function journalKindsOf(
  harness: ExecutionHarness,
  scope: ExecutionScope,
  requestId: string,
): string[] {
  return harness.journal
    .listEntries(scope.tenantId, requestIdOf(requestId))
    .map((entry) => entry.kind as string);
}

/** Byte-stable snapshot of one session (for immutability proofs). */
export function snapshotOf(session: ExecutionSession): string {
  return JSON.stringify(session);
}
