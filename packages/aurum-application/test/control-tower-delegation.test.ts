/**
 * W010 acceptance proofs — the 1:1 DELEGATION law (catalog clause 2:
 * "every semantic action goes through public contract").
 *
 * Method: instrument the four PUBLIC area services with call recorders
 * (each wrapper records the invocation and captures the underlying return
 * value), rebuild the tower over the instrumented deps, then prove for
 * every tower method:
 * - exactly ONE area method is invoked — the one the tower claims to
 *   delegate to, and nothing else;
 * - the arguments are forwarded UNCHANGED (reference-identical scope and
 *   input objects);
 * - the area's own Result is returned VERBATIM (reference-identical value
 *   AND error objects — the tower translates nothing, retries nothing,
 *   re-wraps nothing on the action paths).
 */
import { describe, expect, it } from "vitest";
import {
  createControlTowerService,
  isControlTowerError,
  type ControlTowerDeps,
  type LocalControlTowerRuntime,
} from "../src/index.js";
import { CompanyError } from "../src/index.js";
import {
  okOf,
  personActor,
  scope,
  seedApprovedAction,
  seedObservation,
  seedTowerCandidate,
  seedTowerGoal,
  towerFixture,
  towerPlanInput,
  towerRead,
} from "./control-tower-helpers.js";

interface RecordedCall {
  readonly area: "company" | "lab" | "plans" | "cognition";
  readonly method: string;
  readonly args: readonly unknown[];
  readonly returned: unknown;
}

/**
 * Wraps the four services' tower-picked methods with recorders. Every call
 * is captured (args + return value) and forwarded to the REAL service —
 * the tower under test behaves exactly as in production composition.
 */
function instrumentedTower(runtime: LocalControlTowerRuntime): {
  deps: ControlTowerDeps;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const record =
    <A extends unknown[], R>(area: RecordedCall["area"], method: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      const returned = fn(...args);
      calls.push({ area, method, args, returned });
      return returned;
    };

  const deps: ControlTowerDeps = {
    company: {
      situation: record("company", "situation", (s, input) => runtime.company.situation(s, input)),
      goalAttention: record("company", "goalAttention", (s, input) =>
        runtime.company.goalAttention(s, input),
      ),
      reportUnknowns: record("company", "reportUnknowns", (s, input) =>
        runtime.company.reportUnknowns(s, input),
      ),
    },
    lab: {
      listEvaluations: record("lab", "listEvaluations", (s) => runtime.lab.listEvaluations(s)),
    },
    plans: {
      listPlans: record("plans", "listPlans", (s) => runtime.plans.listPlans(s)),
      getPlan: record("plans", "getPlan", (s, planId) => runtime.plans.getPlan(s, planId)),
      readyTasks: record("plans", "readyTasks", (s, planId) => runtime.plans.readyTasks(s, planId)),
      listEscalations: record("plans", "listEscalations", (s, planId) =>
        runtime.plans.listEscalations(s, planId),
      ),
      submitForApproval: record("plans", "submitForApproval", (s, input) =>
        runtime.plans.submitForApproval(s, input),
      ),
      approvePlan: record("plans", "approvePlan", (s, input) =>
        runtime.plans.approvePlan(s, input),
      ),
      rejectPlan: record("plans", "rejectPlan", (s, input) => runtime.plans.rejectPlan(s, input)),
      activatePlan: record("plans", "activatePlan", (s, input) =>
        runtime.plans.activatePlan(s, input),
      ),
      dispatchTask: record("plans", "dispatchTask", (s, input) =>
        runtime.plans.dispatchTask(s, input),
      ),
    },
    cognition: {
      listMissions: record("cognition", "listMissions", (s) => runtime.cognition.listMissions(s)),
      getMission: record("cognition", "getMission", (s, missionId) =>
        runtime.cognition.getMission(s, missionId),
      ),
      createMission: record("cognition", "createMission", (s, input) =>
        runtime.cognition.createMission(s, input),
      ),
      advance: record("cognition", "advance", (s, missionId, input) =>
        runtime.cognition.advance(s, missionId, input),
      ),
      runToCompletion: record("cognition", "runToCompletion", (s, missionId, input) =>
        runtime.cognition.runToCompletion(s, missionId, input),
      ),
      cancelMission: record("cognition", "cancelMission", (s, missionId, input) =>
        runtime.cognition.cancelMission(s, missionId, input),
      ),
    },
  };
  return { deps, calls };
}

