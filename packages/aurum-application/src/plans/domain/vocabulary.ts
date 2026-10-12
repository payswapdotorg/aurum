/**
 * Plans vocabulary (W009): the frozen enum unions for plan/task/handoff and
 * escalation kinds. Plain string unions by mandate (spec/ARCHITECTURE.md —
 * never an object graph, never a registry of instances).
 *
 * Vocabulary alignment:
 * - `PlanTaskKind` is ALIGNED with the W005 process step kinds
 *   (`PROCESS_STEP_KINDS = manual/automated/hybrid`) but declared HERE for
 *   plan-owned semantics (a plan task is a unit of scheduled execution, not a
 *   reconstructed process step). No boundary import occurs (the plans domain
 *   layer is stdlib + `@aurum/domain` only).
 * - `ExecutionEnvironmentClass` values are aligned with the W006 vocabulary
 *   (`EXECUTION_ENVIRONMENT_CLASSES = local/browser/computer/workflow/remote/
 *   sandbox`) so the substrate adapter's pass-through is the identity
 *   function. Declared here as plain strings — no `@aurum/execution` import
 *   (the truth-law tripwire forbids it in the domain layer).
 * - `EscalationDecision` is the W009 escalation vocabulary (catalog clause
 *   4: retry/replace/cancel-branch/cancel-plan). Escalation PROPOSES, the
 *   authority seams DISPOSE.
 */
import type { ValidationIssue } from "@aurum/domain";

/** Plan task kinds (W009-owned; aligned with W005 process step kinds). */
export const PLAN_TASK_KINDS = ["manual", "automated", "hybrid"] as const;

export type PlanTaskKind = (typeof PLAN_TASK_KINDS)[number];

export function isKnownPlanTaskKind(value: string): value is PlanTaskKind {
  return (PLAN_TASK_KINDS as readonly string[]).includes(value);
}

/**
 * Execution-environment class (W009-owned re-declaration; ALIGNED with the
 * W006 boundary vocabulary `EXECUTION_ENVIRONMENT_CLASSES`). The plans
 * domain layer cannot import `@aurum/execution` (truth-law), so the union is
 * re-declared here. The substrate adapter asserts structural identity with
 * `@aurum/execution`'s surface once CR-W009 wires the dep.
 */
export const PLAN_ENVIRONMENT_CLASSES = [
  "local",
  "browser",
  "computer",
  "workflow",
  "remote",
  "sandbox",
] as const;

export type PlanEnvironmentClass = (typeof PLAN_ENVIRONMENT_CLASSES)[number];

export function isKnownPlanEnvironmentClass(value: string): value is PlanEnvironmentClass {
  return (PLAN_ENVIRONMENT_CLASSES as readonly string[]).includes(value);
}

/** Plan approval state machine (catalog clause 1: draft → submitted → approved/rejected). */
export const PLAN_APPROVAL_STATES = ["draft", "submitted", "approved", "rejected"] as const;

export type PlanApprovalState = (typeof PLAN_APPROVAL_STATES)[number];

export function isKnownPlanApprovalState(value: string): value is PlanApprovalState {
  return (PLAN_APPROVAL_STATES as readonly string[]).includes(value);
}

/** Plan lifecycle state (catalog clause 1: active/completed/cancelled — audit-cited). */
export const PLAN_LIFECYCLE_STATES = ["active", "completed", "cancelled"] as const;

export type PlanLifecycleState = (typeof PLAN_LIFECYCLE_STATES)[number];

