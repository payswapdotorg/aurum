/**
 * Contextual constraint shapes (W005 frozen shared vocabulary). The context
 * dimensions a candidate organization is conditioned on, from
 * spec/DOMAIN-MAPPING.md: season, date/window, duration, staffing,
 * experience, workload, geography, budget, SLA, quality, inspection
 * intensity, risk tolerance, environment capability and evidence freshness.
 * All fields optional — a constraint shape records what the context pins
 * down, never invented values.
 */
import type { DomainTimestamp } from "../core/branding.js";
import type { ValidationIssue } from "../core/errors.js";

export const INSPECTION_INTENSITIES = ["low", "medium", "high"] as const;

export type InspectionIntensity = (typeof INSPECTION_INTENSITIES)[number];

export const RISK_TOLERANCES = ["low", "medium", "high"] as const;

export type RiskTolerance = (typeof RISK_TOLERANCES)[number];

/** Staffing envelope for the candidate window. */
export interface StaffingBounds {
  readonly minHeadcount?: number;
  readonly maxHeadcount?: number;
}

/** Service-level expectations. */
export interface SlaConstraints {
  readonly maxDurationMs?: number;
  /** Required success rate as a fraction in [0, 1]. */
  readonly successRate?: number;
}

/** Quality expectations. */
export interface QualityConstraints {
  /** Minimum acceptable capability proficiency level (1..5). */
  readonly minLevel?: number;
}

/** Budget envelope (amounts in an opaque unit; currency optional). */
export interface BudgetConstraint {
  readonly maxCost?: number;
  readonly currency?: string;
}

/** Evidence freshness requirement attached to the context. */
export interface EvidenceFreshnessConstraint {
  readonly maxAgeMs: number;
}

/** The full contextual constraint shape (all fields optional). */
export interface ContextualConstraints {
  readonly season?: string;
  readonly window?: { readonly start: DomainTimestamp; readonly end: DomainTimestamp };
  /** Planned duration in milliseconds. */
  readonly duration?: number;
  readonly staffing?: StaffingBounds;
  /** Minimum experience in years. */
  readonly minExperience?: number;
  /** Expected workload level (unit-free demand figure). */
  readonly workload?: number;
  readonly geography?: string;
  readonly budget?: BudgetConstraint;
  readonly sla?: SlaConstraints;
  readonly quality?: QualityConstraints;
  readonly inspectionIntensity?: InspectionIntensity;
  readonly riskTolerance?: RiskTolerance;
  /** Required environment capabilities (opaque capability names). */
  readonly environmentCapabilities?: readonly string[];
  readonly evidenceFreshness?: EvidenceFreshnessConstraint;
}

