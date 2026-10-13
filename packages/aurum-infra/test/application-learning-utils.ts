/**
 * P003 learning-loop test helpers (the outcome side of the
 * application-storage oracle): the candidate/join/outcome helpers the
 * outcome-store proofs and the end-to-end learning-loop proof drive —
 * split from `application-test-utils.ts` (the shared oracle core: trio,
 * fixtures, search journeys) to stay under the repo's max-lines law.
 *
 * Everything here drives the REAL application services over the in-memory
 * references (the semantic authority) or the REAL join/calibration
 * functions over PG-hydrated anchors — nothing is re-implemented (zero
 * drift by construction; the P002 test-double ruling bounds the fixtures
 * to the exported public surface they drive).
 */
import { expect } from "vitest";
import { assembleOutcomeJoin } from "@aurum/application";
import type {
  CalibratedSearchResult,
  LearningError,
  LearningLoopRetrieval,
  OutcomeJoinRecord,
  OutcomeJoinViews,
  OutcomeRecordStorage,
  OutcomeStatus,
  OutcomeStore,
  RecordOutcomeInput,
} from "@aurum/application";
import type { LoopFixture } from "./application-test-utils.js";
import { now, okOf, personActor, provenance } from "./application-test-utils.js";
import type {
  OrganizationCandidate,
  RegisterCandidateInput,
  Result,
  SearchOrganizationsInput,
  TenantScope,
  UnitId,
} from "@aurum/domain";

/** Maps a produced candidate VALUE into the registry input (house mapping). */
export function candidateInputOf(candidate: OrganizationCandidate): RegisterCandidateInput {
  return {
    candidateId: candidate.candidateId,
    ...(candidate.goalId !== undefined ? { goalId: candidate.goalId } : {}),
    ...(candidate.contextFingerprint !== undefined
      ? { contextFingerprint: candidate.contextFingerprint }
      : {}),
    ...(candidate.constraints !== undefined ? { constraints: candidate.constraints } : {}),
    actors: candidate.actors.map((actor) => ({
      actorId: actor.actorId,
      kind: actor.kind,
      ...(actor.personId ? { personId: actor.personId } : {}),
      ...(actor.unitId ? { unitId: actor.unitId as UnitId } : {}),
      ...(actor.agentBodyRef ? { agentBodyRef: actor.agentBodyRef } : {}),
      ...(actor.externalRef ? { externalRef: actor.externalRef } : {}),
      ...(actor.displayName ? { displayName: actor.displayName } : {}),
    })),
    assignments: candidate.assignments.map((assignment) => ({
      assignmentId: assignment.assignmentId,
      actorId: assignment.actorId,
      position: assignment.position,
      ...(assignment.stepRefs ? { stepRefs: [...assignment.stepRefs] } : {}),
      effortShare: assignment.effortShare,
      ...(assignment.period ? { period: assignment.period } : {}),
    })),
    capabilityAllocations: candidate.capabilityAllocations.map((allocation) => ({
      allocationId: allocation.allocationId,
      capabilityId: allocation.capabilityId,
      ...(allocation.requirementRef ? { requirementRef: allocation.requirementRef } : {}),
      actorIds: [...allocation.actorIds],
      level: allocation.level,
      capacityPerPeriod: allocation.capacityPerPeriod,
      ...(allocation.workloadShare !== undefined
        ? { workloadShare: allocation.workloadShare }
        : {}),
    })),
    topology: candidate.topology,
    modelOccupancy: [...candidate.modelOccupancy],
    environment: [...candidate.environment],
    ...(candidate.budget ? { budget: candidate.budget } : {}),
    expectedOutcome: candidate.expectedOutcome,
    risks: [...candidate.risks],
    evidenceRefs: [...candidate.evidenceRefs],
    proposedBy: candidate.proposedBy,
    provenance: candidate.provenance,
    now: candidate.proposedAt,
  };
}

/** Registers a search-produced candidate into the kernel registry (oracle side). */
export function registerCandidate(
  fx: LoopFixture,
  s: TenantScope,
  candidate: OrganizationCandidate,
): void {
  const registered = fx.kernel.candidates.registerCandidate(s, candidateInputOf(candidate));
  if (!registered.ok) {
    throw new Error(`test setup: registerCandidate failed: ${registered.error.message}`);
  }
}

