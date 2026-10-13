/**
 * P003 test helpers: the application-storage oracle pattern.
 *
 * Every proof drives the REAL application services — `createOrganizationalLab`
 * (W008) and `createOutcomeLearning` (W013) — over the in-memory references
 * (the semantic authority, composed exactly like the untouched application
 * suites compose them), and then carries the very records those services
 * produce into the PG-backed stores AND the async in-memory doubles,
 * asserting the three agree (values deep-equal, typed errors identical in
 * code/message/issues — the P001 `expectSameResult` discipline adapted to
 * the LabError/LearningError namespaces).
 *
 * The W008/W013 seeding helpers are re-implemented here against the
 * EXPORTED kernel/service APIs (the P002 test-double ruling: cross-package
 * test helpers are not importable; drift is bounded by the public surface
 * they drive, and the fixtures mirror the application suite helpers).
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
  type TenantScope,
} from "@aurum/domain";
import {
  createAsyncInMemoryEvaluationStore,
  createAsyncInMemoryOutcomeStore,
  createInMemoryEvaluationStore,
  createInMemoryOutcomeStore,
  createOrganizationalLab,
  createOutcomeLearning,
} from "@aurum/application";
import type {
  ApplicationStoragePorts,
  ContextFingerprint,
  LabError,
  LabEvaluationRecord,
  LabEvaluationStore,
  LearningError,
  LearningLoopRetrieval,
  OutcomeLearning,
  OutcomeStore,
  OrganizationSearchResult,
  OrganizationalLab,
  SearchOrganizationsInput,
} from "@aurum/application";
import type { PgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";
import { createApplicationPgLiteHarness } from "../src/application-storage/application-runner.js";
import { createPgApplicationStorage } from "../src/application-storage/stores.js";

export type LabKernel = ReturnType<typeof createDomainKernel>;
export type AppError = LabError | LearningError | DomainError;

export const TENANT_A = "acme";
export const TENANT_B = "globex";

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

export function scope(name: string): TenantScope {
  const result = tenantScope(name);
  if (!result.ok) throw new Error(`test setup: invalid tenant name ${name}`);
  return result.value;
}

export function okOf<T>(result: Result<T, AppError>): T {
  expect(result.ok, `expected ok, got error: ${result.ok ? "" : result.error.message}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

export function errOf<T>(result: Result<T, AppError>): AppError {
  expect(
    result.ok,
    `expected error, got value: ${result.ok ? JSON.stringify(result.value) : ""}`,
  ).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

export const now = (secondsAfterBase = 0): DomainTimestamp =>
  (T0 + secondsAfterBase * 1000) as DomainTimestamp;

export const daysAfter = (days: number, baseSeconds = 0): DomainTimestamp =>
  (T0 + baseSeconds * 1000 + days * DAY) as DomainTimestamp;

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

/**
 * Equivalence oracle (the P001 pattern): a storage Result must equal the
 * reference Result — values deep-equal, errors identical in code, message
 * and issues.
 */
export function expectSameAppResult<T>(
  actual: Result<T, AppError>,
  expected: Result<T, AppError>,
): void {
  if (expected.ok && actual.ok) {
    expect(actual).toEqual(expected);
    return;
  }
  expect(actual.ok, `ok-ness must match (expected ${JSON.stringify(expected)})`).toBe(expected.ok);
  if (!expected.ok && !actual.ok) {
    expect({
      code: actual.error.code,
      message: actual.error.message,
      issues: (actual.error as LabError).issues,
    }).toEqual({
      code: expected.error.code,
      message: expected.error.message,
      issues: (expected.error as LabError).issues,
    });
  }
}

/** Boots the shared-database application harness (domain + application areas). */
export async function bootApplicationHarness(): Promise<PgLiteHarness> {
  return createApplicationPgLiteHarness();
}

/** One PG store pair bound to a harness: the PG stores + the async in-memory twins. */
export interface ApplicationStoreTrio {
  readonly harness: PgLiteHarness;
  readonly pg: ApplicationStoragePorts;
  readonly mem: ApplicationStoragePorts;
  readonly retrieval: LearningLoopRetrieval;
}

