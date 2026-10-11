/**
 * Lab constraint model (W008 domain layer): constraints are first-class and
 * INSPECTABLE. Every search result carries the exact constraint set applied
 * plus which constraints BOUND each candidate organization (catalog
 * acceptance clause 3).
 *
 * The shapes reuse the W005 contextual constraint vocabulary
 * (`ContextualConstraints`, `StaffingBounds`, `BudgetConstraint`,
 * `QualityConstraints`, `SlaConstraints`) wherever the semantics already
 * exist, and add the lab-local allocation limits that the W005 shapes do not
 * cover. Nothing here invents domain state: the set is caller-supplied data
 * (defaults are explicit constants below).
 */
import type {
  BudgetConstraint,
  CandidateActor,
  OrganizationCandidate,
  QualityConstraints,
  RiskTolerance,
  SlaConstraints,
  StaffingBounds,
  ValidationIssue,
} from "@aurum/domain";
import type { CapabilityDemand } from "./fingerprint.js";

/** Limits applied while synthesizing assignments/allocations. */
export interface AllocationLimits {
  /** Maximum assignments one actor may hold in a candidate. */
  readonly maxAssignmentsPerActor: number;
  /** Maximum actors contributing to one capability allocation. */
  readonly maxActorsPerAllocation: number;
  /** Maximum total effort share one actor may commit (0, 1]. */
  readonly maxTotalEffortPerActor: number;
}

export const DEFAULT_ALLOCATION_LIMITS: AllocationLimits = {
  maxAssignmentsPerActor: 4,
  maxActorsPerAllocation: 3,
  maxTotalEffortPerActor: 1,
};

/**
 * Cost-proxy unit table by candidate actor kind (opaque units — a proxy for
 * relative operating cost, NOT a price). Documented and deterministic.
 */
export const COST_PROXY_UNITS: Readonly<Record<string, number>> = {
  human: 100,
  team: 90,
  agent: 40,
  "agent-team": 36,
  software: 10,
  automation: 5,
  supplier: 80,
  partner: 60,
  "external-service": 30,
};

/**
 * The full, inspectable constraint set the lab applies during search and
 * evaluation. Mirrors `ContextualConstraints` (W005) plus lab allocation
 * limits plus the capability demand the constraints apply to.
 */
export interface LabConstraintSet {
  readonly staffing?: StaffingBounds;
  readonly budget?: BudgetConstraint;
  readonly quality?: QualityConstraints;
  readonly sla?: SlaConstraints;
  readonly riskTolerance?: RiskTolerance;
  readonly allocationLimits: AllocationLimits;
  /** Capability demand the constraint set governs (the fingerprint profile). */
  readonly capabilityDemand: readonly CapabilityDemand[];
  /**
   * Cost normalization reference for the cost-proxy criterion (opaque units).
   * Deterministic default when omitted: `defaultReferenceBudget(demand)`.
   */
  readonly referenceBudget?: number;
}

/** Deterministic default reference budget (documented, demand-driven). */
export function defaultReferenceBudget(demand: readonly CapabilityDemand[]): number {
  return demand.reduce((sum, entry) => sum + 60 * entry.requiredLevel, 0) + 120;
}

/** Validates a constraint set. Returns issues, empty when valid. */
export function constraintSetIssues(set: LabConstraintSet | undefined): ValidationIssue[] {
  if (!set || typeof set !== "object") {
    return [{ field: "constraints", problem: "constraint set is required" }];
  }
  const issues: ValidationIssue[] = [];
  const staffing = set.staffing;
  if (staffing !== undefined) {
    for (const key of ["minHeadcount", "maxHeadcount"] as const) {
      const value = staffing[key];
      if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
        issues.push({
          field: `constraints.staffing.${key}`,
          problem: "must be a non-negative integer when present",
        });
      }
    }
    if (
      staffing.minHeadcount !== undefined &&
      staffing.maxHeadcount !== undefined &&
      staffing.minHeadcount > staffing.maxHeadcount
    ) {
      issues.push({
        field: "constraints.staffing",
        problem: "minHeadcount must not exceed maxHeadcount",
      });
    }
  }
  if (set.budget?.maxCost !== undefined) {
    const maxCost = set.budget.maxCost;
    if (typeof maxCost !== "number" || !Number.isFinite(maxCost) || maxCost < 0) {
      issues.push({
        field: "constraints.budget.maxCost",
        problem: "must be a non-negative number",
      });
    }
  }
  if (set.quality?.minLevel !== undefined) {
    const minLevel = set.quality.minLevel;
    if (!Number.isInteger(minLevel) || minLevel < 1 || minLevel > 5) {
      issues.push({
        field: "constraints.quality.minLevel",
        problem: "must be an integer level in 1..5",
      });
    }
  }
  if (set.sla?.maxDurationMs !== undefined) {
    const maxDuration = set.sla.maxDurationMs;
    if (typeof maxDuration !== "number" || !Number.isFinite(maxDuration) || maxDuration < 0) {
      issues.push({
        field: "constraints.sla.maxDurationMs",
        problem: "must be a non-negative number",
      });
    }
  }
  const limits = set.allocationLimits;
  if (!limits || typeof limits !== "object") {
    issues.push({ field: "constraints.allocationLimits", problem: "are required" });
  } else {
    for (const key of ["maxAssignmentsPerActor", "maxActorsPerAllocation"] as const) {
      const value = limits[key];
      if (!Number.isInteger(value) || value < 1) {
        issues.push({
          field: `constraints.allocationLimits.${key}`,
          problem: "must be an integer >= 1",
        });
      }
    }
    const effort = limits.maxTotalEffortPerActor;
    if (typeof effort !== "number" || !Number.isFinite(effort) || effort <= 0 || effort > 1) {
      issues.push({
        field: "constraints.allocationLimits.maxTotalEffortPerActor",
        problem: "must be a fraction in (0, 1]",
      });
    }
  }
  if (set.referenceBudget !== undefined) {
    const budget = set.referenceBudget;
    if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) {
      issues.push({
        field: "constraints.referenceBudget",
        problem: "must be a positive number when present",
      });
    }
  }
  if (!Array.isArray(set.capabilityDemand) || set.capabilityDemand.length === 0) {
    issues.push({
      field: "constraints.capabilityDemand",
      problem: "must be a non-empty demand profile",
    });
  }
  return issues;
}

