/**
 * Outcome join assembly (W013 app layer): builds the OutcomeJoinRecord by
 * reading the join sources through their read-only seams — the W008 lab
 * evaluation (context: fingerprint, constraint set, weights, ranking rule,
 * rank/score at evaluation time) and the W005 candidate value (organization,
 * actor allocation, model occupancy, information strategy, environment,
 * budget). Nothing here mutates domain or lab state; the only write is the
 * learning area's own append-only outcome record (performed by the caller).
 *
 * JOIN INTEGRITY (typed refusals, never silent skips):
 * - the candidate must appear in the evaluation's ranked list (the
 *   organization was actually ranked in that context);
 * - when the candidate carries a stamped `contextFingerprint`, it must
 *   equal the evaluation's `fingerprintDigest` (lab-produced candidates
 *   stamp it; external candidates may omit it);
 * - both anchors must exist in the requesting tenant (uniform not-found —
 *   no existence leakage).
 */
import {
  err,
  ok,
  provenanceIssues,
  type OrganizationCandidate,
  type Result,
  type SubjectReference,
  type TenantScope,
  type ValidationIssue,
} from "@aurum/domain";
import type { LabEvaluationRecord } from "../../lab/contract.lab.js";
import { costProxyOf } from "../../lab/contract.lab.js";
import { contextClassOf } from "../domain/contextClass.js";
import { organizationShapeOf } from "../domain/shape.js";
import {
  learningJoinAnchorNotFound,
  learningJoinRefused,
  learningValidationError,
} from "../domain/errors.js";
import type { LearningError } from "../domain/errors.js";
import type {
  AllocationJoin,
  CostJoin,
  InformationStrategyJoin,
  OccupancyJoin,
  OutcomeJoinRecord,
  RecordOutcomeInput,
} from "../domain/records.js";
import type { LearningCandidateViews, LearningEvaluationViews } from "../domain/ports.js";
import {
  isFailedOutcomeStatus,
  isKnownOutcomeSourceKind,
  isKnownOutcomeStatus,
} from "../domain/vocabulary.js";

const HUMAN_LIKE = new Set(["human", "team"]);
const AUTOMATED = new Set(["agent", "agent-team", "software", "automation"]);
const EXTERNAL = new Set(["supplier", "partner", "external-service"]);

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function observationIssues(input: RecordOutcomeInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const observation = input.observation;
  if (!observation || typeof observation !== "object") {
    return [{ field: "observation", problem: "is required" }];
  }
  if (!isKnownOutcomeStatus(String(observation.status))) {
    issues.push({ field: "observation.status", problem: "must be a known outcome status" });
  }
  if (
    !observation.source ||
    !isKnownOutcomeSourceKind(String(observation.source?.kind)) ||
    typeof observation.source?.ref !== "string" ||
    observation.source.ref.trim().length === 0
  ) {
    issues.push({
      field: "observation.source",
      problem: "must be a known source kind with a non-empty reference",
    });
  }
  if (
    typeof observation.observedAt !== "number" ||
    !Number.isFinite(observation.observedAt) ||
    observation.observedAt < 0
  ) {
    issues.push({ field: "observation.observedAt", problem: "must be finite epoch ms >= 0" });
  }
  if (!observation.observedBy || typeof observation.observedBy !== "object") {
    issues.push({ field: "observation.observedBy", problem: "is required" });
  }
  const status = observation.status;
  if (isKnownOutcomeStatus(String(status)) && observation.failure !== undefined) {
    if (!isFailedOutcomeStatus(status)) {
      issues.push({
        field: "observation.failure",
        problem: "failure detail is only valid for missed/failed outcomes",
      });
    } else if (
      typeof observation.failure.kind !== "string" ||
      observation.failure.kind.trim().length === 0 ||
      typeof observation.failure.detail !== "string"
    ) {
      issues.push({
        field: "observation.failure",
        problem: "must carry a non-empty kind and a detail string",
      });
    }
  }
  if (observation.metric !== undefined) {
    const metric = observation.metric;
    if (
      typeof metric?.metric !== "string" ||
      metric.metric.trim().length === 0 ||
      typeof metric?.observed !== "number" ||
      !Number.isFinite(metric.observed) ||
      typeof metric?.target !== "number" ||
      !Number.isFinite(metric.target)
    ) {
      issues.push({
        field: "observation.metric",
        problem: "must carry a metric name with finite observed/target values",
      });
    }
  }
  if (
    observation.actualCost !== undefined &&
    (typeof observation.actualCost !== "number" ||
      !Number.isFinite(observation.actualCost) ||
      observation.actualCost < 0)
  ) {
    issues.push({
      field: "observation.actualCost",
      problem: "must be a non-negative number when present",
    });
  }
  return issues;
}

