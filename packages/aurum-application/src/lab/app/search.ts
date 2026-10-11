/**
 * Mixed organization search (W008 app layer): assembles the tenant-scoped
 * mixed pool through the W005 capability seams, enumerates strategy
 * blueprints, validates them with the W005 deep validator, and ranks them
 * with the evaluation harness. Humans + agents + software + suppliers and
 * partners are JOINTLY considered (catalog clause 2); every result carries
 * its constraint set and which constraints bound it (clause 3).
 */
import {
  err,
  ok,
  organizationCandidateIssues,
  type CapabilitySupplyRecord,
  type DomainTimestamp,
  type GoalRecord,
  type OrganizationCandidate,
  type Result,
  type SubjectReference,
  type TenantScope,
} from "@aurum/domain";
import type { ContextFingerprint } from "../domain/fingerprint.js";
import { canonicalFingerprint, fingerprintDigest } from "../domain/fingerprint.js";
import type { LabConstraintSet } from "../domain/constraints.js";
import {
  bindingConstraintsOf,
  constraintSetIssues,
  defaultReferenceBudget,
} from "../domain/constraints.js";
import { labValidationError, labSubjectNotFound, type LabError } from "../domain/errors.js";
import type {
  ExcludedBlueprint,
  OrganizationSearchResult,
  PoolSummaryEntry,
  RankedOrganization,
  SearchStrategy,
} from "../domain/records.js";
import { SEARCH_STRATEGIES, isKnownSearchStrategy } from "../domain/records.js";
import { rankCandidates, scoreCandidate, RANKING_RULE } from "../domain/evaluation.js";
import { contextModifiersForFingerprint, weightsForFingerprint } from "../domain/weights.js";
import type { LabDomainViews } from "../domain/ports.js";
import { assembleCandidate } from "./candidate-assembly.js";
import type { CompositionContext } from "./compose.js";

/** Verifies a fingerprint value: canonical form and digest must match the
 * axes (detects hand-tampered values before they condition a search). */
export function verifyFingerprint(fingerprint: ContextFingerprint): LabError | null {
  if (!fingerprint || typeof fingerprint !== "object" || !fingerprint.axes) {
    return labValidationError([{ field: "fingerprint", problem: "is required" }]);
  }
  if (fingerprint.axes.capabilityDemandProfile.length === 0) {
    return labValidationError([
      { field: "fingerprint.axes.capabilityDemandProfile", problem: "must not be empty" },
    ]);
  }
  const canonical = canonicalFingerprint(fingerprint.axes);
  if (canonical !== fingerprint.canonical || fingerprintDigest(canonical) !== fingerprint.digest) {
    return labValidationError([
      { field: "fingerprint", problem: "canonical form/digest does not match the axes" },
    ]);
  }
  return null;
}

/** Builds the full constraint set (defaults are explicit constants). */
export function resolveConstraintSet(
  fingerprint: ContextFingerprint,
  partial: Partial<Omit<LabConstraintSet, "capabilityDemand">> | undefined,
): LabConstraintSet {
  const demand = fingerprint.axes.capabilityDemandProfile;
  return {
    ...(partial?.staffing !== undefined ? { staffing: partial.staffing } : {}),
    ...(partial?.budget !== undefined ? { budget: partial.budget } : {}),
    ...(partial?.quality !== undefined ? { quality: partial.quality } : {}),
    ...(partial?.sla !== undefined ? { sla: partial.sla } : {}),
    ...(partial?.riskTolerance !== undefined ? { riskTolerance: partial.riskTolerance } : {}),
    allocationLimits: partial?.allocationLimits ?? {
      maxAssignmentsPerActor: 4,
      maxActorsPerAllocation: 3,
      maxTotalEffortPerActor: 1,
    },
    capabilityDemand: demand,
    ...(partial?.referenceBudget !== undefined ? { referenceBudget: partial.referenceBudget } : {}),
  };
}

export interface SearchRunInput {
  readonly scope: TenantScope;
  readonly goalId?: string;
  readonly fingerprint: ContextFingerprint;
  readonly constraints?: Partial<Omit<LabConstraintSet, "capabilityDemand">>;
  readonly strategies: readonly SearchStrategy[];
  readonly proposedBy: CompositionContext["proposedBy"];
  readonly provenance: CompositionContext["provenance"];
  readonly evidenceRefs: readonly SubjectReference[];
  readonly now: DomainTimestamp;
}

