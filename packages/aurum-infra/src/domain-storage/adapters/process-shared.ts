/**
 * Shared mirrors and builders for the P001 process area adapter (validation
 * of steps/handoffs/variants/measurements, revision building, freshness).
 * Pure helpers — no database handles, no factories; the store adapter
 * imports these to stay under the architecture line budget without
 * duplicating the domain-internal semantics it mirrors.
 */
import {
  PROCESS_STEP_KINDS,
  isKnownProcessStepKind,
  provenanceIssues,
  supplierIssues,
} from "@aurum/domain";
import type {
  DomainTimestamp,
  FreshnessStamp,
  HandoffDescriptor,
  HandoffInput,
  ProcessRevision,
  ProcessRevisionContent,
  ProcessStep,
  ProcessStepInput,
  ProcessVariant,
  ProcessVariantInput,
  StepMeasurement,
  Validator,
} from "@aurum/domain";

const EPSILON = 1e-9;

/** Mirrors the domain-internal resolveFreshness (verbatim stamps win). */
export function resolveFreshness(
  stamp: FreshnessStamp | undefined,
  fallbackAsOf: number,
): FreshnessStamp {
  if (stamp !== undefined && (stamp.asOf !== undefined || stamp.validUntil !== undefined)) {
    return stamp;
  }
  return { asOf: fallbackAsOf as DomainTimestamp };
}

/** Mirrors the domain-internal step validation (issue-for-issue). */
export function validateSteps(v: Validator, steps: readonly ProcessStepInput[] | undefined): void {
  if (!Array.isArray(steps) || steps.length === 0) {
    v.add("steps", "must be a non-empty array");
    return;
  }
  const seen = new Set<string>();
  steps.forEach((step, index) => {
    v.requireIdFormat(`steps.${index}.stepId`, step?.stepId ?? "");
    v.requireText(`steps.${index}.name`, step?.name ?? "", { max: 300 });
    v.requireVocabulary(`steps.${index}.kind`, String(step?.kind ?? ""), PROCESS_STEP_KINDS);
    if (seen.has(step?.stepId))
      v.add(`steps.${index}.stepId`, `duplicate step id: ${step?.stepId}`);
    if (step?.stepId) seen.add(step.stepId);
    if (step?.performer !== undefined) {
      for (const issue of supplierIssues(step.performer, `steps.${index}.performer`)) {
        v.add(issue.field, issue.problem);
      }
    }
  });
}

/** Mirrors the domain-internal handoff validation (issue-for-issue). */
export function validateHandoffs(
  v: Validator,
  handoffs: readonly HandoffInput[] | undefined,
  stepIds: ReadonlySet<string>,
): void {
  (Array.isArray(handoffs) ? handoffs : []).forEach((handoff, index) => {
    v.requireIdFormat(`handoffs.${index}.fromStepId`, handoff?.fromStepId ?? "");
    v.requireIdFormat(`handoffs.${index}.toStepId`, handoff?.toStepId ?? "");
    if (stepIds.size > 0) {
      if (!stepIds.has(handoff?.fromStepId ?? "")) {
        v.add(`handoffs.${index}.fromStepId`, "must reference a declared step");
      }
      if (!stepIds.has(handoff?.toStepId ?? "")) {
        v.add(`handoffs.${index}.toStepId`, "must reference a declared step");
      }
      if (handoff?.fromStepId === handoff?.toStepId) {
        v.add(`handoffs.${index}`, "must be between two different steps");
      }
    }
    if (handoff?.fromPerformer !== undefined) {
      for (const issue of supplierIssues(
        handoff.fromPerformer,
        `handoffs.${index}.fromPerformer`,
      )) {
        v.add(issue.field, issue.problem);
      }
    }
    if (handoff?.toPerformer !== undefined) {
      for (const issue of supplierIssues(handoff.toPerformer, `handoffs.${index}.toPerformer`)) {
        v.add(issue.field, issue.problem);
      }
    }
    if (handoff?.medium !== undefined) {
      v.requireText(`handoffs.${index}.medium`, handoff.medium, { max: 120 });
    }
  });
}

