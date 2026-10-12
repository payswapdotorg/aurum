/**
 * W009 escalation (catalog clause 4: escalation proposes / disposes).
 *
 * Tripwires:
 * - escalation records NEVER mutate plans directly (source-scan: the
 *   escalation module has no ExecutionPlan imports).
 * - escalation builders refuse invalid triggers, decisions, addresses.
 * - escalation carries causation identity (failureSettlementRef or
 *   failedDependencyTaskId) — never a plan mutation.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDeadlineExceededEscalation,
  buildDependencyFailedEscalation,
  buildTaskFailedEscalation,
  DEFAULT_ESCALATION_DECISIONS,
  escalationInputIssues,
  nextAttemptNumber,
  type EscalationRecord,
} from "../src/index.js";
import { errOf, okOf, personActor, planTask, provenance, now } from "./plans-helpers.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const escalationSource = readFileSync(
  join(packageRoot, "src", "plans", "domain", "escalation.ts"),
  "utf8",
);

describe("escalation proposes / disposes (catalog clause 4)", () => {
  it("the escalation module has NO ExecutionPlan import (never mutates plans)", () => {
    const offenders = escalationSource.split("\n").filter((line) => /\bExecutionPlan\b/.test(line));
    expect(offenders).toEqual([]);
  });

  it("the escalation module has NO plan-store import (never writes plans)", () => {
    const offenders = escalationSource
      .split("\n")
      .filter((line) => /PlanStore|planService|plans\./.test(line));
    expect(offenders).toEqual([]);
  });
});

describe("escalation input validation (catalog clause 4)", () => {
  it("rejects unknown trigger", () => {
    const issues = escalationInputIssues({
      trigger: "unknown",
      requestedDecision: "retry",
      addressedTo: { kind: "person", personId: "p-1" },
      reason: "x",
    });
    expect(issues.some((i) => i.field === "trigger")).toBe(true);
  });

  it("rejects unknown decision", () => {
    const issues = escalationInputIssues({
      trigger: "task-failed",
      requestedDecision: "unknown",
      addressedTo: { kind: "person", personId: "p-1" },
      reason: "x",
    });
    expect(issues.some((i) => i.field === "requestedDecision")).toBe(true);
  });

  it("rejects unknown actor kind", () => {
    const issues = escalationInputIssues({
      trigger: "task-failed",
      requestedDecision: "retry",
      addressedTo: { kind: "alien" },
      reason: "x",
    });
    expect(issues.some((i) => i.field === "addressedTo.kind")).toBe(true);
  });

  it("rejects empty reason", () => {
    const issues = escalationInputIssues({
      trigger: "task-failed",
      requestedDecision: "retry",
      addressedTo: { kind: "person", personId: "p-1" },
      reason: "",
    });
    expect(issues.some((i) => i.field === "reason")).toBe(true);
  });

  it("accepts a valid input", () => {
    expect(
      escalationInputIssues({
        trigger: "task-failed",
        requestedDecision: "retry",
        addressedTo: { kind: "person", personId: "p-1" },
        reason: "x",
      }),
    ).toEqual([]);
  });
});

describe("buildTaskFailedEscalation (catalog clause 4)", () => {
  it("builds an escalation record for a failed settlement", () => {
    const task = planTask("t1");
    const esc = okOf(
      buildTaskFailedEscalation({
        escalationId: "esc-1",
        planId: "plan-1",
        task,
        settlement: {
          requestId: "req-1",
          status: "failed",
          settledAt: 1000,
          failure: { kind: "transport-failed", code: "x", message: "boom", retryable: true },
        },
        addressedTo: personActor("p-1"),
        reason: "task failed",
        raisedAt: now(1),
        provenance: provenance(personActor("p-1")),
      }),
    );
    expect(esc.trigger).toBe("task-failed");
    expect(esc.requestedDecision).toBe(DEFAULT_ESCALATION_DECISIONS["task-failed"]);
    expect(esc.failureSettlementRef?.requestId).toBe("req-1");
    expect(esc.failureSettlementRef?.settledAt).toBe(1000);
    expect(esc.addressedTo.kind).toBe("person");
  });

  it("refuses a non-failed settlement", () => {
    const task = planTask("t1");
    const result = buildTaskFailedEscalation({
      escalationId: "esc-1",
      planId: "plan-1",
      task,
      settlement: { requestId: "req-1", status: "settled", settledAt: 1000 },
      addressedTo: personActor("p-1"),
      reason: "task failed",
      raisedAt: now(1),
      provenance: provenance(personActor("p-1")),
    });
    expect(errOf(result).code).toBe("plan-validation");
  });

  it("supports override of the default decision (retry → cancel-plan)", () => {
    const task = planTask("t1");
    const esc = okOf(
      buildTaskFailedEscalation({
        escalationId: "esc-1",
        planId: "plan-1",
        task,
        settlement: {
          requestId: "req-1",
          status: "failed",
          settledAt: 1000,
          failure: { kind: "transport-failed", code: "x", message: "boom", retryable: false },
        },
        addressedTo: personActor("p-1"),
        reason: "task failed, give up",
        requestedDecision: "cancel-plan",
        raisedAt: now(1),
        provenance: provenance(personActor("p-1")),
      }),
    );
    expect(esc.requestedDecision).toBe("cancel-plan");
  });
});

describe("buildDeadlineExceededEscalation (catalog clause 4)", () => {
  it("builds an escalation when the deadline has passed", () => {
    const task = planTask("t1", { deadlineEpochMs: 500 });
    const esc = okOf(
      buildDeadlineExceededEscalation({
        escalationId: "esc-2",
        planId: "plan-1",
        task,
        now: 1000,
        addressedTo: personActor("p-1"),
        reason: "deadline exceeded",
        raisedAt: now(2),
        provenance: provenance(personActor("p-1")),
      }),
    );
    expect(esc.trigger).toBe("task-deadline-exceeded");
    expect(esc.requestedDecision).toBe(DEFAULT_ESCALATION_DECISIONS["task-deadline-exceeded"]);
  });

  it("refuses when the deadline has NOT passed", () => {
    const task = planTask("t1", { deadlineEpochMs: 5000 });
    const result = buildDeadlineExceededEscalation({
      escalationId: "esc-2",
      planId: "plan-1",
      task,
      now: 1000,
      addressedTo: personActor("p-1"),
      reason: "deadline exceeded",
      raisedAt: now(2),
      provenance: provenance(personActor("p-1")),
    });
    expect(errOf(result).code).toBe("plan-validation");
  });
});

describe("buildDependencyFailedEscalation (catalog clause 4)", () => {
  it("builds an escalation for a failed dependency", () => {
    const task = planTask("t2", { dependsOn: ["t1"] });
    const esc = okOf(
      buildDependencyFailedEscalation({
        escalationId: "esc-3",
        planId: "plan-1",
        task,
        failedDependencyTaskId: "t1",
        failedDependencySettlement: {
          requestId: "req-1",
          status: "failed",
          settledAt: 1000,
          failure: { kind: "platform-failed", code: "x", message: "boom", retryable: true },
        },
        addressedTo: personActor("p-1"),
        reason: "dep failed",
        raisedAt: now(3),
        provenance: provenance(personActor("p-1")),
      }),
    );
    expect(esc.trigger).toBe("dependency-failed");
    expect(esc.failedDependencyTaskId).toBe("t1");
    expect(esc.requestedDecision).toBe(DEFAULT_ESCALATION_DECISIONS["dependency-failed"]);
  });

  it("refuses when the failed dependency task is NOT a declared dependency", () => {
    const task = planTask("t2");
    const result = buildDependencyFailedEscalation({
      escalationId: "esc-3",
      planId: "plan-1",
      task,
      failedDependencyTaskId: "nonexistent",
      failedDependencySettlement: { requestId: "req-1", status: "failed", settledAt: 1000 },
      addressedTo: personActor("p-1"),
      reason: "dep failed",
      raisedAt: now(3),
      provenance: provenance(personActor("p-1")),
    });
    expect(errOf(result).code).toBe("plan-validation");
  });

  it("refuses when the dependency settlement is NOT failed", () => {
    const task = planTask("t2", { dependsOn: ["t1"] });
    const result = buildDependencyFailedEscalation({
      escalationId: "esc-3",
      planId: "plan-1",
      task,
      failedDependencyTaskId: "t1",
      failedDependencySettlement: { requestId: "req-1", status: "settled", settledAt: 1000 },
      addressedTo: personActor("p-1"),
      reason: "dep failed",
      raisedAt: now(3),
      provenance: provenance(personActor("p-1")),
    });
    expect(errOf(result).code).toBe("plan-validation");
  });
});

describe("recovery: next attempt number (catalog clause 4)", () => {
  it("returns 1 for the first attempt (no previous attempts)", () => {
    expect(nextAttemptNumber([])).toBe(1);
  });

  it("returns N+1 for the (N+1)th attempt", () => {
    expect(
      nextAttemptNumber([
        { attempt: 1, requestId: "r1" },
        { attempt: 2, requestId: "r2" },
      ]),
    ).toBe(3);
  });
});

describe("escalation record structure (catalog clause 4)", () => {
  it("an escalation record carries no plan-mutation fields (no plan-state fields)", () => {
    const task = planTask("t1");
    const esc = okOf(
      buildTaskFailedEscalation({
        escalationId: "esc-1",
        planId: "plan-1",
        task,
        settlement: {
          requestId: "req-1",
          status: "failed",
          settledAt: 1000,
          failure: { kind: "transport-failed", code: "x", message: "boom", retryable: true },
        },
        addressedTo: personActor("p-1"),
        reason: "x",
        raisedAt: now(1),
        provenance: provenance(personActor("p-1")),
      }),
    ) as EscalationRecord;
    // The escalation record must not have plan-state fields.
    expect((esc as unknown as { approval?: unknown }).approval).toBeUndefined();
    expect((esc as unknown as { lifecycleState?: unknown }).lifecycleState).toBeUndefined();
  });
});