/** Runs the full search. Every step is deterministic and inspectable. */
export function runSearch(
  views: LabDomainViews,
  input: SearchRunInput,
): Result<OrganizationSearchResult, LabError> {
  const fingerprintError = verifyFingerprint(input.fingerprint);
  if (fingerprintError) return err(fingerprintError);

  const constraintSet = resolveConstraintSet(input.fingerprint, input.constraints);
  const setIssues = constraintSetIssues(constraintSet);
  if (setIssues.length > 0) return err(labValidationError(setIssues));

  // The subject goal provides the horizon window (occupancy + availability).
  let horizon: { start: DomainTimestamp; end: DomainTimestamp };
  let requirementIds: (string | undefined)[] = [];
  if (input.goalId !== undefined) {
    const goalResult = views.goals.getGoal(input.scope, input.goalId);
    if (!goalResult.ok) return err(labSubjectNotFound("goal"));
    const goal = goalResult.value as GoalRecord;
    const revision = goal.revisions[goal.currentRevision - 1];
    if (!revision) return err(labSubjectNotFound(`goal revision ${goal.currentRevision}`));
    horizon = { start: revision.horizonStart, end: revision.horizonEnd };
    requirementIds = views.capabilities
      .listRequirements(input.scope, { sourceKind: "goal" })
      .filter((requirement) => requirement.source.ref === input.goalId)
      .sort((a, b) =>
        a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0,
      )
      .map((requirement) => requirement.requirementId);
  } else {
    // No subject: a 30-day window from `now` (documented fallback; the
    // fingerprint's horizon CLASS already conditioned the weights).
    horizon = {
      start: input.now as DomainTimestamp,
      end: (input.now + 30 * 24 * 60 * 60 * 1000) as DomainTimestamp,
    };
  }

  // Mixed pool: one entry per demanded capability (tenant-scoped read).
  const demand = fingerprintDemand(input.fingerprint);
  const pool = new Map<string, readonly CapabilitySupplyRecord[]>();
  const poolSummary: PoolSummaryEntry[] = [];
  for (const entry of demand) {
    const supplies = views.capabilities.listSupplies(input.scope, {
      capabilityId: entry.capabilityId,
    });
    pool.set(entry.capabilityId, supplies);
    poolSummary.push({
      capabilityId: entry.capabilityId,
      requiredLevel: entry.requiredLevel,
      ...(entry.requiredCapacityPerPeriod !== undefined
        ? { requiredCapacityPerPeriod: entry.requiredCapacityPerPeriod }
        : {}),
      supplierKinds: Object.freeze([...new Set(supplies.map((supply) => supply.supplier.kind))]),
      eligibleSupplyCount: supplies.filter((supply) => supply.level >= entry.requiredLevel).length,
    });
  }

  const weights = weightsForFingerprint(input.fingerprint);
  const modifiers = contextModifiersForFingerprint(input.fingerprint);
  const referenceBudget = constraintSet.referenceBudget ?? defaultReferenceBudget(demand);
  const evaluationContext = { demand, weights, modifiers, referenceBudget };

  const ranked: RankedOrganization[] = [];
  const excluded: ExcludedBlueprint[] = [];
  for (const strategy of input.strategies) {
    const ctx: CompositionContext = {
      scope: input.scope,
      goalId: input.goalId,
      fingerprint: input.fingerprint,
      constraints: constraintSet,
      strategy,
      horizon,
      now: input.now,
      proposedBy: input.proposedBy,
      provenance: input.provenance,
      evidenceRefs: input.evidenceRefs,
      requirementIds,
    };
    const { candidate, bindings } = assembleCandidate(pool, ctx);
    const issues = organizationCandidateIssues(candidate);
    if (issues.length > 0) {
      excluded.push({
        strategy,
        reason: "blueprint failed the W005 deep candidate validation",
        issues: Object.freeze(issues.map((issue) => ({ ...issue }))),
      });
      continue;
    }
    if (candidate.actors.length === 0) {
      excluded.push({
        strategy,
        reason: "no eligible supplies in the mixed pool for this strategy",
        issues: [],
      });
      continue;
    }
    ranked.push({
      rank: 0,
      strategy,
      candidate,
      score: scoreCandidate(candidate, evaluationContext),
      bindingConstraints: [
        ...bindings,
        ...bindingConstraintsOf(candidate, constraintSet, modifiers.urgencyPremium),
      ],
    });
  }

  const ordered = rankCandidates(ranked).map((item, index) => ({ ...item, rank: index + 1 }));

  return ok({
    ...(input.goalId !== undefined ? { goalId: input.goalId } : {}),
    fingerprintDigest: input.fingerprint.digest,
    fingerprintAxes: input.fingerprint.axes,
    constraints: constraintSet,
    weights,
    modifiers,
    rankingRule: RANKING_RULE,
    ranked: Object.freeze(ordered),
    excluded: Object.freeze(excluded),
    poolSummary: Object.freeze(poolSummary),
    evaluatedAt: input.now as DomainTimestamp,
  });
}

function fingerprintDemand(fingerprint: ContextFingerprint) {
  return fingerprint.axes.capabilityDemandProfile;
}

/** Normalizes the requested strategies (defaults to all, deterministic order). */
export function normalizeStrategies(
  requested: readonly string[] | undefined,
): Result<readonly SearchStrategy[], LabError> {
  if (requested === undefined) return ok(SEARCH_STRATEGIES);
  if (!Array.isArray(requested) || requested.length === 0) {
    return err(labValidationError([{ field: "strategies", problem: "must be a non-empty array" }]));
  }
  const strategies: SearchStrategy[] = [];
  for (const value of requested) {
    if (!isKnownSearchStrategy(String(value))) {
      return err(
        labValidationError([
          { field: "strategies", problem: `unknown strategy: ${String(value)}` },
        ]),
      );
    }
    strategies.push(value as SearchStrategy);
  }
  return ok(Object.freeze(strategies));
}

/** Narrow re-export for the service (candidate value type). */
export type { OrganizationCandidate };
