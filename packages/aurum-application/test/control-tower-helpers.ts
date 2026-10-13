/**
 * W010 test helpers: fixtures for the control-tower proofs. The tower
 * surface is imported from the PUBLIC application contract
 * (../src/index.js) — the same boundary the web variant consumes — and the
 * fixture composes the CANONICAL LOCAL RUNTIME (real kernel + the four real
 * services + the tower) with the deterministic scripted reasoner. No real
 * model is ever called; no fixture writes tower view models back anywhere.
 */
import { expect } from "vitest";
import {
  tenantScope,
  type ActorReference,
  type DomainError,
  type DomainTimestamp,
  type PersonId,
  type ProvenanceRecord,
  type Result,
  type SubjectReference,
  type TenantScope,
} from "@aurum/domain";
import type {
  ControlTowerError,
  LocalControlTowerRuntime,
  MissionError,
  PlanError,
  ReasonerScriptEntry,
  ScriptedReasoner,
} from "../src/index.js";
import { createLocalControlTowerRuntime, createScriptedReasoner } from "../src/index.js";
import { standardContent } from "./cognition-helpers.js";
import { planTask, seedCandidate } from "./plans-helpers.js";

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

export function scope(name: string): TenantScope {
  const result = tenantScope(name);
  if (!result.ok) throw new Error(`test setup: invalid tenant name ${name}`);
  return result.value;
}

type TowerOk<T> = Result<T, ControlTowerError>;

