/**
 * Task DAG construction + inspection (W009 domain layer, pure).
 *
 * Catalog clause 2: tasks within a plan, dependencies (DAG — cycle-rejected
 * at construction with a typed error and the offending cycle path), per-task
 * authorization requirements, per-task information requirements. The DAG is
 * inspectable: topological order, critical path (longest dependency chain),
 * readiness computation.
 *
 * All operations are pure functions returning NEW frozen values; no IO, no
 * clocks, no side effects.
 */
import { err, ok, type Result } from "@aurum/domain";
import type { ValidationIssue } from "@aurum/domain";
import { planValidationError } from "./errors.js";
import { planCycle, type PlanError } from "./errors.js";
import type { PlanTask, TaskDag } from "./records.js";

/** Validates a list of plan tasks before DAG construction; returns issues. */
export function taskDagIssues(tasks: readonly PlanTask[] | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(tasks)) {
    return [{ field: "tasks", problem: "must be a non-empty array" }];
  }
  if (tasks.length === 0) {
    return [{ field: "tasks", problem: "must be a non-empty array" }];
  }
  const taskIds = new Set<string>();
  tasks.forEach((task, index) => {
    const prefix = `tasks.${index}`;
    if (!task || typeof task !== "object") {
      issues.push({ field: prefix, problem: "is required" });
      return;
    }
    if (typeof task.taskId !== "string" || task.taskId.trim().length === 0) {
      issues.push({ field: `${prefix}.taskId`, problem: "must be a non-empty string" });
    } else if (taskIds.has(task.taskId)) {
      issues.push({ field: `${prefix}.taskId`, problem: `duplicate task id: ${task.taskId}` });
    } else {
      taskIds.add(task.taskId);
    }
    if (typeof task.title !== "string" || task.title.trim().length === 0) {
      issues.push({ field: `${prefix}.title`, problem: "must be a non-empty string" });
    }
    if (!Array.isArray(task.dependsOn)) {
      issues.push({ field: `${prefix}.dependsOn`, problem: "must be an array" });
    }
    if (!Array.isArray(task.consumes)) {
      issues.push({ field: `${prefix}.consumes`, problem: "must be an array" });
    }
    if (!Array.isArray(task.produces)) {
      issues.push({ field: `${prefix}.produces`, problem: "must be an array" });
    }
  });
  // dangling dependency references
  tasks.forEach((task, index) => {
    if (!task || !Array.isArray(task.dependsOn)) return;
    task.dependsOn.forEach((dep: string, depIndex: number) => {
      if (typeof dep !== "string" || !taskIds.has(dep)) {
        issues.push({
          field: `tasks.${index}.dependsOn.${depIndex}`,
          problem: `must reference a declared task: ${String(dep)}`,
        });
      }
    });
  });
  return issues;
}

/**
 * Detects a cycle in the dependency graph (DFS coloring). Returns the
 * offending cycle path (task ids, cycle closed back to the start) when a
 * cycle exists, or null when the graph is acyclic.
 *
 * Determinism: when multiple cycles exist, the lexically-smallest cycle
 * path is returned (the search starts from the lexically-smallest task id
 * and explores neighbors in lexical order).
 */