/** Mirrors the domain-internal variant validation (issue-for-issue). */
export function validateVariants(
  v: Validator,
  variants: readonly ProcessVariantInput[] | undefined,
  stepIds: ReadonlySet<string>,
): void {
  const list = Array.isArray(variants) ? variants : [];
  const seen = new Set<string>();
  let shareSum = 0;
  let anyShare = false;
  list.forEach((variant, index) => {
    v.requireIdFormat(`variants.${index}.variantId`, variant?.variantId ?? "");
    v.requireText(`variants.${index}.name`, variant?.name ?? "", { max: 300 });
    if (seen.has(variant?.variantId)) {
      v.add(`variants.${index}.variantId`, `duplicate variant id: ${variant?.variantId}`);
    }
    if (variant?.variantId) seen.add(variant.variantId);
    const stepIdList = Array.isArray(variant?.stepIds) ? variant.stepIds : [];
    if (stepIdList.length === 0) v.add(`variants.${index}.stepIds`, "must be a non-empty array");
    if (stepIds.size > 0) {
      for (const stepId of stepIdList) {
        if (!stepIds.has(stepId)) {
          v.add(`variants.${index}.stepIds`, `must reference a declared step: ${String(stepId)}`);
        }
      }
    }
    if (variant?.share !== undefined) {
      v.requireFiniteNumber(`variants.${index}.share`, variant.share);
      if (variant.share < 0 || variant.share > 1) {
        v.add(`variants.${index}.share`, "must be a fraction in [0, 1]");
      }
      anyShare = true;
      shareSum += variant.share;
    }
  });
  if (anyShare && shareSum > 1 + EPSILON) {
    v.add("variants", "declared shares must not sum above 1");
  }
}

/** Mirrors the domain-internal measurement validation (issue-for-issue). */
export function validateMeasurement(
  v: Validator,
  measurement: StepMeasurement,
  index: number,
  stepIds: ReadonlySet<string>,
): void {
  const prefix = `measurements.${index}`;
  v.requireIdFormat(`${prefix}.stepId`, measurement?.stepId ?? "");
  if (stepIds.size > 0 && !stepIds.has(measurement?.stepId ?? "")) {
    v.add(`${prefix}.stepId`, "must reference a step of the current revision");
  }
  for (const field of [
    "manualEffortMs",
    "waitingTimeMs",
    "errorCount",
    "throughputPerPeriod",
  ] as const) {
    if (measurement?.[field] !== undefined) {
      v.requireNonNegativeNumber(`${prefix}.${field}`, measurement[field]);
    }
  }
  if (measurement?.utilization !== undefined) {
    v.requireFiniteNumber(`${prefix}.utilization`, measurement.utilization);
    if (measurement.utilization < 0 || measurement.utilization > 1) {
      v.add(`${prefix}.utilization`, "must be a fraction in [0, 1]");
    }
  }
  const duplicates = Array.isArray(measurement?.duplicates) ? measurement.duplicates : [];
  if (stepIds.size > 0) {
    for (const target of duplicates) {
      if (!stepIds.has(target)) {
        v.add(`${prefix}.duplicates`, `must reference a declared step: ${String(target)}`);
      }
    }
  }
}

/** Mirrors the domain-internal revision content validation (issue-for-issue). */
export function validateRevisionContent(
  v: Validator,
  content: ProcessRevisionContent | undefined,
): void {
  if (!content) {
    v.add("revision", "is required");
    return;
  }
  v.requireText("name", content.name ?? "", { max: 300 });
  if (content?.description !== undefined) v.requireText("description", content.description);
  validateSteps(v, content.steps);
  const stepIds = new Set((content.steps ?? []).map((step) => step?.stepId ?? ""));
  validateHandoffs(v, content.handoffs, stepIds);
  validateVariants(v, content.variants, stepIds);
  for (const issue of provenanceIssues(content?.provenance)) v.add(issue.field, issue.problem);
  v.requireNonNegativeNumber("now", content?.now ?? Number.NaN);
}

/** Mirrors the domain-internal revision building (normalization + freezing). */
export function buildRevisionContent(content: ProcessRevisionContent): {
  readonly steps: readonly ProcessStep[];
  readonly handoffs: readonly HandoffDescriptor[];
  readonly variants: readonly ProcessVariant[];
} {
  const steps: readonly ProcessStep[] = Object.freeze(
    (content.steps ?? []).map((step) => {
      const record: ProcessStep = {
        stepId: step.stepId.trim(),
        name: step.name.trim(),
        kind: isKnownProcessStepKind(step.kind) ? step.kind : "manual",
        ...(step.performer ? { performer: step.performer } : {}),
      };
      return record;
    }),
  );
  const handoffs: readonly HandoffDescriptor[] = Object.freeze(
    (content.handoffs ?? []).map((handoff) => ({
      fromStepId: handoff.fromStepId.trim(),
      toStepId: handoff.toStepId.trim(),
      ...(handoff.fromPerformer ? { fromPerformer: handoff.fromPerformer } : {}),
      ...(handoff.toPerformer ? { toPerformer: handoff.toPerformer } : {}),
      ...(handoff.medium ? { medium: handoff.medium.trim() } : {}),
    })),
  );
  const variants: readonly ProcessVariant[] = Object.freeze(
    (content.variants ?? []).map((variant) => ({
      variantId: variant.variantId.trim(),
      name: variant.name.trim(),
      stepIds: Object.freeze([...variant.stepIds]),
      ...(variant.share !== undefined ? { share: variant.share } : {}),
    })),
  );
  return { steps, handoffs, variants };
}

/** The revision number the next append produces for this history length. */
export function nextRevisionNumber(revisions: readonly ProcessRevision[] | null): number {
  return revisions ? revisions.length + 1 : 1;
}
