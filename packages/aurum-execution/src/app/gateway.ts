/**
 * The Agent Gateway (W006 app layer) — the composition point between Aurum
 * semantics and platform execution.
 *
 * Canonical flow (spec/ZCODE-SUBSTRATE-MAP.md):
 *   execution request (citing domain authority — action id/audit ref)
 *   -> environment selection by capability (semantic registry, fail-closed
 *      wiring gate)
 *   -> W001 seam handle acquisition (opaque, never persisted — the session
 *      persists the capabilityId instead)
 *   -> submit through the boundary's ExecutionTransportPort (idempotent per
 *      submission key) -> lifecycle tracking (start/pause/resume/cancel)
 *   -> settlement as NORMALIZED evidence (result/cost/evidenceRef + authority
 *      echo), returned to the caller.
 *
 * THE AUTHORITY LAW: the gateway settles results and failures as typed error
 * results + execution-plane journal events. It NEVER mutates semantic state:
 * there are no domain-package imports anywhere in this package's src —
 * callers record results through the domain seams themselves. Runtime
 * failures (adapter throws, transport failures, timeouts) settle the SESSION
 * (execution-local runtime state) and never the kernel.
 *
 * Error/settlement duality (mirrors the W001 port's rejection/resolve split):
 * - platform-reported failures (failed envelopes) resolve as ok(settlement)
 *   with status "failed" — the execution's own outcome;
 * - wait-level failures (deadline exceeded, transport rejections) return
 *   typed errors and additionally settle the session failed for durability;
 *   caller aborts leave the session re-awaitable;
 * - control-request failures (pause/resume/cancel) return typed errors and
 *   leave the in-flight session untouched (the control failed, not the
 *   execution).
 *
 * The operation bodies live in gateway-submission.ts (submit/await) and
 * gateway-controls.ts (pause/resume/cancel); this module owns the surface.
 */
import type { AurumSeamRegistry } from "@zcode/shared/aurum-boundary";
import type { ExecutionError, Result } from "../domain/errors.js";
import type { ExecutionRequestId, ExecutionScope } from "../domain/ids.js";
import type { ExecutionSettlement } from "../domain/envelope.js";
import type { ExecutionRequest, ExecutionSession } from "../domain/session.js";
import type {
  ExecutionClock,
  ExecutionEnvironmentRegistry,
  ExecutionIdGenerator,
  ExecutionJournal,
  ExecutionSessionFilter,
  ExecutionSessionStore,
} from "../domain/ports.js";
import type { AwaitSettledOptions, GatewayCoreDeps } from "./gateway-support.js";
import { runRecovery, type RecoveryReport } from "./recovery.js";
import {
  submitExecutionOperation,
  awaitSettledOperation,
  type ExecutionSubmissionOutcome,
} from "./gateway-submission.js";
import { cancelRequest, controlRequest } from "./gateway-controls.js";

/** Gateway dependencies (all ports; adapters are replaceable behind them). */
export interface AgentGatewayDeps extends GatewayCoreDeps {
  readonly environments: ExecutionEnvironmentRegistry;
  readonly seam: AurumSeamRegistry;
  readonly sessions: ExecutionSessionStore;
  readonly journal: ExecutionJournal;
  readonly clock: ExecutionClock;
  readonly ids: ExecutionIdGenerator;
}

/** Result of accepting an execution request. */
export interface ExecutionSubmission extends ExecutionSubmissionOutcome {}

export type { AwaitSettledOptions } from "./gateway-support.js";

/** The Agent Gateway public surface (8 methods; policy limit is 12). */
export interface AgentGateway {
  submitExecution(
    scope: ExecutionScope,
    request: ExecutionRequest,
  ): Promise<Result<ExecutionSubmission, ExecutionError>>;
  getExecution(
    scope: ExecutionScope,
    requestId: ExecutionRequestId,
  ): Result<ExecutionSession, ExecutionError>;
  awaitSettled(
    scope: ExecutionScope,
    requestId: ExecutionRequestId,
    options?: AwaitSettledOptions,
  ): Promise<Result<ExecutionSettlement, ExecutionError>>;
  pauseExecution(
    scope: ExecutionScope,
    requestId: ExecutionRequestId,
  ): Promise<Result<ExecutionSession, ExecutionError>>;
  resumeExecution(
    scope: ExecutionScope,
    requestId: ExecutionRequestId,
  ): Promise<Result<ExecutionSession, ExecutionError>>;
  cancelExecution(
    scope: ExecutionScope,
    requestId: ExecutionRequestId,
  ): Promise<Result<ExecutionSettlement, ExecutionError>>;
  recoverInterrupted(scope: ExecutionScope): Promise<Result<RecoveryReport, ExecutionError>>;
  listExecutions(
    scope: ExecutionScope,
    filter?: ExecutionSessionFilter,
  ): readonly ExecutionSession[];
}

/** Builds the Agent Gateway over its ports. */
export function createAgentGateway(deps: AgentGatewayDeps): AgentGateway {
  const core: GatewayCoreDeps = deps;
  return {
    async submitExecution(scope, request) {
      return submitExecutionOperation(core, scope, request);
    },
    getExecution(scope, requestId) {
      return deps.sessions.getSession(scope.tenantId, requestId);
    },
    async awaitSettled(scope, requestId, options) {
      return awaitSettledOperation(core, scope, requestId, options);
    },
    async pauseExecution(scope, requestId) {
      return controlRequest(core, scope, requestId, "pause");
    },
    async resumeExecution(scope, requestId) {
      return controlRequest(core, scope, requestId, "resume");
    },
    async cancelExecution(scope, requestId) {
      return cancelRequest(core, scope, requestId);
    },
    async recoverInterrupted(scope) {
      return runRecovery(core, scope);
    },
    listExecutions(scope, filter) {
      return deps.sessions.listSessions(scope.tenantId, filter);
    },
  };
}
