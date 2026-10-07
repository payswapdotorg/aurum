/**
 * In-memory organization candidate registry (W005). Registration performs the
 * deep structural validation of the frozen vocabulary (actor/assignment/
 * allocation/topology/occupancy cross-references, budget, expected outcome,
 * risks, constraints, mandatory evidence) and freezes the record. Candidates
 * are proposals: this store exposes no activation or execution path.
 */
import { conflictError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type {
  GoalId,
  OrganizationCandidateId,
  PersonId,
  UnitId,
  CapabilityId,
} from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import type { AuditSink } from "../audit/ports.js";
import { provenanceIssues } from "../evidence/provenance.js";
import { isKnownCandidateActorKind, type CandidateActor } from "./actors.js";
import type { ActorAssignment, CapabilityAllocation } from "./allocations.js";
import { organizationCandidateIssues, type OrganizationCandidate } from "./records.js";
import type {
  CandidateActorInput,
  OrganizationCandidateRegistry,
  RegisterCandidateInput,
} from "./ports.js";

function buildActor(actor: CandidateActorInput): CandidateActor {
  return {
    actorId: actor.actorId.trim(),
    kind: isKnownCandidateActorKind(actor.kind) ? actor.kind : "external-service",
    ...(actor.personId ? { personId: actor.personId.trim() as PersonId } : {}),
    ...(actor.unitId ? { unitId: actor.unitId.trim() as UnitId } : {}),
    ...(actor.agentBodyRef ? { agentBodyRef: actor.agentBodyRef.trim() } : {}),
    ...(actor.externalRef ? { externalRef: actor.externalRef.trim() } : {}),
    ...(actor.displayName ? { displayName: actor.displayName.trim() } : {}),
  };
}

export function createCandidateRegistry(audit: AuditSink): OrganizationCandidateRegistry {
  const candidates = new TenantIndex<OrganizationCandidate>();

  function registerCandidate(
    scope: TenantScope,
    input: RegisterCandidateInput,
  ): Result<OrganizationCandidate> {
    const v = createValidator();
    const candidateId = v.requireIdFormat(
      "candidateId",
      input?.candidateId ?? "",
    ) as OrganizationCandidateId;
    if (input?.goalId !== undefined) v.requireIdFormat("goalId", input.goalId);
    if (input?.contextFingerprint !== undefined) {
      v.requireText("contextFingerprint", input.contextFingerprint, { max: 300 });
    }
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    if (candidates.has(scope, candidateId)) {
      return { ok: false, error: conflictError("candidate already registered in tenant") };
    }
    const outcomeInput = input.expectedOutcome ?? {
      target: Number.NaN,
      confidence: Number.NaN,
    };

    const draft: OrganizationCandidate = {
      scope,
      candidateId,
      ...(input.goalId ? { goalId: input.goalId.trim() as GoalId } : {}),
      ...(input.contextFingerprint ? { contextFingerprint: input.contextFingerprint.trim() } : {}),
      ...(input.constraints ? { constraints: input.constraints } : {}),
      actors: Object.freeze((input.actors ?? []).map(buildActor)),
      assignments: Object.freeze(
        (input.assignments ?? []).map((assignment) => ({
          assignmentId: assignment.assignmentId.trim(),
          actorId: assignment.actorId.trim(),
          position: assignment.position.trim(),
          ...(assignment.stepRefs ? { stepRefs: Object.freeze([...assignment.stepRefs]) } : {}),
          effortShare: assignment.effortShare,
          ...(assignment.period ? { period: assignment.period } : {}),
        })) as readonly ActorAssignment[],
      ),
      capabilityAllocations: Object.freeze(
        (input.capabilityAllocations ?? []).map((allocation) => ({
          allocationId: allocation.allocationId.trim(),
          capabilityId: allocation.capabilityId.trim() as CapabilityId,
          ...(allocation.requirementRef
            ? { requirementRef: allocation.requirementRef.trim() }
            : {}),
          actorIds: Object.freeze([...allocation.actorIds]),
          level: allocation.level,
          capacityPerPeriod: allocation.capacityPerPeriod,
          ...(allocation.workloadShare !== undefined
            ? { workloadShare: allocation.workloadShare }
            : {}),
        })) as readonly CapabilityAllocation[],
      ),
      topology: input.topology,
      modelOccupancy: Object.freeze([...(input.modelOccupancy ?? [])]),
      environment: Object.freeze([...(input.environment ?? [])]),
      ...(input.budget ? { budget: input.budget } : {}),
      expectedOutcome: {
        ...(outcomeInput.goalId ? { goalId: outcomeInput.goalId.trim() as GoalId } : {}),
        ...(outcomeInput.metric ? { metric: outcomeInput.metric } : {}),
        target: typeof outcomeInput.target === "number" ? outcomeInput.target : Number.NaN,
        confidence:
          typeof outcomeInput.confidence === "number" ? outcomeInput.confidence : Number.NaN,
      },
      risks: Object.freeze([...(input.risks ?? [])]),
      evidenceRefs: Object.freeze([
        ...(input.evidenceRefs ?? []),
      ]) as OrganizationCandidate["evidenceRefs"],
      proposedBy: input.proposedBy,
      proposedAt: input.now,
      provenance: input.provenance,
    };

    const issues = organizationCandidateIssues(draft);
    if (issues.length > 0) return { ok: false, error: validationError(issues) };

    const stored = candidates.put(scope, candidateId, draft);
    audit.append(
      scope,
      { kind: "candidate", id: candidateId },
      "candidate.registered",
      { actor: input.proposedBy, at: input.now, reason: "organization candidate registered" },
      Object.freeze({
        candidateId,
        actorCount: draft.actors.length,
        assignmentCount: draft.assignments.length,
        allocationCount: draft.capabilityAllocations.length,
        evidenceCount: draft.evidenceRefs.length,
      }),
    );
    return ok(stored);
  }

  return {
    registerCandidate,
    getCandidate: (scope: TenantScope, candidateId: string) => {
      const record = candidates.get(scope, candidateId);
      return record ? ok(record) : { ok: false, error: notFound("organization candidate") };
    },
    listCandidates: (scope: TenantScope) => candidates.list(scope),
  };
}
