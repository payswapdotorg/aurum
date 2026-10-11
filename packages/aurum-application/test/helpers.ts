/**
 * W008 test helpers: fixtures and Result narrowing utilities. Imports follow
 * the module boundary rules: the lab surface comes from the PUBLIC application
 * contract (../src/index.js) — the same boundary other modules will use —
 * while the shared organization vocabulary (W005) is consumed from
 * @aurum/domain's public entrypoint, exactly as the lab source itself does.
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
  type UnitId,
} from "@aurum/domain";
import type { LabError, OrganizationalLab } from "../src/index.js";
import { createInMemoryEvaluationStore, createOrganizationalLab } from "../src/index.js";

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

export function scope(name: string): TenantScope {
  const result = tenantScope(name);
  if (!result.ok) throw new Error(`test setup: invalid tenant name ${name}`);
  return result.value;
}

export function okOf<T>(result: Result<T, LabError | DomainError>): T {
  expect(result.ok, `expected ok, got error: ${result.ok ? "" : result.error.message}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

export function errOf<T>(result: Result<T, LabError | DomainError>): LabError | DomainError {
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

export function lab(kernel = createDomainKernel()): {
  kernel: ReturnType<typeof createDomainKernel>;
  service: OrganizationalLab;
} {
  return {
    kernel,
    service: createOrganizationalLab({
      views: {
        goals: kernel.goals,
        capabilities: kernel.capabilities,
        workforce: kernel.workforce,
        inquiry: kernel.inquiry,
      },
      evaluations: createInMemoryEvaluationStore(),
    }),
  };
}

export interface SupplySeed {
  readonly supplyId: string;
  readonly capabilityId: string;
  readonly kind: "employee" | "team" | "agent" | "software" | "supplier" | "partner";
  readonly level: number;
  readonly capacityPerPeriod?: number;
  readonly personId?: string;
  readonly unitId?: string;
  readonly externalRef?: string;
  readonly availableFrom?: DomainTimestamp;
  readonly availableUntil?: DomainTimestamp;
  readonly freshnessAsOf?: DomainTimestamp;
}

/**
 * Seeds the mixed pool for the standard fixture tenant: two demanded
 * capabilities (cap-design level 4 capacity 45, cap-review level 3 capacity
 * 30), each offered by an employee, an agent and (for cap-review) software.
 * `employeeCapacity` overrides the employee supplies' capacity per period
 * (the urgency-flip fixture uses lightly loaded, high-capacity humans).
 */
export function seedMixedPool(
  kernel: ReturnType<typeof createDomainKernel>,
  s: TenantScope,
  atSeconds = 10,
  employeeCapacity: { design: number; review: number } = { design: 90, review: 60 },
): void {
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
      capacityPerPeriod: employeeCapacity.design,
      personId: "p-designer",
      freshnessAsOf: now(atSeconds),
    },
    {
      supplyId: "sup-emp-review",
      capabilityId: "cap-review",
      kind: "employee",
      level: 4,
      capacityPerPeriod: employeeCapacity.review,
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
          ...(seed.unitId ? { unitId: seed.unitId as UnitId } : {}),
          ...(seed.externalRef ? { externalRef: seed.externalRef } : {}),
        },
        level: seed.level,
        ...(seed.capacityPerPeriod !== undefined
          ? { capacityPerPeriod: seed.capacityPerPeriod }
          : {}),
        ...(seed.availableFrom !== undefined ? { availableFrom: seed.availableFrom } : {}),
        ...(seed.availableUntil !== undefined ? { availableUntil: seed.availableUntil } : {}),
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
export function seedGoal(
  kernel: ReturnType<typeof createDomainKernel>,
  s: TenantScope,
  options: { priority?: string; goalId?: string } = {},
): void {
  okOf(
    kernel.goals.createGoal(s, {
      goalId: options.goalId ?? "goal-1",
      objective: "Ship the invoice processing overhaul",
      desiredState: "Invoices processed within SLA",
      horizonStart: now(0),
      horizonEnd: daysFromNow(60),
      ownerId: "boss",
      ownerLabels: ["executive"],
      priority: options.priority ?? "medium",
      provenance: provenance(personActor("boss"), 0),
      now: now(0),
      audit: { actor: personActor("boss"), at: now(0), reason: "seed" },
    }),
  );
}

/**
 * Seeds one capability plus a goal-sourced requirement but NO supplies: the
 * tenant has a valid non-empty demand profile with an empty supply pool.
 */
export function seedDemandOnly(
  kernel: ReturnType<typeof createDomainKernel>,
  s: TenantScope,
  capabilityId = "cap-isolated",
): void {
  okOf(
    kernel.capabilities.registerCapability(s, {
      capabilityId,
      name: `capability ${capabilityId}`,
      provenance: provenance(systemActor("seed"), 0),
      now: now(0),
    }),
  );
  okOf(
    kernel.capabilities.registerRequirement(s, {
      requirementId: `req-${capabilityId}`,
      capabilityId,
      source: { kind: "goal", ref: "goal-1" },
      requiredLevel: 2,
      provenance: provenance(systemActor("seed"), 2),
      now: now(2),
    }),
  );
}

/** Raises `count` open unknowns related to the goal (uncertainty axis). */
export function raiseUnknowns(
  kernel: ReturnType<typeof createDomainKernel>,
  s: TenantScope,
  goalId: string,
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    okOf(
      kernel.inquiry.raiseUnknown(s, {
        unknownId: `unknown-${index}`,
        question: `Open question ${index}`,
        consequence: "decision quality degrades",
        relatedSubjects: [{ kind: "goal", id: goalId }],
        provenance: provenance(personActor("boss"), 5),
        now: now(5),
      }),
    );
  }
}

/** Appends a goal revision with a new priority (same subject, new context). */
export function reviseGoalPriority(
  kernel: ReturnType<typeof createDomainKernel>,
  s: TenantScope,
  goalId: string,
  priority: string,
  atSeconds = 15,
): void {
  okOf(
    kernel.goals.reviseGoal(s, {
      goalId,
      objective: "Ship the invoice processing overhaul",
      desiredState: "Invoices processed within SLA",
      horizonStart: now(0),
      horizonEnd: daysFromNow(60),
      ownerId: "boss",
      ownerLabels: ["executive"],
      priority,
      provenance: provenance(personActor("boss"), atSeconds),
      now: now(atSeconds),
      audit: { actor: personActor("boss"), at: now(atSeconds), reason: "priority change" },
    }),
  );
}