/** Builds a RecordOutcomeInput (observation + join anchor). */
export function outcomeInput(options: {
  outcomeId: string;
  evaluationId: string;
  candidateId: string;
  status: OutcomeStatus;
  observedAtSec?: number;
  atSec?: number;
  failure?: { kind: string; detail: string };
  metric?: { metric: string; observed: number; target: number };
  actualCost?: number;
}): RecordOutcomeInput {
  return {
    outcomeId: options.outcomeId,
    evaluationId: options.evaluationId,
    candidateId: options.candidateId,
    observation: {
      status: options.status,
      source: { kind: "manual", ref: `run-${options.outcomeId}` },
      observedAt: now(options.observedAtSec ?? 30),
      observedBy: personActor("boss"),
      ...(options.failure ? { failure: options.failure } : {}),
      ...(options.metric ? { metric: options.metric } : {}),
      ...(options.actualCost !== undefined ? { actualCost: options.actualCost } : {}),
    },
    provenance: provenance(personActor("boss"), 30),
    now: now(options.atSec ?? 40),
  };
}

/** Convenience: records an outcome through the REAL learning service (oracle). */
export function recordOutcome(
  fx: LoopFixture,
  s: TenantScope,
  options: Parameters<typeof outcomeInput>[0],
): OutcomeJoinRecord {
  return okOf(fx.learning.recordOutcome(s, outcomeInput(options)));
}

/** Convenience: calibrated search through the REAL learning service. */
export function calibratedSearch(
  fx: LoopFixture,
  s: TenantScope,
  options: { goalId?: string; atSeconds?: number } = {},
): CalibratedSearchResult {
  const goalId = options.goalId ?? "goal-1";
  const at = options.atSeconds ?? 20;
  const { fingerprint } = okOf(fx.lab.fingerprintSituation(s, { goalId, now: now(at) }));
  return okOf(
    fx.learning.calibratedSearch(s, {
      goalId,
      fingerprint: fingerprint as SearchOrganizationsInput["fingerprint"],
      proposedBy: personActor("boss"),
      provenance: provenance(personActor("boss"), 10),
      now: now(at),
    }),
  );
}

/**
 * Carries every reference outcome not yet stored into BOTH async stores —
 * the symmetric-driving discipline for the outcome side: after every
 * learning journey the three stores must hold the same records.
 */
export async function mirrorReferenceOutcomes(
  reference: OutcomeStore,
  stores: readonly OutcomeRecordStorage[],
  s: TenantScope,
): Promise<void> {
  const existing = new Set(
    (
      await Promise.all(
        stores.map(async (store) => (await store.listOutcomes(s)).map((r) => r.outcomeId)),
      )
    ).flat(),
  );
  for (const record of reference.listOutcomes(s)) {
    if (existing.has(record.outcomeId)) continue;
    for (const store of stores) {
      const appended = await store.putOutcome(s, record);
      expect(
        appended.ok,
        `mirror append failed: ${appended.ok ? "" : appended.error.message}`,
      ).toBe(true);
    }
  }
}

/**
 * Loads the two join anchors through the PG retrieval paths and hydrates
 * the SYNC seam views the REAL `assembleOutcomeJoin` consumes — the
 * retrieval paths feed the learning loop; the join logic itself is never
 * re-implemented (zero drift by construction).
 */
export async function hydratedJoinViews(
  retrieval: LearningLoopRetrieval,
  s: TenantScope,
  anchors: { evaluationId: string; candidateId: string },
): Promise<OutcomeJoinViews> {
  const evaluation = await retrieval.evaluations.getEvaluation(s, anchors.evaluationId);
  const candidate = await retrieval.candidates.getCandidate(s, anchors.candidateId);
  return {
    evaluations: { getEvaluation: () => evaluation },
    candidates: { getCandidate: () => candidate },
  };
}

/** Runs the REAL join assembly over PG-hydrated anchors (the loop's join step). */
export async function joinOutcomeFromPg(
  retrieval: LearningLoopRetrieval,
  s: TenantScope,
  input: RecordOutcomeInput,
): Promise<Result<OutcomeJoinRecord, LearningError>> {
  const views = await hydratedJoinViews(retrieval, s, {
    evaluationId: input.evaluationId,
    candidateId: input.candidateId,
  });
  return assembleOutcomeJoin(views, s, input);
}
