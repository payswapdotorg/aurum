/**
 * The OrganizationCandidate (W005 frozen shared vocabulary — one of the most
 * important integration contracts in the architecture). spec/DOMAIN-MAPPING.md:
 * "OrganizationCandidate contains mixed human/agent/software/external actors,
 * assignments, capability/workload allocation, execution/information topology,
 * delegation, review, escalation, handoffs, model occupancy, environment,
 * budget, expected outcome, risk and evidence."
 *
 * A candidate is a *proposal* — analysis, not authority. Activation and
 * execution are owned downstream (action authority, W008/W009); this
 * vocabulary only guarantees the shape and the evidence trail.
 */
import type { DomainTimestamp, GoalId, OrganizationCandidateId } from "../core/branding.js";
import type { TenantScopedRecord } from "../core/scope.js";
import type { ActorReference, SubjectReference } from "../core/refs.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { CandidateActor, ModelOccupancy } from "./actors.js";
import { candidateActorIssues, modelOccupancyIssues } from "./actors.js";
import type { ActorAssignment, CapabilityAllocation } from "./allocations.js";
import { actorAssignmentIssues, capabilityAllocationIssues } from "./allocations.js";
import type { ExecutionTopology, InformationTopology } from "./topology.js";
import { executionTopologyIssues, informationTopologyIssues } from "./topology.js";
import type { ContextualConstraints } from "./constraints.js";
import { contextualConstraintIssues } from "./constraints.js";
import type { ValidationIssue } from "../core/errors.js";
import { isKnownSubjectKind } from "../core/refs.js";

export const CANDIDATE_RISK_SEVERITIES = ["low", "medium", "high"] as const;

export type CandidateRiskSeverity = (typeof CANDIDATE_RISK_SEVERITIES)[number];

/** Risk vocabulary attached to a candidate. */
export const CANDIDATE_RISK_KINDS = [
  "operational",
  "capability",
  "cost",
  "continuity",
  "information",
  "employment",
  "other",
] as const;

export type CandidateRiskKind = (typeof CANDIDATE_RISK_KINDS)[number];

/** One identified risk of running this candidate organization. */
export interface CandidateRisk {
  readonly kind: CandidateRiskKind;
  readonly description: string;
  readonly severity: CandidateRiskSeverity;
  readonly mitigation?: string;
}

/** Budget breakdown of a candidate (amounts in an opaque unit). */
export interface CandidateBudget {
  readonly maxTotalCost?: number;
  readonly currency?: string;
  readonly humanCost?: number;
  readonly agentCost?: number;
  readonly softwareCost?: number;
  readonly externalCost?: number;
}

/** Execution environment reference (W006 owns the environment registry). */
export interface EnvironmentRef {
  readonly environmentRef: string;
  readonly requiredCapabilities?: readonly string[];
}

/** What the candidate is expected to achieve. */
export interface ExpectedOutcome {
  /** The goal this candidate serves (opaque goal reference). */
  readonly goalId?: GoalId;
  readonly metric?: string;
  readonly target: number;
  /** Confidence in achieving the target, 0..1. */
  readonly confidence: number;
}

/**
 * The candidate organization: the full mixed-actor proposal with
 * allocations, topologies, occupancy, environment, budget, expected
 * outcome, risks and evidence. Tenant-scoped, immutable once registered.
 */
export interface OrganizationCandidate extends TenantScopedRecord {
  readonly candidateId: OrganizationCandidateId;
  readonly goalId?: GoalId;
  /** Lab-computed context fingerprint this candidate is conditioned on. */
  readonly contextFingerprint?: string;
  readonly constraints?: ContextualConstraints;
  readonly actors: readonly CandidateActor[];
  readonly assignments: readonly ActorAssignment[];
  readonly capabilityAllocations: readonly CapabilityAllocation[];
  readonly topology: {
    readonly execution: ExecutionTopology;
    readonly information: InformationTopology;
  };
  readonly modelOccupancy: readonly ModelOccupancy[];
  readonly environment: readonly EnvironmentRef[];
  readonly budget?: CandidateBudget;
  readonly expectedOutcome: ExpectedOutcome;
  readonly risks: readonly CandidateRisk[];
  /** Evidence backing this candidate; required non-empty. */
  readonly evidenceRefs: readonly SubjectReference[];
  readonly proposedBy: ActorReference;
  readonly proposedAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
}