export async function makeApplicationTrio(): Promise<ApplicationStoreTrio> {
  const harness = await bootApplicationHarness();
  const pg = createPgApplicationStorage(harness.sql);
  const mem: ApplicationStoragePorts = {
    evaluations: createAsyncInMemoryEvaluationStore(),
    outcomes: createAsyncInMemoryOutcomeStore(),
  };
  const { createPgLearningLoopRetrieval } = await import("../src/application-storage/stores.js");
  return { harness, pg, mem, retrieval: createPgLearningLoopRetrieval(harness.sql) };
}

// ---------------------------------------------------------------------------
// W008-style fixtures (mirrored from the application suite helpers against
// the exported kernel API — the P002 test-double ruling).
// ---------------------------------------------------------------------------

interface SupplySeed {
  readonly supplyId: string;
  readonly capabilityId: string;
  readonly kind: "employee" | "team" | "agent" | "software" | "supplier" | "partner";
  readonly level: number;
  readonly capacityPerPeriod?: number;
  readonly personId?: string;
  readonly externalRef?: string;
  readonly freshnessAsOf?: DomainTimestamp;
}

/** Seeds the standard mixed pool (two capabilities, six supplies). */
export function seedMixedPool(kernel: LabKernel, s: TenantScope, atSeconds = 10): void {
  for (const capabilityId of ["cap-design", "cap-review"]) {
    okOf(
      kernel.capabilities.registerCapability(s, {
        capabilityId,
        name: `capability ${capabilityId}`,
        provenance: provenance(systemActor("seed"), 0),
        now: now(0),
      }),
    );
  }
  const supplies: SupplySeed[] = [
    {
      supplyId: "sup-emp-design",
      capabilityId: "cap-design",
      kind: "employee",
      level: 5,
      capacityPerPeriod: 90,
      personId: "p-designer",
      freshnessAsOf: now(atSeconds),
    },
    {
      supplyId: "sup-emp-review",
      capabilityId: "cap-review",
      kind: "employee",
      level: 4,
      capacityPerPeriod: 60,
      personId: "p-reviewer",
      freshnessAsOf: now(atSeconds),
    },
    {
      supplyId: "sup-agent-design",
      capabilityId: "cap-design",
      kind: "agent",
      level: 4,
      capacityPerPeriod: 200,
      externalRef: "agent-body-7",
      freshnessAsOf: now(atSeconds),
    },
    {
      supplyId: "sup-agent-review",
      capabilityId: "cap-review",
      kind: "agent",
      level: 4,
      capacityPerPeriod: 150,
      externalRef: "agent-body-8",
      freshnessAsOf: now(atSeconds),
    },
    {
      supplyId: "sup-software-review",
      capabilityId: "cap-review",
      kind: "software",
      level: 3,
      capacityPerPeriod: 500,
      externalRef: "ocr-svc",
      freshnessAsOf: now(atSeconds),
    },
    {
      supplyId: "sup-supplier-design",
      capabilityId: "cap-design",
      kind: "supplier",
      level: 4,
      capacityPerPeriod: 120,
      externalRef: "bpo-2",
      freshnessAsOf: now(atSeconds),
    },
  ];
  for (const seed of supplies) {
    okOf(
      kernel.capabilities.registerSupply(s, {
        supplyId: seed.supplyId,
        capabilityId: seed.capabilityId,
        supplier: {
          kind: seed.kind,
          ...(seed.personId ? { personId: seed.personId as PersonId } : {}),
          ...(seed.externalRef ? { externalRef: seed.externalRef } : {}),
        },
        level: seed.level,
        ...(seed.capacityPerPeriod !== undefined
          ? { capacityPerPeriod: seed.capacityPerPeriod }
          : {}),
        ...(seed.freshnessAsOf !== undefined ? { freshness: { asOf: seed.freshnessAsOf } } : {}),
        provenance: provenance(systemActor("seed"), 1),
        now: now(1),
      }),
    );
  }
  for (const [capabilityId, level, capacity] of [
    ["cap-design", 4, 45],
    ["cap-review", 3, 30],
  ] as const) {
    okOf(
      kernel.capabilities.registerRequirement(s, {
        requirementId: `req-${capabilityId}`,
        capabilityId,
        source: { kind: "goal", ref: "goal-1" },
        requiredLevel: level,
        requiredCapacityPerPeriod: capacity,
        provenance: provenance(systemActor("seed"), 2),
        now: now(2),
      }),
    );
  }
}

