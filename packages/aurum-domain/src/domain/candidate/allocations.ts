/**
 * Actor assignments and capability allocations (W005 frozen shared
 * vocabulary, spec/DOMAIN-MAPPING.md "OrganizationCandidate contains ...
 * assignments, capability/workload allocation"). These shapes are the
 * integration contract consumed by the Lab (W008), ExecutionPlan (W009) and
 * outcome learning (W013); they are validated structurally here.
 */
import type { CapabilityId } from "../core/branding.js";
import type { TimeWindow } from "../core/time.js";
import type { ValidationIssue } from "../core/errors.js";

/**
 * Assignment of one candidate actor to one position (role/title) in the
 * candidate organization, optionally covering specific execution steps.
 */
export interface ActorAssignment {
  readonly assignmentId: string;
  /** Must reference a declared actor of the same candidate. */
  readonly actorId: string;
  readonly position: string;
  /** Execution topology step ids covered by this assignment. */
  readonly stepRefs?: readonly string[];
  /** Fraction of the actor's effort dedicated to this assignment, (0, 1]. */
  readonly effortShare: number;
  readonly period?: TimeWindow;
}

/** Validates one assignment against the candidate's actor/step sets. */
export function actorAssignmentIssues(
  assignment: ActorAssignment | undefined,
  actorIds: ReadonlySet<string>,
  stepIds: ReadonlySet<string>,
  field = "assignments",
): ValidationIssue[] {
  if (!assignment || typeof assignment !== "object") {
    return [{ field, problem: "is required" }];
  }
  const issues: ValidationIssue[] = [];
  if (typeof assignment.assignmentId !== "string" || assignment.assignmentId.trim().length === 0) {
    issues.push({ field: `${field}.assignmentId`, problem: "must be a non-empty string" });
  }
  if (!actorIds.has(assignment.actorId)) {
    issues.push({ field: `${field}.actorId`, problem: "must reference a declared actor" });
  }
  if (typeof assignment.position !== "string" || assignment.position.trim().length === 0) {
    issues.push({ field: `${field}.position`, problem: "must be a non-empty string" });
  }
  for (const stepRef of assignment.stepRefs ?? []) {
    if (!stepIds.has(stepRef)) {
      issues.push({
        field: `${field}.stepRefs`,
        problem: `must reference a declared execution step: ${String(stepRef)}`,
      });
    }
  }
  if (
    typeof assignment.effortShare !== "number" ||
    !Number.isFinite(assignment.effortShare) ||
    assignment.effortShare <= 0 ||
    assignment.effortShare > 1
  ) {
    issues.push({ field: `${field}.effortShare`, problem: "must be a fraction in (0, 1]" });
  }
  const period = assignment.period;
  if (period !== undefined) {
    if (
      typeof period.start !== "number" ||
      !Number.isFinite(period.start) ||
      period.start < 0 ||
      typeof period.end !== "number" ||
      !Number.isFinite(period.end) ||
      period.end < 0 ||
      period.start > period.end
    ) {
      issues.push({ field: `${field}.period`, problem: "must be a valid time window" });
    }
  }
  return issues;
}

/**
 * Allocation of a capability to specific actors: how the candidate covers a
 * capability demand, at what level and with what capacity.
 */
export interface CapabilityAllocation {
  readonly allocationId: string;
  readonly capabilityId: CapabilityId;
  /** Optional link to the driving capability requirement. */
  readonly requirementRef?: string;
  /** Must reference declared actors of the same candidate. */
  readonly actorIds: readonly string[];
  /** Expected proficiency level after allocation (1..5). */
  readonly level: number;
  /** Capacity the allocation commits per period. */
  readonly capacityPerPeriod: number;
  /** Optional workload share this allocation consumes, (0, 1]. */
  readonly workloadShare?: number;
}

/** Validates one capability allocation against the candidate's actor set. */
export function capabilityAllocationIssues(
  allocation: CapabilityAllocation | undefined,
  actorIds: ReadonlySet<string>,
  field = "capabilityAllocations",
): ValidationIssue[] {
  if (!allocation || typeof allocation !== "object") {
    return [{ field, problem: "is required" }];
  }
  const issues: ValidationIssue[] = [];
  if (typeof allocation.allocationId !== "string" || allocation.allocationId.trim().length === 0) {
    issues.push({ field: `${field}.allocationId`, problem: "must be a non-empty string" });
  }
  if (typeof allocation.capabilityId !== "string" || allocation.capabilityId.trim().length === 0) {
    issues.push({
      field: `${field}.capabilityId`,
      problem: "must be a non-empty capability reference",
    });
  }
  if (allocation.requirementRef !== undefined && allocation.requirementRef.trim().length === 0) {
    issues.push({ field: `${field}.requirementRef`, problem: "must be non-empty when present" });
  }
  const actors = Array.isArray(allocation.actorIds) ? allocation.actorIds : [];
  if (actors.length === 0) {
    issues.push({ field: `${field}.actorIds`, problem: "must be a non-empty array" });
  }
  for (const actorId of actors) {
    if (!actorIds.has(actorId)) {
      issues.push({
        field: `${field}.actorIds`,
        problem: `must reference a declared actor: ${String(actorId)}`,
      });
    }
  }
  if (
    !Number.isInteger(allocation.level) ||
    (allocation.level ?? 0) < 1 ||
    (allocation.level ?? 0) > 5
  ) {
    issues.push({ field: `${field}.level`, problem: "must be an integer level in 1..5" });
  }
  if (
    typeof allocation.capacityPerPeriod !== "number" ||
    !Number.isFinite(allocation.capacityPerPeriod) ||
    allocation.capacityPerPeriod < 0
  ) {
    issues.push({ field: `${field}.capacityPerPeriod`, problem: "must be a non-negative number" });
  }
  if (allocation.workloadShare !== undefined) {
    if (
      typeof allocation.workloadShare !== "number" ||
      !Number.isFinite(allocation.workloadShare) ||
      allocation.workloadShare <= 0 ||
      allocation.workloadShare > 1
    ) {
      issues.push({ field: `${field}.workloadShare`, problem: "must be a fraction in (0, 1]" });
    }
  }
  return issues;
}
