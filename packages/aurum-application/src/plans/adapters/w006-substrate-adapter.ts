/**
 * W006 Agent Gateway substrate adapter (W009 adapter — REAL pass-through,
 * POST CR-W009 wiring).
 *
 * Catalog clause 5: "the execution-substrate adapter (submits approved+ready
 * tasks to the W006 Agent Gateway through the W001 boundary shapes; maps
 * settlements back to task completions)".
 *
 * This adapter is a THIN PASS-THROUGH to `@aurum/execution`'s
 * `AgentGateway`. It compiles once CR-W009 wires the `@aurum/execution`
 * and `@zcode/shared` deps into `packages/aurum-application/package.json`
 * (the lockfile is TL-owned per W009 hard laws). Until then, the
 * in-process double (`in-process-substrate.ts`) is the working
 * implementation against which all W009 acceptance gates pass.
 *
 * STRUCTURAL COMPATIBILITY: this file's `ExecutionSubstratePort`
 * implementation matches `@aurum/execution`'s `AgentGateway` surface 1:1.
 * The CR-W009 wiring note (spec/contract-requests/CR-W009-package-wiring.md)
 * is the source of truth for the dep wiring.
 *
 * PLAN-IS-TRUTH LAW: this adapter NEVER stores execution-session ids on
 * plan records. The settlement references flow through this adapter and are
 * recorded on `TaskCompletionRecord` (relay-side, not plan-side). The
 * truth-law tripwire (`test/plans-truth-law.test.ts`) source-scans the
 * plan-record file and finds no execution-session-shaped fields.
 */
export {};

/**
 * When CR-W009 resolves, the adapter below is what lands. It is kept here
 * as a documented stub so reviewers can see the structural shape.
 *
 * ```ts
 * import {
 *   asExecutionRequestId,
 *   asExecutionTenantId,
 *   buildExecutionSettlement,
 *   executionScope,
 *   type AgentGateway,
 *   type ExecutionSubmission,
 * } from "@aurum/execution";
 *
 * export class W006SubstrateAdapter implements ExecutionSubstratePort {
 *   constructor(private readonly gateway: AgentGateway) {}
 *
 *   async submitPlanTask(scope, request) {
 *     const execScope = executionScope(scope.tenantId);
 *     if (!execScope.ok) return err(...);
 *     const requestId = asExecutionRequestId(`${request.planId}-${request.taskId}-${request.attempt}`);
 *     if (!requestId.ok) return err(...);
 *     const submission = await this.gateway.submitExecution(execScope.value, {
 *       requestId: requestId.value,
 *       authority: request.authority,
 *       environmentClass: request.environmentClass,
 *       ...(request.environmentVariant ? { variant: request.environmentVariant } : {}),
 *       payload: request.payload,
 *       payloadMediaType: request.payloadMediaType,
 *       ...(request.deadlineEpochMs ? { deadlineEpochMs: request.deadlineEpochMs } : {}),
 *     });
 *     if (!submission.ok) return err(...);
 *     const settlement = await this.gateway.awaitSettled(execScope.value, requestId.value);
 *     if (!settlement.ok) return err(...);
 *     return ok({ requestId: settlement.value.requestId, settlement: settlement.value });
 *   }
 *   // ... awaitPlanTaskSettlement, cancelPlanTask similarly thin.
 * }
 * ```
 */
