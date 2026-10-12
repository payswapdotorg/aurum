/**
 * Plans typed error namespace (W009). The ExecutionPlan + information relay
 * never throws bare strings: every failure is a structured `PlanError`
 * carried inside a `Result`. The codes are plans-local (the domain
 * `DomainErrorCode` union is frozen by W002 and is not extended here — no
 * second authority over domain error semantics).
 *
 * The W005/W002 validators (`organizationCandidateIssues`,
 * `actorAssignmentIssues`, `capabilityAllocationIssues`,
 * `auditInputIssues`) are the acceptance gate for plan construction; their
 * issue lists travel verbatim on `plan-validation` / `plan-allocation-refused`
 * errors.
 *
 * PLAN-IS-TRUTH LAW (catalog clause: "plan remains Aurum truth while ZCode
 * workflow is execution substrate"): no `ExecutionRequestId`,
 * `submissionTicket`, `ExecutionSession`, or any other execution-session id
 * EVER appears in a plan record. The truth-law tripwire
 * (`test/plans-truth-law.test.ts`) source-scans the domain layer to prove
 * this. Runtime execution sessions live only on the substrate adapter side.
 */
import type { ValidationIssue } from "@aurum/domain";

export type PlanErrorCode =
  /** Plan input failed validation; `issues` lists the offending fields. */
  | "plan-validation"
  /** Plan record not found in the requesting tenant. Uniform for foreign-tenant
   *  and never-existing ids: no existence leaks (spec/ARCHITECTURE.md). */
  | "plan-not-found"
  /** The referenced subject (goal / candidate / action) was not found in the
   *  requesting tenant — closed-failure semantics, no tenant leaks. */
  | "plan-subject-not-found"
  /** The plan's task DAG contains a cycle; `cyclePath` carries the offending
   *  path. Refused at construction (catalog clause 2). */
  | "plan-cycle"
  /** Constrained allocation refused by the W005 validators; `issues` carries
   *  the verbatim actor-assignment / capability-allocation issue list. */
  | "plan-allocation-refused"
  /** The transition is illegal in the current plan state (draft → submitted →
   *  approved/rejected → active/completed/cancelled). */
  | "plan-lifecycle"
  /** A handoff was issued to an executor that lacks the declared authority
   *  (catalog: "relay is minimal-context AND authorization-aware"). */
  | "plan-unauthorized"
  /** A duplicate handoff delivery was observed with a DIVERGENT payload
   *  (catalog: "duplicate delivery is idempotent" — byte-identical duplicates
   *  are suppressed; divergent duplicates are refused as an invariant). */
  | "plan-handoff-divergent"
  /** Internal invariant violation (a plans bug, never a caller error). */
  | "plan-invariant";

/** Structured, typed plan error. `message` is safe to display. */
export class PlanError extends Error {
  readonly code: PlanErrorCode;
  /** Present for validation / refusal / lifecycle codes. Empty otherwise. */
  readonly issues: readonly ValidationIssue[];
  /** Present iff `code === "plan-cycle"`. The offending cycle's task ids. */
  readonly cyclePath?: readonly string[];

  constructor(
    code: PlanErrorCode,
    message: string,
    options: {
      issues?: readonly ValidationIssue[];
      cyclePath?: readonly string[];
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "PlanError";
    this.code = code;
    this.issues = options.issues ?? [];
    if (options.cyclePath !== undefined) {
      this.cyclePath = Object.freeze([...options.cyclePath]);
    }
  }
}

export function isPlanError(value: unknown): value is PlanError {
  return value instanceof PlanError;
}

export function planValidationError(issues: readonly ValidationIssue[]): PlanError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new PlanError("plan-validation", `plan validation failed: ${summary}`, { issues });
}

/** Uniform not-found for plan-owned records. No tenant leaks. */
export function planNotFound(recordKind: string): PlanError {
  return new PlanError("plan-not-found", `${recordKind} not found`);
}

/** Uniform not-found for plan subjects (goal/candidate/action). */
export function planSubjectNotFound(subject: string): PlanError {
  return new PlanError("plan-subject-not-found", `subject not found: ${subject}`);
}

/** Cycle rejection at DAG construction (catalog clause 2). */
export function planCycle(cyclePath: readonly string[]): PlanError {
  const path = cyclePath.join(" -> ");
  return new PlanError("plan-cycle", `task DAG contains a cycle: ${path}`, { cyclePath });
}

/** Constrained-allocation refusal (W005 validators rejected). */
export function planAllocationRefused(issues: readonly ValidationIssue[]): PlanError {
  const summary = issues.map((issue) => `${issue.field}: ${issue.problem}`).join("; ");
  return new PlanError("plan-allocation-refused", `allocation refused: ${summary}`, { issues });
}

/** Illegal lifecycle transition. */
export function planLifecycleIllegal(from: string, to: string): PlanError {
  return new PlanError("plan-lifecycle", `illegal transition: ${from} -> ${to}`);
}

/** Unauthorized handoff delivery (catalog: relay is authorization-aware). */
export function planUnauthorized(message: string): PlanError {
  return new PlanError("plan-unauthorized", message);
}

/** Divergent duplicate handoff (catalog: duplicate delivery is idempotent). */
export function planHandoffDivergent(handoffId: string): PlanError {
  return new PlanError(
    "plan-handoff-divergent",
    `handoff ${handoffId} already delivered with a divergent payload`,
  );
}

export function planInvariant(message: string): PlanError {
  return new PlanError("plan-invariant", `plan invariant violated: ${message}`);
}
