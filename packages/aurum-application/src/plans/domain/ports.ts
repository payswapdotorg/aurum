/**
 * Plans ports (W009 domain layer): the narrow seams the plans module consumes
 * from the composed domain kernel + execution plane + boundary.
 *
 * Following the W008 lab pattern (`lab/domain/ports.ts`), these are typed as
 * STRUCTURAL PICKS of the kernel + execution interfaces so the composed
 * kernel satisfies them directly, while tests can supply minimal
 * deterministic doubles.
 *
 * PLAN-IS-TRUTH LAW: the domain layer imports ONLY `@aurum/domain`. There is
 * NO `@aurum/execution` or `@zcode/shared` import anywhere in
 * `src/plans/domain/**` (source-scan tripwire: `test/plans-truth-law.test.ts`).
 *
 * The execution-substrate port (`ExecutionSubstratePort`) is the LOCAL
 * re-declaration of the `@aurum/execution` AgentGateway surface. It is
 * STRUCTURALLY COMPATIBLE with the W006 gateway — once CR-W009 wires the
 * `@aurum/execution` dep, the substrate adapter (`adapters/w006-substrate-adapter.ts`)
 * is a thin pass-through. Until then, the in-process double
 * (`adapters/in-process-substrate.ts`) implements this port directly.
 */
import type {
  ActorReference,
  AuditActionKind,
  AuditInput,
  AuditRecord,
  DomainTimestamp,
  GoalRecord,
  OrganizationCandidate,
  Result,
  SubjectReference,
  TenantScope,
} from "@aurum/domain";
import type { ValidationIssue } from "@aurum/domain";
import type { HandoffDescriptor } from "./records.js";
import type { PlanError } from "./errors.js";
import type { PlanEnvironmentClass } from "./vocabulary.js";

/**
 * Read-only goal views (W002 seam). The plan references a goal by id;
 * construction-time validation fetches the goal to confirm it exists in the
 * requesting tenant (closed-failure: a foreign-tenant goal and a missing
 * goal are indistinguishable). Structurally compatible with the kernel's
 * `GoalLedger` so the composed kernel satisfies this directly.
 */
export interface PlanGoalViews {
  getGoal(scope: TenantScope, goalId: string): Result<GoalRecord, PlanError>;
}

/**
 * Read-only candidate views (W005 seam). The plan references a candidate by
 * id and per-task resource allocations by id; construction-time validation
 * fetches the candidate to confirm:
 * - the candidate exists in the requesting tenant;
 * - the referenced assignment / allocation ids exist within that candidate.
 */
export interface PlanCandidateViews {
  getCandidate(
    scope: TenantScope,
    candidateId: string,
  ): Result<OrganizationCandidate, PlanError>;
}

/**
 * Approval authority port (W002 seam — the action authority). Catalog
 * clause 1: "approvals are human-gated per the W005/W002 authority laws".
 * The port is the APPLICATION-owned shape that the action authority satisfies
 * structurally; the real adapter (`adapters/action-authority-adapter.ts`,
 * post-CR-W009) is a thin pass-through to the kernel's `ActionAuthority`.
 *
 * The port NEVER mutates plan state directly — it only ASSERTS that the
 * human approval exists in the requesting tenant (closed-failure: foreign
 * and missing are indistinguishable). The plan service records the citation
 * on the plan after the assertion succeeds.
 *
 * The proof is required at TWO points:
 * - PLAN APPROVAL: when the plan transitions submitted → approved, the
 *   caller must supply a `PlanApprovalCitation` whose `actionId` / `auditRef`
 *   this port asserts in the requesting tenant.
 * - HANDOFF ISSUANCE: when a handoff is issued to an executor, the
 *   executor's `TaskAuthorityRequirement` is asserted by this port (catalog
 *   clause 3: "authorization-aware ... declared, checked at relay time").
 */
