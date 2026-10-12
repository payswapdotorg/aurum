/**
 * W007 ACCEPTANCE CLAUSE 3 — "every consequential action enters authority
 * gate".
 *
 * Proofs (against the REAL kernel action authority — the fixture wires the
 * kernel's own ActionAuthority through the seam picks):
 * - every reasoned proposal becomes an ActionRecord via proposeAction and
 *   advances only to `recommended` (the analysis-grade transition);
 * - mission-proposed actions are never employment-impacting, carry the
 *   service policy and evidence-cited expectedEvidence;
 * - the remaining path is HUMAN-ONLY: a role-holding person approves; a
 *   role-less person is refused; a person without the role cannot approve;
 * - a gate refusal surfaces typed (`mission-authority-refused`) and the
 *   mission stays resumable at the gate stage;
 * - zero proposals produce zero action records.
 */
import { describe, expect, it } from "vitest";
import {
  createCognitionService,
  createInMemoryMissionStore,
  createKernelCognitionSeams,
  createScriptedReasoner,
  missionAuthorityRefused,
  type MissionAuthorityGate,
} from "../src/index.js";
import { createDomainKernel } from "@aurum/domain";
import {
  cognitionFixture,
  createMissionInput,
  errOf,
  now,
  okOf,
  personActor,
  scope,
  seedObservation,
  seedPersonWithRoles,
  standardContent,
} from "./cognition-helpers.js";

