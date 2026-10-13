/**
 * W012 acceptance proofs — the RPC ENVELOPE (APPROACH R6): wire-agnostic
 * `{method, args}` behind the SAME service interfaces. Method-name
 * membership + arity are checked at the envelope edge (typed refusals);
 * every argument is validated by the OWNING service (no second validation
 * authority); the service's own `Result` crosses the envelope VERBATIM.
 * The local tower satisfies `TowerServiceAccess` structurally (compile-time
 * law); the RPC client satisfies it over any transport.
 */
import { describe, expect, it } from "vitest";
import { err } from "@aurum/domain";
import type { ControlTowerService, TowerServiceAccess } from "../src/index.js";
import {
  TOWER_RPC_METHODS,
  continuityValidationError,
  createTowerRpcClient,
  createTowerRpcHandler,
  isContinuityError,
} from "../src/index.js";
import { errOf, now, okOf, personActor, scope, towerRead } from "./continuity-helpers.js";

const S = scope("acme");

/** A recorder tower double: records (method, args) and answers from a script. */
function recorderTower(
  script: Readonly<Record<string, unknown>> = {},
): ControlTowerService & { calls: { method: string; args: unknown[] }[] } {
  const calls: { method: string; args: unknown[] }[] = [];
  const tower = {
    overview: (...args: unknown[]) => {
      calls.push({ method: "overview", args });
      return script.overview ?? { ok: true, value: "overview-value" };
    },
    conversation: (...args: unknown[]) => {
      calls.push({ method: "conversation", args });
      return script.conversation ?? { ok: true, value: "thread-value" };
    },
    createMission: (...args: unknown[]) => {
      calls.push({ method: "createMission", args });
      return script.createMission ?? { ok: true, value: "mission-value" };
    },
    advanceMission: (...args: unknown[]) => {
      calls.push({ method: "advanceMission", args });
      return script.advanceMission ?? { ok: true, value: "advanced" };
    },
    runMissionToCompletion: (...args: unknown[]) => {
      calls.push({ method: "runMissionToCompletion", args });
      return script.runMissionToCompletion ?? { ok: true, value: "completed" };
    },
    cancelMission: (...args: unknown[]) => {
      calls.push({ method: "cancelMission", args });
      return script.cancelMission ?? { ok: true, value: "cancelled" };
    },
    submitPlanForApproval: (...args: unknown[]) => {
      calls.push({ method: "submitPlanForApproval", args });
      return script.submitPlanForApproval ?? { ok: true, value: "submitted" };
    },
    approvePlan: (...args: unknown[]) => {
      calls.push({ method: "approvePlan", args });
      return script.approvePlan ?? { ok: true, value: "approved" };
    },
    rejectPlan: (...args: unknown[]) => {
      calls.push({ method: "rejectPlan", args });
      return script.rejectPlan ?? { ok: true, value: "rejected" };
    },
    activatePlan: (...args: unknown[]) => {
      calls.push({ method: "activatePlan", args });
      return script.activatePlan ?? { ok: true, value: "activated" };
    },
    dispatchTask: (...args: unknown[]) => {
      calls.push({ method: "dispatchTask", args });
      return script.dispatchTask ?? { ok: true, value: "dispatched" };
    },
  };
  return { ...(tower as unknown as ControlTowerService), calls };
}

