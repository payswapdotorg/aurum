/**
 * In-memory process directory. Revisions and metric observations are
 * append-only; previously returned record objects are deep-frozen. Every
 * consequential transition lands in the shared audit trail.
 */
import { conflictError, invariantError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type { ProcessId } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import { supplierIssues } from "../core/suppliers.js";
import type { AuditSink } from "../audit/ports.js";
import { provenanceIssues } from "../evidence/provenance.js";
import { resolveFreshness } from "../evidence/freshness.js";
import {
  isKnownProcessStepKind,
  type HandoffDescriptor,
  type ProcessMetricsObservation,
  type ProcessRecord,
  type ProcessRevision,
  type ProcessStep,
  type ProcessVariant,
  type StepMeasurement,
} from "./records.js";
import type {
  HandoffInput,
  ProcessMetricsFilter,
  ProcessRevisionContent,
  ProcessStepInput,
  ProcessVariantInput,
  ProcessDirectory,
  RecordProcessMetricsInput,
  RegisterProcessInput,
  ReviseProcessInput,
} from "./ports.js";

const EPSILON = 1e-9;

function validateSteps(
  v: ReturnType<typeof createValidator>,
  steps: readonly ProcessStepInput[] | undefined,
): void {
  if (!Array.isArray(steps) || steps.length === 0) {
    v.add("steps", "must be a non-empty array");
    return;
  }
  const seen = new Set<string>();
  steps.forEach((step, index) => {
    v.requireIdFormat(`steps.${index}.stepId`, step?.stepId ?? "");
    v.requireText(`steps.${index}.name`, step?.name ?? "", { max: 300 });
    v.requireVocabulary(`steps.${index}.kind`, String(step?.kind ?? ""), [
      "manual",
      "automated",
      "hybrid",
    ]);
    if (seen.has(step?.stepId))
      v.add(`steps.${index}.stepId`, `duplicate step id: ${step?.stepId}`);
    if (step?.stepId) seen.add(step.stepId);
    for (const issue of supplierIssues(step?.performer, `steps.${index}.performer`)) {
      v.add(issue.field, issue.problem);
    }
  });
}

function validateHandoffs(
  v: ReturnType<typeof createValidator>,
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
    for (const issue of supplierIssues(handoff?.fromPerformer, `handoffs.${index}.fromPerformer`)) {
      v.add(issue.field, issue.problem);
    }
    for (const issue of supplierIssues(handoff?.toPerformer, `handoffs.${index}.toPerformer`)) {
      v.add(issue.field, issue.problem);
    }
    if (handoff?.medium !== undefined)
      v.requireText(`handoffs.${index}.medium`, handoff.medium, { max: 120 });
  });
}

