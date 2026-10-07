/**
 * Goals: creation, append-only revision semantics, validation and the pure
 * metric evaluator.
 */
import { describe, expect, it } from "vitest";
import { evaluateGoalMetric } from "../src/index.js";
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

function goalContent(overrides: Record<string, unknown> = {}) {
  return {
    objective: "increase delivery reliability",
    desiredState: "95% on-time deliveries",
    horizonStart: now(0),
    horizonEnd: now(90 * 24 * 3600),
    ownerId: "p-1",
    ownerLabels: ["employee"],
    priority: "high",
    metrics: [
      { name: "on-time rate", unit: "%", target: 95, threshold: 85, direction: "at-least" },
      { name: "escalations", target: 0, threshold: 10, direction: "at-most" },
    ],
    expectedEvidence: [
      {
        description: "weekly delivery report",
        subject: { kind: "topic" as const, id: "delivery" },
      },
    ],
    successCriteria: [{ description: "quarter closes at or above target", metric: "on-time rate" }],
    provenance: provenance(systemActor("seed")),
    now: now(0),
    audit: auditInput(personActor("p-1"), "goal created"),
    ...overrides,
  };
}

describe("goals", () => {
  it("creates a goal with revision 1 carrying the full vocabulary", () => {
    const k = kernel();
    const s = scope("acme");
    const goal = okOf(k.goals.createGoal(s, { goalId: "g-1", ...goalContent() }));
    const r1 = goal.revisions[0];
    expect(goal.currentRevision).toBe(1);
    expect(r1?.objective).toBe("increase delivery reliability");
    expect(r1?.desiredState).toBe("95% on-time deliveries");
    expect(r1?.metrics).toHaveLength(2);
    expect(r1?.horizonStart).toBe(now(0));
    expect(r1?.horizonEnd).toBe(now(90 * 24 * 3600));
    expect(r1?.owner.personId).toBe("p-1" as never);
    expect(r1?.priority).toBe("high");
    expect(r1?.expectedEvidence[0]?.subject.kind).toBe("topic");
    expect(r1?.successCriteria[0]?.metric).toBe("on-time rate");
    expect(r1?.provenance.actor.kind).toBe("system");
  });

  it("validates the goal vocabulary (priority, horizon, owner, metrics)", () => {
    const k = kernel();
    const s = scope("acme");
    const badPriority = k.goals.createGoal(s, {
      goalId: "g-1",
      ...goalContent({ priority: "urgent" }),
    });
    expect(errOf(badPriority).code).toBe("validation");
    expect(errOf(badPriority).issues.map((i) => i.field)).toContain("priority");

    const invertedHorizon = k.goals.createGoal(s, {
      goalId: "g-1",
      ...goalContent({ horizonStart: now(10), horizonEnd: now(5) }),
    });
    expect(errOf(invertedHorizon).code).toBe("validation");

    const emptyObjective = k.goals.createGoal(s, {
      goalId: "g-1",
      ...goalContent({ objective: "  " }),
    });
    expect(errOf(emptyObjective).code).toBe("validation");

    const badDirection = k.goals.createGoal(s, {
      goalId: "g-1",
      ...goalContent({ metrics: [{ name: "x", target: 1, threshold: 2, direction: "sideways" }] }),
    });
    expect(errOf(badDirection).issues.map((i) => i.field)).toContain("metrics.0.direction");

    const noOwnerLabels = k.goals.createGoal(s, {
      goalId: "g-1",
      ...goalContent({ ownerLabels: [] }),
    });
    expect(errOf(noOwnerLabels).issues.map((i) => i.field)).toContain("ownerLabels");
  });

  it("cannot create the same goal id twice; cannot revise an unknown goal", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(k.goals.createGoal(s, { goalId: "g-1", ...goalContent() }));
    const duplicate = k.goals.createGoal(s, { goalId: "g-1", ...goalContent() });
    expect(errOf(duplicate).code).toBe("conflict");

    const unknown = k.goals.reviseGoal(s, { goalId: "nope", ...goalContent() });
    expect(errOf(unknown).code).toBe("not-found");
  });

  it("listGoals filters by current revision priority", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(k.goals.createGoal(s, { goalId: "g-1", ...goalContent() }));
    okOf(
      k.goals.createGoal(s, {
        goalId: "g-2",
        ...goalContent({ priority: "critical" }),
      }),
    );
    expect(k.goals.listGoals(s)).toHaveLength(2);
    const critical = k.goals.listGoals(s, { priority: "critical" });
    expect(critical).toHaveLength(1);
    expect(critical[0]?.goalId).toBe("g-2" as never);
  });

  it("evaluateGoalMetric evaluates both directions with thresholds", () => {
    const atLeast = { name: "on-time", target: 95, threshold: 85, direction: "at-least" } as const;
    expect(evaluateGoalMetric(atLeast, 96)).toBe("met");
    expect(evaluateGoalMetric(atLeast, 95)).toBe("met");
    expect(evaluateGoalMetric(atLeast, 90)).toBe("in-progress");
    expect(evaluateGoalMetric(atLeast, 85)).toBe("threshold-breached");
    expect(evaluateGoalMetric(atLeast, 80)).toBe("threshold-breached");

    const atMost = { name: "escalations", target: 0, threshold: 10, direction: "at-most" } as const;
    expect(evaluateGoalMetric(atMost, 0)).toBe("met");
    expect(evaluateGoalMetric(atMost, 5)).toBe("in-progress");
    expect(evaluateGoalMetric(atMost, 10)).toBe("threshold-breached");
  });
});
