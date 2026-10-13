/**
 * W013 test helpers: fixtures and Result narrowing utilities for the
 * outcome learning + conditional organizations module. Mirrors the W008
 * helper patterns: the learning + lab surfaces are imported from the PUBLIC
 * application contract (../src/index.js) — the same boundary other modules
 * will use — while the domain vocabulary is consumed from @aurum/domain's
 * public entrypoint, exactly as the learning source itself does.
 *
 * The fixture wires a REAL domain kernel, a REAL W008 lab (sharing the
 * in-memory evaluation store with the learning service — the lab area's
 * own record surface) and the W013 learning service over an in-memory
 * append-only outcome store. No model, no IO, no execution plane.
 */
import { expect } from "vitest";
import {
  createDomainKernel,
  type DomainError,
  type DomainTimestamp,
  type OrganizationCandidate,
  type ProvenanceRecord,
  type RegisterCandidateInput,
  type Result,
  type TenantScope,
} from "@aurum/domain";
import type {
  CalibratedSearchResult,
  ConditionalEvidence,
  ContextFingerprint,
  LabEvaluationRecord,
  LearningError,
  OrganizationSearchResult,
  OutcomeLearning,
  OutcomeObservation,
  OutcomeStatus,
  OutcomeJoinRecord,
  OrganizationalLab,
  RecordOutcomeInput,
  SearchOrganizationsInput,
} from "../src/index.js";
import {
  createInMemoryEvaluationStore,
  createInMemoryOutcomeStore,
  createOrganizationalLab,
  createOutcomeLearning,
} from "../src/index.js";
import {
  now as labNow,
  personActor,
  provenance as labProvenance,
  raiseUnknowns,
  reviseGoalPriority,
  scope as labScope,
  seedGoal as seedLabGoal,
  seedMixedPool,
  systemActor,
} from "./helpers.js";

export type LabKernel = ReturnType<typeof createDomainKernel>;

export function scope(name: string): TenantScope {
  return labScope(name);
}