export function okOf<T>(result: TowerOk<T> | Result<T, MissionError | PlanError | DomainError>): T {
  expect(result.ok, `expected ok, got error: ${result.ok ? "" : result.error}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

/** Narrows a tower READ error (the tagged union). */
export function towerErrOf<T>(result: TowerOk<T>): ControlTowerError {
  expect(
    result.ok,
    `expected error, got value: ${result.ok ? JSON.stringify(result.value) : ""}`,
  ).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

/** Narrows a DELEGATED action error (the owning area's own namespace). */
export function errOf<T, E>(result: Result<T, E>): E {
  expect(
    result.ok,
    `expected error, got value: ${result.ok ? JSON.stringify(result.value) : ""}`,
  ).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

export const now = (secondsAfterBase = 0): DomainTimestamp =>
  (T0 + secondsAfterBase * 1000) as DomainTimestamp;

export const daysFromNow = (days: number, base = 0): DomainTimestamp =>
  (T0 + base * 1000 + days * DAY) as DomainTimestamp;

export const personActor = (personId: string): ActorReference => ({
  kind: "person",
  personId: personId as PersonId,
});

export const systemActor = (name: string): ActorReference => ({ kind: "system", name });

export const provenance = (actor: ActorReference, atSeconds = 0): ProvenanceRecord => ({
  actor,
  source: "human-entered",
  recordedAt: now(atSeconds),
});

/** The standard knowledge subject used across the tower proofs. */
export const topic = (id = "invoices"): SubjectReference => ({ kind: "topic", id });

export interface TowerFixture {
  readonly runtime: LocalControlTowerRuntime;
  readonly reasoner: ScriptedReasoner;
  readonly tower: LocalControlTowerRuntime["tower"];
}

/** Wires the canonical local runtime with the deterministic reasoner. */
export function towerFixture(
  script: readonly ReasonerScriptEntry[] = [standardContent()],
): TowerFixture {
  const reasoner = createScriptedReasoner(script);
  const runtime = createLocalControlTowerRuntime({ reasoning: reasoner });
  return { runtime, reasoner, tower: runtime.tower };
}

/** Seeds a goal with expected evidence about the standard topic. */
export function seedTowerGoal(
  runtime: LocalControlTowerRuntime,
  s: TenantScope,
  options: { goalId?: string; priority?: string } = {},
): string {
  const goalId = options.goalId ?? "goal-1";
  const result = runtime.kernel.goals.createGoal(s, {
    goalId,
    objective: "Cut invoice processing cycle time",
    desiredState: "Invoices processed within SLA",
    horizonStart: now(0),
    horizonEnd: daysFromNow(60),
    ownerId: "boss",
    ownerLabels: ["executive"],
    priority: options.priority ?? "high",
    expectedEvidence: [{ description: "processing metrics", subject: topic() }],
    provenance: provenance(personActor("p-1"), 0),
    now: now(0),
    audit: { actor: personActor("p-1"), at: now(0), reason: "seed" },
  });
  if (!result.ok) throw new Error(`seedTowerGoal failed: ${result.error.message}`);
  return goalId;
}

/** Seeds one active observation about the standard topic. */
export function seedObservation(
  runtime: LocalControlTowerRuntime,
  s: TenantScope,
  observationId: string,
  atSeconds = 0,
): string {
  const result = runtime.kernel.evidence.recordObservation(s, {
    observationId,
    subject: topic(),
    content: `Observation ${observationId} about the topic`,
    observedAt: now(atSeconds),
    provenance: provenance(personActor("p-1"), atSeconds),
    freshness: { asOf: now(atSeconds) },
  });
  if (!result.ok) throw new Error(`seedObservation failed: ${result.error.message}`);
  return observationId;
}

/**
 * Grants the person an owner membership, then drives one action through the
 * REAL kernel authority to `approved` (propose -> recommend -> approve) so a
 * plan approval can cite it. Returns the action id.
 */
export function seedApprovedAction(
  runtime: LocalControlTowerRuntime,
  s: TenantScope,
  options: { actionId?: string; personId?: string } = {},
): string {
  const actionId = options.actionId ?? "action-approve-1";
  const personId = options.personId ?? "p-1";
  const person = runtime.kernel.identity.registerPerson(s, {
    personId,
    displayName: `Person ${personId}`,
    labels: ["employee"],
    provenance: systemActor("seed"),
    now: now(0),
  });
  if (!person.ok) throw new Error(`registerPerson failed: ${person.error.message}`);
  const membership = runtime.kernel.identity.grantMembership(s, {
    membershipId: `mem-${personId}`,
    personId,
    organizationId: "org-1",
    roles: ["owner"],
    grantedBy: systemActor("seed"),
    now: now(0),
    audit: { actor: systemActor("seed"), at: now(0), reason: "seed" },
  });
  if (!membership.ok) throw new Error(`grantMembership failed: ${membership.error.message}`);

  const proposed = runtime.kernel.actions.proposeAction(s, {
    actionId,
    title: "Approve the invoice overhaul plan",
    subject: { kind: "topic", id: "invoices" },
    policy: {
      approvalRoles: ["owner"],
      authorizationRoles: ["owner"],
      employmentImpacting: false,
    },
    createdBy: personActor(personId),
    now: now(1),
  });
  if (!proposed.ok) throw new Error(`proposeAction failed: ${proposed.error.message}`);
  const recommended = runtime.kernel.actions.recommendAction(s, {
    actionId,
    expectedState: "proposed",
    now: now(2),
    audit: { actor: systemActor("seed"), at: now(2), reason: "seed recommendation" },
  });
  if (!recommended.ok) throw new Error(`recommendAction failed: ${recommended.error.message}`);
  const approved = runtime.kernel.actions.approveAction(s, {
    actionId,
    expectedState: "recommended",
    now: now(3),
    audit: { actor: personActor(personId), at: now(3), reason: "seed approval" },
  });
  if (!approved.ok) throw new Error(`approveAction failed: ${approved.error.message}`);
  return actionId;
}

/** Creates a registered candidate (W005) the plan can instantiate. */
export function seedTowerCandidate(
  runtime: LocalControlTowerRuntime,
  s: TenantScope,
  candidateId = "cand-1",
): string {
  seedCandidate(runtime.kernel, s, candidateId);
  return candidateId;
}

/** Standard two-task plan input over the seeded candidate. */
export function towerPlanInput(
  candidateId: string,
  authorityActionId = "action-approve-1",
): Parameters<LocalControlTowerRuntime["plans"]["createPlan"]>[1] {
  return {
    planId: "plan-1",
    goalId: "goal-1",
    candidateId,
    tasks: [planTask("task-a", { authorityActionId }), planTask("task-b", { authorityActionId })],
    createdBy: personActor("p-1"),
    provenance: provenance(systemActor("seed"), 0),
    evidenceRefs: [{ kind: "goal", id: "goal-1" }],
    now: now(5),
  };
}

/** Standard tower read input (a logged company query). */
export function towerRead(
  atSeconds = 30,
): Parameters<LocalControlTowerRuntime["tower"]["overview"]>[1] {
  return {
    now: now(atSeconds),
    askedBy: personActor("boss"),
    reason: "control tower board refresh",
  };
}
