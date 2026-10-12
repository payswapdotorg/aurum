/**
 * W007 test helpers: fixtures and Result narrowing utilities for the
 * cognition + learning missions module. Mirrors the W008/W009 helper
 * patterns: the cognition surface is imported from the PUBLIC application
 * contract (../src/index.js) — the same boundary other modules will use —
 * while the domain vocabulary is consumed from @aurum/domain's public
 * entrypoint, exactly as the cognition source itself does.
 *
 * The fixture wires a REAL domain kernel through the kernel-cognition-seams
 * adapter (so authority/audit/epistemics semantics are the kernel's own),
 * an in-memory mission store, and the deterministic scripted reasoner. No
 * real model is ever called.
 */
import { expect } from "vitest";
import {
  createDomainKernel,
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
import type { CognitionService, MissionError, ReasonedContent } from "../src/index.js";
import {
  createCognitionService,
  createInMemoryMissionStore,
  createKernelCognitionSeams,
  createScriptedReasoner,
  type ReasonerScriptEntry,
  type ScriptedReasoner,
} from "../src/index.js";

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

export function scope(name: string): TenantScope {
  const result = tenantScope(name);
  if (!result.ok) throw new Error(`test setup: invalid tenant name ${name}`);
  return result.value;
}

export function okOf<T>(result: Result<T, MissionError | DomainError>): T {
  expect(result.ok, `expected ok, got error: ${result.ok ? "" : result.error.message}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

export function errOf<T>(
  result: Result<T, MissionError | DomainError>,
): MissionError | DomainError {
  expect(
    result.ok,
    `expected error, got value: ${result.ok ? JSON.stringify(result.value) : ""}`,
  ).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

export const now = (secondsAfterBase = 0): DomainTimestamp =>
  (T0 + secondsAfterBase * 1000) as DomainTimestamp;

export const daysAgo = (days: number): DomainTimestamp => (T0 - days * DAY) as DomainTimestamp;

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

/** The standard knowledge subject used across the cognition proofs. */
export const topic = (id = "invoices"): SubjectReference => ({ kind: "topic", id });

export interface CognitionFixture {
  readonly kernel: ReturnType<typeof createDomainKernel>;
  readonly service: CognitionService;
  readonly reasoner: ScriptedReasoner;
}

export type CognitionKernel = ReturnType<typeof createDomainKernel>;

/** Wires a complete W007 fixture: real kernel + scripted model + stores. */
export function cognitionFixture(
  script: readonly ReasonerScriptEntry[] = [standardContent()],
): CognitionFixture {
  const kernel = createDomainKernel();
  const seams = createKernelCognitionSeams(kernel);
  const reasoner = createScriptedReasoner(script);
  const service = createCognitionService({
    reads: seams.reads,
    knowledge: seams.knowledge,
    gate: seams.gate,
    model: reasoner,
    missions: createInMemoryMissionStore(),
    proposalPolicy: { approvalRoles: ["approver"], authorizationRoles: ["authorizer"] },
  });
  return { kernel, service, reasoner };
}

/** Seeds one ACTIVE observation about the subject; returns its id. */
export function seedObservation(
  kernel: CognitionKernel,
  s: TenantScope,
  options: {
    observationId?: string;
    subject?: SubjectReference;
    content?: string;
    asOf?: DomainTimestamp;
    retracted?: boolean;
  } = {},
): string {
  const observationId = options.observationId ?? "obs-1";
  const result = kernel.evidence.recordObservation(s, {
    observationId,
    subject: options.subject ?? topic(),
    content: options.content ?? `Observation ${observationId} about the topic`,
    observedAt: options.asOf ?? now(0),
    provenance: provenance(personActor("p-1"), 0),
    freshness: { asOf: options.asOf ?? now(0) },
  });
  if (!result.ok) throw new Error(`seedObservation failed: ${result.error.message}`);
  if (options.retracted === true) {
    const retracted = kernel.evidence.retractObservation(s, observationId, {
      reason: "test seed retraction",
      now: now(1),
      audit: { actor: personActor("p-1"), at: now(1), reason: "test seed retraction" },
    });
    if (!retracted.ok)
      throw new Error(`seedObservation retract failed: ${retracted.error.message}`);
  }
  return observationId;
}

/** Seeds a goal whose expected evidence points at the given subject. */
export function seedGoal(
  kernel: CognitionKernel,
  s: TenantScope,
  options: { goalId?: string; evidenceSubject?: SubjectReference } = {},
): string {
  const goalId = options.goalId ?? "goal-1";
  const evidenceSubject = options.evidenceSubject ?? topic();
  const result = kernel.goals.createGoal(s, {
    goalId,
    objective: "Cut invoice processing cycle time",
    desiredState: "Invoices processed within SLA",
    horizonStart: now(0),
    horizonEnd: (T0 + 90 * DAY) as DomainTimestamp,
    ownerId: "boss",
    ownerLabels: ["executive"],
    priority: "high",
    expectedEvidence: [{ description: "processing metrics", subject: evidenceSubject }],
    provenance: provenance(personActor("p-1"), 0),
    now: now(0),
    audit: { actor: personActor("p-1"), at: now(0), reason: "seed" },
  });
  if (!result.ok) throw new Error(`seedGoal failed: ${result.error.message}`);
  return goalId;
}

/** Seeds a person holding the given roles (for human-authority proofs). */
export function seedPersonWithRoles(
  kernel: CognitionKernel,
  s: TenantScope,
  personId: string,
  roles: readonly string[],
): void {
  const person = kernel.identity.registerPerson(s, {
    personId,
    displayName: `Person ${personId}`,
    labels: ["employee"],
    provenance: systemActor("seed"),
    now: now(0),
  });
  if (!person.ok) throw new Error(`seedPerson failed: ${person.error.message}`);
  const membership = kernel.identity.grantMembership(s, {
    membershipId: `mem-${personId}`,
    personId,
    organizationId: "org-1",
    roles,
    grantedBy: systemActor("seed"),
    now: now(0),
    audit: { actor: systemActor("seed"), at: now(0), reason: "seed" },
  });
  if (!membership.ok) throw new Error(`seedMembership failed: ${membership.error.message}`);
}

/** Seeds an open unknown linked (or not) to the given subject. */
export function seedUnknown(
  kernel: CognitionKernel,
  s: TenantScope,
  options: { unknownId?: string; subject?: SubjectReference; linked?: boolean } = {},
): string {
  const unknownId = options.unknownId ?? "unknown-1";
  const subject = options.subject ?? topic();
  const result = kernel.inquiry.raiseUnknown(s, {
    unknownId,
    question: "Which supplier drives the processing delays?",
    consequence: "SLA breaches continue unnoticed",
    relatedSubjects: options.linked === false ? [] : [subject],
    provenance: provenance(personActor("p-1"), 0),
    now: now(0),
  });
  if (!result.ok) throw new Error(`seedUnknown failed: ${result.error.message}`);
  return unknownId;
}

/** Standard valid bounded content citing the two seeded observations. */
export function standardContent(
  options: {
    observations?: readonly string[];
    proposals?: number;
  } = {},
): ReasonedContent {
  const observations = options.observations ?? ["obs-1", "obs-2"];
  return Object.freeze({
    summary: "Invoice processing latency correlates with supplier ACME's batch size.",
    findings: Object.freeze([
      Object.freeze({
        statement: "Supplier ACME delivers unbatched invoices causing manual steps.",
        basedOn: Object.freeze([observations[0] ?? "obs-1"]),
      }),
      Object.freeze({
        statement: "The manual step adds two days to the cycle.",
        basedOn: Object.freeze([observations[1] ?? "obs-2"]),
      }),
    ]),
    gaps: Object.freeze([]),
    hypotheses: Object.freeze([
      Object.freeze({
        statement: "Batching ACME invoices removes the manual step.",
        explains: Object.freeze([topic()]),
      }),
    ]),
    proposals: Object.freeze(
      Array.from({ length: options.proposals ?? 1 }, (_, index) =>
        Object.freeze({
          kind: "recommendation" as const,
          title: `Automate ACME invoice intake ${index === 0 ? "" : index}`,
          rationale: "Removes the manual step identified by the mission findings.",
        }),
      ),
    ),
  });
}

/** Creates the standard mission on the topic subject. */
export function createMissionInput(
  options: {
    missionId?: string;
    subject?: SubjectReference;
    goalId?: string;
  } = {},
): Parameters<CognitionService["createMission"]>[1] {
  return {
    missionId: options.missionId ?? "mission-1",
    subject: options.subject ?? topic(),
    question: "Why is invoice processing slow?",
    consequence: "SLA breaches accumulate without a known cause",
    ...(options.goalId !== undefined ? { goalId: options.goalId } : {}),
    createdBy: personActor("p-1"),
    now: now(0),
  };
}
