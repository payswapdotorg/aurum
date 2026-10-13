/**
 * W010 acceptance proofs — the CONVERSATION projection.
 *
 * Catalog clause mapping:
 * - "UI never becomes company truth" (clause 3): every turn below derives
 *   from REAL mission/plan records — the thread is a read over the records'
 *   own journals, and the turn order/kind/role mirrors the journal exactly;
 * - the bounded-content law: the reason turn renders the model's bounded
 *   content summary VERBATIM (the tower never rephrases model output).
 */
import { describe, expect, it } from "vitest";
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
import { standardContent } from "./cognition-helpers.js";

describe("control tower conversation: threads over real records", () => {
  it("a mission thread mirrors the charter + stage journal exactly (turn for turn)", async () => {
    const { runtime, tower } = towerFixture();
    const s = scope("acme");
    seedTowerGoal(runtime, s);
    seedObservation(runtime, s, "obs-1");
    seedObservation(runtime, s, "obs-2");

    okOf(
      tower.createMission(s, {
        missionId: "mission-1",
        subject: { kind: "topic", id: "invoices" },
        question: "Why is invoice processing slow?",
        consequence: "SLA breaches accumulate",
        goalId: "goal-1",
        createdBy: personActor("p-1"),
        now: 1_700_000_000_000,
      }),
    );
    okOf(await tower.runMissionToCompletion(s, "mission-1", { now: 1_700_000_000_006 }));

    const thread = okOf(tower.conversation(s, { kind: "mission", missionId: "mission-1" }));
    expect(thread.topic).toEqual({ kind: "mission", missionId: "mission-1" });
    expect(thread.title).toBe("Why is invoice processing slow?");
    expect(thread.status).toBe("complete");

    // The record's own journal: charter + the six ordered stages — the thread
    // has exactly one turn per journal entry, in journal order.
    const mission = okOf(runtime.cognition.getMission(s, "mission-1"));
    expect(thread.turns).toHaveLength(1 + mission.stages.length);
    expect(thread.turns.map((turn) => turn.kind)).toEqual([
      "mission-charter",
      "mission-orient",
      "mission-reason",
      "mission-evaluate",
      "mission-propose",
      "mission-gate",
      "mission-record",
    ]);
    expect(thread.turns.map((turn) => turn.role)).toEqual([
      "human",
      "system",
      "model",
      "system",
      "system",
      "system",
      "system",
    ]);

    // Every turn is journal-derived: same timestamps, same actors, cited by
    // the record's own ids.
    const [charter, , reason, , , gate] = thread.turns;
    expect(charter?.at).toBe(mission.createdAt);
    expect(charter?.actor).toEqual(mission.createdBy);
    expect(charter?.citations).toEqual(["mission-1"]);
    const reasonStage = mission.stages[1];
    if (reasonStage?.stage !== "reason") throw new Error("expected reason stage");
    expect(reason?.at).toBe(reasonStage.at);
    // The reason turn's title is the model's bounded summary VERBATIM.
    expect(reason?.title).toBe(reasonStage.content.summary);
    expect(reason?.title).toBe(
      "Invoice processing latency correlates with supplier ACME's batch size.",
    );
    const gateStage = mission.stages[4];
    if (gateStage?.stage !== "gate") throw new Error("expected gate stage");
    expect(gate?.awaitsHuman).toBe(true);
    expect(gate?.citations).toEqual([
      "mission-mission-1#stage-4",
      ...gateStage.gated.map((entry) => entry.actionId),
    ]);
  });

  it("the gate turn awaits a human only while gated actions sit at `recommended`", async () => {
    const { runtime, tower } = towerFixture([standardContent({ proposals: 0 })]);
    const s = scope("acme");
    seedTowerGoal(runtime, s);
    seedObservation(runtime, s, "obs-1");
    seedObservation(runtime, s, "obs-2");

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
    okOf(await tower.runMissionToCompletion(s, "mission-1", { now: 1_700_000_000_006 }));

    const thread = okOf(tower.conversation(s, { kind: "mission", missionId: "mission-1" }));
    // No proposals crossed the gate: nothing awaits a human anywhere in the
    // thread, and the thread surfaces no pending approvals.
    expect(thread.turns.every((turn) => turn.awaitsHuman)).toBe(false);
    expect(thread.pendingApprovals).toEqual([]);
    const gate = thread.turns.find((turn) => turn.kind === "mission-gate");
    expect(gate?.awaitsHuman).toBe(false);
  });

  it("the mission thread's pending approvals are the gate's recommended actions", async () => {
    const { runtime, tower } = towerFixture([standardContent({ proposals: 2 })]);
    const s = scope("acme");
    seedTowerGoal(runtime, s);
    seedObservation(runtime, s, "obs-1");
    seedObservation(runtime, s, "obs-2");

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
    okOf(await tower.runMissionToCompletion(s, "mission-1", { now: 1_700_000_000_006 }));

    const thread = okOf(tower.conversation(s, { kind: "mission", missionId: "mission-1" }));
    expect(thread.pendingApprovals).toHaveLength(2);
    for (const item of thread.pendingApprovals) {
      expect(item.kind).toBe("mission-action");
      expect(item.sourceId).toBe("mission-1");
    }
    // Same items the overview board shows for this mission (one derivation).
    const board = okOf(tower.overview(s, towerRead(30)));
    const boardMissionItems = board.pendingApprovals.filter(
      (item) => item.kind === "mission-action" && item.sourceId === "mission-1",
    );
    expect(thread.pendingApprovals).toEqual(boardMissionItems);
  });

  it("a cancelled mission's thread appends the human cancellation turn", async () => {
    const { runtime, tower } = towerFixture();
    const s = scope("acme");
    seedTowerGoal(runtime, s);
    seedObservation(runtime, s, "obs-1");
    seedObservation(runtime, s, "obs-2");

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
    okOf(
      tower.cancelMission(s, "mission-1", {
        actor: personActor("p-1"),
        reason: "superseded by a direct fix",
        now: 1_700_000_000_003,
      }),
    );

    const thread = okOf(tower.conversation(s, { kind: "mission", missionId: "mission-1" }));
    expect(thread.status).toBe("cancelled");
    const last = thread.turns[thread.turns.length - 1];
    expect(last?.kind).toBe("mission-cancelled");
    expect(last?.role).toBe("human");
    expect(last?.detail).toBe("superseded by a direct fix");
    expect(last?.at).toBe(1_700_000_000_003);
  });

  it("a plan thread mirrors creation + approval history + lifecycle history", () => {
    const { runtime, tower } = towerFixture();
    const s = scope("acme");
    seedTowerGoal(runtime, s);
    seedTowerCandidate(runtime, s);
    const actionId = seedApprovedAction(runtime, s);

    okOf(runtime.plans.createPlan(s, towerPlanInput("cand-1")));
    okOf(
      tower.submitPlanForApproval(s, {
        planId: "plan-1",
        actor: personActor("p-1"),
        reason: "submit",
        now: 1_700_000_000_010,
      }),
    );

    // While submitted, the LAST approval turn awaits a human and the thread
    // carries exactly one pending approval item.
    const submitted = okOf(tower.conversation(s, { kind: "plan", planId: "plan-1" }));
    expect(submitted.status).toBe("submitted / active");
    expect(submitted.turns.map((turn) => turn.kind)).toEqual(["plan-created", "plan-approval"]);
    expect(submitted.turns[1]?.awaitsHuman).toBe(true);
    expect(submitted.pendingApprovals).toHaveLength(1);
    expect(submitted.pendingApprovals[0]?.kind).toBe("plan");

    okOf(
      tower.approvePlan(s, {
        planId: "plan-1",
        actor: personActor("p-1"),
        reason: "approved with cited authority",
        now: 1_700_000_000_020,
        humanDecision: { decidedBy: "p-1", decidedAt: 1_700_000_000_020 },
        citation: { actionId },
      }),
    );
    okOf(
      tower.activatePlan(s, {
        planId: "plan-1",
        actor: personActor("p-1"),
        reason: "kick off",
        now: 1_700_000_000_021,
        auditRef: "plan-audit-2",
      }),
    );

    // The record's own histories: one turn per immutable history entry.
    const plan = okOf(runtime.plans.getPlan(s, "plan-1"));
    const approved = okOf(tower.conversation(s, { kind: "plan", planId: "plan-1" }));
    expect(approved.turns.map((turn) => turn.kind)).toEqual([
      "plan-created",
      "plan-approval",
      "plan-approval",
      "plan-lifecycle",
    ]);
    expect(approved.turns).toHaveLength(
      1 + plan.approval.history.length + plan.lifecycleHistory.length,
    );
    expect(approved.turns.every((turn) => turn.awaitsHuman)).toBe(false);
    expect(approved.pendingApprovals).toEqual([]);

    // The approval turn cites the human's action citation verbatim.
    const citationTurn = approved.turns[2];
    expect(citationTurn?.citations).toEqual(["plan-plan-1#approval-1", actionId]);
    const lifecycleTurn = approved.turns[3];
    expect(lifecycleTurn?.citations).toEqual(["plan-plan-1#lifecycle-0", "plan-audit-2"]);
  });

  it("topic validation: the tower rejects malformed thread topics itself", () => {
    const { tower } = towerFixture();
    const s = scope("acme");
    const badKind = tower.conversation(s, { kind: "goal", goalId: "goal-1" } as never);
    expect(badKind.ok).toBe(false);
    if (!badKind.ok) {
      expect(badKind.error.kind).toBe("tower-validation");
    }
    const emptyId = tower.conversation(s, { kind: "mission", missionId: "  " });
    expect(emptyId.ok).toBe(false);
    if (!emptyId.ok) {
      expect(emptyId.error.kind).toBe("tower-validation");
      if (emptyId.error.kind === "tower-validation") {
        expect(emptyId.error.issues[0]?.field).toBe("topic.missionId");
      }
    }
  });

  it("unknown records surface the owning area's own not-found error (no existence leak)", () => {
    const { tower } = towerFixture();
    const s = scope("acme");
    const mission = tower.conversation(s, { kind: "mission", missionId: "nope" });
    expect(mission.ok).toBe(false);
    if (!mission.ok) {
      expect(mission.error.kind).toBe("cognition");
    }
    const plan = tower.conversation(s, { kind: "plan", planId: "nope" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.error.kind).toBe("plans");
    }
  });
});
