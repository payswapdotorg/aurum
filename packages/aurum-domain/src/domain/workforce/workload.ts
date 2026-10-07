/**
 * Pure workload arithmetic (W005): utilization of declared capacity from
 * active assignments, plus observed workload from evidence. Deterministic
 * and total; no store, no IO.
 */
import type { PersonId } from "../core/branding.js";
import type { TimeWindow } from "../core/time.js";
import type { CapacityBounds, WorkAssignmentRecord, WorkloadObservationRecord } from "./records.js";

/** Workload summary for one person over one period. */
export interface WorkloadSummary {
  readonly personId: PersonId;
  readonly period: TimeWindow;
  /** Declared bounds covering the period, when they exist. */
  readonly bounds: CapacityBounds | undefined;
  readonly activeAssignmentCount: number;
  readonly totalAssignedEffortMs: number;
  /** Assigned effort / maxEffortMs; undefined without bounds. */
  readonly utilization: number | undefined;
  /** Observed effort from the matching workload observation, when given. */
  readonly observedEffortMs: number | undefined;
  readonly observedUtilization: number | undefined;
  /** True when observed effort exceeds the declared bound. */
  readonly overCapacity: boolean;
}

function periodCovers(boundsPeriod: TimeWindow, period: TimeWindow): boolean {
  return boundsPeriod.start <= period.start && boundsPeriod.end >= period.end;
}

/**
 * Summarizes workload. Rules (frozen):
 * - assignments counted: status "active" and overlapping the query period;
 * - utilization = total assigned effort / maxEffortMs (only with bounds);
 * - overCapacity: observed effort exceeds maxEffortMs — observations are
 *   evidence and may legitimately exceed planned bounds; assignments
 *   themselves are rejected upstream when they would exceed bounds.
 */
export function summarizeWorkload(
  personId: PersonId,
  period: TimeWindow,
  bounds: CapacityBounds | undefined,
  assignments: readonly WorkAssignmentRecord[],
  observation?: WorkloadObservationRecord,
): WorkloadSummary {
  const active = assignments.filter(
    (assignment) =>
      assignment.personId === personId &&
      assignment.status === "active" &&
      assignment.period.start < period.end &&
      assignment.period.end > period.start,
  );
  const totalAssignedEffortMs = active.reduce((sum, assignment) => sum + assignment.effortMs, 0);
  const covering = bounds !== undefined && periodCovers(bounds.period, period) ? bounds : undefined;
  const utilization =
    covering !== undefined && covering.maxEffortMs > 0
      ? totalAssignedEffortMs / covering.maxEffortMs
      : undefined;
  const observedEffortMs = observation?.observedEffortMs;
  const observedUtilization =
    observation !== undefined &&
    covering !== undefined &&
    covering.maxEffortMs > 0 &&
    observedEffortMs !== undefined
      ? observedEffortMs / covering.maxEffortMs
      : observation?.observedUtilization;
  const overCapacity =
    covering !== undefined &&
    observedEffortMs !== undefined &&
    observedEffortMs > covering.maxEffortMs;
  return {
    personId,
    period,
    bounds: covering,
    activeAssignmentCount: active.length,
    totalAssignedEffortMs,
    utilization,
    observedEffortMs,
    observedUtilization,
    overCapacity,
  };
}
