/**
 * W013 acceptance proofs — OUTCOME SOURCES + THE FULL LOOP. The mission
 * (W007) and plan (W009) outcome-source adapters derive observations from
 * REAL records produced by the real services (pure value mapping, no
 * service handles), and the full journey closes: lab search -> candidate
 * registered -> mission run to completion -> observation joined to the
 * evaluation context -> conditional evidence learned.
 */
import { describe, expect, it } from "vitest";
import {
  conditionalEvidence,
  learningFixture,
  now,
  okOf,
  personActor,
  recordOutcome,
  registerCandidate,
  runSearch,
  scope,
  seedSubject,
} from "./learning-helpers.js";
import {
  createCognitionService,
  createInMemoryMissionStore,
  createKernelCognitionSeams,
  createScriptedReasoner,
  failedScript,
  missionOutcomeObservation,
  planOutcomeObservation,
} from "../src/index.js";
import {
  cognitionFixture,
  createMissionInput,
  seedGoal as seedCognitionGoal,
  seedObservation,
  standardContent,
} from "./cognition-helpers.js";
import {
  createPlanInput,
  planServiceFixture,
  planTask,
  seedCandidate,
  seedGoal as seedPlanGoal,
} from "./plans-helpers.js";

describe("learning: mission outcome source (W007 -> W013)", () => {
  it("derives an achieved observation from a satisfied mission", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    seedCognitionGoal(fx.kernel, s);
    okOf(fx.service.createMission(s, createMissionInput({ missionId: "m-1" })));
    const mission = okOf(await fx.service.runToCompletion(s, "m-1", { now: now(1) }));

    const observation = missionOutcomeObservation(mission);
    expect(observation).not.toBeNull();
    expect(observation?.status).toBe("achieved");
    expect(observation?.source).toEqual({ kind: "mission", ref: "m-1" });
    expect(observation?.failure).toBeUndefined();
    expect(observation?.observedAt).toBe(mission.stages[5]?.at);
  });

  it("derives a MISSED observation (with failure detail) from a knowledge-gap mission", async () => {
    const fx = cognitionFixture([
      {
        ...standardContent(),
        findings: [],
        hypotheses: [],
        proposals: [],
        gaps: [{ question: "What is missing?", consequence: "cannot decide" }],
      },
    ]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    seedCognitionGoal(fx.kernel, s);
    okOf(fx.service.createMission(s, createMissionInput({ missionId: "m-1" })));
    const mission = okOf(await fx.service.runToCompletion(s, "m-1", { now: now(1) }));
    expect(mission.disposition).toBe("knowledge-gap-remains");

    const observation = missionOutcomeObservation(mission);
    expect(observation?.status).toBe("missed");
    expect(observation?.failure?.kind).toBe("knowledge-gap-remains");
    expect(observation?.failure?.detail).toContain("gap(s) raised");
  });

  it("observes nothing for pending or cancelled missions", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    okOf(fx.service.createMission(s, createMissionInput({ missionId: "m-1" })));
    const pending = okOf(fx.service.getMission(s, "m-1"));
    expect(missionOutcomeObservation(pending)).toBeNull();

    const cancelled = okOf(
      fx.service.cancelMission(s, "m-1", {
        now: now(1),
        actor: personActor("p-1"),
        reason: "not needed",
      }),
    );
    expect(missionOutcomeObservation(cancelled)).toBeNull();
  });
});