export function isKnownPlanLifecycleState(value: string): value is PlanLifecycleState {
  return (PLAN_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/**
 * Pure legality of the plan approval graph. draft → submitted; submitted →
 * approved | rejected; approved → active (via activate); rejected is
 * terminal (rejection refuses further transitions — re-draft instead).
 */
export function planApprovalTransitionLegal(
  from: PlanApprovalState,
  to: PlanApprovalState,
): boolean {
  if (to === from) return false;
  switch (from) {
    case "draft":
      return to === "submitted";
    case "submitted":
      return to === "approved" || to === "rejected";
    case "approved":
    case "rejected":
      return false;
  }
}

/** Escalation decisions requested when a task settles failed / deadline passes. */
export const ESCALATION_DECISIONS = ["retry", "replace", "cancel-branch", "cancel-plan"] as const;

export type EscalationDecision = (typeof ESCALATION_DECISIONS)[number];

export function isKnownEscalationDecision(value: string): value is EscalationDecision {
  return (ESCALATION_DECISIONS as readonly string[]).includes(value);
}

/**
 * Escalation trigger kinds — WHY the escalation was raised. Catalog clause 4:
 * when a task's execution settles failed, OR its deadline passes, OR a
 * dependency settles failed.
 */
export const ESCALATION_TRIGGERS = [
  /** The task's execution settled "failed". */
  "task-failed",
  /** The task's deadline passed before settlement. */
  "task-deadline-exceeded",
  /** A dependency of the task settled "failed" (cascade escalation). */
  "dependency-failed",
] as const;

export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

export function isKnownEscalationTrigger(value: string): value is EscalationTrigger {
  return (ESCALATION_TRIGGERS as readonly string[]).includes(value);
}

/** Handoff delivery outcome: exactly-once settlement (catalog clause 3). */
export const HANDOFF_DELIVERY_OUTCOMES = [
  /** First-time delivery: the handoff was delivered and observed. */
  "delivered-first",
  /** Idempotent duplicate: byte-identical re-delivery, observed exactly once. */
  "delivered-duplicate",
] as const;

export type HandoffDeliveryOutcome = (typeof HANDOFF_DELIVERY_OUTCOMES)[number];

export function isKnownHandoffDeliveryOutcome(value: string): value is HandoffDeliveryOutcome {
  return (HANDOFF_DELIVERY_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Authority requirement shape a task declares (catalog clause 2: per-task
 * authorization requirements — what authority an executor needs, declared,
 * checked at relay time). The requirement is DATA: it is not the authority
 * itself, it is the SHAPE of the authority the executor must present at
 * handoff time. The approval authority port
 * (`PlanApprovalAuthority` in `ports.ts`) validates the proof at relay time.
 *
 * The citation shape mirrors the W006 `AuthorityCitation`
 * (`{actionId?, auditRef?}` — at least one present): plan tasks cite kernel
 * authority the same way execution sessions do. The re-declaration here is
 * structural; the substrate adapter asserts structural identity with
 * `@aurum/execution`'s surface once CR-W009 wires the dep.
 */
export interface TaskAuthorityRequirement {
  /**
   * Domain ActionRecord id (W002 action authority) the executor must cite.
   * The action must be in state `authorized` (or `executed`) at relay time.
   */
  readonly actionId?: string;
  /**
   * Domain AuditRecord id (W002 audit trail) the executor must cite. The
   * audit entry must exist in the requesting tenant at relay time.
   */
  readonly auditRef?: string;
}

/** Validates a task authority requirement; empty array when valid. */
export function taskAuthorityRequirementIssues(
  requirement: unknown,
  fieldPrefix = "authority",
): ValidationIssue[] {
  if (!requirement || typeof requirement !== "object") {
    return [{ field: fieldPrefix, problem: "is required (actionId and/or auditRef)" }];
  }
  const record = requirement as Record<string, unknown>;
  const actionId = typeof record["actionId"] === "string" ? record["actionId"].trim() : "";
  const auditRef = typeof record["auditRef"] === "string" ? record["auditRef"].trim() : "";
  if (actionId.length === 0 && auditRef.length === 0) {
    return [
      {
        field: fieldPrefix,
        problem: "at least one of actionId or auditRef must be a non-empty string",
      },
    ];
  }
  if (actionId.length > 200) {
    return [{ field: `${fieldPrefix}.actionId`, problem: "must be at most 200 characters" }];
  }
  if (auditRef.length > 200) {
    return [{ field: `${fieldPrefix}.auditRef`, problem: "must be at most 200 characters" }];
  }
  return [];
}