function validateVariants(
  v: ReturnType<typeof createValidator>,
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

function buildSteps(content: ProcessRevisionContent): readonly ProcessStep[] {
  return Object.freeze(
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
}

function buildHandoffs(content: ProcessRevisionContent): readonly HandoffDescriptor[] {
  return Object.freeze(
    (content.handoffs ?? []).map((handoff) => ({
      fromStepId: handoff.fromStepId.trim(),
      toStepId: handoff.toStepId.trim(),
      ...(handoff.fromPerformer ? { fromPerformer: handoff.fromPerformer } : {}),
      ...(handoff.toPerformer ? { toPerformer: handoff.toPerformer } : {}),
      ...(handoff.medium ? { medium: handoff.medium.trim() } : {}),
    })),
  );
}

function buildVariants(content: ProcessRevisionContent): readonly ProcessVariant[] {
  return Object.freeze(
    (content.variants ?? []).map((variant) => ({
      variantId: variant.variantId.trim(),
      name: variant.name.trim(),
      stepIds: Object.freeze([...variant.stepIds]),
      ...(variant.share !== undefined ? { share: variant.share } : {}),
    })),
  );
}

function validateMeasurement(
  v: ReturnType<typeof createValidator>,
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

export function createProcessDirectory(audit: AuditSink): ProcessDirectory {
  const processes = new TenantIndex<ProcessRecord>();
  const observations = new TenantIndex<ProcessMetricsObservation>();

  function validateRevisionContent(
    v: ReturnType<typeof createValidator>,
    content: ProcessRevisionContent,
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

  function revise(
    scope: TenantScope,
    input: RegisterProcessInput | ReviseProcessInput,
    mode: "create" | "revise",
  ): Result<ProcessRecord> {
    const v = createValidator();
    const processIdValue = v.requireIdFormat("processId", input?.processId ?? "") as ProcessId;
    validateRevisionContent(v, input);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    const existing = processes.get(scope, processIdValue);
    if (mode === "create" && existing) {
      return { ok: false, error: conflictError("process already registered in tenant") };
    }
    if (mode === "revise" && !existing) {
      return { ok: false, error: notFound("process") };
    }
    const revision: ProcessRevision = {
      revisionNumber: existing ? existing.revisions.length + 1 : 1,
      name: input.name.trim(),
      ...(input.description ? { description: input.description.trim() } : {}),
      steps: buildSteps(input),
      handoffs: buildHandoffs(input),
      variants: buildVariants(input),
      provenance: input.provenance,
      createdAt: input.now,
    };
    const record: ProcessRecord = existing
      ? {
          ...existing,
          currentRevision: revision.revisionNumber,
          revisions: Object.freeze([...existing.revisions, revision]),
        }
      : {
          scope,
          processId: processIdValue,
          currentRevision: 1,
          revisions: Object.freeze([revision]),
        };
    const stored = processes.put(scope, processIdValue, record);
    audit.append(
      scope,
      { kind: "process", id: processIdValue },
      mode === "create" ? "process.registered" : "process.revised",
      {
        actor: input.provenance.actor,
        at: input.now,
        reason: mode === "create" ? "process registered" : "process revised",
      },
      Object.freeze({ revisionNumber: revision.revisionNumber }),
    );
    return ok(stored);
  }

  function recordProcessMetrics(
    scope: TenantScope,
    input: RecordProcessMetricsInput,
  ): Result<ProcessMetricsObservation> {
    const v = createValidator();
    const observationId = v.requireIdFormat("observationId", input?.observationId ?? "");
    v.requireIdFormat("processId", input?.processId ?? "");
    const observationsList = Array.isArray(input?.measurements) ? input.measurements : [];
    if (observationsList.length === 0) v.add("measurements", "must be a non-empty array");
    v.requireNonNegativeNumber("period.start", input?.period?.start ?? Number.NaN);
    v.requireNonNegativeNumber("period.end", input?.period?.end ?? Number.NaN);
    if (
      typeof input?.period?.start === "number" &&
      typeof input?.period?.end === "number" &&
      Number.isFinite(input.period.start) &&
      Number.isFinite(input.period.end) &&
      input.period.start > input.period.end
    ) {
      v.add("period", "start must not be after end");
    }
    const record = processes.get(scope, (input?.processId ?? "") as ProcessId);
    if (!record) return { ok: false, error: notFound("process") };
    const current = record.revisions[record.currentRevision - 1];
    if (!current) {
      return {
        ok: false,
        error: invariantError("corrupt process record: missing current revision"),
      };
    }
    const stepIds = new Set(current.steps.map((step) => step.stepId));
    observationsList.forEach((measurement, index) => {
      validateMeasurement(v, measurement, index, stepIds);
    });
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    if (observations.has(scope, observationId)) {
      return {
        ok: false,
        error: conflictError("process metrics observation already recorded in tenant"),
      };
    }

    const observation: ProcessMetricsObservation = {
      scope,
      observationId,
      processId: record.processId,
      revisionNumber: current.revisionNumber,
      period: input.period,
      measurements: Object.freeze(
        observationsList.map((measurement) => ({
          ...measurement,
          duplicates: Object.freeze([...(measurement.duplicates ?? [])]),
        })),
      ),
      provenance: input.provenance,
      freshness: resolveFreshness(input.freshness, input.now),
      recordedAt: input.now,
    };
    const stored = observations.put(scope, observationId, observation);
    audit.append(
      scope,
      { kind: "process", id: record.processId },
      "process.metrics-recorded",
      {
        actor: input.provenance.actor,
        at: input.now,
        reason: "process metrics observed",
      },
      Object.freeze({ observationId, revisionNumber: current.revisionNumber }),
    );
    return ok(stored);
  }

  return {
    registerProcess: (scope, input) => revise(scope, input, "create"),
    reviseProcess: (scope, input) => revise(scope, input, "revise"),
    getProcess: (scope: TenantScope, processId: string) => {
      const record = processes.get(scope, processId);
      return record ? ok(record) : { ok: false, error: notFound("process") };
    },
    listProcesses: (scope: TenantScope) => processes.list(scope),
    recordProcessMetrics,
    listProcessMetrics: (scope: TenantScope, processId: string, filter?: ProcessMetricsFilter) => {
      const all = observations
        .list(scope)
        .filter((item) => item.processId === processId)
        .sort((a, b) => a.recordedAt - b.recordedAt);
      if (!filter) return Object.freeze(all);
      return Object.freeze(
        all.filter(
          (item) =>
            (filter.since === undefined || item.recordedAt >= filter.since) &&
            (filter.until === undefined || item.recordedAt <= filter.until),
        ),
      );
    },
  };
}
