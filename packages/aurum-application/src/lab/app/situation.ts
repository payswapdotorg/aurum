/**
 * Situation assembly (W008 app layer): reads the tenant-scoped domain seams
 * and assembles the plain-data `FingerprintInput` for the pure fingerprint
 * constructor. Every read is documented with its source seam; nothing is
 * invented. The trace (which records fed which axis) is returned alongside
 * for inspectability.
 */
import {
  classifyFreshness,
  DEFAULT_FRESHNESS_POLICY,
  type DomainTimestamp,
  type FreshnessPolicy,
  type GoalRecord,
  type TenantScope,
} from "@aurum/domain";
import type { FingerprintInput, CapabilityDemand } from "../domain/fingerprint.js";
import type { LabError } from "../domain/errors.js";
import { labSubjectNotFound } from "../domain/errors.js";
import { err, ok } from "@aurum/domain";
import type { Result } from "@aurum/domain";
import type { LabDomainViews } from "../domain/ports.js";
import type { SituationTrace } from "../domain/records.js";

export interface SituationAssembly {
  readonly input: FingerprintInput;
  readonly trace: SituationTrace;
}

function referencesSubject(
  references: readonly { readonly kind: string; readonly id: string }[],
  goalId: string,
): boolean {
  return references.some((reference) => reference.kind === "goal" && reference.id === goalId);
}

/**
 * Assembles the situation snapshot for a subject (goal) at a point in time.
 *
 * Axis derivations (source seams in parentheses):
 * - goalPriority        : current goal revision priority (GoalLedger.getGoal)
 * - horizon             : current revision horizon window (GoalLedger.getGoal)
 * - openUnknowns        : open unknowns whose relatedSubjects reference the
 *                         goal (InquiryLedger.listOpenUnknowns)
 * - openContradictions  : open contradictions referencing the goal in
 *                         `between` (InquiryLedger.listOpenContradictions)
 * - evidenceFreshness   : freshness classes of the supplies offering the
 *                         required capabilities (CapabilityGraph.listSupplies,
 *                         classified via classifyFreshness) plus the goal's
 *                         expected-evidence freshness stamps
 * - capabilityDemand    : capability requirements with source { goal, goalId }
 *                         (CapabilityGraph.listRequirements)
 */
export function assembleSituation(
  views: LabDomainViews,
  scope: TenantScope,
  goalId: string,
  now: DomainTimestamp,
  freshnessPolicy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): Result<SituationAssembly, LabError> {
  const goalResult = views.goals.getGoal(scope, goalId);
  if (!goalResult.ok) {
    // Uniform not-found: a foreign-tenant goal and a missing goal are
    // indistinguishable (spec/ARCHITECTURE.md tenant isolation).
    return err(labSubjectNotFound("goal"));
  }
  const goal: GoalRecord = goalResult.value;
  const revision = goal.revisions[goal.currentRevision - 1];
  if (!revision) {
    return err(labSubjectNotFound(`goal revision ${goal.currentRevision}`));
  }

  const requirements = views.capabilities
    .listRequirements(scope, { sourceKind: "goal" })
    .filter((requirement) => requirement.source.ref === goalId);

  const demand: CapabilityDemand[] = requirements.map((requirement) => ({
    capabilityId: requirement.capabilityId,
    requiredLevel: requirement.requiredLevel,
    ...(requirement.requiredCapacityPerPeriod !== undefined
      ? { requiredCapacityPerPeriod: requirement.requiredCapacityPerPeriod }
      : {}),
  }));

  const supplyFreshness: { supplyId: string; freshness: string }[] = [];
  for (const entry of demand) {
    const supplies = views.capabilities.listSupplies(scope, {
      capabilityId: entry.capabilityId,
    });
    for (const supply of supplies) {
      supplyFreshness.push({
        supplyId: supply.supplyId,
        freshness: classifyFreshness(supply.freshness, now, freshnessPolicy),
      });
    }
  }
  for (const expected of revision.expectedEvidence) {
    supplyFreshness.push({
      supplyId: `goal-evidence:${expected.subject.kind}:${expected.subject.id}`,
      freshness: classifyFreshness(expected.freshness, now, freshnessPolicy),
    });
  }

  const openUnknowns = views.inquiry
    .listOpenUnknowns(scope)
    .filter((unknown) => referencesSubject(unknown.relatedSubjects, goalId));

  const openContradictions = views.inquiry
    .listOpenContradictions(scope)
    .filter((contradiction) => referencesSubject(contradiction.between, goalId));

  const input: FingerprintInput = {
    goalPriority: revision.priority,
    horizon: { start: revision.horizonStart, end: revision.horizonEnd },
    openUnknowns: openUnknowns.length,
    openContradictions: openContradictions.length,
    evidenceFreshness: supplyFreshness.map((signal) => signal.freshness),
    capabilityDemand: demand,
  };

  return ok({
    input,
    trace: {
      goalId,
      goalRevision: goal.currentRevision,
      openUnknownIds: Object.freeze(openUnknowns.map((unknown) => unknown.unknownId)),
      openContradictionIds: Object.freeze(
        openContradictions.map((contradiction) => contradiction.contradictionId),
      ),
      supplyFreshness: Object.freeze(supplyFreshness),
      requirementIds: Object.freeze(requirements.map((requirement) => requirement.requirementId)),
    },
  });
}
