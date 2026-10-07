/**
 * ACCEPTANCE PROOF — immutable / versioned records.
 *
 * - Revision histories (goals, beliefs, memory) are append-only: captured
 *   older record objects remain byte-identical after later revisions.
 * - All records handed out by the kernel are deep-frozen: mutation throws.
 * - Contradictions are retained even after resolution (see also
 *   epistemics.test.ts) and lifecycle histories (hypotheses, actions) only
 *   ever append.
 */
import { describe, expect, it } from "vitest";
import {
  auditInput,
  errOf,
  kernel,
  now,
  okOf,
  personActor,
  provenance,
  scope,
  systemActor,
} from "./helpers.js";

describe("immutable, versioned records", () => {
  it("goal revisions are append-only and the old revision object never changes", () => {
    const k = kernel();
    const s = scope("acme");
    const created = okOf(
      k.goals.createGoal(s, {
        goalId: "g-1",
        objective: "v1 objective",
        desiredState: "v1 state",
        horizonStart: now(),
        horizonEnd: now(1000),
        ownerId: "p-1",
        ownerLabels: ["employee"],
        priority: "high",
        metrics: [{ name: "revenue", target: 100, threshold: 10, direction: "at-least" }],
        provenance: provenance(systemActor("seed")),
        now: now(0),
        audit: auditInput(personActor("p-1"), "create"),
      }),
    );
    expect(created.currentRevision).toBe(1);
    expect(created.revisions).toHaveLength(1);

    const revised = okOf(
      k.goals.reviseGoal(s, {
        goalId: "g-1",
        objective: "v2 objective",
        desiredState: "v2 state",
        horizonStart: now(),
        horizonEnd: now(2000),
        ownerId: "p-1",
        ownerLabels: ["employee"],
        priority: "critical",
        provenance: provenance(systemActor("seed")),
        now: now(10),
        audit: auditInput(personActor("p-1"), "revise"),
      }),
    );

    expect(revised.currentRevision).toBe(2);
    expect(revised.revisions).toHaveLength(2);
    expect(revised.revisions[0]?.revisionNumber).toBe(1);
    expect(revised.revisions[1]?.revisionNumber).toBe(2);

    // The previously returned record object is untouched.
    expect(created.currentRevision).toBe(1);
    expect(created.revisions).toHaveLength(1);
    expect(created.revisions[0]?.objective).toBe("v1 objective");
    // And the revision inside the new record is a distinct, unchanged value.
    expect(revised.revisions[0]?.objective).toBe("v1 objective");

    // Old revision is still retrievable.
    const v1 = okOf(k.goals.getGoalRevision(s, "g-1", 1));
    expect(v1.objective).toBe("v1 objective");
    // Unknown revision numbers are explicit not-founds.
    expect(errOf(k.goals.getGoalRevision(s, "g-1", 3)).code).toBe("not-found");
  });

  it("belief revisions are append-only; supporting claims retained per revision", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.evidence.recordObservation(s, {
        observationId: "o-1",
        subject: { kind: "topic", id: "t" },
        content: "observed",
        observedAt: now(),
        provenance: provenance(systemActor("seed")),
      }),
    );
    okOf(
      k.evidence.recordObservation(s, {
        observationId: "o-2",
        subject: { kind: "topic", id: "t" },
        content: "observed more",
        observedAt: now(),
        provenance: provenance(systemActor("seed")),
      }),
    );
    okOf(
      k.epistemics.registerClaim(s, {
        claimId: "c-1",
        statement: "first claim",
        derivedFrom: ["o-1"],
        provenance: provenance(systemActor("seed")),
      }),
    );
    okOf(
      k.epistemics.registerClaim(s, {
        claimId: "c-2",
        statement: "second claim",
        derivedFrom: ["o-2"],
        provenance: provenance(systemActor("seed")),
      }),
    );

    const r1 = okOf(
      k.epistemics.reviseBelief(s, {
        beliefId: "b-1",
        subject: { kind: "topic", id: "t" },
        statement: "understanding v1",
        supportingClaimIds: ["c-1"],
        provenance: provenance(systemActor("seed")),
        now: now(0),
        audit: auditInput(personActor("p-1"), "initial understanding"),
      }),
    );
    const r2 = okOf(
      k.epistemics.reviseBelief(s, {
        beliefId: "b-1",
        subject: { kind: "topic", id: "t" },
        statement: "understanding v2",
        supportingClaimIds: ["c-1", "c-2"],
        provenance: provenance(systemActor("seed")),
        now: now(5),
        audit: auditInput(personActor("p-1"), "updated understanding"),
      }),
    );

    expect(r2.currentRevision).toBe(2);
    expect(r2.revisions).toHaveLength(2);
    expect(r1.currentRevision).toBe(1);
    expect(r1.revisions[0]?.supportingClaimIds).toEqual(["c-1"]);
    expect(r2.revisions[0]?.statement).toBe("understanding v1");
    expect(r2.revisions[1]?.supportingClaimIds).toEqual(["c-1", "c-2"]);
  });

  it("memory versions are append-only with per-version provenance", () => {
    const k = kernel();
    const s = scope("acme");
    const m1 = okOf(
      k.memory.recordMemory(s, {
        memoryId: "m-1",
        subject: { kind: "topic", id: "t" },
        content: "knowledge v1",
        provenance: provenance(systemActor("seed")),
        now: now(0),
        audit: auditInput(personActor("p-1"), "record"),
      }),
    );
    const m2 = okOf(
      k.memory.reviseMemory(s, {
        memoryId: "m-1",
        content: "knowledge v2",
        provenance: provenance(systemActor("seed"), 5),
        now: now(5),
        audit: auditInput(personActor("p-1"), "revise", 5),
      }),
    );
    expect(m2.currentVersion).toBe(2);
    expect(m2.versions).toHaveLength(2);
    expect(m1.versions[0]?.content).toBe("knowledge v1");
    expect(m2.versions[0]?.content).toBe("knowledge v1");
    expect(m2.versions[1]?.provenance.recordedAt).toBe(now(5));
  });

  it("records are deep-frozen: mutation attempts throw", () => {
    const k = kernel();
    const s = scope("acme");
    const goal = okOf(
      k.goals.createGoal(s, {
        goalId: "g-1",
        objective: "o",
        desiredState: "d",
        horizonStart: now(),
        horizonEnd: now(1000),
        ownerId: "p-1",
        ownerLabels: ["employee"],
        priority: "high",
        provenance: provenance(systemActor("seed")),
        now: now(),
        audit: auditInput(personActor("p-1"), "create"),
      }),
    );
    expect(Object.isFrozen(goal)).toBe(true);
    expect(Object.isFrozen(goal.revisions)).toBe(true);
    expect(Object.isFrozen(goal.revisions[0])).toBe(true);
    expect(Object.isFrozen(goal.revisions[0]?.metrics)).toBe(true);
    expect(() => {
      (goal as unknown as { currentRevision: number }).currentRevision = 99;
    }).toThrow(TypeError);
    expect(() => {
      (goal.revisions as unknown as { push: (x: unknown) => void }).push(null);
    }).toThrow(TypeError);
  });

  it("action state history is append-only across the full lifecycle", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.identity.registerPerson(s, {
        personId: "boss",
        displayName: "Boss",
        labels: ["manager"],
        provenance: systemActor("seed"),
        now: now(),
      }),
    );
    okOf(
      k.identity.grantMembership(s, {
        membershipId: "m-1",
        personId: "boss",
        organizationId: "org-1",
        roles: ["approver", "authorizer"],
        grantedBy: personActor("boss"),
        now: now(),
        audit: auditInput(personActor("boss"), "grant"),
      }),
    );
    okOf(
      k.actions.proposeAction(s, {
        actionId: "a-1",
        title: "t",
        subject: { kind: "topic", id: "x" },
        policy: {
          approvalRoles: ["approver"],
          authorizationRoles: ["authorizer"],
          employmentImpacting: false,
        },
        createdBy: systemActor("lab"),
        now: now(0),
      }),
    );
    okOf(
      k.actions.recommendAction(s, {
        actionId: "a-1",
        expectedState: "proposed",
        now: now(1),
        audit: auditInput(systemActor("lab"), "r"),
      }),
    );
    okOf(
      k.actions.approveAction(s, {
        actionId: "a-1",
        expectedState: "recommended",
        now: now(2),
        audit: auditInput(personActor("boss"), "a"),
      }),
    );
    okOf(
      k.actions.authorizeAction(s, {
        actionId: "a-1",
        expectedState: "approved",
        now: now(3),
        audit: auditInput(personActor("boss"), "u"),
      }),
    );
    const executed = okOf(
      k.actions.recordExecution(s, {
        actionId: "a-1",
        expectedState: "authorized",
        now: now(4),
        audit: auditInput(personActor("boss"), "x"),
        outcome: "done",
      }),
    );
    expect(executed.stateHistory.map((entry) => entry.to)).toEqual([
      "proposed",
      "recommended",
      "approved",
      "authorized",
      "executed",
    ]);
    // History entries carry who/when/why.
    expect(executed.stateHistory[1]?.actor.kind).toBe("system");
    expect(executed.stateHistory[2]?.reason).toBe("a");
  });

  it("hypothesis status history is append-only and terminal states stick", () => {
    const k = kernel();
    const s = scope("acme");
    const opened = okOf(
      k.inquiry.openHypothesis(s, {
        hypothesisId: "h-1",
        statement: "maybe x",
        explains: [{ kind: "topic", id: "t" }],
        provenance: provenance(systemActor("seed")),
        now: now(0),
      }),
    );
    const supported = okOf(
      k.inquiry.recordHypothesisStatus(s, {
        hypothesisId: "h-1",
        status: "supported",
        provenance: provenance(systemActor("seed")),
        now: now(5),
        audit: auditInput(personActor("p-1"), "supported by new claim"),
      }),
    );
    expect(opened.statusHistory).toHaveLength(1);
    expect(supported.status).toBe("supported");
    expect(supported.statusHistory).toHaveLength(2);
    expect(supported.statusHistory[0]?.status).toBe("open");
    // Retired is reachable from supported, then terminal.
    const retired = okOf(
      k.inquiry.recordHypothesisStatus(s, {
        hypothesisId: "h-1",
        status: "retired",
        provenance: provenance(systemActor("seed")),
        now: now(10),
        audit: auditInput(personActor("p-1"), "obsolete"),
      }),
    );
    expect(retired.statusHistory).toHaveLength(3);
    const resurrect = k.inquiry.recordHypothesisStatus(s, {
      hypothesisId: "h-1",
      status: "supported",
      provenance: provenance(systemActor("seed")),
      now: now(20),
      audit: auditInput(personActor("p-1"), "attempt to resurrect"),
    });
    expect(errOf(resurrect).code).toBe("invariant");
  });
});
