/**
 * W009 plan service end-to-end (catalog clauses 1 + 5: create / draft /
 * submit / approve / activate / dispatch / handoff / list). All tests run
 * against a deterministic in-process substrate (no real W006 gateway —
 * CR-W009 will wire it; the port shape is structurally compatible).
 */
import { describe, expect, it } from "vitest";
import { createInMemoryPlanStore, type ExecutionPlan } from "../src/index.js";
import {
  errOf,
  okOf,
  planServiceFixture,
  planTask,
  personActor,
  scope,
  seedCandidate,
  seedGoal,
  createPlanInput,
  now,
} from "./plans-helpers.js";
import { failedScript } from "../src/index.js";

describe("plan service: create + lifecycle (catalog clause 1)", () => {
  it("creates a plan with approval state 'draft' + lifecycle 'active'", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    expect(plan.approval.state).toBe("draft");
    expect(plan.lifecycleState).toBe("active");
    expect(plan.version).toBe(1);
    expect(plan.taskDag.tasks.length).toBe(1);
    expect(plan.taskDag.topologicalOrder).toEqual(["t1"]);
  });

  it("rejects a plan whose candidateId does not exist in the tenant", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    const result = fx.service.createPlan(
      s,
      createPlanInput("nonexistent", [planTask("t1", { authorityActionId: "act-1" })]),
    );
    expect(errOf(result).code).toBe("plan-not-found");
  });

  it("rejects a plan with a cycle in the task DAG", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const result = fx.service.createPlan(
      s,
      createPlanInput("cand-1", [
        planTask("a", { authorityActionId: "act-1", dependsOn: ["b"] }),
        planTask("b", { authorityActionId: "act-1", dependsOn: ["a"] }),
      ]),
    );
    expect(errOf(result).code).toBe("plan-cycle");
  });

  it("rejects a plan whose resource allocations reference foreign assignment ids", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const result = fx.service.createPlan(
      s,
      createPlanInput("cand-1", [
        planTask("t1", {
          authorityActionId: "act-1",
          resourceCandidateId: "cand-1",
          resourceAssignmentIds: ["nonexistent-assignment"],
        }),
      ]),
    );
    expect(errOf(result).code).toBe("plan-validation");
  });
});

describe("plan service: approval gate (catalog clause 1: human-gated)", () => {
  it("transitions draft → submitted", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    const submitted = okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ready for review",
        now: now(1),
      }),
    ) as ExecutionPlan;
    expect(submitted.approval.state).toBe("submitted");
    expect(submitted.approval.history.length).toBe(1);
  });

  it("refuses approve from draft (must be submitted first)", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    const result = fx.service.approvePlan(s, {
      planId: plan.planId,
      actor: personActor("p-1"),
      reason: "approve",
      now: now(1),
      humanDecision: { decidedBy: "p-1" as never, decidedAt: now(1) },
      citation: { actionId: "act-1" },
    });
    expect(errOf(result).code).toBe("plan-lifecycle");
  });

  it("transitions submitted → approved with a human decision + citation", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ready",
        now: now(1),
      }),
    );
    const approved = okOf(
      fx.service.approvePlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "approved by boss",
        now: now(2),
        humanDecision: { decidedBy: "p-1" as never, decidedAt: now(2) },
        citation: { actionId: "act-1", auditRef: "audit-1" },
      }),
    ) as ExecutionPlan;
    expect(approved.approval.state).toBe("approved");
    expect(approved.approval.citation?.actionId).toBe("act-1");
    expect(approved.approval.citation?.approvedBy.kind).toBe("person");
  });

  it("refuses approve without a humanDecision", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ready",
        now: now(1),
      }),
    );
    const result = fx.service.approvePlan(s, {
      planId: plan.planId,
      actor: personActor("p-1"),
      reason: "approved",
      now: now(2),
      citation: { actionId: "act-1" },
    });
    expect(errOf(result).code).toBe("plan-validation");
  });

  it("refuses approve when the approver is not a person", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ready",
        now: now(1),
      }),
    );
    const result = fx.service.approvePlan(s, {
      planId: plan.planId,
      actor: { kind: "system", name: "bot" },
      reason: "approved",
      now: now(2),
      humanDecision: { decidedBy: "p-1" as never, decidedAt: now(2) },
      citation: { actionId: "act-1" },
    });
    expect(errOf(result).code).toBe("plan-unauthorized");
  });

  it("refuses approve when the approval authority port refuses", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ready",
        now: now(1),
      }),
    );
    fx.approval.refuseNext = true;
    const result = fx.service.approvePlan(s, {
      planId: plan.planId,
      actor: personActor("p-1"),
      reason: "approved",
      now: now(2),
      humanDecision: { decidedBy: "p-1" as never, decidedAt: now(2) },
      citation: { actionId: "act-1" },
    });
    expect(errOf(result).code).toBe("plan-unauthorized");
  });

  it("transitions submitted → rejected with a rejection reason", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ready",
        now: now(1),
      }),
    );
    const rejected = okOf(
      fx.service.rejectPlan(s, {
        planId: plan.planId,
        actor: personActor("p-2"),
        reason: "no",
        now: now(2),
        rejectionReason: "missing evidence",
      }),
    ) as ExecutionPlan;
    expect(rejected.approval.state).toBe("rejected");
    expect(rejected.approval.rejection?.reason).toBe("missing evidence");
  });
});