/** Creates the standard subject goal (priority, 90-day horizon). */
export function seedGoal(kernel: LabKernel, s: TenantScope, priority = "medium"): void {
  okOf(
    kernel.goals.createGoal(s, {
      goalId: "goal-1",
      objective: "Ship the invoice processing overhaul",
      desiredState: "Invoices processed within SLA",
      horizonStart: now(0),
      horizonEnd: daysAfter(60),
      ownerId: "boss",
      ownerLabels: ["executive"],
      priority,
      provenance: provenance(personActor("boss"), 0),
      now: now(0),
      audit: { actor: personActor("boss"), at: now(0), reason: "seed" },
    }),
  );
}

/** Raises `count` open unknowns related to the goal (uncertainty axis). */
export function raiseUnknowns(kernel: LabKernel, s: TenantScope, count: number): void {
  for (let index = 0; index < count; index += 1) {
    okOf(
      kernel.inquiry.raiseUnknown(s, {
        unknownId: `unknown-${index}`,
        question: `Open question ${index}`,
        consequence: "decision quality degrades",
        relatedSubjects: [{ kind: "goal", id: "goal-1" }],
        provenance: provenance(personActor("boss"), 5),
        now: now(5),
      }),
    );
  }
}

/** Revises the subject goal priority (context change). */
export function reviseGoalPriority(kernel: LabKernel, s: TenantScope, priority: string): void {
  okOf(
    kernel.goals.reviseGoal(s, {
      goalId: "goal-1",
      objective: "Ship the invoice processing overhaul",
      desiredState: "Invoices processed within SLA",
      horizonStart: now(0),
      horizonEnd: daysAfter(60),
      ownerId: "boss",
      ownerLabels: ["executive"],
      priority,
      provenance: provenance(personActor("boss"), 15),
      now: now(15),
      audit: { actor: personActor("boss"), at: now(15), reason: "priority change" },
    }),
  );
}

// ---------------------------------------------------------------------------
// The oracle fixture: REAL lab + learning services over the in-memory
// references (the exact composition the application suites drive).
// ---------------------------------------------------------------------------

/** The reference fixture: kernel + lab + learning over shared in-memory stores. */
export interface LoopFixture {
  readonly kernel: LabKernel;
  readonly lab: OrganizationalLab;
  readonly learning: OutcomeLearning;
  readonly referenceEvaluations: LabEvaluationStore;
  readonly referenceOutcomes: OutcomeStore;
}

export function loopFixture(): LoopFixture {
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
  const outcomes = createInMemoryOutcomeStore();
  const learning = createOutcomeLearning({
    outcomes,
    evaluations,
    candidates: kernel.candidates,
    lab,
  });
  return { kernel, lab, learning, referenceEvaluations: evaluations, referenceOutcomes: outcomes };
}

/** Seeds the standard subject (goal + mixed pool). */
export function seedSubject(fx: LoopFixture, s: TenantScope, priority = "medium"): void {
  seedGoal(fx.kernel, s, priority);
  seedMixedPool(fx.kernel, s);
}

export interface SearchRun {
  readonly fingerprint: ContextFingerprint;
  readonly result: OrganizationSearchResult;
  readonly evaluation: LabEvaluationRecord;
}

/** Runs a search through the REAL lab service + returns the recorded evaluation. */
export function runSearch(
  fx: LoopFixture,
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

/**
 * Mirrors the reference (in-kernel) evaluation records into every store
 * under test — the evaluation-store sibling of the learning-utils
 * `mirrorReferenceOutcomes` pattern (P003 completion note: this helper was
 * in flight when the worker pod was recycled; reconstructed verbatim from
 * its tests' usage + the sibling pattern).
 */
export async function mirrorReferenceEvaluations(
  reference: LabEvaluationStore,
  stores: readonly LabEvaluationStore[],
  s: TenantScope,
): Promise<void> {
  const existing = new Set(
    (
      await Promise.all(
        stores.map(async (store) => (await store.listEvaluations(s)).map((r) => r.evaluationId)),
      )
    ).flat(),
  );
  for (const record of reference.listEvaluations(s)) {
    if (existing.has(record.evaluationId)) continue;
    for (const store of stores) {
      const appended = await store.putEvaluation(s, record);
      expect(
        appended.ok,
        `mirror append failed: ${appended.ok ? "" : appended.error.message}`,
      ).toBe(true);
    }
  }
}
