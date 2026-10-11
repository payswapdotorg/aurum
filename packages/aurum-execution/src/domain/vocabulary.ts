/**
 * Execution-plane vocabulary (W006): environment classes, control surfaces,
 * journal event kinds and normalized failure kinds.
 *
 * Environment classes are ALIGNED with the W001 boundary's capability classes
 * (the catalog-mandated set local/browser/computer/workflow/remote/sandbox)
 * but declared here as the SEMANTIC vocabulary: this package owns the Aurum
 * execution side, the boundary owns the platform side, and the app layer maps
 * between them (spec/ZCODE-SUBSTRATE-MAP.md: browser/computer/remote host =
 * RETAIN/ADAPT ExecutionEnvironment). No boundary import occurs in this
 * layer — the semantic vocabulary stands alone by design.
 */
import type { ValidationIssue } from "./issues.js";

/**
 * Execution-environment classes the Aurum execution plane recognizes.
 * Plain string union by mandate (never an object graph, never a registry of
 * instances).
 */
export const EXECUTION_ENVIRONMENT_CLASSES = [
  "local",
  "browser",
  "computer",
  "workflow",
  "remote",
  "sandbox",
] as const;

/** Execution-environment class (plain string union). */
export type ExecutionEnvironmentClass = (typeof EXECUTION_ENVIRONMENT_CLASSES)[number];

/** Type guard for an environment class value (e.g. off the wire). */
export function isExecutionEnvironmentClass(
  value: unknown,
): value is ExecutionEnvironmentClass {
  return (
    typeof value === "string" &&
    (EXECUTION_ENVIRONMENT_CLASSES as readonly string[]).includes(value)
  );
}

/**
 * Which control operations an environment honors for in-flight executions.
 * Field names are deliberately aligned with the boundary's control surface so
 * the app-layer mapping is the identity function (values cross verbatim).
 */
export interface ExecutionControlSurface {
  readonly cancellable: boolean;
  readonly pausable: boolean;
  readonly resumable: boolean;
}

/**
 * Static description of one registered execution environment. All identifying
 * fields are opaque strings; none are addresses, secrets or semantic ids.
 *
 * `wired: false` marks a fail-closed STUB registration: the environment class
 * is visible (listed, selectable, seam-resolvable) but submissions reject
 * with the typed `execution/not-wired` error — real ZCode substrate wiring is
 * follow-up work.
 */
export interface ExecutionEnvironmentDescriptor {
  /** Opaque, stable identifier within one registry. */
  readonly environmentId: string;
  readonly environmentClass: ExecutionEnvironmentClass;
  /** Opaque variant label distinguishing environments inside one class. */
  readonly variant: string;
  readonly control: ExecutionControlSurface;
  /** False ⇒ fail-closed stub (submissions reject not-wired). */
  readonly wired: boolean;
  /** Diagnostic only — never used for decisions. */
  readonly notes?: string;
}

/** What a consumer is looking for when selecting an environment. */
export interface EnvironmentSelectionQuery {
  readonly environmentClass: ExecutionEnvironmentClass;
  /** Narrowing variant label; omit to accept any variant. */
  readonly variant?: string;
}

/** Pure selection match (class equality + optional variant equality). */
export function matchesSelectionQuery(
  descriptor: ExecutionEnvironmentDescriptor,
  query: EnvironmentSelectionQuery,
): boolean {
  if (descriptor.environmentClass !== query.environmentClass) return false;
  if (query.variant === undefined) return true;
  return descriptor.variant === query.variant;
}

/** Validation for selection queries. */
export function selectionQueryIssues(query: unknown): ValidationIssue[] {
  if (!query || typeof query !== "object") {
    return [{ field: "environment", problem: "selection query is required" }];
  }
  const record = query as Record<string, unknown>;
  if (!isExecutionEnvironmentClass(record["environmentClass"])) {
    return [
      {
        field: "environment.environmentClass",
        problem: "must be one of " + EXECUTION_ENVIRONMENT_CLASSES.join("/"),
      },
    ];
  }
  return [];
}

/**
 * Append-only journal event kinds (the execution-plane "audit events" the
 * authority law produces on failure paths). Execution-local records — never
 * domain audit entries.
 */
export const EXECUTION_JOURNAL_KINDS = [
  "request-accepted",
  "environment-selected",
  "submission-acknowledged",
  "execution-started",
  "execution-paused",
  "execution-resumed",
  "cancel-requested",
  "session-settled",
  "session-failed",
  "session-cancelled",
  "failure-recorded",
  "duplicate-suppressed",
  "recovery-opened",
  "recovery-settled",
] as const;

export type ExecutionJournalKind = (typeof EXECUTION_JOURNAL_KINDS)[number];

/** Type guard for a journal kind value. */
export function isExecutionJournalKind(value: unknown): value is ExecutionJournalKind {
  return (
    typeof value === "string" &&
    (EXECUTION_JOURNAL_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Normalized failure kinds — HOW an execution failed, independent of which
 * layer reported it. Carried on failed settlements so callers (W009 relay,
 * W013 outcome learning) can classify without parsing messages.
 */
export const EXECUTION_FAILURE_KINDS = [
  /** The platform itself reported a failed envelope (error detail verbatim). */
  "platform-failed",
  /** A transport/adapter call failed (adapter threw, transport closed). */
  "transport-failed",
  /** The submission deadline passed before settlement. */
  "deadline-exceeded",
  /** Registered but fail-closed (not yet wired). */
  "not-wired",
  /** No environment offers the requested class/variant. */
  "environment-unavailable",
  /** Platform state unknown after interruption and unrecoverable. */
  "interrupted",
] as const;

export type ExecutionFailureKind = (typeof EXECUTION_FAILURE_KINDS)[number];

/** Type guard for a failure kind value. */
export function isExecutionFailureKind(value: unknown): value is ExecutionFailureKind {
  return (
    typeof value === "string" &&
    (EXECUTION_FAILURE_KINDS as readonly string[]).includes(value)
  );
}