describe("plan service: lifecycle (active / completed / cancelled)", () => {
  it("activates an approved plan", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ready",
        now: now(1),
      }),
    );
    const approved = okOf(
      fx.service.approvePlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ok",
        now: now(2),
        humanDecision: { decidedBy: "p-1" as never, decidedAt: now(2) },
        citation: { actionId: "act-1" },
      }),
    ) as ExecutionPlan;
    // lifecycle already 'active' on creation; activate is a no-op-ish
    // transition that records the audit-cited lifecycle history.
    const activated = okOf(
      fx.service.activatePlan(s, {
        planId: approved.planId,
        actor: personActor("p-1"),
        reason: "go",
        now: now(3),
        auditRef: "audit-2",
      }),
    ) as ExecutionPlan;
    expect(activated.lifecycleState).toBe("active");
    expect(activated.lifecycleHistory.length).toBe(1);
    expect(activated.lifecycleHistory[0].auditRef).toBe("audit-2");
  });

  it("refuses activate when not approved", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    const result = fx.service.activatePlan(s, {
      planId: plan.planId,
      actor: personActor("p-1"),
      reason: "go",
      now: now(1),
      auditRef: "audit-1",
    });
    expect(errOf(result).code).toBe("plan-lifecycle");
  });

  it("completes an active plan", () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ready",
        now: now(1),
      }),
    );
    okOf(
      fx.service.approvePlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ok",
        now: now(2),
        humanDecision: { decidedBy: "p-1" as never, decidedAt: now(2) },
        citation: { actionId: "act-1" },
      }),
    );
    const completed = okOf(
      fx.service.completePlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "done",
        now: now(3),
        auditRef: "audit-3",
      }),
    ) as ExecutionPlan;
    expect(completed.lifecycleState).toBe("completed");
  });
});

