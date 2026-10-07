/**
 * In-memory workforce recommendation store (W005). Proposals are open to any
 * actor (analysis is not authority); decisions are human-only — the store
 * rejects every non-person actor, so no code path can auto-decide.
 * Employment-impacting recommendations must be proposed with non-empty
 * evidence references, and inherently employment-impacting adjustments
 * (reassignment/hiring/agent-replacement/outsourcing) cannot be proposed
 * with `employmentImpacting: false`. Decisions are final (immutable).
 */
import { conflictError, forbiddenError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type { WorkforceRecommendationId } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import { isKnownSubjectKind } from "../core/refs.js";
import type { AuditSink } from "../audit/ports.js";
import { provenanceIssues } from "../evidence/provenance.js";
import {
  WORKFORCE_ADJUSTMENTS,
  isInherentlyEmploymentImpacting,
  isKnownWorkforceAdjustment,
  type WorkforceRecommendationRecord,
} from "./records.js";
import type {
  DecideRecommendationInput,
  ProposeRecommendationInput,
  RecommendationFilter,
  WorkforceRecommendations,
} from "./ports.js";

function validateSubject(
  v: ReturnType<typeof createValidator>,
  subject: { kind?: unknown; id?: unknown } | undefined,
  field: string,
): void {
  if (
    !subject ||
    typeof subject.kind !== "string" ||
    !isKnownSubjectKind(subject.kind) ||
    typeof subject.id !== "string" ||
    subject.id.trim().length === 0
  ) {
    v.add(field, "must be a typed subject reference");
  }
}

export function createWorkforceRecommendations(audit: AuditSink): WorkforceRecommendations {
  const recommendations = new TenantIndex<WorkforceRecommendationRecord>();

  function proposeRecommendation(
    scope: TenantScope,
    input: ProposeRecommendationInput,
  ): Result<WorkforceRecommendationRecord> {
    const v = createValidator();
    const recommendationId = v.requireIdFormat(
      "recommendationId",
      input?.recommendationId ?? "",
    ) as WorkforceRecommendationId;
    const adjustment = v.requireVocabulary("adjustment", String(input?.adjustment ?? ""), [
      ...WORKFORCE_ADJUSTMENTS,
    ]);
    validateSubject(v, input?.subject, "subject");
    v.requireText("rationale", input?.rationale ?? "");
    const evidenceRefs = Array.isArray(input?.evidenceRefs) ? input.evidenceRefs : [];
    evidenceRefs.forEach((ref, index) => {
      validateSubject(v, ref, `evidenceRefs.${index}`);
    });
    if (typeof input?.employmentImpacting !== "boolean") {
      v.add("employmentImpacting", "must be a boolean");
    }
    if (!input?.proposedBy || typeof input.proposedBy.kind !== "string") {
      v.add("proposedBy", "is required");
    }
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    const employmentImpacting = input.employmentImpacting;
    if (isKnownWorkforceAdjustment(adjustment)) {
      if (isInherentlyEmploymentImpacting(adjustment) && !employmentImpacting) {
        return {
          ok: false,
          error: validationError([
            {
              field: "employmentImpacting",
              problem: `adjustment "${adjustment}" impacts employment by construction and cannot be proposed as non-impacting`,
            },
          ]),
        };
      }
    }
    if (employmentImpacting && evidenceRefs.length === 0) {
      return {
        ok: false,
        error: validationError([
          {
            field: "evidenceRefs",
            problem: "employment-impacting recommendations require non-empty evidence references",
          },
        ]),
      };
    }
    if (recommendations.has(scope, recommendationId)) {
      return {
        ok: false,
        error: conflictError("workforce recommendation already registered in tenant"),
      };
    }
    const record: WorkforceRecommendationRecord = {
      scope,
      recommendationId,
      adjustment: isKnownWorkforceAdjustment(adjustment) ? adjustment : "training",
      subject: input.subject,
      rationale: input.rationale.trim(),
      evidenceRefs: Object.freeze([...evidenceRefs]),
      employmentImpacting,
      decision: { state: "pending" },
      proposedBy: input.proposedBy,
      proposedAt: input.now,
      provenance: input.provenance,
    };
    const stored = recommendations.put(scope, recommendationId, record);
    audit.append(
      scope,
      { kind: "workforce", id: recommendationId },
      "workforce.recommendation-proposed",
      { actor: input.proposedBy, at: input.now, reason: "workforce recommendation proposed" },
      Object.freeze({
        adjustment: record.adjustment,
        employmentImpacting,
        evidenceCount: evidenceRefs.length,
      }),
    );
    return ok(stored);
  }

  function decideRecommendation(
    scope: TenantScope,
    input: DecideRecommendationInput,
  ): Result<WorkforceRecommendationRecord> {
    const v = createValidator();
    v.requireIdFormat("recommendationId", input?.recommendationId ?? "");
    v.requireVocabulary("decision", String(input?.decision ?? ""), [
      "human-approved",
      "human-rejected",
    ]);
    v.requireText("reason", input?.reason ?? "");
    if (!input?.decidedBy || typeof input.decidedBy.kind !== "string") {
      v.add("decidedBy", "is required");
    }
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (input.decidedBy.kind !== "person") {
      return {
        ok: false,
        error: forbiddenError("workforce recommendations are decided by humans only"),
      };
    }
    const record = recommendations.get(scope, input.recommendationId);
    if (!record) return { ok: false, error: notFound("workforce recommendation") };
    if (record.decision.state !== "pending") {
      return {
        ok: false,
        error: conflictError(
          `recommendation already ${record.decision.state}; decisions are immutable`,
        ),
      };
    }
    const updated: WorkforceRecommendationRecord = {
      ...record,
      decision: {
        state: input.decision,
        decidedBy: input.decidedBy,
        decidedAt: input.now,
        reason: input.reason.trim(),
      },
    };
    const stored = recommendations.put(scope, record.recommendationId, updated);
    audit.append(
      scope,
      { kind: "workforce", id: record.recommendationId },
      "workforce.recommendation-decided",
      {
        actor: input.decidedBy,
        at: input.now,
        reason: input.reason,
      },
      Object.freeze({
        recommendationId: record.recommendationId,
        decision: input.decision,
        employmentImpacting: record.employmentImpacting,
      }),
    );
    return ok(stored);
  }

  return {
    proposeRecommendation,
    decideRecommendation,
    getRecommendation: (scope: TenantScope, recommendationId: string) => {
      const record = recommendations.get(scope, recommendationId);
      return record ? ok(record) : { ok: false, error: notFound("workforce recommendation") };
    },
    listRecommendations: (scope: TenantScope, filter?: RecommendationFilter) => {
      const all = recommendations.list(scope);
      if (!filter?.adjustment && !filter?.state && filter?.employmentImpacting === undefined) {
        return all;
      }
      return Object.freeze(
        all.filter(
          (record) =>
            (filter?.adjustment === undefined || record.adjustment === filter.adjustment) &&
            (filter?.state === undefined || record.decision.state === filter.state) &&
            (filter?.employmentImpacting === undefined ||
              record.employmentImpacting === filter.employmentImpacting),
        ),
      );
    },
  };
}