/** Asserts the recorder saw exactly one forwarded call; returns it. */
function soleCall(
  calls: readonly RecordedCall[],
  area: RecordedCall["area"],
  method: string,
): RecordedCall {
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (call === undefined) throw new Error("unreachable");
  expect(call.area).toBe(area);
  expect(call.method).toBe(method);
  return call;
}

describe("control tower delegation: 1:1 through the public contracts", () => {
  it("the tower holds no kernel handle and no area beyond the four picks", () => {
    const { tower } = towerFixture();
    const towerKeys = Object.keys(tower).sort();
    expect(towerKeys).toEqual([
      "activatePlan",
      "advanceMission",
      "approvePlan",
      "cancelMission",
      "conversation",
      "createMission",
      "dispatchTask",
      "overview",
      "rejectPlan",
      "runMissionToCompletion",
      "submitPlanForApproval",
    ]);
    expect("kernel" in tower).toBe(false);
    expect("company" in tower).toBe(false);
    expect("lab" in tower).toBe(false);
    expect("plans" in tower).toBe(false);
    expect("cognition" in tower).toBe(false);
  });

  it("cognition actions forward unchanged and return the service's Result verbatim", async () => {
    const fx = towerFixture();
    const s = scope("acme");
    seedTowerGoal(fx.runtime, s);
    seedObservation(fx.runtime, s, "obs-1");
    seedObservation(fx.runtime, s, "obs-2");
    const { deps, calls } = instrumentedTower(fx.runtime);
    const tower = createControlTowerService(deps);

    // createMission
    calls.length = 0;
    const createInput = {
      missionId: "mission-1",
      subject: { kind: "topic" as const, id: "invoices" },
      question: "Why is invoice processing slow?",
      consequence: "SLA breaches accumulate",
      createdBy: personActor("p-1"),
      now: 1_700_000_000_000,
    };
    const created = tower.createMission(s, createInput);
    let call = soleCall(calls, "cognition", "createMission");
    expect(call.args[0]).toBe(s);
    expect(call.args[1]).toBe(createInput);
    expect(created).toBe(call.returned);
    okOf(created);

    // advanceMission
    calls.length = 0;
    const advanceInput = { now: 1_700_000_000_001 };
    const advanced = await tower.advanceMission(s, "mission-1", advanceInput);
    call = soleCall(calls, "cognition", "advance");
    expect(call.args[0]).toBe(s);
    expect(call.args[1]).toBe("mission-1");
    expect(call.args[2]).toBe(advanceInput);
    // The async seam: the tower awaited the service's own promise and
    // returned its resolved Result verbatim.
    expect(advanced).toBe(await (call.returned as Promise<typeof advanced>));
    okOf(advanced);

    // runMissionToCompletion
    calls.length = 0;
    const runInput = { now: 1_700_000_000_006 };
    const finished = await tower.runMissionToCompletion(s, "mission-1", runInput);
    call = soleCall(calls, "cognition", "runToCompletion");
    expect(call.args[2]).toBe(runInput);
    expect(finished).toBe(await (call.returned as Promise<typeof finished>));
    okOf(finished);

    // cancelMission (terminal on a complete mission errors — the area's own
    // error, returned verbatim through the tower).
    calls.length = 0;
    const cancelInput = {
      actor: personActor("p-1"),
      reason: "too late",
      now: 1_700_000_000_010,
    };
    const cancelled = tower.cancelMission(s, "mission-1", cancelInput);
    call = soleCall(calls, "cognition", "cancelMission");
    expect(call.args[2]).toBe(cancelInput);
    expect(cancelled).toBe(call.returned);
    expect(cancelled.ok).toBe(false);
  });

  it("plans actions forward unchanged and return the service's Result verbatim", async () => {
    const fx = towerFixture();
    const s = scope("acme");
    seedTowerGoal(fx.runtime, s);
    seedTowerCandidate(fx.runtime, s);
    const actionId = seedApprovedAction(fx.runtime, s);
    const { deps, calls } = instrumentedTower(fx.runtime);
    const tower = createControlTowerService(deps);

    // The plan itself is created on the plans area surface (not a tower
    // action) — the recorder proves the tower never touches createPlan.
    okOf(fx.runtime.plans.createPlan(s, towerPlanInput("cand-1")));
    expect(calls.some((entry) => entry.method === "createPlan")).toBe(false);

    calls.length = 0;
    const submitInput = {
      planId: "plan-1",
      actor: personActor("p-1"),
      reason: "submit",
      now: 1_700_000_000_010,
    };
    const submitted = tower.submitPlanForApproval(s, submitInput);
    let call = soleCall(calls, "plans", "submitForApproval");
    expect(call.args[0]).toBe(s);
    expect(call.args[1]).toBe(submitInput);
    expect(submitted).toBe(call.returned);
    okOf(submitted);

    calls.length = 0;
    const approveInput = {
      planId: "plan-1",
      actor: personActor("p-1"),
      reason: "approved with cited authority",
      now: 1_700_000_000_020,
      humanDecision: { decidedBy: "p-1", decidedAt: 1_700_000_000_020 },
      citation: { actionId },
    };
    const approved = tower.approvePlan(s, approveInput);
    call = soleCall(calls, "plans", "approvePlan");
    expect(call.args[1]).toBe(approveInput);
    expect(approved).toBe(call.returned);
    okOf(approved);

    calls.length = 0;
    const activateInput = {
      planId: "plan-1",
      actor: personActor("p-1"),
      reason: "kick off",
      now: 1_700_000_000_021,
      auditRef: "plan-audit-2",
    };
    const activated = tower.activatePlan(s, activateInput);
    call = soleCall(calls, "plans", "activatePlan");
    expect(call.args[1]).toBe(activateInput);
    expect(activated).toBe(call.returned);
    okOf(activated);

    calls.length = 0;
    const rejectInput = {
      planId: "plan-1",
      actor: personActor("p-1"),
      reason: "not this one",
      now: 1_700_000_000_022,
    };
    const rejected = tower.rejectPlan(s, rejectInput);
    // The W009 approval state machine rejects a reject-after-approve move —
    // the area's OWN typed error, returned verbatim (no tower re-wrap).
    call = soleCall(calls, "plans", "rejectPlan");
    expect(call.args[1]).toBe(rejectInput);
    expect(rejected).toBe(call.returned);
    expect(rejected.ok).toBe(false);

    calls.length = 0;
    const dispatchInput = {
      planId: "plan-1",
      taskId: "task-a",
      authority: { actionId },
      now: 1_700_000_000_023,
    };
    const dispatched = await tower.dispatchTask(s, dispatchInput);
    call = soleCall(calls, "plans", "dispatchTask");
    expect(call.args[1]).toBe(dispatchInput);
    expect(dispatched).toBe(await (call.returned as Promise<typeof dispatched>));
    const completion = okOf(dispatched);
    expect(completion.status).toBe("settled");
  });

  it("a delegated action's error is the area's own namespace (no second authority)", () => {
    const fx = towerFixture();
    const s = scope("acme");
    const { deps, calls } = instrumentedTower(fx.runtime);
    const tower = createControlTowerService(deps);

    // Malformed mission input: the cognition area's own validation fires.
    const result = tower.createMission(s, {
      missionId: "",
      subject: { kind: "topic", id: "invoices" },
      question: "",
      consequence: "",
      createdBy: personActor(""),
      now: -1,
    });
    const call = soleCall(calls, "cognition", "createMission");
    expect(result).toBe(call.returned);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // MissionError, not a ControlTowerError — actions carry the owning
      // area's namespace unchanged.
      expect(isControlTowerError(result.error)).toBe(false);
      expect((result.error as { code?: string }).code).toBe("mission-validation");
    }
  });

  it("the overview read forwards the logged query to each company seam unchanged", () => {
    const fx = towerFixture();
    const s = scope("acme");
    seedTowerGoal(fx.runtime, s);
    const { deps, calls } = instrumentedTower(fx.runtime);
    const tower = createControlTowerService(deps);

    const read = towerRead(45);
    const overview = okOf(tower.overview(s, read));
    for (const method of ["situation", "goalAttention", "reportUnknowns"]) {
      const call = calls.find((entry) => entry.method === method);
      expect(call, `expected a ${method} call`).toBeDefined();
      expect(call?.args[0]).toBe(s);
      expect(call?.args[1]).toBe(read);
    }
    // The verbatim pass-through: the overview's panels ARE the values the
    // company seams returned (reference identity — no copy, no re-shaping).
    const situationCall = calls.find((entry) => entry.method === "situation");
    const situationResult = situationCall?.returned as { ok: boolean; value: unknown };
    expect(overview.situation).toBe(situationResult.value);
    // Reads only: no write-shaped method was touched anywhere.
    const writeShaped = calls.filter((entry) =>
      /submit|approve|reject|activate|dispatch|create|advance|cancel/i.test(entry.method),
    );
    expect(writeShaped).toEqual([]);
  });

  it("company read errors propagate tagged with the owning area, error verbatim", () => {
    const fx = towerFixture();
    const s = scope("acme");
    const { deps } = instrumentedTower(fx.runtime);
    const companyError = new CompanyError("company-subject-not-found", "goal nope");
    deps.company.situation = () => ({ ok: false, error: companyError });
    const tower = createControlTowerService(deps);

    const result = tower.overview(s, towerRead(45));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isControlTowerError(result.error)).toBe(true);
      if (result.error.kind === "company") {
        expect(result.error.error).toBe(companyError);
      } else {
        throw new Error(`expected a company-tagged error, got ${result.error.kind}`);
      }
    }
  });

  it("the conversation read forwards to the owning area's get seam unchanged", async () => {
    const fx = towerFixture();
    const s = scope("acme");
    seedTowerGoal(fx.runtime, s);
    seedObservation(fx.runtime, s, "obs-1");
    seedObservation(fx.runtime, s, "obs-2");
    const { deps, calls } = instrumentedTower(fx.runtime);
    const tower = createControlTowerService(deps);

    okOf(
      tower.createMission(s, {
        missionId: "mission-1",
        subject: { kind: "topic", id: "invoices" },
        question: "Why is invoice processing slow?",
        consequence: "SLA breaches accumulate",
        createdBy: personActor("p-1"),
        now: 1_700_000_000_000,
      }),
    );
    okOf(await tower.advanceMission(s, "mission-1", { now: 1_700_000_000_001 }));

    calls.length = 0;
    const thread = okOf(tower.conversation(s, { kind: "mission", missionId: "mission-1" }));
    const call = soleCall(calls, "cognition", "getMission");
    expect(call.args[0]).toBe(s);
    expect(call.args[1]).toBe("mission-1");
    // The thread is derived from the exact record the seam returned.
    const mission = okOf(fx.runtime.cognition.getMission(s, "mission-1"));
    expect(thread.turns).toHaveLength(2); // charter + orient (one advance)
    expect(mission.stages).toHaveLength(1);

    calls.length = 0;
    const planThread = tower.conversation(s, { kind: "plan", planId: "nope" });
    const planCall = soleCall(calls, "plans", "getPlan");
    expect(planCall.args[1]).toBe("nope");
    expect(planThread.ok).toBe(false);
  });
});
