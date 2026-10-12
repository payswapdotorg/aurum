/**
 * W009 DAG construction + cycle rejection + topological order + critical
 * path + readiness (catalog clause 2: task dependency graph).
 *
 * All tests are over the pure domain layer (no IO, no ports).
 */
import { describe, expect, it } from "vitest";
import {
  buildTaskDag,
  criticalPath,
  detectCycle,
  downstreamOf,
  readyTasks,
  taskDagIssues,
  topologicalOrder,
  upstreamOf,
  type PlanTask,
} from "../src/index.js";
import { errOf, okOf, planTask } from "./plans-helpers.js";

describe("task DAG: cycle rejection (catalog clause 2)", () => {
  it("rejects a 2-task cycle with the offending path", () => {
    const tasks: PlanTask[] = [
      planTask("a", { dependsOn: ["b"] }),
      planTask("b", { dependsOn: ["a"] }),
    ];
    const result = buildTaskDag(tasks);
    const err = errOf(result);
    expect(err.code).toBe("plan-cycle");
    expect(err.cyclePath).toBeDefined();
    expect(err.cyclePath!.length).toBeGreaterThan(0);
  });

  it("rejects a 3-task cycle", () => {
    const tasks: PlanTask[] = [
      planTask("a", { dependsOn: ["c"] }),
      planTask("b", { dependsOn: ["a"] }),
      planTask("c", { dependsOn: ["b"] }),
    ];
    const result = buildTaskDag(tasks);
    expect(errOf(result).code).toBe("plan-cycle");
  });

  it("detectCycle returns null for a DAG with no cycles", () => {
    const tasks: PlanTask[] = [
      planTask("a"),
      planTask("b", { dependsOn: ["a"] }),
      planTask("c", { dependsOn: ["a", "b"] }),
    ];
    expect(detectCycle(tasks)).toBeNull();
  });

  it("detectCycle returns the cycle path for a 2-task cycle", () => {
    const tasks: PlanTask[] = [
      planTask("a", { dependsOn: ["b"] }),
      planTask("b", { dependsOn: ["a"] }),
    ];
    const path = detectCycle(tasks);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    // The cycle path must start and end at the same task id.
    expect(path![0]).toBe(path![path!.length - 1]);
  });
});

describe("task DAG: validation (catalog clause 2)", () => {
  it("rejects empty tasks array", () => {
    const issues = taskDagIssues([]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].field).toBe("tasks");
  });

  it("rejects duplicate task ids", () => {
    const issues = taskDagIssues([
      planTask("a"),
      planTask("a"),
    ]);
    expect(issues.some((i) => i.field.includes("taskId"))).toBe(true);
  });

  it("rejects dangling dependency references", () => {
    const issues = taskDagIssues([
      planTask("a", { dependsOn: ["nonexistent"] }),
    ]);
    expect(issues.some((i) => i.field.includes("dependsOn"))).toBe(true);
  });

  it("accepts a valid DAG", () => {
    const issues = taskDagIssues([
      planTask("a"),
      planTask("b", { dependsOn: ["a"] }),
    ]);
    expect(issues).toEqual([]);
  });
});