export function detectCycle(tasks: readonly PlanTask[]): readonly string[] | null {
  const ids = tasks.map((task) => task.taskId).sort();
  const upstream = new Map<string, readonly string[]>();
  for (const task of tasks) upstream.set(task.taskId, task.dependsOn);
  const state = new Map<string, number>(); // 0=unseen, 1=in-progress, 2=done
  const stack: string[] = [];

  function dfs(node: string): readonly string[] | null {
    state.set(node, 1);
    stack.push(node);
    const deps = upstream.get(node) ?? [];
    for (const dep of [...deps].sort()) {
      if (!upstream.has(dep)) continue; // dangling — validated separately
      const s = state.get(dep) ?? 0;
      if (s === 0) {
        const found = dfs(dep);
        if (found) return found;
      } else if (s === 1) {
        const idx = stack.indexOf(dep);
        return stack.slice(idx).concat(dep);
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  }

  for (const id of ids) {
    if ((state.get(id) ?? 0) === 0) {
      const found = dfs(id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Topological sort (deterministic). Uses Kahn's algorithm with a stable
 * queue (lexically-smallest ready task first). Returns the order in which
 * tasks with no unmet upstream dependencies become ready.
 */
export function topologicalOrder(tasks: readonly PlanTask[]): readonly string[] {
  const upstream = new Map<string, Set<string>>();
  const downstream = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const task of tasks) {
    upstream.set(task.taskId, new Set(task.dependsOn));
    downstream.set(task.taskId, new Set());
    indegree.set(task.taskId, 0);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!upstream.has(dep)) continue; // dangling — validated separately
      downstream.get(dep)?.add(task.taskId);
      indegree.set(task.taskId, (indegree.get(task.taskId) ?? 0) + 1);
    }
  }
  const ready = tasks
    .map((task) => task.taskId)
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    order.push(next);
    for (const dependent of [...(downstream.get(next) ?? [])].sort()) {
      const newIndegree = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, newIndegree);
      if (newIndegree === 0) {
        // Insert in lexical order to maintain the stable queue.
        const insertAt = ready.findIndex((id) => id > dependent);
        if (insertAt === -1) ready.push(dependent);
        else ready.splice(insertAt, 0, dependent);
      }
    }
  }
  return order;
}

/**
 * Critical path: the longest dependency chain in the DAG (by task count).
 * Computed via dynamic programming on the topological order. When multiple
 * paths of equal length exist, the lexically-smallest path is returned for
 * determinism.
 */
export function criticalPath(tasks: readonly PlanTask[]): readonly string[] {
  const order = topologicalOrder(tasks);
  const upstream = new Map<string, readonly string[]>();
  for (const task of tasks) upstream.set(task.taskId, task.dependsOn);
  // length[id] = longest chain ending at id (counting id itself)
  const length = new Map<string, number>();
  const pred = new Map<string, string | null>();
  for (const id of order) {
    let best = 1;
    let bestPred: string | null = null;
    for (const dep of upstream.get(id) ?? []) {
      if (!upstream.has(dep)) continue; // dangling
      const candidate = (length.get(dep) ?? 0) + 1;
      if (candidate > best) {
        best = candidate;
        bestPred = dep;
      } else if (candidate === best && bestPred !== null && dep < bestPred) {
        bestPred = dep;
      }
    }
    length.set(id, best);
    pred.set(id, bestPred);
  }
  // Find the longest end (deterministic — lex-smallest when tied).
  let endId: string | null = null;
  let endLen = 0;
  for (const id of order) {
    const l = length.get(id) ?? 0;
    if (l > endLen) {
      endLen = l;
      endId = id;
    } else if (l === endLen && endId !== null && id < endId) {
      endId = id;
    }
  }
  if (endId === null) return [];
  const path: string[] = [endId];
  let current: string | null = endId;
  while (current !== null) {
    const p: string | null = pred.get(current) ?? null;
    if (p === null) break;
    path.unshift(p);
    current = p;
  }
  return path;
}

/** Builds the upstream/downstream adjacency maps for inspection. */
function adjacency(tasks: readonly PlanTask[]): {
  upstream: ReadonlyMap<string, readonly string[]>;
  downstream: ReadonlyMap<string, readonly string[]>;
} {
  const upstream = new Map<string, readonly string[]>();
  const downstream = new Map<string, readonly string[]>();
  for (const task of tasks) {
    upstream.set(
      task.taskId,
      Object.freeze([...task.dependsOn].sort()) as readonly string[],
    );
    downstream.set(task.taskId, []);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!downstream.has(dep)) continue;
      const current = downstream.get(dep) as string[];
      current.push(task.taskId);
    }
  }
  for (const [id, deps] of downstream) {
    downstream.set(id, Object.freeze([...deps].sort()) as readonly string[]);
  }
  return { upstream, downstream };
}

/**
 * Constructs the task DAG. Cycle-rejected at construction with a typed
 * `plan-cycle` error and the offending cycle path (catalog clause 2).
 * Validates the tasks' shape and dependency references first (typed
 * `plan-validation` error with the verbatim issue list when invalid).
 */
export function buildTaskDag(tasks: readonly PlanTask[]): Result<TaskDag, PlanError> {
  const issues = taskDagIssues(tasks);
  if (issues.length > 0) return err(planValidationError(issues));
  const cycle = detectCycle(tasks);
  if (cycle !== null) return err(planCycle(cycle));
  const { upstream, downstream } = adjacency(tasks);
  const order = topologicalOrder(tasks);
  const path = criticalPath(tasks);
  return ok({
    tasks: Object.freeze([...tasks]) as readonly PlanTask[],
    upstream,
    downstream,
    topologicalOrder: Object.freeze(order),
    criticalPath: Object.freeze(path),
  });
}

/**
 * Readiness computation (catalog clause 2). A task is READY when:
 * - all its dependency tasks are settled (have a completion record with a
 *   successful `settled` status); AND
 * - all its declared input handoffs have been delivered (payloads available
 *   for every entry in `task.consumes`).
 *
 * Returns the set of ready task ids, in topological order (deterministic).
 */
export function readyTasks(
  dag: TaskDag,
  completions: ReadonlyMap<string, { status: "settled" | "cancelled" | "failed" }>,
  deliveredHandoffs: ReadonlyMap<string, ReadonlySet<string>>,
): readonly string[] {
  const ready: string[] = [];
  for (const taskId of dag.topologicalOrder) {
    const task = dag.tasks.find((t) => t.taskId === taskId);
    if (!task) continue;
    // all dependencies settled successfully
    const depsSettled = task.dependsOn.every((dep) => {
      const completion = completions.get(dep);
      return completion?.status === "settled";
    });
    if (!depsSettled) continue;
    // all declared input handoffs have been delivered
    const handoffsForTask = deliveredHandoffs.get(taskId) ?? new Set<string>();
    const allHandoffsDelivered = task.consumes.every((h) => handoffsForTask.has(h.handoffId));
    if (!allHandoffsDelivered) continue;
    // task itself is not already complete
    if (completions.has(taskId)) continue;
    ready.push(taskId);
  }
  return Object.freeze(ready);
}

/** All tasks downstream of a given task (transitive). */
export function downstreamOf(dag: TaskDag, taskId: string): readonly string[] {
  const visited = new Set<string>();
  const stack = [taskId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of dag.downstream.get(current) ?? []) stack.push(next);
  }
  visited.delete(taskId);
  return Object.freeze([...visited].sort());
}

/** All tasks upstream of a given task (transitive). */
export function upstreamOf(dag: TaskDag, taskId: string): readonly string[] {
  const visited = new Set<string>();
  const stack = [taskId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of dag.upstream.get(current) ?? []) stack.push(next);
  }
  visited.delete(taskId);
  return Object.freeze([...visited].sort());
}
