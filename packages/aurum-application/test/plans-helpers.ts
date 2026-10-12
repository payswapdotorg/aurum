/**
 * W009 test helpers: fixtures and Result narrowing utilities for the plans
 * module. Mirrors the W008 `helpers.ts` pattern: imports the plans surface
 * from the PUBLIC application contract (../src/index.js) — the same boundary
 * other modules will use — while the W002/W005 frozen vocabulary is consumed
 * from `@aurum/domain`'s public entrypoint, exactly as the plans source
 * itself does.
 *
 * Fixtures:
 * - a deterministic in-process substrate (with a settledScript so dispatch
 *   returns a successful settlement by default);
 * - a fake PlanApprovalAuthority that records the citations and asserts
 *   only basic shape (the real adapter delegates to the kernel's
 *   `ActionAuthority` post-CR-W009);
 * - a fake PlanAuditPort that returns sequential `audit-N` ids;
 * - in-memory stores for plans / handoffs / completions / escalations;
 * - a `planService()` factory that wires all of the above + a real
 *   `DomainKernel` for the W002/W005 views (goals + candidate registry).
 */
import { expect } from "vitest";
import {
  createDomainKernel,
  err,
  ok,
  personActor,
  provenanceIssues,
  systemActor,
  tenantScope,
  type ActorReference,
  type AuditActionKind,
  type AuditRecord,
  type DomainError,
  type DomainTimestamp,
  type PersonId,
  type ProvenanceRecord,
  type Result,
  type TenantScope,
} from "@aurum/domain";
import { planNotFound, planUnauthorized, type PlanError } from "../src/index.js";
import {
  cancelledScript,
  createInMemoryEscalationStore,
  createInMemoryHandoffRelayStore,
  createInMemoryPlanStore,
  createInMemoryTaskCompletionStore,
  createInProcessExecutionSubstrate,
  createPlanService,
  failedScript,
  settledScript,
  type CreatePlanInput,
  type InProcessExecutionSubstrate,
  type PlanApprovalAuthority,
  type PlanAuditPort,
  type PlanCandidateViews,
  type PlanGoalViews,
  type PlanService,
  type PlanServiceDeps,
} from "../src/index.js";

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

export function scope(name: string): TenantScope {
  const result = tenantScope(name);
  if (!result.ok) throw new Error(`test setup: invalid tenant name ${name}`);
  return result.value;
}

