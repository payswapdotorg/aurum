/**
 * PostgreSQL organization candidate registry (P001, candidate area) with
 * semantics identical to the in-memory reference — same input validation
 * issues (id formats, context fingerprint length, provenance, now), the
 * same conflict-before-deep-validation order, the same deep structural
 * validation of the W005 frozen vocabulary (actor/assignment/allocation/
 * topology/occupancy cross-references, budget, expected outcome, risks,
 * constraints, mandatory evidence) and the same audit side-effect
 * (candidate.registered on subject "candidate").
 *
 * Zero-drift ruling: the deep validation is the domain-exported pure
 * function `organizationCandidateIssues` — the very function the
 * in-memory registry calls on its draft — so the structural vocabulary
 * check cannot drift between kernels (the identity-area pattern of
 * reusing `activeRolesFor`, the workforce pattern of `summarizeWorkload`).
 * The adapter mirrors only the input field validation, the draft building
 * (including the unknown-actor-kind fallback and the NaN expected-outcome
 * fallback) and the storage discipline.
 *
 * Storage ruling (migration 0012): one immutable row per candidate keyed
 * (tenant, candidate_id) under aurum_reject_mutation. Candidates are
 * proposals — this store exposes no activation or execution path, exactly
 * like the in-memory registry.
 */
import {
  conflictError,
  createValidator,
  deepFreeze,
  isKnownCandidateActorKind,
  notFound,
  ok,
  organizationCandidateIssues,
  provenanceIssues,
  validationError,
} from "@aurum/domain";
import type {
  ActorAssignment,
  CandidateActor,
  CandidateStorage,
  CapabilityAllocation,
  GoalId,
  OrganizationCandidate,
  OrganizationCandidateId,
  PersonId,
  RegisterCandidateInput,
  TenantScope,
  UnitId,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db } from "../pg/db.js";

/** Mirrors the domain-internal buildActor (candidateStore.ts). */
function buildActor(actor: RegisterCandidateInput["actors"][number]): CandidateActor {
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

/** Mirrors the domain-internal draft building (candidateStore.ts). */
function buildDraft(
  scope: TenantScope,
  candidateId: OrganizationCandidateId,
  input: RegisterCandidateInput,
): OrganizationCandidate {
  const outcomeInput = input.expectedOutcome ?? {
    target: Number.NaN,
    confidence: Number.NaN,
  };
  return {
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
        capabilityId: allocation.capabilityId.trim() as CapabilityAllocation["capabilityId"],
        ...(allocation.requirementRef ? { requirementRef: allocation.requirementRef.trim() } : {}),
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
}

/** Loads one candidate record, undefined when absent for this tenant. */
async function loadCandidate(
  sql: Db,
  scope: TenantScope,
  candidateId: string,
): Promise<OrganizationCandidate | undefined> {
  const rows: readonly { record: OrganizationCandidate }[] = await sql`
    select record from domain_candidates
    where tenant_id = ${scope.tenantId} and candidate_id = ${candidateId}
  `;
  const row = rows[0];
  return row ? deepFreeze(row.record) : undefined;
}

/** Creates the PostgreSQL candidate registry bound to a database handle. */
export function createPgCandidateRegistry(sql: Db): CandidateStorage {
  return {
    registerCandidate: async (scope, input: RegisterCandidateInput) => {
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

      try {
        return await sql.begin(async (tx) => {
          // Id conflict before the deep structural validation (in-memory order).
          const existing = await tx`
            select 1 from domain_candidates
            where tenant_id = ${scope.tenantId} and candidate_id = ${candidateId}
          `;
          if (existing.length > 0) {
            return { ok: false, error: conflictError("candidate already registered in tenant") };
          }
          const draft = buildDraft(scope, candidateId, input);
          // The domain-exported deep validation — zero drift by construction.
          const issues = organizationCandidateIssues(draft);
          if (issues.length > 0) return { ok: false, error: validationError(issues) };
          await tx`
            insert into domain_candidates (tenant_id, candidate_id, record)
            values (${scope.tenantId}, ${candidateId}, ${jsonbParam(tx, draft)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `candidate:register:${candidateId}`,
            area: "candidate",
            operation: "register",
            recordId: candidateId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "candidate", id: candidateId },
            "candidate.registered",
            {
              actor: input.proposedBy,
              at: input.now,
              reason: "organization candidate registered",
            },
            Object.freeze({
              candidateId,
              actorCount: draft.actors.length,
              assignmentCount: draft.assignments.length,
              allocationCount: draft.capabilityAllocations.length,
              evidenceCount: draft.evidenceRefs.length,
            }),
          );
          return ok(deepFreeze(draft));
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("candidate already registered in tenant") };
        }
        throw error;
      }
    },
    getCandidate: async (scope, candidateId: string) => {
      const record = await loadCandidate(sql, scope, candidateId);
      return record ? ok(record) : { ok: false, error: notFound("organization candidate") };
    },
    listCandidates: async (scope) => {
      const rows: readonly { record: OrganizationCandidate }[] = await sql`
        select record from domain_candidates
        where tenant_id = ${scope.tenantId}
        order by seq
      `;
      return Object.freeze(rows.map((row) => deepFreeze(row.record)));
    },
  };
}