describe("task DAG: topological order (catalog clause 2)", () => {
  it("returns a single task as itself", () => {
    const tasks = [planTask("a")];
    expect([...topologicalOrder(tasks)]).toEqual(["a"]);
  });

  it("orders a linear chain correctly", () => {
    const tasks = [
      planTask("c", { dependsOn: ["b"] }),
      planTask("b", { dependsOn: ["a"] }),
      planTask("a"),
    ];
    const order = [...topologicalOrder(tasks)];
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("orders a diamond (b + c after a, d after b + c) with stable ordering", () => {
    const tasks = [
      planTask("d", { dependsOn: ["b", "c"] }),
      planTask("c", { dependsOn: ["a"] }),
      planTask("b", { dependsOn: ["a"] }),
      planTask("a"),
    ];
    const order = [...topologicalOrder(tasks)];
    expect(order[0]).toBe("a");
    expect(order.indexOf("b")).toBeGreaterThan(order.indexOf("a"));
    expect(order.indexOf("c")).toBeGreaterThan(order.indexOf("a"));
    expect(order.indexOf("d")).toBeGreaterThan(order.indexOf("b"));
    expect(order.indexOf("d")).toBeGreaterThan(order.indexOf("c"));
  });

  it("is deterministic: same input → same output", () => {
    const tasks = [
      planTask("c", { dependsOn: ["a", "b"] }),
      planTask("a"),
      planTask("b"),
    ];
    const o1 = [...topologicalOrder(tasks)];
    const o2 = [...topologicalOrder(tasks)];
    expect(o1).toEqual(o2);
  });
});

describe("task DAG: critical path (catalog clause 2)", () => {
  it("returns a single task as the critical path for a single-task DAG", () => {
    const tasks = [planTask("a")];
    expect([...criticalPath(tasks)]).toEqual(["a"]);
  });

  it("returns the longest chain for a linear DAG", () => {
    const tasks = [
      planTask("c", { dependsOn: ["b"] }),
      planTask("b", { dependsOn: ["a"] }),
      planTask("a"),
    ];
    expect([...criticalPath(tasks)]).toEqual(["a", "b", "c"]);
  });

  it("returns the longer branch when two branches of different lengths exist", () => {
    // a -> b -> c (length 3) and a -> d (length 2).
    const tasks = [
      planTask("c", { dependsOn: ["b"] }),
      planTask("b", { dependsOn: ["a"] }),
      planTask("d", { dependsOn: ["a"] }),
      planTask("a"),
    ];
    const path = [...criticalPath(tasks)];
    expect(path).toEqual(["a", "b", "c"]);
  });
});

describe("task DAG: readiness computation (catalog clause 2)", () => {
  it("a task with no dependencies + no consumed handoffs is ready", () => {
    const tasks = [planTask("a")];
    const dag = okOf(buildTaskDag(tasks));
    const ready = readyTasks(dag, new Map(), new Map());
    expect([...ready]).toEqual(["a"]);
  });

  it("a task whose dependency is not yet settled is NOT ready", () => {
    const tasks = [
      planTask("a"),
      planTask("b", { dependsOn: ["a"] }),
    ];
    const dag = okOf(buildTaskDag(tasks));
    // 'a' not yet complete.
    const ready = readyTasks(dag, new Map(), new Map());
    expect([...ready]).toEqual(["a"]);
  });

  it("a task whose dependency settled 'settled' IS ready", () => {
    const tasks = [
      planTask("a"),
      planTask("b", { dependsOn: ["a"] }),
    ];
    const dag = okOf(buildTaskDag(tasks));
    const completions = new Map([["a", { status: "settled" as const }]]);
    const ready = readyTasks(dag, completions, new Map());
    expect([...ready]).toEqual(["b"]);
  });

  it("a task whose dependency settled 'failed' is NOT ready", () => {
    const tasks = [
      planTask("a"),
      planTask("b", { dependsOn: ["a"] }),
    ];
    const dag = okOf(buildTaskDag(tasks));
    const completions = new Map([["a", { status: "failed" as const }]]);
    const ready = readyTasks(dag, completions, new Map());
    expect([...ready]).toEqual([]);
  });

  it("a task with un-delivered input handoffs is NOT ready", () => {
    const tasks = [
      planTask("a", { produces: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }] }),
      planTask("b", {
        dependsOn: ["a"],
        consumes: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
      }),
    ];
    const dag = okOf(buildTaskDag(tasks));
    const completions = new Map([["a", { status: "settled" as const }]]);
    // 'b' has not yet received h1.
    const ready = readyTasks(dag, completions, new Map());
    expect([...ready]).toEqual([]);
  });

  it("a task whose consumed handoffs are all delivered IS ready", () => {
    const tasks = [
      planTask("a", { produces: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }] }),
      planTask("b", {
        dependsOn: ["a"],
        consumes: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
      }),
    ];
    const dag = okOf(buildTaskDag(tasks));
    const completions = new Map([["a", { status: "settled" as const }]]);
    const delivered = new Map([["b", new Set(["h1"])]]);
    const ready = readyTasks(dag, completions, delivered);
    expect([...ready]).toEqual(["b"]);
  });
});

describe("task DAG: upstream / downstream (catalog clause 2)", () => {
  it("downstreamOf returns the transitive descendants", () => {
    const tasks = [
      planTask("a"),
      planTask("b", { dependsOn: ["a"] }),
      planTask("c", { dependsOn: ["b"] }),
      planTask("d", { dependsOn: ["a"] }),
    ];
    const dag = okOf(buildTaskDag(tasks));
    expect([...downstreamOf(dag, "a")].sort()).toEqual(["b", "c", "d"]);
  });

  it("upstreamOf returns the transitive ancestors", () => {
    const tasks = [
      planTask("a"),
      planTask("b", { dependsOn: ["a"] }),
      planTask("c", { dependsOn: ["b"] }),
    ];
    const dag = okOf(buildTaskDag(tasks));
    expect([...upstreamOf(dag, "c")].sort()).toEqual(["a", "b"]);
  });

  it("downstreamOf of a leaf returns empty", () => {
    const tasks = [
      planTask("a"),
      planTask("b", { dependsOn: ["a"] }),
    ];
    const dag = okOf(buildTaskDag(tasks));
    expect([...downstreamOf(dag, "b")]).toEqual([]);
  });
});
