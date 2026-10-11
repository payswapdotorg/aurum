/**
 * The Organizational Lab service (W008 app layer): the facade that composes
 * fingerprinting, mixed organization search, constrained allocation and the
 * evaluation/ranking harness. In-memory state machine (house pattern —
 * persistence is the TL-tracked P003 work item; no IO here).
 *
 * THE CONTEXTUAL RULE: `searchOrganizations` conditions both the search and
 * the scoring on the ContextFingerprint, so the same subject under two
 * different fingerprints yields different best organizations (test-locked).
 *
 * NO SECOND AUTHORITY: the lab RECOMMENDS. It reads domain seams (queries
 * only) and writes its own in-memory evaluations. It never registers
 * candidates into the domain registry, never mutates domain state, and
 * exposes NO execution capability of any kind (tripwire test-locked).
 */
import {
  err,
  ok,
  provenanceIssues,
  type DomainTimestamp,
  type OrganizationCandidate,
  type ProvenanceRecord,
  type SubjectReference,
  type TenantScope,
} from "@aurum/domain";
import type { Result } from "@aurum/domain";
import type { ContextFingerprint } from "../domain/fingerprint.js";
import { contextFingerprint, fingerprintIssues } from "../domain/fingerprint.js";
import type { LabConstraintSet } from "../domain/constraints.js";
import { defaultReferenceBudget } from "../domain/constraints.js";
import { labValidationError, type LabError } from "../domain/errors.js";
import {
  synthesizeAllocation,
  limitsOf,
  type AllocationDirectives,
  type AllocationSynthesis,
} from "../domain/allocation.js";
import type {
  EvaluateOrganizationsInput,
  FingerprintSituationInput,
  LabEvaluationRecord,
  OrganizationSearchResult,
  SearchOrganizationsInput,
  SearchStrategy,
} from "../domain/records.js";
import type {
  EvaluationFilter,
  LabDomainViews,
  LabEvaluationStore,
  OrganizationalLabDeps,
} from "../domain/ports.js";
import { RANKING_RULE, rankCandidates, scoreCandidate } from "../domain/evaluation.js";
import { contextModifiersForFingerprint, weightsForFingerprint } from "../domain/weights.js";
import { assembleSituation } from "./situation.js";
import {
  normalizeStrategies,
  resolveConstraintSet,
  runSearch,
  verifyFingerprint,
} from "./search.js";

/** The public lab service surface (6 methods; policy limit is 12). */
export interface OrganizationalLab {
  /** Derives the situational fingerprint from the domain seams (read-only). */
  fingerprintSituation(
    scope: TenantScope,
    input: FingerprintSituationInput,
  ): Result<{ fingerprint: ContextFingerprint; goalRevision: number }, LabError>;
  /** Mixed organization search: ranked, constraint-tagged candidate values. */
  searchOrganizations(
    scope: TenantScope,
    input: SearchOrganizationsInput,
  ): Result<OrganizationSearchResult, LabError>;
  /** Constrained allocation gated by the W005 validators (refusal = issues). */
  synthesizeAllocation(
    scope: TenantScope,
    input: {
      candidate: OrganizationCandidate;
      directives: AllocationDirectives;
      constraints?: Partial<Omit<LabConstraintSet, "capabilityDemand">>;
    },
  ): Result<AllocationSynthesis, LabError>;
  /** Standalone evaluation harness: scores + ranks given candidate values. */
  evaluateOrganizations(
    scope: TenantScope,
    input: EvaluateOrganizationsInput,
  ): Result<LabEvaluationRecord, LabError>;
  getEvaluation(scope: TenantScope, evaluationId: string): Result<LabEvaluationRecord, LabError>;
  listEvaluations(scope: TenantScope, filter?: EvaluationFilter): readonly LabEvaluationRecord[];
}

let evaluationCounter = 0;

function nextEvaluationId(): string {
  evaluationCounter += 1;
  return `lab-eval-${evaluationCounter}`;
}

function provenanceOf(input: SearchOrganizationsInput): LabError | null {
  const issues = provenanceIssues(input.provenance as ProvenanceRecord);
  if (issues.length > 0) return labValidationError(issues);
  return null;
}

