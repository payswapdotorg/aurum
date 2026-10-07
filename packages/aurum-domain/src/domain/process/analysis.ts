/**
 * Pure process analysis (W005): derives the operating-model exposure lens —
 * bottleneck, duplication, handoffs, manual effort, errors, variants and
 * waiting time — from a process revision plus one metric observation. No
 * store, no IO; deterministic and total.
 */
import type { ProcessMetricsObservation, ProcessRecord, ProcessRevision } from "./records.js";
import type { BottleneckPolicy } from "./policy.js";
import { DEFAULT_BOTTLENECK_POLICY } from "./policy.js";
import type { TimeWindow } from "../core/time.js";

/** Aggregated analysis of one process revision + observation. */
export interface ProcessAnalysis {
  readonly processId: string;
  readonly revisionNumber: number;
  readonly observationId: string;
  readonly period: TimeWindow;
  readonly stepCount: number;
  readonly handoffCount: number;
  readonly variantCount: number;
  /** Sum of declared variant shares, when any variant declares one. */
  readonly variantCoverage: number | undefined;
  /** Step with the highest utilization at or above the policy threshold. */
  readonly bottleneckStepId: string | undefined;
  readonly bottleneckUtilization: number | undefined;
  readonly totalManualEffortMs: number;
  readonly totalWaitingTimeMs: number;
  readonly totalErrors: number;
  /** Union of declared duplication targets, in revision step order. */
  readonly duplicatedStepIds: readonly string[];
}

function currentRevisionOf(process: ProcessRecord): ProcessRevision {
  const revision = process.revisions[process.currentRevision - 1];
  if (!revision) throw new Error("corrupt process record: missing current revision");
  return revision;
}

/**
 * Analyzes a process against one observation. Rule (documented, frozen):
 * - bottleneck: among measured steps, those with utilization >= policy
 *   threshold are candidates; the maximum utilization wins; ties resolve to
 *   the earliest step in revision order;
 * - duplication: union of every measurement's `duplicates` lists, ordered by
 *   revision step order;
 * - totals: sums of the optional per-step fields (absent fields count 0).
 */
export function analyzeProcess(
  process: ProcessRecord,
  observation: ProcessMetricsObservation,
  policy: BottleneckPolicy = DEFAULT_BOTTLENECK_POLICY,
): ProcessAnalysis {
  const revision = currentRevisionOf(process);
  const stepOrder = new Map(revision.steps.map((step, index) => [step.stepId, index]));
  const measurements = observation.measurements.filter((item) => stepOrder.has(item.stepId));

  let bottleneckStepId: string | undefined;
  let bottleneckUtilization: number | undefined;
  for (const measurement of measurements) {
    const utilization = measurement.utilization;
    if (utilization === undefined || utilization < policy.utilizationThreshold) continue;
    const better =
      bottleneckStepId === undefined ||
      utilization > (bottleneckUtilization ?? 0) ||
      (utilization === bottleneckUtilization &&
        (stepOrder.get(measurement.stepId) ?? 0) < (stepOrder.get(bottleneckStepId) ?? 0));
    if (better) {
      bottleneckStepId = measurement.stepId;
      bottleneckUtilization = utilization;
    }
  }

  const duplicated = new Set<string>();
  for (const measurement of measurements) {
    for (const target of measurement.duplicates ?? []) {
      if (stepOrder.has(target)) duplicated.add(target);
    }
  }
  const duplicatedStepIds = [...duplicated].sort(
    (a, b) => (stepOrder.get(a) ?? 0) - (stepOrder.get(b) ?? 0),
  );

  let anyShare = false;
  let variantCoverage = 0;
  for (const variant of revision.variants) {
    if (variant.share !== undefined) {
      anyShare = true;
      variantCoverage += variant.share;
    }
  }

  return {
    processId: process.processId,
    revisionNumber: revision.revisionNumber,
    observationId: observation.observationId,
    period: observation.period,
    stepCount: revision.steps.length,
    handoffCount: revision.handoffs.length,
    variantCount: revision.variants.length,
    variantCoverage: anyShare ? variantCoverage : undefined,
    bottleneckStepId,
    bottleneckUtilization,
    totalManualEffortMs: measurements.reduce((sum, m) => sum + (m.manualEffortMs ?? 0), 0),
    totalWaitingTimeMs: measurements.reduce((sum, m) => sum + (m.waitingTimeMs ?? 0), 0),
    totalErrors: measurements.reduce((sum, m) => sum + (m.errorCount ?? 0), 0),
    duplicatedStepIds: Object.freeze(duplicatedStepIds),
  };
}