function inputIssues(input: RecordOutcomeInput): ValidationIssue[] {
  if (!input || typeof input !== "object") {
    return [{ field: "input", problem: "is required" }];
  }
  const issues: ValidationIssue[] = [];
  for (const key of ["outcomeId", "evaluationId", "candidateId"] as const) {
    const value = input[key];
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
      issues.push({ field: key, problem: "must be a non-empty string of at most 128 characters" });
    }
  }
  if (typeof input.now !== "number" || !Number.isFinite(input.now) || input.now < 0) {
    issues.push({ field: "now", problem: "must be finite epoch ms >= 0" });
  }
  issues.push(...observationIssues(input));
  return issues;
}

function allocationJoinOf(candidate: OrganizationCandidate): AllocationJoin {
  const kinds = candidate.actors.map((actor) => actor.kind);
  return {
    actorCount: kinds.length,
    assignmentCount: candidate.assignments.length,
    capabilityAllocationCount: candidate.capabilityAllocations.length,
    humanLikeActorCount: kinds.filter((kind) => HUMAN_LIKE.has(kind)).length,
    automatedActorCount: kinds.filter((kind) => AUTOMATED.has(kind)).length,
    externalActorCount: kinds.filter((kind) => EXTERNAL.has(kind)).length,
    totalEffortShare: round4(
      candidate.assignments.reduce((sum, assignment) => sum + assignment.effortShare, 0),
    ),
  };
}

function occupancyJoinOf(candidate: OrganizationCandidate): OccupancyJoin {
  const agentActors = candidate.actors.filter(
    (actor) => actor.kind === "agent" || actor.kind === "agent-team",
  ).length;
  return {
    agentActorCount: agentActors,
    entryCount: candidate.modelOccupancy.length,
    exclusiveEntryCount: candidate.modelOccupancy.filter((entry) => entry.exclusive).length,
    distinctModelBindings: new Set(candidate.modelOccupancy.map((entry) => entry.modelBindingRef))
      .size,
  };
}

function informationStrategyJoinOf(candidate: OrganizationCandidate): InformationStrategyJoin {
  const flows = candidate.topology.information.flows;
  const requirements = flows
    .map((flow) => flow.freshnessMaxAgeMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    flowCount: flows.length,
    reviewRequiredFlows: flows.filter((flow) => flow.reviewRequired).length,
    minimalContextFlows: flows.filter((flow) => flow.minimalContext).length,
    ...(requirements.length > 0
      ? { tightestFreshnessRequirementMs: Math.min(...requirements) }
      : {}),
  };
}

function costJoinOf(candidate: OrganizationCandidate, urgencyPremium: number): CostJoin {
  return {
    costProxy: round4(costProxyOf(candidate, urgencyPremium)),
    ...(candidate.budget?.maxTotalCost !== undefined
      ? { budgetCeiling: candidate.budget.maxTotalCost }
      : {}),
  };
}

/** Read seams the join consumes (structural picks; see domain/ports.ts). */
export interface OutcomeJoinViews {
  readonly evaluations: LearningEvaluationViews;
  readonly candidates: LearningCandidateViews;
}