export interface PlanApprovalAuthority {
  /**
   * Asserts that an approval citation is valid in the requesting tenant:
   * - the `actionId` exists and is in state `approved` or `authorized` (or
   *   `executed`); AND
   * - the `auditRef` exists and records the human decision; AND
   * - the `approvedBy` actor matches the action's `stateHistory` entry.
   *
   * Returns the resolved citation (echo) when valid; a typed `plan-unauthorized`
   * error when not.
   */
  assertApprovalCitation(
    scope: TenantScope,
    citation: {
      readonly actionId?: string;
      readonly auditRef?: string;
      readonly approvedBy: ActorReference;
      readonly approvedAt: DomainTimestamp;
    },
  ): Result<{ readonly actionId?: string; readonly auditRef?: string }, PlanError>;
  /**
   * Asserts that an executor's authority requirement is valid at relay time:
   * - the `actionId` (if present) exists in state `authorized` (or
   *   `executed`) in the requesting tenant; AND
   * - the `auditRef` (if present) exists in the requesting tenant.
   *
   * Closed-failure: returns `plan-unauthorized` for missing, foreign-tenant,
   * or wrong-state citations (no existence leaks).
   */
  assertExecutorAuthority(
    scope: TenantScope,
    requirement: { readonly actionId?: string; readonly auditRef?: string },
  ): Result<{ readonly actionId?: string; readonly auditRef?: string }, PlanError>;
}

/**
 * Audit append port (W002 seam — the audit trail). The plan service records
 * audit entries for lifecycle transitions (active / completed / cancelled)
 * and for approval transitions (submitted / approved / rejected). The audit
 * entry's `auditId` is the `auditRef` the plan cites.
 */
export interface PlanAuditPort {
  append(
    scope: TenantScope,
    subject: SubjectReference,
    action: AuditActionKind,
    input: AuditInput,
  ): Result<{ readonly auditRef: string }, PlanError>;
  /** Read-back for tests + consumers; not used for plan decisions. */
  getAudit(scope: TenantScope, auditId: string): Result<AuditRecord, PlanError>;
}

/**
 * The execution-substrate port — the LOCAL re-declaration of the W006
 * AgentGateway surface. STRUCTURALLY COMPATIBLE with `@aurum/execution`'s
 * `AgentGateway` (the substrate adapter asserts identity once CR-W009 wires
 * the dep). The plans domain layer never imports `@aurum/execution`.
 *
 * THE AUTHORITY LAW: this port submits approved+ready plan tasks to the
 * execution plane and maps settlements back to task completions. It NEVER
 * mutates plan state — the plan service records the completion through the
 * plan store after the substrate returns. The substrate is the EXECUTION
 * substrate only; the plan is SEMANTIC TRUTH.
 *
 * Recovery (catalog clause 4): re-dispatch of a task creates a NEW execution
 * session (request id) referencing the SAME plan task id; correlation
 * retained. The substrate tracks the latest request id per (planId,
 * taskId); the plan never persists it.
 */
export interface ExecutionSubstratePort {
  /**
   * Submits an approved+ready plan task to the execution plane. Returns the
   * request id (correlation identity) and the eventual settlement. The
   * `submissionKey` is derived from (planId, taskId, attempt) so duplicate
   * submits are idempotent (the W006 gateway's exactly-once settlement law
   * applies — same submission key returns the same ticket/envelope).
   */
  submitPlanTask(
    scope: TenantScope,
    request: {
      readonly planId: string;
      readonly taskId: string;
      readonly environmentClass: PlanEnvironmentClass;
      readonly environmentVariant?: string;
      readonly payload: string;
      readonly payloadMediaType: string;
      readonly authority: {
        readonly actionId?: string;
        readonly auditRef?: string;
      };
      readonly deadlineEpochMs?: number;
      readonly attempt: number;
    },
  ): Promise<
    Result<
      {
        readonly requestId: string;
        readonly settlement: TaskSettlementEcho;
      },
      PlanError
    >
  >;
  /**
   * Re-fetches a previously-submitted task's settlement (recovery path:
   * the substrate may have settled between calls; the plan re-derives
   * correlation by (planId, taskId, attempt)).
   */
  awaitPlanTaskSettlement(
    scope: TenantScope,
    request: {
      readonly planId: string;
      readonly taskId: string;
      readonly attempt: number;
    },
  ): Promise<Result<TaskSettlementEcho, PlanError>>;
  /**
   * Cancels an in-flight submission (best-effort; the substrate may report
   * "already-terminal"). The plan's task is then settled cancelled.
   */
  cancelPlanTask(
    scope: TenantScope,
    request: {
      readonly planId: string;
      readonly taskId: string;
      readonly attempt: number;
    },
  ): Promise<Result<TaskSettlementEcho, PlanError>>;
}