export function createOrganizationalLab(deps: OrganizationalLabDeps): OrganizationalLab {
  const views: LabDomainViews = deps.views;
  const evaluations: LabEvaluationStore = deps.evaluations;

  function recordEvaluation(
    scope: TenantScope,
    result: OrganizationSearchResult,
    now: DomainTimestamp,
  ): Result<LabEvaluationRecord, LabError> {
    const record: LabEvaluationRecord = {
      scope,
      evaluationId: nextEvaluationId(),
      ...(result.goalId !== undefined ? { goalId: result.goalId } : {}),
      fingerprintDigest: result.fingerprintDigest,
      fingerprintAxes: result.fingerprintAxes,
      constraintSet: result.constraints,
      weights: result.weights,
      modifiers: result.modifiers,
      rankingRule: result.rankingRule,
      ranked: Object.freeze(
        result.ranked.map((entry) => ({
          rank: entry.rank,
          candidateId: entry.candidate.candidateId,
          strategy: entry.strategy,
          weightedScore: entry.score.weightedScore,
          criteria: entry.score.criteria,
          bindingConstraints: entry.bindingConstraints,
        })),
      ),
      createdAt: now,
    };
    return evaluations.putEvaluation(scope, record);
  }

  return {
    fingerprintSituation(scope, input) {
      if (!input?.goalId || typeof input.goalId !== "string" || input.goalId.trim().length === 0) {
        return err(
          labValidationError([{ field: "goalId", problem: "must be a non-empty subject id" }]),
        );
      }
      const assembly = assembleSituation(views, scope, input.goalId, input.now);
      if (!assembly.ok) return err(assembly.error);
      const fingerprint = contextFingerprint(assembly.value.input);
      if (!fingerprint.ok) return err(fingerprint.error);
      return ok({
        fingerprint: fingerprint.value,
        goalRevision: assembly.value.trace.goalRevision,
      });
    },

    searchOrganizations(scope, input) {
      const fingerprintError = verifyFingerprint(input?.fingerprint);
      if (fingerprintError) return err(fingerprintError);
      const provenanceError = provenanceOf(input);
      if (provenanceError) return err(provenanceError);
      if (typeof input?.now !== "number" || !Number.isFinite(input.now) || input.now < 0) {
        return err(labValidationError([{ field: "now", problem: "must be finite epoch ms >= 0" }]));
      }
      const strategies = normalizeStrategies(input.strategies);
      if (!strategies.ok) return err(strategies.error);
      const evidenceRefs: readonly SubjectReference[] =
        input.evidenceRefs ??
        (input.goalId !== undefined ? [{ kind: "goal", id: input.goalId }] : []);
      if (evidenceRefs.length === 0) {
        return err(
          labValidationError([
            { field: "evidenceRefs", problem: "at least one evidence reference is required" },
          ]),
        );
      }
      const searchResult = runSearch(views, {
        scope,
        goalId: input.goalId,
        fingerprint: input.fingerprint,
        constraints: input.constraints,
        strategies: strategies.value as readonly SearchStrategy[],
        proposedBy: input.proposedBy,
        provenance: input.provenance,
        evidenceRefs,
        now: input.now,
      });
      if (!searchResult.ok) return err(searchResult.error);
      const recorded = recordEvaluation(scope, searchResult.value, input.now);
      if (!recorded.ok) return err(recorded.error);
      return ok(searchResult.value);
    },

    synthesizeAllocation(scope, input) {
      if (!input?.candidate || typeof input.candidate !== "object") {
        return err(labValidationError([{ field: "candidate", problem: "is required" }]));
      }
      if (input.candidate.scope?.tenantId !== scope.tenantId) {
        return err(
          labValidationError([
            { field: "candidate", problem: "must belong to the requesting tenant" },
          ]),
        );
      }
      const limits = limitsOf(input.constraints);
      return synthesizeAllocation(input.candidate, input.directives, limits);
    },

    evaluateOrganizations(scope, input) {
      const fingerprintError = verifyFingerprint(input?.fingerprint);
      if (fingerprintError) return err(fingerprintError);
      if (!Array.isArray(input?.candidates)) {
        return err(labValidationError([{ field: "candidates", problem: "must be an array" }]));
      }
      for (const candidate of input.candidates) {
        if (!candidate || candidate.scope?.tenantId !== scope.tenantId) {
          return err(
            labValidationError([
              {
                field: "candidates",
                problem: "every candidate must belong to the requesting tenant",
              },
            ]),
          );
        }
      }
      const constraintSet = resolveConstraintSet(input.fingerprint, input.constraints);
      const demand = input.fingerprint.axes.capabilityDemandProfile;
      const weights = weightsForFingerprint(input.fingerprint);
      const modifiers = contextModifiersForFingerprint(input.fingerprint);
      const referenceBudget = constraintSet.referenceBudget ?? defaultReferenceBudget(demand);
      const scored = input.candidates.map((candidate) => ({
        candidate,
        score: scoreCandidate(candidate, { demand, weights, modifiers, referenceBudget }),
      }));
      const ordered = rankCandidates(scored);
      const record: LabEvaluationRecord = {
        scope,
        evaluationId: nextEvaluationId(),
        ...(input.goalId !== undefined ? { goalId: input.goalId } : {}),
        fingerprintDigest: input.fingerprint.digest,
        fingerprintAxes: input.fingerprint.axes,
        constraintSet,
        weights,
        modifiers,
        rankingRule: RANKING_RULE,
        ranked: Object.freeze(
          ordered.map((entry, index) => ({
            rank: index + 1,
            candidateId: entry.candidate.candidateId,
            weightedScore: entry.score.weightedScore,
            criteria: entry.score.criteria,
            bindingConstraints: [],
          })),
        ),
        createdAt: input.now,
      };
      const stored = evaluations.putEvaluation(scope, record);
      if (!stored.ok) return err(stored.error);
      return ok(stored.value);
    },

    getEvaluation(scope, evaluationId) {
      return evaluations.getEvaluation(scope, evaluationId);
    },

    listEvaluations(scope, filter) {
      return evaluations.listEvaluations(scope, filter);
    },
  };
}

/** Re-exported for the contract: pure fingerprint construction (what-if). */
export function makeFingerprint(
  input: Parameters<typeof contextFingerprint>[0],
): Result<ContextFingerprint, LabError> {
  const issues = fingerprintIssues(input);
  if (issues.length > 0) return err(labValidationError(issues));
  return contextFingerprint(input);
}