/**
 * Assembles the outcome join. Pure with respect to domain/lab state (read
 * seams only); deterministic given the seam contents.
 */
export function assembleOutcomeJoin(
  views: OutcomeJoinViews,
  scope: TenantScope,
  input: RecordOutcomeInput,
): Result<OutcomeJoinRecord, LearningError> {
  const issues = inputIssues(input);
  if (issues.length > 0) return err(learningValidationError(issues));
  const provenance = provenanceIssues(input.provenance);
  if (provenance.length > 0) return err(learningValidationError(provenance));

  const evaluationResult = views.evaluations.getEvaluation(scope, input.evaluationId);
  if (!evaluationResult.ok) return err(learningJoinAnchorNotFound("lab evaluation"));
  const evaluation: LabEvaluationRecord = evaluationResult.value;

  const rankedEntry = evaluation.ranked.find((entry) => entry.candidateId === input.candidateId);
  if (!rankedEntry) {
    return err(
      learningJoinRefused([
        {
          field: "candidateId",
          problem: `candidate ${input.candidateId} was not ranked by evaluation ${input.evaluationId}`,
        },
      ]),
    );
  }

  const candidateResult = views.candidates.getCandidate(scope, input.candidateId);
  if (!candidateResult.ok) return err(learningJoinAnchorNotFound("organization candidate"));
  const candidate = candidateResult.value as OrganizationCandidate;
  if (candidate.scope?.tenantId !== scope.tenantId) {
    return err(learningJoinAnchorNotFound("organization candidate"));
  }
  if (
    candidate.contextFingerprint !== undefined &&
    candidate.contextFingerprint !== evaluation.fingerprintDigest
  ) {
    return err(
      learningJoinRefused([
        {
          field: "candidate.contextFingerprint",
          problem: "candidate fingerprint stamp disagrees with the evaluation's fingerprint digest",
        },
      ]),
    );
  }

  const contextClass = contextClassOf(evaluation.fingerprintAxes);
  if (!contextClass.ok) return err(contextClass.error);

  const defaultRefs: SubjectReference[] = [
    { kind: "candidate", id: input.candidateId },
    ...(evaluation.goalId !== undefined ? [{ kind: "goal" as const, id: evaluation.goalId }] : []),
  ];
  const evidenceRefs = input.evidenceRefs ?? defaultRefs;
  if (evidenceRefs.length === 0) {
    return err(
      learningValidationError([
        { field: "evidenceRefs", problem: "at least one evidence reference is required" },
      ]),
    );
  }

  const record: OutcomeJoinRecord = {
    scope,
    outcomeId: input.outcomeId,
    observation: input.observation,
    evaluationId: evaluation.evaluationId,
    ...(evaluation.goalId !== undefined ? { goalId: evaluation.goalId } : {}),
    fingerprintDigest: evaluation.fingerprintDigest,
    fingerprintAxes: evaluation.fingerprintAxes,
    contextClass: contextClass.value,
    constraintSet: evaluation.constraintSet,
    weights: evaluation.weights,
    modifiers: evaluation.modifiers,
    rankingRule: evaluation.rankingRule,
    rankAtEvaluation: rankedEntry.rank,
    weightedScoreAtEvaluation: rankedEntry.weightedScore,
    candidateId: candidate.candidateId,
    ...(rankedEntry.strategy !== undefined ? { strategy: rankedEntry.strategy } : {}),
    shape: organizationShapeOf(candidate),
    allocation: allocationJoinOf(candidate),
    occupancy: occupancyJoinOf(candidate),
    informationStrategy: informationStrategyJoinOf(candidate),
    environments: Object.freeze(
      [...new Set(candidate.environment.map((entry) => entry.environmentRef))].sort(),
    ),
    cost: costJoinOf(candidate, evaluation.modifiers.urgencyPremium),
    evidenceRefs: Object.freeze([...evidenceRefs]),
    provenance: input.provenance,
    recordedAt: input.now,
  };
  return ok(record);
}