export function okOf<T>(result: Result<T, PlanError | DomainError>): T {
  expect(result.ok, `expected ok, got error: ${result.ok ? "" : result.error.message}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

export function errOf<T>(result: Result<T, PlanError | DomainError>): PlanError | DomainError {
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

export const approverActor = (personId: string): ActorReference => ({
  kind: "person",
  personId: personId as PersonId,
});

export const seedActor = (name: string): ActorReference => ({ kind: "system", name });

export function provenance(actor: ActorReference, atSeconds = 0): ProvenanceRecord {
  const issues = provenanceIssues({
    actor,
    source: "human-entered",
    recordedAt: now(atSeconds),
  });
  if (issues.length > 0)
    throw new Error(`test setup: invalid provenance: ${JSON.stringify(issues)}`);
  return { actor, source: "human-entered", recordedAt: now(atSeconds) };
}

/**
 * Fake `PlanApprovalAuthority` for tests: records the citations and
 * approves everything that has at least one of actionId/auditRef. The real
 * adapter (post-CR-W009) delegates to the kernel's `ActionAuthority` — the
 * port is structurally compatible.
 */
export class FakeApprovalAuthority implements PlanApprovalAuthority {
  readonly citations: {
    actionId?: string;
    auditRef?: string;
    approvedBy: ActorReference;
    approvedAt: DomainTimestamp;
  }[] = [];
  readonly executorProofs: { actionId?: string; auditRef?: string }[] = [];
  /** Set to true to refuse the next approval (for unauthorized tests). */
  refuseNext = false;

  assertApprovalCitation(
    _scope: TenantScope,
    citation: {
      actionId?: string;
      auditRef?: string;
      approvedBy: ActorReference;
      approvedAt: DomainTimestamp;
    },
  ): Result<{ actionId?: string; auditRef?: string }, PlanError> {
    if (this.refuseNext) {
      return err(planUnauthorized("fake approval refusal"));
    }
    this.citations.push(citation);
    return ok({ actionId: citation.actionId, auditRef: citation.auditRef });
  }
  assertExecutorAuthority(
    _scope: TenantScope,
    requirement: { actionId?: string; auditRef?: string },
  ): Result<{ actionId?: string; auditRef?: string }, PlanError> {
    if (this.refuseNext) {
      return err(planUnauthorized("fake executor refusal"));
    }
    this.executorProofs.push(requirement);
    return ok({ actionId: requirement.actionId, auditRef: requirement.auditRef });
  }
}

/** Fake `PlanAuditPort`: returns sequential `audit-N` ids; records the calls. */
export class FakeAuditPort implements PlanAuditPort {
  readonly entries: AuditRecord[] = [];
  private counter = 0;

  append(
    scope: TenantScope,
    subject: { kind: string; id: string },
    action: AuditActionKind,
    input: { actor: ActorReference; at: DomainTimestamp; reason: string },
  ): Result<{ auditRef: string }, PlanError> {
    this.counter += 1;
    const auditRef = `audit-${this.counter}`;
    const record: AuditRecord = {
      scope,
      auditId: auditRef,
      subject: subject as AuditRecord["subject"],
      action,
      actor: input.actor,
      at: input.at,
      reason: input.reason,
    };
    this.entries.push(record);
    return ok({ auditRef });
  }

  getAudit(_scope: TenantScope, auditId: string): Result<AuditRecord, PlanError> {
    const found = this.entries.find((e) => e.auditId === auditId);
    if (!found) {
      return err(planNotFound(`audit ${auditId}`));
    }
    return ok(found);
  }
}

/** Composes the kernel's `GoalLedger` + `OrganizationCandidateRegistry` into the W009 plan views. */
export function planViewsFromKernel(kernel: ReturnType<typeof createDomainKernel>): {
  goals: PlanGoalViews;
  candidates: PlanCandidateViews;
} {
  return {
    goals: {
      getGoal: (scope, goalId) => {
        const result = kernel.goals.getGoal(scope, goalId);
        if (!result.ok) {
          // Translate the kernel's DomainError codes into plan-local PlanError codes
          // (closed-failure for tenant isolation: "not-found" → "plan-subject-not-found").
          if (result.error.code === "not-found") {
            return err(planSubjectNotFound("goal")) as unknown as Result<
              import("@aurum/domain").GoalRecord,
              PlanError
            >;
          }
          return err(planNotFound("goal")) as unknown as Result<
            import("@aurum/domain").GoalRecord,
            PlanError
          >;
        }
        return result as unknown as Result<import("@aurum/domain").GoalRecord, PlanError>;
      },
    },
    candidates: {
      getCandidate: (scope, candidateId) => {
        const result = kernel.candidates.getCandidate(scope, candidateId);
        if (!result.ok) {
          if (result.error.code === "not-found") {
            return err(planNotFound("candidate")) as unknown as Result<
              import("@aurum/domain").OrganizationCandidate,
              PlanError
            >;
          }
          return err(planNotFound("candidate")) as unknown as Result<
            import("@aurum/domain").OrganizationCandidate,
            PlanError
          >;
        }
        return result as unknown as Result<
          import("@aurum/domain").OrganizationCandidate,
          PlanError
        >;
      },
    },
  };
}

export interface PlanServiceFixture {
  readonly kernel: ReturnType<typeof createDomainKernel>;
  readonly service: PlanService;
  readonly approval: FakeApprovalAuthority;
  readonly audit: FakeAuditPort;
  readonly substrate: InProcessExecutionSubstrate;
  readonly deps: PlanServiceDeps;
}

/** Wires a complete W009 fixture: kernel + plans service + in-process substrate. */
export function planServiceFixture(options?: {
  substrateScript?:
    | ReturnType<typeof settledScript>
    | ReturnType<typeof failedScript>
    | ReturnType<typeof cancelledScript>;
}): PlanServiceFixture {
  const kernel = createDomainKernel();
  const { goals, candidates } = planViewsFromKernel(kernel);
  const approval = new FakeApprovalAuthority();
  const audit = new FakeAuditPort();
  const substrate = createInProcessExecutionSubstrate({
    defaultScript: options?.substrateScript ?? settledScript("ok"),
  });
  const deps: PlanServiceDeps = {
    goals,
    candidates,
    approval,
    audit,
    substrate,
    plans: createInMemoryPlanStore(),
    handoffs: createInMemoryHandoffRelayStore(),
    completions: createInMemoryTaskCompletionStore(),
    escalations: createInMemoryEscalationStore(),
  };
  const service = createPlanService(deps);
  return { kernel, service, approval, audit, substrate, deps };
}

/**
 * Seeds the kernel with a minimal valid `OrganizationCandidate` so the plan
 * has a real W005 resource side to reference. Returns the candidate id +
 * the actor / assignment / allocation ids the plan can cite.
 */
export function seedCandidate(
  kernel: ReturnType<typeof createDomainKernel>,
  s: TenantScope,
  candidateId = "cand-1",
): {
  candidateId: string;
  actorId: string;
  assignmentId: string;
  allocationId: string;
} {
  const actorId = "actor-1";
  const assignmentId = "asgn-1";
  const allocationId = "alloc-1";
  const result = kernel.candidates.registerCandidate(s, {
    candidateId,
    goalId: "goal-1",
    actors: [
      {
        actorId,
        kind: "human",
        personId: "p-1" as PersonId,
        displayName: "Worker 1",
      },
    ],
    assignments: [
      {
        assignmentId,
        actorId,
        position: "Doer",
        effortShare: 1,
      },
    ],
    capabilityAllocations: [
      {
        allocationId,
        capabilityId: "cap-1",
        actorIds: [actorId],
        level: 3,
        capacityPerPeriod: 40,
      },
    ],
    topology: {
      execution: {
        steps: [{ stepId: "s1", name: "Do work", automated: false }],
        edges: [],
      },
      information: {
        flows: [
          {
            flowId: "f1",
            knowledge: "result",
            recipientActorIds: [actorId],
            minimalContext: true,
            reviewRequired: false,
          },
        ],
      },
    },
    modelOccupancy: [],
    environment: [{ environmentRef: "local" }],
    expectedOutcome: { target: 1, confidence: 0.5 },
    risks: [],
    evidenceRefs: [{ kind: "goal", id: "goal-1" }],
    proposedBy: personActor("p-1" as PersonId),
    provenance: provenance(systemActor("seed"), 0),
    now: now(0),
  });
  if (!result.ok) throw new Error(`seedCandidate failed: ${result.error.message}`);
  return { candidateId, actorId, assignmentId, allocationId };
}

/** Builds a minimal valid plan task with the given id + optional deps. */
export function planTask(
  taskId: string,
  options: {
    dependsOn?: readonly string[];
    produces?: readonly { handoffId: string; knowledge: string; mediaType: string }[];
    consumes?: readonly { handoffId: string; knowledge: string; mediaType: string }[];
    authorityActionId?: string;
    authorityAuditRef?: string;
    resourceCandidateId?: string;
    resourceAssignmentIds?: readonly string[];
    resourceAllocationIds?: readonly string[];
    environmentClass?: "local" | "browser" | "computer" | "workflow" | "remote" | "sandbox";
    deadlineEpochMs?: number;
  } = {},
): import("../src/index.js").PlanTask {
  return {
    taskId,
    kind: "manual",
    title: `Task ${taskId}`,
    dependsOn: Object.freeze(options.dependsOn ?? []),
    authorityRequirement: {
      ...(options.authorityActionId ? { actionId: options.authorityActionId } : {}),
      ...(options.authorityAuditRef ? { auditRef: options.authorityAuditRef } : {}),
    },
    consumes: Object.freeze(options.consumes ?? []),
    produces: Object.freeze(options.produces ?? []),
    resourceAllocations: Object.freeze(
      (options.resourceCandidateId ??
        options.resourceAssignmentIds ??
        options.resourceAllocationIds)
        ? [
            {
              candidateId: options.resourceCandidateId ?? "cand-1",
              actorAssignmentIds: Object.freeze(options.resourceAssignmentIds ?? ["asgn-1"]),
              capabilityAllocationIds: Object.freeze(options.resourceAllocationIds ?? ["alloc-1"]),
            },
          ]
        : [],
    ),
    ...(options.environmentClass ? { environmentClass: options.environmentClass } : {}),
    ...(options.deadlineEpochMs ? { deadlineEpochMs: options.deadlineEpochMs } : {}),
  };
}

/** Builds a `CreatePlanInput` with the standard fixture candidate + tasks. */
export function createPlanInput(
  candidateId: string,
  tasks: readonly import("../src/index.js").PlanTask[],
  options: { goalId?: string; planId?: string } = {},
): CreatePlanInput {
  return {
    ...(options.planId ? { planId: options.planId } : {}),
    ...(options.goalId ? { goalId: options.goalId as CreatePlanInput["goalId"] } : {}),
    candidateId,
    tasks,
    createdBy: personActor("p-1" as PersonId),
    provenance: provenance(systemActor("seed"), 0),
    evidenceRefs: [{ kind: "goal", id: "goal-1" }],
    now: now(0),
  };
}

/** Seeds a goal so the plan can reference goalId="goal-1". */
export function seedGoal(
  kernel: ReturnType<typeof createDomainKernel>,
  s: TenantScope,
  goalId = "goal-1",
): void {
  const result = kernel.goals.createGoal(s, {
    goalId,
    objective: "Ship the invoice processing overhaul",
    desiredState: "Invoices processed within SLA",
    horizonStart: now(0),
    horizonEnd: daysFromNow(60),
    ownerId: "boss",
    ownerLabels: ["executive"],
    priority: "medium",
    provenance: provenance(personActor("p-1" as PersonId), 0),
    now: now(0),
    audit: { actor: personActor("p-1" as PersonId), at: now(0), reason: "seed" },
  });
  if (!result.ok) throw new Error(`seedGoal failed: ${result.error.message}`);
}

export { personActor, systemActor };