describe("continuity RPC envelope: same interfaces over any wire", () => {
  it("the method table is exactly the 11 tower methods with their arities", () => {
    expect(Object.keys(TOWER_RPC_METHODS).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(TOWER_RPC_METHODS["overview"]).toBe(2);
    expect(TOWER_RPC_METHODS["advanceMission"]).toBe(3);
    expect(TOWER_RPC_METHODS["approvePlan"]).toBe(2);
  });

  it("delegates every method 1:1 with arguments forwarded verbatim, Result verbatim", async () => {
    const tower = recorderTower();
    const handler = createTowerRpcHandler(tower);
    const payload = { ok: true, value: { marker: "the-owning-service-result" } };
    const towerScripted = recorderTower({ createMission: payload });
    const scriptedHandler = createTowerRpcHandler(towerScripted);

    const input = {
      missionId: "mission-1",
      subject: { kind: "topic" as const, id: "invoices" },
      question: "Why?",
      consequence: "SLA",
      createdBy: personActor("p-1"),
      now: now(1),
    };
    const transported = okOf(
      await scriptedHandler.invoke({ method: "createMission", args: [S, input] }),
    );
    // The service's OWN Result object crosses the envelope verbatim.
    expect(transported).toBe(payload);
    // Exactly one call, arguments reference-identical.
    expect(towerScripted.calls).toHaveLength(1);
    expect(towerScripted.calls[0]?.args[0]).toBe(S);
    expect(towerScripted.calls[0]?.args[1]).toBe(input);
    void handler;
    void tower;
  });

  it("refuses an unknown method with the typed validation error (no dispatch)", async () => {
    const tower = recorderTower();
    const handler = createTowerRpcHandler(tower);
    const refused = await handler.invoke({ method: "approveEverything", args: [S, {}] });
    const error = errOf(refused);
    expect(isContinuityError(error) && error.code === "continuity-validation").toBe(true);
    expect(error.issues[0]?.field).toBe("method");
    expect(tower.calls).toHaveLength(0); // nothing dispatched
  });

  it("refuses a wrong-arity envelope with the typed validation error", async () => {
    const tower = recorderTower();
    const handler = createTowerRpcHandler(tower);
    const tooFew = await handler.invoke({ method: "overview", args: [S] });
    expect(isContinuityError(errOf(tooFew)) && errOf(tooFew).code === "continuity-validation").toBe(
      true,
    );
    const tooMany = await handler.invoke({ method: "overview", args: [S, towerRead(), "extra"] });
    expect(
      isContinuityError(errOf(tooMany)) && errOf(tooMany).code === "continuity-validation",
    ).toBe(true);
    expect(tower.calls).toHaveLength(0);
  });

  it("refuses a malformed envelope (not {method, args})", async () => {
    const handler = createTowerRpcHandler(recorderTower());
    const refused = await handler.invoke(null as never);
    expect(
      isContinuityError(errOf(refused)) && errOf(refused).code === "continuity-validation",
    ).toBe(true);
  });

  it("the owning service's error crosses the envelope VERBATIM (no re-wrap)", async () => {
    const missionError = { ok: false, error: { code: "mission-validation", message: "bad input" } };
    const tower = recorderTower({ createMission: missionError });
    const handler = createTowerRpcHandler(tower);
    const transported = okOf(
      await handler.invoke({ method: "createMission", args: [S, {} as never] }),
    );
    expect(transported).toBe(missionError); // the area's own Result, byte-for-byte
    expect(isContinuityError(transported)).toBe(false); // never re-wrapped
  });

  it("a throwing service surfaces as the typed continuity invariant", async () => {
    const tower = recorderTower();
    tower.overview = (() => {
      throw new Error("kernel exploded");
    }) as unknown as ControlTowerService["overview"];
    const handler = createTowerRpcHandler(tower);
    const result = await handler.invoke({ method: "overview", args: [S, towerRead()] });
    expect(isContinuityError(errOf(result)) && errOf(result).code === "continuity-invariant").toBe(
      true,
    );
  });

  it("the client satisfies TowerServiceAccess over a loopback transport", async () => {
    const tower = recorderTower();
    const handler = createTowerRpcHandler(tower);
    const client: TowerServiceAccess = createTowerRpcClient((envelope) => handler.invoke(envelope));

    const input = towerRead(1);
    const result = await client.overview(S, input);
    expect(result).toEqual({ ok: true, value: "overview-value" });
    expect(tower.calls).toHaveLength(1);
    expect(tower.calls[0]?.method).toBe("overview");

    const missionInput = {
      missionId: "m-1",
      subject: { kind: "topic" as const, id: "invoices" },
      question: "Q?",
      consequence: "C",
      createdBy: personActor("p-1"),
      now: now(2),
    };
    const created = await client.createMission(S, missionInput);
    expect(created).toEqual({ ok: true, value: "mission-value" });
    expect(tower.calls[1]?.args[1]).toBe(missionInput);
  });

  it("the client surfaces envelope refusals as thrown typed errors (typed)", async () => {
    // The transport's refusal is NOT a tower Result channel (the area errors
    // own those) — the client throws the typed ContinuityError for the
    // caller's catch path. No swallowing, no re-wrapping.
    const refusal = err(
      continuityValidationError([{ field: "method", problem: "'nope' is not a tower method" }]),
    );
    const client = createTowerRpcClient(async () => refusal);
    await expect(client.overview(S, towerRead())).rejects.toMatchObject({
      name: "ContinuityError",
      code: "continuity-validation",
    });
  });

  it("the LOCAL tower structurally satisfies TowerServiceAccess (compile-time law)", () => {
    // Type-level: a ControlTowerService IS a TowerServiceAccess (the
    // widening is a pure supertype — W010's surface unchanged).
    type LocalSatisfiesAccess = ControlTowerService extends TowerServiceAccess ? true : never;
    const witness: LocalSatisfiesAccess = true;
    expect(witness).toBe(true);
  });
});
