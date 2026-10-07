/**
 * In-memory capability graph. Supplies/requirements/capabilities are
 * registered with provenance; gap records are appended by recompute (ids
 * kernel-generated, sequential per store — deterministic, no IO). Every
 * consequential transition lands in the shared audit trail.
 */
import { conflictError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type {
  CapabilityGapId,
  CapabilityId,
  CapabilityRequirementId,
  CapabilitySupplyId,
} from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import { supplierIssues } from "../core/suppliers.js";
import type { AuditSink } from "../audit/ports.js";
import { provenanceIssues } from "../evidence/provenance.js";
import { resolveFreshness } from "../evidence/freshness.js";
import { isKnownGoalPriority, type GoalPriority } from "../goals/records.js";
import {
  PROFICIENCY_MAX,
  PROFICIENCY_MIN,
  assessCoverage,
  isKnownRequirementSource,
  type CapabilityGapRecord,
  type CapabilityRecord,
  type CapabilityRequirementRecord,
  type CapabilitySupplyRecord,
  type CoverageAssessment,
  type RequirementSource,
} from "./records.js";
import type {
  CapabilityGraph,
  GapFilter,
  RecomputeGapsInput,
  RegisterCapabilityInput,
  RegisterRequirementInput,
  RegisterSupplyInput,
  RequirementFilter,
  SupplyFilter,
} from "./ports.js";

function validateLevel(v: ReturnType<typeof createValidator>, field: string, value: number): void {
  v.requireMinInt(field, value, PROFICIENCY_MIN);
  if (Number.isInteger(value) && value > PROFICIENCY_MAX) {
    v.add(field, `must be at most ${PROFICIENCY_MAX}`);
  }
}

export function createCapabilityGraph(audit: AuditSink): CapabilityGraph {
  const capabilities = new TenantIndex<CapabilityRecord>();
  const supplies = new TenantIndex<CapabilitySupplyRecord>();
  const requirements = new TenantIndex<CapabilityRequirementRecord>();
  const gaps = new TenantIndex<CapabilityGapRecord>();
  let gapCounter = 0;

  function registerCapability(
    scope: TenantScope,
    input: RegisterCapabilityInput,
  ): Result<CapabilityRecord> {
    const v = createValidator();
    const capabilityId = v.requireIdFormat(
      "capabilityId",
      input?.capabilityId ?? "",
    ) as CapabilityId;
    v.requireText("name", input?.name ?? "", { max: 300 });
    if (input?.description !== undefined) v.requireText("description", input.description);
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    if (capabilities.has(scope, capabilityId)) {
      return { ok: false, error: conflictError("capability already registered in tenant") };
    }
    const record: CapabilityRecord = {
      scope,
      capabilityId,
      name: input.name.trim(),
      ...(input.description ? { description: input.description.trim() } : {}),
      provenance: input.provenance,
      createdAt: input.now,
    };
    const stored = capabilities.put(scope, capabilityId, record);
    audit.append(
      scope,
      { kind: "capability", id: capabilityId },
      "capability.registered",
      { actor: input.provenance.actor, at: input.now, reason: "capability registered" },
      Object.freeze({ name: record.name }),
    );
    return ok(stored);
  }

  function registerSupply(
    scope: TenantScope,
    input: RegisterSupplyInput,
  ): Result<CapabilitySupplyRecord> {
    const v = createValidator();
    const supplyId = v.requireIdFormat("supplyId", input?.supplyId ?? "") as CapabilitySupplyId;
    v.requireIdFormat("capabilityId", input?.capabilityId ?? "");
    for (const issue of supplierIssues(input?.supplier)) v.add(issue.field, issue.problem);
    validateLevel(v, "level", input?.level ?? Number.NaN);
    if (input?.capacityPerPeriod !== undefined) {
      v.requireNonNegativeNumber("capacityPerPeriod", input.capacityPerPeriod);
    }
    if (input?.availableFrom !== undefined) {
      v.requireNonNegativeNumber("availableFrom", input.availableFrom);
    }
    if (input?.availableUntil !== undefined) {
      v.requireNonNegativeNumber("availableUntil", input.availableUntil);
    }
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    const capability = capabilities.get(scope, (input.capabilityId ?? "") as CapabilityId);
    if (!capability) return { ok: false, error: notFound("capability") };
    if (supplies.has(scope, supplyId)) {
      return { ok: false, error: conflictError("capability supply already registered in tenant") };
    }
    const record: CapabilitySupplyRecord = {
      scope,
      supplyId,
      capabilityId: capability.capabilityId,
      supplier: input.supplier,
      level: input.level,
      ...(input.capacityPerPeriod !== undefined
        ? { capacityPerPeriod: input.capacityPerPeriod }
        : {}),
      ...(input.availableFrom !== undefined ? { availableFrom: input.availableFrom } : {}),
      ...(input.availableUntil !== undefined ? { availableUntil: input.availableUntil } : {}),
      provenance: input.provenance,
      freshness: resolveFreshness(input.freshness, input.now),
      createdAt: input.now,
    };
    const stored = supplies.put(scope, supplyId, record);
    audit.append(
      scope,
      { kind: "capability", id: capability.capabilityId },
      "capability.supply-registered",
      { actor: input.provenance.actor, at: input.now, reason: "capability supply registered" },
      Object.freeze({
        supplyId,
        supplierKind: record.supplier.kind,
        level: record.level,
      }),
    );
    return ok(stored);
  }

  function registerRequirement(
    scope: TenantScope,
    input: RegisterRequirementInput,
  ): Result<CapabilityRequirementRecord> {
    const v = createValidator();
    const requirementId = v.requireIdFormat(
      "requirementId",
      input?.requirementId ?? "",
    ) as CapabilityRequirementId;
    v.requireIdFormat("capabilityId", input?.capabilityId ?? "");
    const sourceKind = v.requireVocabulary("source.kind", String(input?.source?.kind ?? ""), [
      "goal",
      "process",
      "project",
      "opportunity",
      "manual",
    ]);
    v.requireIdFormat("source.ref", input?.source?.ref ?? "");
    validateLevel(v, "requiredLevel", input?.requiredLevel ?? Number.NaN);
    if (input?.requiredCapacityPerPeriod !== undefined) {
      v.requireNonNegativeNumber("requiredCapacityPerPeriod", input.requiredCapacityPerPeriod);
    }
    if (input?.priority !== undefined) {
      v.requireVocabulary("priority", String(input.priority), [
        "critical",
        "high",
        "medium",
        "low",
      ]);
    }
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    const capability = capabilities.get(scope, (input.capabilityId ?? "") as CapabilityId);
    if (!capability) return { ok: false, error: notFound("capability") };
    if (requirements.has(scope, requirementId)) {
      return {
        ok: false,
        error: conflictError("capability requirement already registered in tenant"),
      };
    }
    const source: RequirementSource = {
      kind: isKnownRequirementSource(sourceKind) ? sourceKind : "manual",
      ref: input.source.ref.trim(),
    };
    const record: CapabilityRequirementRecord = {
      scope,
      requirementId,
      capabilityId: capability.capabilityId,
      source,
      requiredLevel: input.requiredLevel,
      ...(input.requiredCapacityPerPeriod !== undefined
        ? { requiredCapacityPerPeriod: input.requiredCapacityPerPeriod }
        : {}),
      ...(input.priority !== undefined && isKnownGoalPriority(String(input.priority))
        ? { priority: input.priority as GoalPriority }
        : {}),
      provenance: input.provenance,
      createdAt: input.now,
    };
    const stored = requirements.put(scope, requirementId, record);
    audit.append(
      scope,
      { kind: "capability", id: capability.capabilityId },
      "capability.requirement-registered",
      { actor: input.provenance.actor, at: input.now, reason: "capability requirement registered" },
      Object.freeze({ requirementId, sourceKind: source.kind }),
    );
    return ok(stored);
  }

  function recomputeGaps(
    scope: TenantScope,
    input: RecomputeGapsInput,
  ): Result<readonly CoverageAssessment[]> {
    const v = createValidator();
    if (input?.requirementId !== undefined) v.requireIdFormat("requirementId", input.requirementId);
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    const all = requirements.list(scope);
    const targets = input?.requirementId
      ? all.filter((item) => item.requirementId === input.requirementId)
      : all;
    if (input?.requirementId && targets.length === 0) {
      return { ok: false, error: notFound("capability requirement") };
    }
    const assessments: CoverageAssessment[] = [];
    for (const requirement of targets) {
      const related = supplies
        .list(scope)
        .filter((supply) => supply.capabilityId === requirement.capabilityId);
      const assessment = assessCoverage(requirement, related, input.now);
      assessments.push(assessment);
      if (assessment.status !== "covered") {
        gapCounter += 1;
        const gapId = `gap-${gapCounter}` as CapabilityGapId;
        const gap: CapabilityGapRecord = {
          scope,
          gapId,
          requirementId: requirement.requirementId,
          capabilityId: requirement.capabilityId,
          kind: assessment.status,
          ...(assessment.levelShortfall !== undefined
            ? { levelShortfall: assessment.levelShortfall }
            : {}),
          ...(assessment.capacityShortfall !== undefined
            ? { capacityShortfall: assessment.capacityShortfall }
            : {}),
          candidateSupplyIds: assessment.candidateSupplyIds,
          computedAt: input.now,
          provenance: input.provenance,
        };
        gaps.put(scope, gapId, gap);
      }
    }
    audit.append(
      scope,
      { kind: "capability", id: "graph" },
      "capability.gap-recomputed",
      { actor: input.provenance.actor, at: input.now, reason: "capability gaps recomputed" },
      Object.freeze({
        assessed: assessments.length,
        gaps: assessments.filter((item) => item.status !== "covered").length,
      }),
    );
    return ok(Object.freeze(assessments));
  }

  return {
    registerCapability,
    getCapability: (scope: TenantScope, capabilityId: string) => {
      const record = capabilities.get(scope, capabilityId);
      return record ? ok(record) : { ok: false, error: notFound("capability") };
    },
    listCapabilities: (scope: TenantScope) => capabilities.list(scope),
    registerSupply,
    listSupplies: (scope: TenantScope, filter?: SupplyFilter) => {
      const all = supplies.list(scope);
      if (!filter?.capabilityId) return all;
      return Object.freeze(all.filter((supply) => supply.capabilityId === filter.capabilityId));
    },
    registerRequirement,
    listRequirements: (scope: TenantScope, filter?: RequirementFilter) => {
      const all = requirements.list(scope);
      if (!filter?.capabilityId && !filter?.sourceKind) return all;
      return Object.freeze(
        all.filter(
          (requirement) =>
            (filter?.capabilityId === undefined ||
              requirement.capabilityId === filter.capabilityId) &&
            (filter?.sourceKind === undefined || requirement.source.kind === filter.sourceKind),
        ),
      );
    },
    recomputeGaps,
    listGaps: (scope: TenantScope, filter?: GapFilter) => {
      const all = [...gaps.list(scope)].sort(
        (a, b) => a.computedAt - b.computedAt || a.gapId.localeCompare(b.gapId),
      );
      if (!filter?.requirementId && !filter?.kind) return Object.freeze(all);
      return Object.freeze(
        all.filter(
          (gap) =>
            (filter?.requirementId === undefined || gap.requirementId === filter.requirementId) &&
            (filter?.kind === undefined || gap.kind === filter.kind),
        ),
      );
    },
  };
}