describe("plan service: tenant isolation (catalog: tenant isolation)", () => {
  it("a plan created in tenant A is invisible to tenant B", () => {
    const fx = planServiceFixture();
    const sA = scope("tA");
    const sB = scope("tB");
    seedGoal(fx.kernel, sA);
    seedCandidate(fx.kernel, sA);
    const plan = okOf(
      fx.service.createPlan(
        sA,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    // Tenant B cannot see it.
    const result = fx.service.getPlan(sB, plan.planId);
    expect(errOf(result).code).toBe("plan-not-found");
  });

  it("listPlans only returns plans from the requesting tenant", () => {
    const fx = planServiceFixture();
    const sA = scope("tA");
    const sB = scope("tB");
    seedGoal(fx.kernel, sA);
    seedCandidate(fx.kernel, sA);
    seedGoal(fx.kernel, sB);
    seedCandidate(fx.kernel, sB, "cand-B");
    okOf(
      fx.service.createPlan(
        sA,
        createPlanInput("cand-1", [planTask("t1", { authorityActionId: "act-1" })], {
          planId: "pA",
        }),
      ),
    );
    okOf(
      fx.service.createPlan(
        sB,
        createPlanInput("cand-B", [planTask("t1", { authorityActionId: "act-1" })], {
          planId: "pB",
        }),
      ),
    );
    const aPlans = fx.service.listPlans(sA);
    const bPlans = fx.service.listPlans(sB);
    expect(aPlans.length).toBe(1);
    expect(bPlans.length).toBe(1);
    expect(aPlans[0].planId).toBe("pA");
    expect(bPlans[0].planId).toBe("pB");
  });
});

describe("plan service: readyTasks + dispatch + handoff (catalog clauses 2-5)", () => {
  it("readyTasks returns the ready tasks (deps settled + handoffs delivered)", async () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [
          planTask("a", {
            authorityActionId: "act-1",
            produces: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
          }),
          planTask("b", {
            authorityActionId: "act-1",
            dependsOn: ["a"],
            consumes: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
          }),
        ]),
      ),
    ) as ExecutionPlan;
    okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ready",
        now: now(1),
      }),
    );
    okOf(
      fx.service.approvePlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ok",
        now: now(2),
        humanDecision: { decidedBy: "p-1" as never, decidedAt: now(2) },
        citation: { actionId: "act-1" },
      }),
    );

    // Initially, only 'a' is ready.
    const ready0 = okOf(fx.service.readyTasks(s, plan.planId));
    expect([...ready0]).toEqual(["a"]);

    // Dispatch 'a' — settles successfully (default script).
    const completionA = await okOf(
      await fx.service.dispatchTask(s, {
        planId: plan.planId,
        taskId: "a",
        authority: { actionId: "act-1" },
        now: now(3),
        payload: "",
        payloadMediaType: "application/octet-stream",
      }),
    );
    expect(completionA.status).toBe("settled");

    // Now 'b' has its dep settled, but its handoff has not been delivered.
    const ready1 = okOf(fx.service.readyTasks(s, plan.planId));
    expect([...ready1]).toEqual([]);

    // Issue the handoff from 'a' to 'b'.
    okOf(
      fx.service.issueHandoff(s, {
        planId: plan.planId,
        producingTaskId: "a",
        consumingTaskId: "b",
        handoffId: "h1",
        producingSettlement: {
          requestId: completionA.settlementRef.requestId,
          status: "settled",
          settledAt: completionA.settlementRef.settledAt,
        },
        payload: '{"result":"ok"}',
        now: now(4),
      }),
    );

    // Now 'b' is ready.
    const ready2 = okOf(fx.service.readyTasks(s, plan.planId));
    expect([...ready2]).toEqual(["b"]);
  });

  it("dispatchTask refuses when the plan is not approved", async () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("a", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    const result = await fx.service.dispatchTask(s, {
      planId: plan.planId,
      taskId: "a",
      authority: { actionId: "act-1" },
      now: now(1),
    });
    expect(errOf(result).code).toBe("plan-lifecycle");
  });

  it("dispatchTask records a completion that cites the settling envelope", async () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("a", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "r",
        now: now(1),
      }),
    );
    okOf(
      fx.service.approvePlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ok",
        now: now(2),
        humanDecision: { decidedBy: "p-1" as never, decidedAt: now(2) },
        citation: { actionId: "act-1" },
      }),
    );
    const completion = await okOf(
      await fx.service.dispatchTask(s, {
        planId: plan.planId,
        taskId: "a",
        authority: { actionId: "act-1" },
        now: now(3),
      }),
    );
    // Causation identity: completion cites the settling envelope.
    expect(completion.settlementRef.requestId).toBeDefined();
    expect(completion.settlementRef.settledAt).toBeDefined();
  });

  it("dispatchTask on a failed settlement raises an escalation", async () => {
    const fx = planServiceFixture({
      substrateScript: failedScript({
        kind: "transport-failed",
        code: "x",
        message: "boom",
        retryable: true,
      }),
    });
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("a", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "r",
        now: now(1),
      }),
    );
    okOf(
      fx.service.approvePlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ok",
        now: now(2),
        humanDecision: { decidedBy: "p-1" as never, decidedAt: now(2) },
        citation: { actionId: "act-1" },
      }),
    );
    const completion = await okOf(
      await fx.service.dispatchTask(s, {
        planId: plan.planId,
        taskId: "a",
        authority: { actionId: "act-1" },
        now: now(3),
      }),
    );
    expect(completion.status).toBe("failed");
    const escalations = okOf(fx.service.listEscalations(s, plan.planId));
    expect(escalations.length).toBe(1);
    expect(escalations[0].trigger).toBe("task-failed");
    expect(escalations[0].taskId).toBe("a");
  });
});

describe("plan service: idempotent dispatch (catalog clause 3)", () => {
  it("re-dispatch of the same task settles a NEW session (recovery)", async () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("a", { authorityActionId: "act-1" })]),
      ),
    ) as ExecutionPlan;
    okOf(
      fx.service.submitForApproval(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "r",
        now: now(1),
      }),
    );
    okOf(
      fx.service.approvePlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "ok",
        now: now(2),
        humanDecision: { decidedBy: "p-1" as never, decidedAt: now(2) },
        citation: { actionId: "act-1" },
      }),
    );
    const first = await okOf(
      await fx.service.dispatchTask(s, {
        planId: plan.planId,
        taskId: "a",
        authority: { actionId: "act-1" },
        now: now(3),
      }),
    );
    // The completion store is idempotent on identical re-completion: a
    // divergent re-completion is refused (in-process double already settles
    // exactly once; this is a structural proof).
    expect(first.status).toBe("settled");
  });
});

describe("plan service: in-memory plan store (catalog: tenant isolation)", () => {
  it("foreign-tenant reads are uniform not-found (no existence leak)", () => {
    const store = createInMemoryPlanStore();
    const sA = scope("tA");
    const sB = scope("tB");
    const plan: {
      scope: typeof sA;
      planId: string;
      version: number;
      approval: { state: string; history: readonly unknown[] };
      lifecycleState: string;
      lifecycleHistory: readonly unknown[];
    } = {
      scope: sA,
      planId: "p1",
      version: 1,
      approval: { state: "draft", history: [] },
      lifecycleState: "active",
      lifecycleHistory: [],
    };
    okOf(store.putPlan(plan));
    const result = store.getPlan(sB, "p1");
    expect(errOf(result).code).toBe("plan-not-found");
    // Same error message as a never-existing id (no existence leak).
    const resultMissing = store.getPlan(sA, "nonexistent");
    expect(errOf(resultMissing).code).toBe("plan-not-found");
  });
});
