/**
 * Constrained allocation (W008 domain layer, pure): ActorAssignment /
 * CapabilityAllocation synthesis from search results, with the W005
 * allocation issue validators (`actorAssignmentIssues`,
 * `capabilityAllocationIssues`) as the ACCEPTANCE GATE. Allocations that fail
 * validation are refused with a typed lab error carrying the verbatim issue
 * list (catalog: the lab never lets an invalid allocation through).
 *
 * Lab-side capacity discipline on top of the W005 structural validators:
 * the per-actor committed effort share must stay within the allocation
 * limits (default: at most 1.0 total effort per actor).
 */
import {
  actorAssignmentIssues,
  capabilityAllocationIssues,
  type ActorAssignment,
  type CapabilityAllocation,
  type OrganizationCandidate,
  type TimeWindow,
  type ValidationIssue,
} from "@aurum/domain";
import { err, ok, type Result } from "@aurum/domain";
import { labAllocationRefused, labValidationError, type LabError } from "./errors.js";
import type { AllocationLimits } from "./constraints.js";
import { DEFAULT_ALLOCATION_LIMITS } from "./constraints.js";

/** Caller directive for one actor assignment. */
export interface AssignmentDirective {
  readonly actorId: string;
  readonly position: string;
  readonly stepRefs?: readonly string[];
  /** Fraction of the actor's effort for this assignment, (0, 1]. */
  readonly effortShare: number;
  readonly period?: TimeWindow;
}

/** Caller directive for one capability allocation. */
export interface AllocationDirective {
  readonly capabilityId: string;
  readonly requirementRef?: string;
  readonly actorIds: readonly string[];
  readonly level: number;
  readonly capacityPerPeriod: number;
  readonly workloadShare?: number;
}

/** Directives for one synthesis call. */
export interface AllocationDirectives {
  readonly assignments: readonly AssignmentDirective[];
  readonly allocations: readonly AllocationDirective[];
}

/** The synthesis result: frozen, W005-valid assignment/allocation sets. */
export interface AllocationSynthesis {
  readonly assignments: readonly ActorAssignment[];
  readonly allocations: readonly CapabilityAllocation[];
  /** Per-actor committed effort (inspectability: who is loaded how much). */
  readonly committedEffort: ReadonlyMap<string, number>;
}

function directiveIssues(directives: AllocationDirectives | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!directives || typeof directives !== "object") {
    return [{ field: "directives", problem: "are required" }];
  }
  if (!Array.isArray(directives.assignments) || directives.assignments.length === 0) {
    issues.push({ field: "assignments", problem: "must be a non-empty array of directives" });
  }
  if (!Array.isArray(directives.allocations) || directives.allocations.length === 0) {
    issues.push({ field: "allocations", problem: "must be a non-empty array of directives" });
  }
  return issues;
}

/**
 * Synthesizes W005-valid assignments and allocations from directives against
 * a candidate organization's declared actor and step sets. The W005
 * validators are the acceptance gate: ANY issue refuses the whole synthesis
 * with the complete issue list (no partial application).
 */
export function synthesizeAllocation(
  candidate: OrganizationCandidate,
  directives: AllocationDirectives,
  limits: AllocationLimits = DEFAULT_ALLOCATION_LIMITS,
): Result<AllocationSynthesis, LabError> {
  const structural = directiveIssues(directives);
  if (structural.length > 0) return err(labValidationError(structural));

  const actorIds = new Set(candidate.actors.map((actor) => actor.actorId));
  const stepIds = new Set(candidate.topology.execution.steps.map((step) => step.stepId));

  const assignments: ActorAssignment[] = [];
  const issues: ValidationIssue[] = [];
  directives.assignments.forEach((directive, index) => {
    const assignment: ActorAssignment = {
      assignmentId: `lab-assign-${index}`,
      actorId: directive.actorId,
      position: directive.position,
      ...(directive.stepRefs ? { stepRefs: Object.freeze([...directive.stepRefs]) } : {}),
      effortShare: directive.effortShare,
      ...(directive.period ? { period: directive.period } : {}),
    };
    issues.push(...actorAssignmentIssues(assignment, actorIds, stepIds, `assignments.${index}`));
    assignments.push(assignment);
  });

  const allocations: CapabilityAllocation[] = [];
  directives.allocations.forEach((directive, index) => {
    const allocation: CapabilityAllocation = {
      allocationId: `lab-alloc-${index}`,
      capabilityId: directive.capabilityId as CapabilityAllocation["capabilityId"],
      ...(directive.requirementRef ? { requirementRef: directive.requirementRef } : {}),
      actorIds: Object.freeze([...directive.actorIds]),
      level: directive.level,
      capacityPerPeriod: directive.capacityPerPeriod,
      ...(directive.workloadShare !== undefined ? { workloadShare: directive.workloadShare } : {}),
    };
    issues.push(
      ...capabilityAllocationIssues(allocation, actorIds, `capabilityAllocations.${index}`),
    );
    allocations.push(allocation);
  });

  // Lab-side capacity discipline: per-actor committed effort within limits.
  const committed = new Map<string, number>();
  for (const assignment of assignments) {
    committed.set(
      assignment.actorId,
      (committed.get(assignment.actorId) ?? 0) + assignment.effortShare,
    );
  }
  for (const [actorId, total] of committed) {
    if (total > limits.maxTotalEffortPerActor + 1e-9) {
      issues.push({
        field: "assignments",
        problem: `actor ${actorId} committed effort ${Math.round(total * 100) / 100} exceeds the limit ${limits.maxTotalEffortPerActor}`,
      });
    }
  }
  const perActorCount = new Map<string, number>();
  for (const assignment of assignments) {
    perActorCount.set(assignment.actorId, (perActorCount.get(assignment.actorId) ?? 0) + 1);
  }
  for (const [actorId, count] of perActorCount) {
    if (count > limits.maxAssignmentsPerActor) {
      issues.push({
        field: "assignments",
        problem: `actor ${actorId} holds ${count} assignments (limit ${limits.maxAssignmentsPerActor})`,
      });
    }
  }
  for (const allocation of allocations) {
    if (allocation.actorIds.length > limits.maxActorsPerAllocation) {
      issues.push({
        field: "capabilityAllocations",
        problem: `allocation ${allocation.allocationId} involves ${allocation.actorIds.length} actors (limit ${limits.maxActorsPerAllocation})`,
      });
    }
  }

  if (issues.length > 0) return err(labAllocationRefused(issues));

  return ok({
    assignments: Object.freeze(assignments),
    allocations: Object.freeze(allocations),
    committedEffort: Object.freeze(committed),
  });
}

/**
 * Extracts the allocation limits actually applied (from the constraint set
 * or caller input, falling back to the documented defaults) — recorded on
 * results so callers can inspect which limits gated the synthesis.
 */
export function limitsOf(
  set: { readonly allocationLimits?: AllocationLimits } | undefined,
): AllocationLimits {
  return set?.allocationLimits ?? DEFAULT_ALLOCATION_LIMITS;
}
