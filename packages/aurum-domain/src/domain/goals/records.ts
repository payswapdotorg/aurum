/**
 * Goals: objective, desired state, metrics/thresholds, horizon, owner,
 * priority, expected evidence, success criteria and history
 * (spec/DOMAIN-MAPPING.md). Goal revisions are immutable and append-only:
 * revising a goal appends a new revision; previous revisions are retained
 * verbatim.
 */
import type { DomainTimestamp, GoalId } from "../core/branding.js";
import type { TenantScopedRecord } from "../core/scope.js";
import type { SubjectReference } from "../core/refs.js";
import type { IdentityReference } from "../identity/records.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { FreshnessStamp } from "../evidence/freshness.js";

export const GOAL_PRIORITIES = ["critical", "high", "medium", "low"] as const;

export type GoalPriority = (typeof GOAL_PRIORITIES)[number];

export function isKnownGoalPriority(value: string): value is GoalPriority {
  return (GOAL_PRIORITIES as readonly string[]).includes(value);
}

export type MetricDirection = "at-least" | "at-most";

/** A measurable goal metric with target and alert threshold. */
export interface GoalMetric {
  readonly name: string;
  readonly unit?: string;
  readonly target: number;
  /** The threshold at which the metric is no longer acceptable. */
  readonly threshold: number;
  readonly direction: MetricDirection;
}

export type GoalMetricEvaluation = "met" | "in-progress" | "threshold-breached";

/**
 * Pure metric evaluation. `at-least`: observed >= target is met, observed <=
 * threshold is a breach, otherwise in progress. `at-most` mirrors it.
 */
export function evaluateGoalMetric(metric: GoalMetric, observed: number): GoalMetricEvaluation {
  if (!Number.isFinite(observed)) return "in-progress";
  if (metric.direction === "at-least") {
    if (observed >= metric.target) return "met";
    if (observed <= metric.threshold) return "threshold-breached";
    return "in-progress";
  }
  if (observed <= metric.target) return "met";
  if (observed >= metric.threshold) return "threshold-breached";
  return "in-progress";
}

/** What evidence would show progress on the goal. */
export interface ExpectedEvidence {
  readonly description: string;
  readonly subject: SubjectReference;
  readonly freshness?: FreshnessStamp;
}

/** A success criterion, optionally tied to a metric by name. */
export interface SuccessCriterion {
  readonly description: string;
  readonly metric?: string;
}

/** One immutable goal revision (append-only history). */
export interface GoalRevision {
  readonly revisionNumber: number;
  readonly objective: string;
  readonly desiredState: string;
  readonly metrics: readonly GoalMetric[];
  /** Start (inclusive) and end (exclusive) horizon window. */
  readonly horizonStart: DomainTimestamp;
  readonly horizonEnd: DomainTimestamp;
  readonly owner: IdentityReference;
  readonly priority: GoalPriority;
  readonly expectedEvidence: readonly ExpectedEvidence[];
  readonly successCriteria: readonly SuccessCriterion[];
  readonly provenance: ProvenanceRecord;
  readonly createdAt: DomainTimestamp;
}

/** Goal: identified by id, carrying an append-only revision history. */
export interface GoalRecord extends TenantScopedRecord {
  readonly goalId: GoalId;
  readonly currentRevision: number;
  readonly revisions: readonly GoalRevision[];
}