describe("cognition authority gate (catalog clause 3)", () => {
  it("routes every proposal through the authority: proposed then recommended, nothing further", async () => {
    const fx = cognitionFixture([standardContent({ proposals: 2 })]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    expect(mission.status).toBe("complete");

    for (const actionId of ["mission-1:action-0", "mission-1:action-1"]) {
      const action = okOf(fx.kernel.actions.getAction(s, actionId));
      expect(action.state).toBe("recommended");
      expect(action.createdBy).toEqual({ kind: "system", name: "aurum-cognition" });
      expect(action.policy.employmentImpacting).toBe(false);
      expect(action.policy.approvalRoles).toEqual(["approver"]);
      expect(action.policy.authorizationRoles).toEqual(["authorizer"]);
      expect(action.expectedEvidence).toContain("claims:mission-1:claim-");
      expect(action.stateHistory.map((entry) => entry.to)).toEqual(["proposed", "recommended"]);
    }
    const gate = mission.stages[4];
    if (gate?.stage !== "gate") throw new Error("expected gate record");
    expect(gate.gated.map((entry) => entry.finalState)).toEqual(["recommended", "recommended"]);
  });

  it("the remaining path is human-only: role-holders approve, others are refused", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    seedPersonWithRoles(fx.kernel, s, "boss", ["approver", "authorizer"]);
    seedPersonWithRoles(fx.kernel, s, "intern", ["observer"]);
    okOf(fx.service.createMission(s, createMissionInput()));
    await fx.service.runToCompletion(s, "mission-1", { now: now(1) });
    const actionId = "mission-1:action-0";

    // A role-less person cannot approve (kernel semantics, tenant-scoped).
    const refused = errOf(
      fx.kernel.actions.approveAction(s, {
        actionId,
        expectedState: "recommended",
        now: now(2),
        audit: { actor: personActor("intern"), at: now(2), reason: "attempted approval" },
      }),
    );
    expect(refused.code).toBe("forbidden");

    // The role-holding human approves and authorizes — outside the mission.
    okOf(
      fx.kernel.actions.approveAction(s, {
        actionId,
        expectedState: "recommended",
        now: now(3),
        audit: { actor: personActor("boss"), at: now(3), reason: "approved by owner" },
      }),
    );
    const authorized = okOf(
      fx.kernel.actions.authorizeAction(s, {
        actionId,
        expectedState: "approved",
        now: now(4),
        audit: { actor: personActor("boss"), at: now(4), reason: "authorized" },
      }),
    );
    expect(authorized.state).toBe("authorized");
  });

  it("an externally advanced action is not re-driven by a later mission replay", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    seedPersonWithRoles(fx.kernel, s, "boss", ["approver", "authorizer"]);
    okOf(fx.service.createMission(s, createMissionInput()));
    // Run 5 stages: the gate has NOT run yet (journal length 4 -> gate next).
    for (let index = 0; index < 4; index += 1) {
      okOf(await fx.service.advance(s, "mission-1", { now: now(index + 1) }));
    }
    // A human approves + authorizes the deterministic action id first.
    okOf(
      fx.kernel.actions.proposeAction(s, {
        actionId: "mission-1:action-0",
        title: "Automate ACME invoice intake ",
        subject: { kind: "topic", id: "invoices" },
        policy: {
          approvalRoles: ["approver"],
          authorizationRoles: ["authorizer"],
          employmentImpacting: false,
        },
        createdBy: personActor("boss"),
        now: now(5),
      }),
    );
    okOf(
      fx.kernel.actions.recommendAction(s, {
        actionId: "mission-1:action-0",
        expectedState: "proposed",
        now: now(6),
        audit: { actor: personActor("boss"), at: now(6), reason: "human pre-recommend" },
      }),
    );
    okOf(
      fx.kernel.actions.approveAction(s, {
        actionId: "mission-1:action-0",
        expectedState: "recommended",
        now: now(7),
        audit: { actor: personActor("boss"), at: now(7), reason: "human approved" },
      }),
    );
    // The mission's gate stage observes the advanced state and never pulls back.
    const mission = okOf(await fx.service.advance(s, "mission-1", { now: now(8) }));
    const gate = mission.stages[4];
    if (gate?.stage !== "gate") throw new Error("expected gate record");
    expect(gate.gated[0]?.finalState).toBe("approved");
    const action = okOf(fx.kernel.actions.getAction(s, "mission-1:action-0"));
    expect(action.stateHistory.map((entry) => entry.to)).toEqual([
      "proposed",
      "recommended",
      "approved",
    ]);
  });

  it("a gate refusal is typed and the mission stays resumable at the gate", async () => {
    const kernel = createDomainKernel();
    const seams = createKernelCognitionSeams(kernel);
    let refuse = true;
    const gate: MissionAuthorityGate = {
      proposeAction: (scopeArg, input) => {
        if (refuse) return { ok: false, error: missionAuthorityRefused("policy refusal") };
        return seams.gate.proposeAction(scopeArg, input);
      },
      recommendAction: (scopeArg, input) => seams.gate.recommendAction(scopeArg, input),
      getAction: (scopeArg, actionId) => seams.gate.getAction(scopeArg, actionId),
    };
    const service = createCognitionService({
      reads: seams.reads,
      knowledge: seams.knowledge,
      gate,
      model: createScriptedReasoner([standardContent()]),
      missions: createInMemoryMissionStore(),
      proposalPolicy: { approvalRoles: ["approver"], authorizationRoles: ["authorizer"] },
    });
    const s = scope("t1");
    seedObservation(kernel, s, { observationId: "obs-1" });
    seedObservation(kernel, s, { observationId: "obs-2" });
    okOf(service.createMission(s, createMissionInput()));
    for (let index = 0; index < 4; index += 1) {
      okOf(await service.advance(s, "mission-1", { now: now(index + 1) }));
    }
    const error = errOf(await service.advance(s, "mission-1", { now: now(5) }));
    expect(error.code).toBe("mission-authority-refused");
    expect(error.message).toContain("policy refusal");
    const missionAfter = okOf(service.getMission(s, "mission-1"));
    expect(missionAfter.stages.length).toBe(4);
    expect(missionAfter.status).toBe("running");
    // Recovery: the refusal is lifted and the same stage re-runs cleanly.
    refuse = false;
    const mission = okOf(await service.runToCompletion(s, "mission-1", { now: now(9) }));
    expect(mission.status).toBe("complete");
    const action = okOf(kernel.actions.getAction(s, "mission-1:action-0"));
    expect(action.state).toBe("recommended");
  });

  it("zero proposals produce zero action records (empty gate stage)", async () => {
    const fx = cognitionFixture([{ ...standardContent(), proposals: Object.freeze([]) }]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    const gate = mission.stages[4];
    if (gate?.stage !== "gate") throw new Error("expected gate record");
    expect(gate.gated).toEqual([]);
    expect(fx.kernel.actions.listActions(s)).toEqual([]);
  });

  it("proposal subjects default to the mission subject and honor explicit ones", async () => {
    const explicit = {
      ...standardContent({ proposals: 1 }),
      proposals: Object.freeze([
        Object.freeze({
          kind: "ask" as const,
          title: "Ask the supplier owner",
          rationale: "Confirm the batching hypothesis",
          subject: { kind: "person", id: "p-supplier" },
        }),
      ]),
    };
    const fx = cognitionFixture([explicit]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    await fx.service.runToCompletion(s, "mission-1", { now: now(1) });
    const action = okOf(fx.kernel.actions.getAction(s, "mission-1:action-0"));
    expect(action.subject).toEqual({ kind: "person", id: "p-supplier" });
  });
});