function validateSubjectRef(
  subject: { kind?: unknown; id?: unknown } | undefined,
  field: string,
  issues: ValidationIssue[],
): void {
  if (
    !subject ||
    typeof subject.kind !== "string" ||
    !isKnownSubjectKind(subject.kind) ||
    typeof subject.id !== "string" ||
    subject.id.trim().length === 0
  ) {
    issues.push({ field, problem: "must be a typed subject reference" });
  }
}

function validateRisks(
  risks: readonly CandidateRisk[] | undefined,
  issues: ValidationIssue[],
): void {
  const list = Array.isArray(risks) ? risks : [];
  list.forEach((risk, index) => {
    const field = `risks.${index}`;
    if (!(CANDIDATE_RISK_KINDS as readonly string[]).includes(String(risk?.kind))) {
      issues.push({ field: `${field}.kind`, problem: "must be a known candidate risk kind" });
    }
    if (typeof risk?.description !== "string" || risk.description.trim().length === 0) {
      issues.push({ field: `${field}.description`, problem: "must be a non-empty string" });
    }
    if (!(CANDIDATE_RISK_SEVERITIES as readonly string[]).includes(String(risk?.severity))) {
      issues.push({ field: `${field}.severity`, problem: "must be low, medium or high" });
    }
    if (risk?.mitigation !== undefined && risk.mitigation.trim().length === 0) {
      issues.push({ field: `${field}.mitigation`, problem: "must be non-empty when present" });
    }
  });
}

function validateBudget(budget: CandidateBudget | undefined, issues: ValidationIssue[]): void {
  if (budget === undefined) return;
  for (const key of [
    "maxTotalCost",
    "humanCost",
    "agentCost",
    "softwareCost",
    "externalCost",
  ] as const) {
    const value = budget[key];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    ) {
      issues.push({
        field: `budget.${key}`,
        problem: "must be a non-negative number when present",
      });
    }
  }
  if (budget.currency !== undefined && budget.currency.trim().length === 0) {
    issues.push({ field: "budget.currency", problem: "must be non-empty when present" });
  }
}

function validateExpectedOutcome(
  outcome: ExpectedOutcome | undefined,
  issues: ValidationIssue[],
): void {
  if (!outcome || typeof outcome !== "object") {
    issues.push({ field: "expectedOutcome", problem: "is required" });
    return;
  }
  if (typeof outcome.target !== "number" || !Number.isFinite(outcome.target)) {
    issues.push({ field: "expectedOutcome.target", problem: "must be a finite number" });
  }
  if (
    typeof outcome.confidence !== "number" ||
    !Number.isFinite(outcome.confidence) ||
    outcome.confidence < 0 ||
    outcome.confidence > 1
  ) {
    issues.push({ field: "expectedOutcome.confidence", problem: "must be a fraction in [0, 1]" });
  }
  if (outcome.metric !== undefined && outcome.metric.trim().length === 0) {
    issues.push({ field: "expectedOutcome.metric", problem: "must be non-empty when present" });
  }
}

/**
 * Deep validation of an OrganizationCandidate. Returns issues, empty when
 * valid. Checks actor targets, dangling actor/step references in
 * assignments, allocations, topologies, model occupancy, budget, expected
 * outcome, risks, constraints and the mandatory evidence trail.
 */