describe("learning: plan outcome source (W009 -> W013)", () => {
  it("derives an achieved observation from a completed all-settled plan", async () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedPlanGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("a", { authorityActionId: "act-1" })]),
      ),
    );
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
    await okOf(
      await fx.service.dispatchTask(s, {
        planId: plan.planId,
        taskId: "a",
        authority: { actionId: "act-1" },
        now: now(3),
      }),
    );
    const completed = okOf(
      fx.service.completePlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "done",
        now: now(4),
        auditRef: "audit-9",
      }),
    );
    const completions = fx.deps.completions.listCompletions(plan.planId);
    expect(completions).toHaveLength(1);

    const observation = planOutcomeObservation(completed, completions);
    expect(observation?.status).toBe("achieved");
    expect(observation?.source).toEqual({ kind: "plan", ref: plan.planId });
    expect(observation?.failure).toBeUndefined();
  });

  it("derives a FAILED observation (with the failure detail) from a failed task settlement", async () => {
    const fx = planServiceFixture({
      substrateScript: failedScript({
        kind: "execution-failed",
        code: "E_TOOL",
        message: "tool crashed",
        retryable: false,
      }),
    });
    const s = scope("t1");
    seedPlanGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("a", { authorityActionId: "act-1" })]),
      ),
    );
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
    await fx.service.dispatchTask(s, {
      planId: plan.planId,
      taskId: "a",
      authority: { actionId: "act-1" },
      now: now(3),
    });
    const completions = fx.deps.completions.listCompletions(plan.planId);
    expect(completions[0]?.status).toBe("failed");

    // A completed plan over a failed settlement is the failure case.
    const planRecord = okOf(fx.service.getPlan(s, plan.planId));
    const completed = okOf(
      fx.service.completePlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "wrapped up after failure",
        now: now(4),
        auditRef: "audit-9",
      }),
    );
    expect(completed.lifecycleState).toBe("completed");
    expect(planRecord.planId).toBe(plan.planId);

    const observation = planOutcomeObservation(completed, completions);
    expect(observation?.status).toBe("failed");
    expect(observation?.failure?.kind).toBe("execution-failed");
    expect(observation?.failure?.detail).toContain("E_TOOL");
    expect(observation?.failure?.detail).toContain("task a");
  });

  it("derives a partial observation when tasks were cancelled without failures", async () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedPlanGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("a", { authorityActionId: "act-1" })]),
      ),
    );
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
    // A cancelled completion record for the plan's task.
    okOf(
      fx.deps.completions.recordCompletion({
        planId: plan.planId,
        taskId: "a",
        status: "cancelled",
        settlementRef: { requestId: "req-1", settledAt: now(3) },
        completedAt: now(3),
      }),
    );
    const completed = okOf(
      fx.service.completePlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "done",
        now: now(4),
        auditRef: "audit-9",
      }),
    );

    const observation = planOutcomeObservation(
      completed,
      fx.deps.completions.listCompletions(plan.planId),
    );
    expect(observation?.status).toBe("partial");
    expect(observation?.notes).toContain("1 task completion(s) cancelled");
  });

  it("observes nothing for active or cancelled plans", async () => {
    const fx = planServiceFixture();
    const s = scope("t1");
    seedPlanGoal(fx.kernel, s);
    seedCandidate(fx.kernel, s);
    const plan = okOf(
      fx.service.createPlan(
        s,
        createPlanInput("cand-1", [planTask("a", { authorityActionId: "act-1" })]),
      ),
    );
    okOf(
      fx.deps.completions.recordCompletion({
        planId: plan.planId,
        taskId: "a",
        status: "settled",
        settlementRef: { requestId: "req-1", settledAt: now(3) },
        completedAt: now(3),
      }),
    );
    const active = okOf(fx.service.getPlan(s, plan.planId));
    expect(
      planOutcomeObservation(active, fx.deps.completions.listCompletions(plan.planId)),
    ).toBeNull();

    const cancelled = okOf(
      fx.service.cancelPlan(s, {
        planId: plan.planId,
        actor: personActor("p-1"),
        reason: "not needed",
        now: now(5),
        auditRef: "audit-9",
      }),
    );
    expect(
      planOutcomeObservation(cancelled, fx.deps.completions.listCompletions(plan.planId)),
    ).toBeNull();
  });
});

describe("learning: the full loop (lab -> candidate -> mission -> outcome -> evidence)", () => {
  it("closes the journey: search, register, run a mission, join, calibrate", async () => {
    const fx = learningFixture();
    const s = scope("acme");
    seedSubject(fx, s);
    const run = runSearch(fx, s);
    const best = run.result.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    registerCandidate(fx, s, best);

    // A cognition mission over the SAME kernel, on the lab's subject goal.
    // The orientation lists observations BY the mission subject, so the
    // seeded evidence must live on the goal subject for the bounded-content
    // citation gate to accept the scripted findings (W007 law: findings may
    // only cite observations present in the orientation).
    seedObservation(fx.kernel, s, {
      observationId: "obs-1",
      subject: { kind: "goal", id: "goal-1" },
    });
    seedObservation(fx.kernel, s, {
      observationId: "obs-2",
      subject: { kind: "goal", id: "goal-1" },
    });
    const seams = createKernelCognitionSeams(fx.kernel);
    const cognition = createCognitionService({
      reads: seams.reads,
      knowledge: seams.knowledge,
      gate: seams.gate,
      model: createScriptedReasoner([standardContent()]),
      missions: createInMemoryMissionStore(),
      proposalPolicy: { approvalRoles: ["approver"], authorizationRoles: ["authorizer"] },
    });
    okOf(
      cognition.createMission(s, {
        missionId: "mission-1",
        subject: { kind: "goal", id: "goal-1" },
        question: "Will this organization deliver the overhaul?",
        consequence: "the recommendation is unverified",
        goalId: "goal-1",
        createdBy: personActor("boss"),
        now: now(25),
      }),
    );
    const mission = okOf(await cognition.runToCompletion(s, "mission-1", { now: now(26) }));

    const observation = missionOutcomeObservation(mission);
    if (!observation) throw new Error("test setup: mission produced no observation");
    expect(observation.status).toBe("achieved");

    const joined = recordOutcome(fx, s, {
      outcomeId: "out-mission-1",
      evaluationId: run.evaluation.evaluationId,
      candidateId: best.candidateId,
      status: observation.status,
      observedAtSec: 26,
      source: observation.source,
    });
    expect(joined.observation.source).toEqual({ kind: "mission", ref: "mission-1" });

    const evidence = conditionalEvidence(fx, s, run.fingerprint);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.achievedCount).toBe(1);
    expect(evidence[0]?.sampleCount).toBe(1);
  });
});