/** One constraint that actually bounded a candidate (inspectable evidence). */
export interface BindingConstraint {
  readonly kind: string;
  readonly description: string;
  /** The value reached. */
  readonly value: number;
  /** The limit that made it binding. */
  readonly limit: number;
}

const HUMAN_LIKE = new Set(["human", "team"]);

function headcountOf(actors: readonly CandidateActor[]): number {
  return actors.filter((actor) => HUMAN_LIKE.has(actor.kind)).length;
}

/** Total cost-proxy estimate of a candidate (unit table x effort share). */
export function costProxyOf(candidate: OrganizationCandidate, urgencyPremium: number): number {
  return candidate.assignments.reduce((total, assignment) => {
    const actor = candidate.actors.find((item) => item.actorId === assignment.actorId);
    const unit = actor ? (COST_PROXY_UNITS[actor.kind] ?? 50) : 50;
    const premium = actor && HUMAN_LIKE.has(actor.kind) ? urgencyPremium : 1;
    return total + unit * assignment.effortShare * premium;
  }, 0);
}

/**
 * Evaluates which constraints of the set actually BOUND this candidate.
 * Pure and deterministic; the result is carried on every search result.
 */
export function bindingConstraintsOf(
  candidate: OrganizationCandidate,
  set: LabConstraintSet,
  urgencyPremium: number,
): readonly BindingConstraint[] {
  const bindings: BindingConstraint[] = [];
  const headcount = headcountOf(candidate.actors);
  if (set.staffing?.maxHeadcount !== undefined && headcount >= set.staffing.maxHeadcount) {
    bindings.push({
      kind: "staffing.maxHeadcount",
      description: "human/team headcount reached the staffing ceiling",
      value: headcount,
      limit: set.staffing.maxHeadcount,
    });
  }
  if (set.staffing?.minHeadcount !== undefined && headcount <= set.staffing.minHeadcount) {
    bindings.push({
      kind: "staffing.minHeadcount",
      description: "human/team headcount sits at the staffing floor",
      value: headcount,
      limit: set.staffing.minHeadcount,
    });
  }
  const totalCost = costProxyOf(candidate, urgencyPremium);
  if (set.budget?.maxCost !== undefined && totalCost >= set.budget.maxCost) {
    bindings.push({
      kind: "budget.maxCost",
      description: "cost proxy reached the budget ceiling",
      value: Math.round(totalCost * 100) / 100,
      limit: set.budget.maxCost,
    });
  }
  if (set.quality?.minLevel !== undefined) {
    const below = candidate.capabilityAllocations.filter(
      (allocation) => allocation.level < (set.quality?.minLevel ?? 1),
    );
    if (below.length > 0) {
      bindings.push({
        kind: "quality.minLevel",
        description: `${below.length} allocation(s) below the minimum quality level`,
        value: below.length,
        limit: set.quality?.minLevel ?? 0,
      });
    }
  }
  const perActor = new Map<string, number>();
  for (const assignment of candidate.assignments) {
    perActor.set(assignment.actorId, (perActor.get(assignment.actorId) ?? 0) + 1);
  }
  const maxAssignments = Math.max(0, ...perActor.values());
  if (maxAssignments > set.allocationLimits.maxAssignmentsPerActor) {
    bindings.push({
      kind: "allocationLimits.maxAssignmentsPerActor",
      description: "an actor holds more assignments than allowed",
      value: maxAssignments,
      limit: set.allocationLimits.maxAssignmentsPerActor,
    });
  }
  const maxActorsPerAllocation = Math.max(
    0,
    ...candidate.capabilityAllocations.map((allocation) => allocation.actorIds.length),
  );
  if (maxActorsPerAllocation > set.allocationLimits.maxActorsPerAllocation) {
    bindings.push({
      kind: "allocationLimits.maxActorsPerAllocation",
      description: "an allocation involves more actors than allowed",
      value: maxActorsPerAllocation,
      limit: set.allocationLimits.maxActorsPerAllocation,
    });
  }
  return Object.freeze(bindings);
}