export function organizationCandidateIssues(
  candidate: OrganizationCandidate | undefined,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!candidate || typeof candidate !== "object") {
    return [{ field: "candidate", problem: "is required" }];
  }
  const actors = Array.isArray(candidate.actors) ? candidate.actors : [];
  if (actors.length === 0) {
    issues.push({ field: "actors", problem: "must be a non-empty array" });
  }
  const actorIds = new Set<string>();
  const actorKinds = new Map<string, string>();
  actors.forEach((actor, index) => {
    for (const issue of candidateActorIssues(actor, `actors.${index}`)) {
      issues.push(issue);
    }
    if (actor?.actorId) {
      if (actorIds.has(actor.actorId)) {
        issues.push({
          field: `actors.${index}.actorId`,
          problem: `duplicate actor id: ${actor.actorId}`,
        });
      }
      actorIds.add(actor.actorId);
      actorKinds.set(actor.actorId, String(actor.kind));
    }
  });
  const topology = candidate.topology;
  if (!topology || typeof topology !== "object") {
    issues.push({ field: "topology", problem: "is required" });
  }
  const executionSteps = Array.isArray(topology?.execution?.steps) ? topology.execution.steps : [];
  const stepIds = new Set<string>(executionSteps.map((step) => String(step?.stepId ?? "")));
  const typedActorKinds = new Map<string, (typeof actors)[number]["kind"]>();
  for (const [id, kind] of actorKinds) {
    typedActorKinds.set(id, kind as (typeof actors)[number]["kind"]);
  }
  if (topology && typeof topology === "object") {
    issues.push(...executionTopologyIssues(topology.execution, actorIds));
    issues.push(...informationTopologyIssues(topology.information, actorIds, stepIds));
  }
  const assignments = Array.isArray(candidate.assignments) ? candidate.assignments : [];
  const assignmentIds = new Set<string>();
  assignments.forEach((assignment, index) => {
    for (const issue of actorAssignmentIssues(
      assignment,
      actorIds,
      stepIds,
      `assignments.${index}`,
    )) {
      issues.push(issue);
    }
    if (assignment?.assignmentId) {
      if (assignmentIds.has(assignment.assignmentId)) {
        issues.push({
          field: `assignments.${index}.assignmentId`,
          problem: `duplicate assignment id: ${assignment.assignmentId}`,
        });
      }
      assignmentIds.add(assignment.assignmentId);
    }
  });
  const allocations = Array.isArray(candidate.capabilityAllocations)
    ? candidate.capabilityAllocations
    : [];
  const allocationIds = new Set<string>();
  allocations.forEach((allocation, index) => {
    for (const issue of capabilityAllocationIssues(
      allocation,
      actorIds,
      `capabilityAllocations.${index}`,
    )) {
      issues.push(issue);
    }
    if (allocation?.allocationId) {
      if (allocationIds.has(allocation.allocationId)) {
        issues.push({
          field: `capabilityAllocations.${index}.allocationId`,
          problem: `duplicate allocation id: ${allocation.allocationId}`,
        });
      }
      allocationIds.add(allocation.allocationId);
    }
  });
  const occupancy = Array.isArray(candidate.modelOccupancy) ? candidate.modelOccupancy : [];
  occupancy.forEach((entry, index) => {
    issues.push(...modelOccupancyIssues(entry, typedActorKinds, `modelOccupancy.${index}`));
  });
  const environment = Array.isArray(candidate.environment) ? candidate.environment : [];
  environment.forEach((entry, index) => {
    if (typeof entry?.environmentRef !== "string" || entry.environmentRef.trim().length === 0) {
      issues.push({
        field: `environment.${index}.environmentRef`,
        problem: "must be a non-empty reference",
      });
    }
  });
  issues.push(...contextualConstraintIssues(candidate.constraints));
  validateBudget(candidate.budget, issues);
  validateExpectedOutcome(candidate.expectedOutcome, issues);
  validateRisks(candidate.risks, issues);
  const evidenceRefs = Array.isArray(candidate.evidenceRefs) ? candidate.evidenceRefs : [];
  if (evidenceRefs.length === 0) {
    issues.push({ field: "evidenceRefs", problem: "must reference at least one evidence record" });
  }
  evidenceRefs.forEach((ref, index) => {
    validateSubjectRef(ref, `evidenceRefs.${index}`, issues);
  });
  if (candidate.proposedBy === undefined || typeof candidate.proposedBy.kind !== "string") {
    issues.push({ field: "proposedBy", problem: "is required" });
  }
  if (
    typeof candidate.proposedAt !== "number" ||
    !Number.isFinite(candidate.proposedAt) ||
    candidate.proposedAt < 0
  ) {
    issues.push({ field: "proposedAt", problem: "must be finite epoch milliseconds >= 0" });
  }
  return issues;
}