/**
 * The settlement echo — the normalized result envelope (W006
 * `ExecutionSettlement`) re-declared in plan-local terms. STRUCTURALLY
 * COMPATIBLE with `@aurum/execution`'s `ExecutionSettlement`. The plan layer
 * only consumes `status`, `failure` (iff failed), and `settledAt` +
 * `requestId` (for the causation identity on completions and handoffs).
 *
 * Truth law: this echo is carried on `TaskCompletionRecord.settlementRef` and
 * `HandoffPayload.producingSettlementRef` — it is a CORRELATION identity on
 * the relay's records, NOT a field on the plan record itself. The
 * source-scan tripwire checks `src/plans/domain/records.ts` for any
 * execution-session-shaped field ON `ExecutionPlan` (none exist).
 */
export interface TaskSettlementEcho {
  readonly requestId: string;
  readonly status: "settled" | "cancelled" | "failed";
  readonly settledAt: number;
  readonly failure?: {
    readonly kind: string;
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
  /** Opaque result payload; present iff the substrate produced output. */
  readonly result?: string;
}

/**
 * The plan store — the application's OWN in-memory truth (P-series debt for
 * PostgreSQL storage). Tenant-scoped; cross-tenant reads fail closed as a
 * uniform not-found (no existence leaks).
 */
export interface PlanStore {
  putPlan(plan: ExecutionPlanLike): Result<ExecutionPlanLike, PlanError>;
  getPlan(scope: TenantScope, planId: string): Result<ExecutionPlanLike, PlanError>;
  listPlans(scope: TenantScope): readonly ExecutionPlanLike[];
}

/**
 * Structural type the plan store accepts (avoids a circular type reference
 * to `ExecutionPlan` from the records file). The actual `ExecutionPlan` in
 * `records.ts` is structurally assignable to this — the store accepts either.
 */
export interface ExecutionPlanLike {
  readonly scope: TenantScope;
  readonly planId: string;
  readonly version: number;
  readonly approval: {
    readonly state: string;
    readonly history: readonly unknown[];
  };
  readonly lifecycleState: string;
  readonly lifecycleHistory: readonly unknown[];
}

/** The handoff relay's own store (catalog clause 3: idempotent delivery). */
export interface HandoffRelayStore {
  /** Records a handoff delivery; idempotent on identical re-delivery. */
  recordDelivery(
    payload: import("./records.js").HandoffPayload,
  ): Result<import("./records.js").HandoffDeliveryResult, PlanError>;
  /** Lists delivered handoffs for a (planId, taskId) correlation. */
  deliveredFor(
    planId: string,
    taskId: string,
  ): readonly import("./records.js").HandoffPayload[];
  /** Lists all delivered handoffs for a plan (used by readiness queries). */
  deliveredForPlan(planId: string): readonly import("./records.js").HandoffPayload[];
}

/** The task completion store (catalog clause 3: completion cites envelope). */
export interface TaskCompletionStore {
  recordCompletion(
    completion: import("./records.js").TaskCompletionRecord,
  ): Result<import("./records.js").TaskCompletionRecord, PlanError>;
  getCompletion(
    planId: string,
    taskId: string,
  ): Result<import("./records.js").TaskCompletionRecord, PlanError>;
  listCompletions(planId: string): readonly import("./records.js").TaskCompletionRecord[];
}

/** The escalation store (catalog clause 4: escalation proposes / disposes). */
export interface EscalationStore {
  appendEscalation(
    escalation: import("./records.js").EscalationRecord,
  ): Result<import("./records.js").EscalationRecord, PlanError>;
  listEscalations(
    scope: TenantScope,
    planId: string,
  ): readonly import("./records.js").EscalationRecord[];
}

/**
 * The plans module's composed dependencies (the service factory's input).
 * Mirrors the W008 `OrganizationalLabDeps` pattern: views + stores + the
 * execution substrate.
 */
export interface PlanServiceDeps {
  readonly goals: PlanGoalViews;
  readonly candidates: PlanCandidateViews;
  readonly approval: PlanApprovalAuthority;
  readonly audit: PlanAuditPort;
  readonly substrate: ExecutionSubstratePort;
  readonly plans: PlanStore;
  readonly handoffs: HandoffRelayStore;
  readonly completions: TaskCompletionStore;
  readonly escalations: EscalationStore;
}

/** Timestamped read helper shared by the app layer (deterministic `now`). */
export type Now = DomainTimestamp;

/** Re-export for the contract: shared handoff descriptor shape. */
export type { HandoffDescriptor } from "./records.js";

/** Validation issue re-export for adapter implementations. */
export type { ValidationIssue } from "@aurum/domain";

/** SubjectReference re-export for adapter implementations. */
export type { SubjectReference, TenantScope, ActorReference } from "@aurum/domain";