/** Validates contextual constraints. Returns issues, empty when valid. */
export function contextualConstraintIssues(
  constraints: ContextualConstraints | undefined,
  field = "constraints",
): ValidationIssue[] {
  if (constraints === undefined) return [];
  if (typeof constraints !== "object" || constraints === null) {
    return [{ field, problem: "must be an object when present" }];
  }
  const issues: ValidationIssue[] = [];
  if (constraints.season !== undefined && constraints.season.trim().length === 0) {
    issues.push({ field: `${field}.season`, problem: "must be non-empty when present" });
  }
  const window = constraints.window;
  if (window !== undefined) {
    if (
      typeof window.start !== "number" ||
      !Number.isFinite(window.start) ||
      window.start < 0 ||
      typeof window.end !== "number" ||
      !Number.isFinite(window.end) ||
      window.end < 0 ||
      window.start > window.end
    ) {
      issues.push({ field: `${field}.window`, problem: "must be a valid time window" });
    }
  }
  for (const key of ["duration", "minExperience", "workload"] as const) {
    const value = constraints[key];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    ) {
      issues.push({
        field: `${field}.${key}`,
        problem: "must be a non-negative number when present",
      });
    }
  }
  const staffing = constraints.staffing;
  if (staffing !== undefined) {
    if (
      staffing.minHeadcount !== undefined &&
      (!Number.isInteger(staffing.minHeadcount) || staffing.minHeadcount < 0)
    ) {
      issues.push({
        field: `${field}.staffing.minHeadcount`,
        problem: "must be a non-negative integer",
      });
    }
    if (
      staffing.maxHeadcount !== undefined &&
      (!Number.isInteger(staffing.maxHeadcount) || staffing.maxHeadcount < 0)
    ) {
      issues.push({
        field: `${field}.staffing.maxHeadcount`,
        problem: "must be a non-negative integer",
      });
    }
    if (
      staffing.minHeadcount !== undefined &&
      staffing.maxHeadcount !== undefined &&
      staffing.minHeadcount > staffing.maxHeadcount
    ) {
      issues.push({
        field: `${field}.staffing`,
        problem: "minHeadcount must not exceed maxHeadcount",
      });
    }
  }
  if (constraints.geography !== undefined && constraints.geography.trim().length === 0) {
    issues.push({ field: `${field}.geography`, problem: "must be non-empty when present" });
  }
  const budget = constraints.budget;
  if (budget !== undefined) {
    if (
      budget.maxCost !== undefined &&
      (typeof budget.maxCost !== "number" || !Number.isFinite(budget.maxCost) || budget.maxCost < 0)
    ) {
      issues.push({ field: `${field}.budget.maxCost`, problem: "must be a non-negative number" });
    }
    if (budget.currency !== undefined && budget.currency.trim().length === 0) {
      issues.push({ field: `${field}.budget.currency`, problem: "must be non-empty when present" });
    }
  }
  const sla = constraints.sla;
  if (sla !== undefined) {
    if (
      sla.maxDurationMs !== undefined &&
      (typeof sla.maxDurationMs !== "number" ||
        !Number.isFinite(sla.maxDurationMs) ||
        sla.maxDurationMs < 0)
    ) {
      issues.push({
        field: `${field}.sla.maxDurationMs`,
        problem: "must be a non-negative number",
      });
    }
    if (
      sla.successRate !== undefined &&
      (typeof sla.successRate !== "number" ||
        !Number.isFinite(sla.successRate) ||
        sla.successRate < 0 ||
        sla.successRate > 1)
    ) {
      issues.push({ field: `${field}.sla.successRate`, problem: "must be a fraction in [0, 1]" });
    }
  }
  const quality = constraints.quality;
  if (
    quality?.minLevel !== undefined &&
    (!Number.isInteger(quality.minLevel) || quality.minLevel < 1 || quality.minLevel > 5)
  ) {
    issues.push({
      field: `${field}.quality.minLevel`,
      problem: "must be an integer level in 1..5",
    });
  }
  if (
    constraints.inspectionIntensity !== undefined &&
    !(INSPECTION_INTENSITIES as readonly string[]).includes(constraints.inspectionIntensity)
  ) {
    issues.push({ field: `${field}.inspectionIntensity`, problem: "must be low, medium or high" });
  }
  if (
    constraints.riskTolerance !== undefined &&
    !(RISK_TOLERANCES as readonly string[]).includes(constraints.riskTolerance)
  ) {
    issues.push({ field: `${field}.riskTolerance`, problem: "must be low, medium or high" });
  }
  const environmentCapabilities = Array.isArray(constraints.environmentCapabilities)
    ? constraints.environmentCapabilities
    : undefined;
  if (environmentCapabilities !== undefined && environmentCapabilities.length === 0) {
    issues.push({
      field: `${field}.environmentCapabilities`,
      problem: "must be non-empty when present",
    });
  }
  const freshness = constraints.evidenceFreshness;
  if (
    freshness !== undefined &&
    (typeof freshness.maxAgeMs !== "number" ||
      !Number.isFinite(freshness.maxAgeMs) ||
      freshness.maxAgeMs <= 0)
  ) {
    issues.push({
      field: `${field}.evidenceFreshness.maxAgeMs`,
      problem: "must be a positive number",
    });
  }
  return issues;
}