export function okOf<T>(result: Result<T, LearningError | DomainError>): T {
  expect(result.ok, `expected ok, got error: ${result.ok ? "" : result.error.message}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

export function errOf<T>(
  result: Result<T, LearningError | DomainError>,
): LearningError | DomainError {
  expect(
    result.ok,
    `expected error, got value: ${result.ok ? JSON.stringify(result.value) : ""}`,
  ).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

export const now = labNow;
export const daysAfter = (days: number, baseSeconds = 0): DomainTimestamp =>
  (1_700_000_000_000 + baseSeconds * 1000 + days * 24 * 60 * 60 * 1000) as DomainTimestamp;

export { personActor, systemActor };
export const provenance = (
  actor: Parameters<typeof labProvenance>[0],
  atSeconds = 0,
): ProvenanceRecord => labProvenance(actor, atSeconds);

/** The full W013 fixture: kernel + lab + learning over shared stores. */
export interface LearningFixture {
  readonly kernel: LabKernel;
  readonly lab: OrganizationalLab;
  readonly learning: OutcomeLearning;
}

export function learningFixture(): LearningFixture {
  const kernel = createDomainKernel();
  const evaluations = createInMemoryEvaluationStore();
  const lab = createOrganizationalLab({
    views: {
      goals: kernel.goals,
      capabilities: kernel.capabilities,
      workforce: kernel.workforce,
      inquiry: kernel.inquiry,
    },
    evaluations,
  });
  const learning = createOutcomeLearning({
    outcomes: createInMemoryOutcomeStore(),
    evaluations,
    candidates: kernel.candidates,
    lab,
  });
  return { kernel, lab, learning };
}

/** Seeds the standard subject (goal + mixed pool), W008 fixture style. */
export function seedSubject(fx: LearningFixture, s: TenantScope, priority = "medium"): void {
  seedLabGoal(fx.kernel, s, { priority });
  seedMixedPool(fx.kernel, s);
}

/** Raises the context to "bounded" uncertainty (one open unknown). */
export function raiseOneUnknown(fx: LearningFixture, s: TenantScope, goalId = "goal-1"): void {
  raiseUnknowns(fx.kernel, s, goalId, 1);
}

/** Revises the subject goal priority (context change). */
export function revisePriority(
  fx: LearningFixture,
  s: TenantScope,
  priority: string,
  goalId = "goal-1",
): void {
  reviseGoalPriority(fx.kernel, s, goalId, priority);
}

export interface SearchRun {
  readonly fingerprint: ContextFingerprint;
  readonly result: OrganizationSearchResult;
  readonly evaluation: LabEvaluationRecord;
}

/** Runs a search + returns the recorded evaluation (the join anchor). */
export function runSearch(
  fx: LearningFixture,
  s: TenantScope,
  options: { goalId?: string; atSeconds?: number } = {},
): SearchRun {
  const goalId = options.goalId ?? "goal-1";
  const at = options.atSeconds ?? 20;
  const { fingerprint } = okOf(fx.lab.fingerprintSituation(s, { goalId, now: now(at) }));
  const input: SearchOrganizationsInput = {
    goalId,
    fingerprint: fingerprint as SearchOrganizationsInput["fingerprint"],
    proposedBy: personActor("boss"),
    provenance: provenance(personActor("boss"), 10),
    now: now(at),
  };
  const result = okOf(fx.lab.searchOrganizations(s, input));
  const evaluation = fx.lab
    .listEvaluations(s, { goalId })
    .filter((record) => record.fingerprintDigest === fingerprint.digest)
    .at(-1);
  if (!evaluation) throw new Error("test setup: no evaluation recorded for the search");
  return { fingerprint, result, evaluation };
}

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
      ...(actor.unitId ? { unitId: actor.unitId } : {}),
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

/** Registers a search-produced candidate into the kernel registry. */
export function registerCandidate(
  fx: LearningFixture,
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
  failure?: { kind: string; detail: string };
  metric?: { metric: string; observed: number; target: number };
  actualCost?: number;
  source?: { kind: "mission" | "plan" | "manual"; ref: string };
  observedBy?: OutcomeObservation["observedBy"];
}): RecordOutcomeInput {
  return {
    outcomeId: options.outcomeId,
    evaluationId: options.evaluationId,
    candidateId: options.candidateId,
    observation: {
      status: options.status,
      source: options.source ?? { kind: "manual", ref: `run-${options.outcomeId}` },
      observedAt: now(options.observedAtSec ?? 30),
      observedBy: options.observedBy ?? personActor("boss"),
      ...(options.failure ? { failure: options.failure } : {}),
      ...(options.metric ? { metric: options.metric } : {}),
      ...(options.actualCost !== undefined ? { actualCost: options.actualCost } : {}),
    },
    provenance: provenance(personActor("boss"), 30),
    now: now(40),
  };
}

/** Convenience: records an outcome through the learning service. */
export function recordOutcome(
  fx: LearningFixture,
  s: TenantScope,
  options: Parameters<typeof outcomeInput>[0],
): OutcomeJoinRecord {
  return okOf(fx.learning.recordOutcome(s, outcomeInput(options)));
}

/** Convenience: calibrated search through the learning service. */
export function calibratedSearch(
  fx: LearningFixture,
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

/** Convenience: conditional evidence for a fingerprint's context class. */
export function conditionalEvidence(
  fx: LearningFixture,
  s: TenantScope,
  fingerprint: ContextFingerprint,
  at: DomainTimestamp = now(40),
): readonly ConditionalEvidence[] {
  return okOf(
    fx.learning.conditionalEvidence(s, {
      fingerprint,
      now: at,
    }),
  );
}

/** The strategy -> ranked-entry lookup on a search result. */
export function entryOf(
  result: SearchRun["result"],
  candidateId: string,
): SearchRun["result"]["ranked"][number] {
  const entry = result.ranked.find((item) => item.candidate.candidateId === candidateId);
  if (!entry) throw new Error(`test setup: candidate ${candidateId} not in ranked result`);
  return entry;
}
