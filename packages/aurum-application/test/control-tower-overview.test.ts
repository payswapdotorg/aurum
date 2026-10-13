/**
 * W010 acceptance proofs — the OVERVIEW projection.
 *
 * Catalog clause mapping:
 * - "UI never becomes company truth" (clause 3): every assertion below
 *   derives from REAL kernel records (goal ledger, evidence ledger, action
 *   authority, candidate registry) read through the four area services —
 *   the overview is a pure function of them;
 * - tenant scoping: cross-tenant tower reads fail closed / stay empty.
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
import { seedMixedPool } from "./helpers.js";

describe("control tower overview: derived from real kernel records", () => {
  it("goal cards carry the goal ledger's own fields plus child plan/mission ids", async () => {
    const { runtime, tower } = towerFixture();
    const s = scope("acme");
    seedTowerGoal(runtime, s);
    seedObservation(runtime, s, "obs-1");
    seedObservation(runtime, s, "obs-2");
    seedTowerCandidate(runtime, s);

    const mission = okOf(
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
    expect(mission.status).toBe("pending");
    okOf(await tower.runMissionToCompletion(s, "mission-1", { now: 1_700_000_000_002 }));

    okOf(tower.plans.createPlan(s, towerPlanInput("cand-1")));
    okOf(
      tower.submitPlanForApproval(s, {
        planId: "plan-1",
        actor: personActor("p-1"),
        reason: "ready for review",
        now: 1_700_000_000_010,
      }),
    );

    const overview = okOf(tower.overview(s, towerRead(60)));
    expect(overview.goals).toHaveLength(1);
    const card = overview.goals[0];
    expect(card?.goalId).toBe("goal-1");
    expect(card?.objective).toBe("Cut invoice processing cycle time");
    expect(card?.priority).toBe("high");
    expect(card?.horizonState).toBe("active");
    expect(card?.ownerPersonId).toBe("boss");
    expect(card?.planIds).toEqual(["plan-1"]);
    expect(card?.missionIds).toEqual(["mission-1"]);
    // The mission's propose stage raised no gap unknowns; the goal's own
    // unknown count comes from the inquiry ledger (zero seeded).
    expect(card?.openUnknowns).toBe(0);
  });

  it("an empty tenant gets an honest empty board (no fabricated cards)", () => {
    const { tower } = towerFixture();
    const s = scope("ghost");
    const overview = okOf(tower.overview(s, towerRead()));
    expect(overview.goals).toEqual([]);
    expect(overview.missions).toEqual([]);
    expect(overview.plans).toEqual([]);
    expect(overview.lab.evaluations).toEqual([]);
    expect(overview.pendingApprovals).toEqual([]);
    expect(overview.situation.totals).toEqual({ goals: 0, openUnknowns: 0, openContradictions: 0 });
    expect(overview.attention.attention).toEqual([]);
  });

  it("mission cards count the journal (stages completed of total)", async () => {
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

    const afterOne = okOf(tower.overview(s, towerRead(10)));
    expect(afterOne.missions).toHaveLength(1);
    expect(afterOne.missions[0]?.status).toBe("running");
    expect(afterOne.missions[0]?.stagesCompleted).toBe(1);
    expect(afterOne.missions[0]?.totalStages).toBe(6);

    okOf(await tower.runMissionToCompletion(s, "mission-1", { now: 1_700_000_000_005 }));
    const afterAll = okOf(tower.overview(s, towerRead(20)));
    expect(afterAll.missions[0]?.status).toBe("complete");
    expect(afterAll.missions[0]?.stagesCompleted).toBe(6);
  });

  it("plan cards show task counts; readiness appears only for active plans", () => {
    const { runtime, tower } = towerFixture();
    const s = scope("acme");
    seedTowerGoal(runtime, s);
    seedTowerCandidate(runtime, s);
    const actionId = seedApprovedAction(runtime, s);

    okOf(tower.plans.createPlan(s, towerPlanInput("cand-1")));
    okOf(
      tower.submitPlanForApproval(s, {
        planId: "plan-1",
        actor: personActor("p-1"),
        reason: "submit",
        now: 1_700_000_000_010,
      }),
    );

    const draftBoard = okOf(tower.overview(s, towerRead(20)));
    const draftCard = draftBoard.plans[0];
    expect(draftCard?.approvalState).toBe("submitted");
    expect(draftCard?.lifecycleState).toBe("inactive");
    expect(draftCard?.taskCount).toBe(2);
    expect(draftCard?.readyTaskCount).toBeUndefined();
    expect(draftCard?.escalationCount).toBeUndefined();

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

    const activeBoard = okOf(tower.overview(s, towerRead(30)));
    const activeCard = activeBoard.plans[0];
    expect(activeCard?.lifecycleState).toBe("active");
    expect(activeCard?.readyTaskCount).toBe(2);
    expect(activeCard?.escalationCount).toBe(0);
  });

  it("the lab panel summarizes real evaluation records (top candidate + score)", () => {
    const { runtime, tower } = towerFixture();
    const s = scope("acme");
    seedTowerGoal(runtime, s);
    seedMixedPool(runtime.kernel, s);
    const fingerprint = okOf(
      runtime.lab.fingerprintSituation(s, { goalId: "goal-1", now: 1_700_000_000_020 }),
    ).fingerprint;
    const search = okOf(
      runtime.lab.searchOrganizations(s, {
        goalId: "goal-1",
        fingerprint,
        proposedBy: personActor("boss"),
        provenance: { actor: personActor("boss"), source: "human-entered", recordedAt: 1_700_000_000_000 },
        now: 1_700_000_000_020,
      }),
    );
    const evaluation = okOf(
      runtime.lab.evaluateOrganizations(s, {
        fingerprint,
        candidates: search.ranked.map((entry) => entry.candidate),
        now: 1_700_000_000_025,
      }),
    );

    const overview = okOf(tower.overview(s, towerRead(40)));
    expect(overview.lab.evaluations).toHaveLength(1);
    const summary = overview.lab.evaluations[0];
    expect(summary?.evaluationId).toBe(evaluation.evaluationId);
    expect(summary?.goalId).toBe("goal-1");
    expect(summary?.rankedCount).toBe(search.ranked.length);
    expect(summary?.topCandidateId).toBe(search.ranked[0]?.candidate.candidateId);
    expect(summary?.topScore).toBe(search.ranked[0]?.score.weightedScore);
  });

  it("pending approvals: mission gate recommendations + submitted plans (and nothing else)", async () => {
    const { runtime, tower } = towerFixture([standardContent({ proposals: 2 })]);
    const s = scope("acme");
    seedTowerGoal(runtime, s);
    seedObservation(runtime, s, "obs-1");
    seedObservation(runtime, s, "obs-2");
    seedTowerCandidate(runtime, s);

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

    okOf(tower.plans.createPlan(s, towerPlanInput("cand-1")));
    okOf(
      tower.submitPlanForApproval(s, {
        planId: "plan-1",
        actor: personActor("p-1"),
        reason: "submit",
        now: 1_700_000_000_010,
      }),
    );

    const overview = okOf(tower.overview(s, towerRead(30)));
    const missionActions = overview.pendingApprovals.filter((item) => item.kind === "mission-action");
    const planItems = overview.pendingApprovals.filter((item) => item.kind === "plan");
    // Two model proposals crossed the gate and stopped at `recommended`.
    expect(missionActions).toHaveLength(2);
    for (const item of missionActions) {
      expect(item.sourceId).toBe("mission-1");
      expect(item.actionId).toMatch(/^action-/);
      expect(item.title).toContain("Automate ACME invoice intake");
    }
    expect(planItems).toHaveLength(1);
    expect(planItems[0]?.sourceId).toBe("plan-1");
  });

  it("tenant isolation: another tenant's board is empty and its threads fail closed", async () => {
    const { runtime, tower } = towerFixture();
    const acme = scope("acme");
    const rival = scope("rival");
    seedTowerGoal(runtime, acme);
    seedObservation(runtime, acme, "obs-1");
    seedObservation(runtime, acme, "obs-2");

    okOf(
      tower.createMission(acme, {
        missionId: "mission-1",
        subject: { kind: "topic", id: "invoices" },
        question: "Why is invoice processing slow?",
        consequence: "SLA breaches accumulate",
        createdBy: personActor("p-1"),
        now: 1_700_000_000_000,
      }),
    );

    const rivalBoard = okOf(tower.overview(rival, towerRead()));
    expect(rivalBoard.goals).toEqual([]);
    expect(rivalBoard.missions).toEqual([]);

    const crossRead = tower.conversation(rival, { kind: "mission", missionId: "mission-1" });
    expect(crossRead.ok).toBe(false);
    if (!crossRead.ok) {
      // Uniform not-found carried in the cognition tag — no existence leak.
      expect(crossRead.error.kind).toBe("cognition");
    }
  });

  it("read validation: the tower rejects malformed board inputs itself", () => {
    const { tower } = towerFixture();
    const s = scope("acme");
    const bad = tower.overview(s, {
      now: -1,
      askedBy: { kind: "mystery" } as never,
      reason: "",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.kind).toBe("tower-validation");
      if (bad.error.kind === "tower-validation") {
        expect(bad.error.issues.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("the situation/attention/unknowns panels pass the company reports through verbatim", () => {
    const { runtime, tower } = towerFixture();
    const s = scope("acme");
    seedTowerGoal(runtime, s);
    const read = towerRead(45);
    const situation = okOf(runtime.company.situation(s, read));
    const overview = okOf(tower.overview(s, read));
    expect(overview.situation).toBe(situation);
    expect(overview.asOf).toBe(read.now);
  });
});
