/**
 * W006 domain proofs: the semantic session lifecycle, exactly-once
 * settlement, request validation, and the normalized-envelope shape guard.
 */
import { describe, expect, it } from "vitest";
import {
  EXECUTION_SESSION_STATES,
  EXECUTION_SESSION_TERMINAL_STATES,
  asExecutionTenantId,
  buildExecutionSettlement,
  createPendingSession,
  err,
  executionRequestIssues,
  executionTransitionLegal,
  isExecutionSettlement,
  isExecutionSessionState,
  isExecutionTerminalState,
  legalExecutionTransitionsFrom,
  ok,
  settleSession,
  withSessionState,
  type ExecutionSession,
  type ExecutionSettlement,
} from "../src/index.js";
import { requestOf } from "./helpers.js";

const TENANT = asExecutionTenantId("tenant-a");
if (!TENANT.ok) throw new Error("test setup failed");

function settlementFor(
  session: ExecutionSession,
  status: ExecutionSettlement["status"],
): ExecutionSettlement {
  return buildExecutionSettlement(
    {
      tenantId: session.tenantId,
      requestId: session.requestId,
      authority: session.authority,
      environment: {
        environmentId: session.environmentId ?? "local-1",
        environmentClass: session.environmentClass,
        variant: "default",
        capabilityId: session.capabilityId ?? "local-1",
      },
    },
    { status, settledAt: 42 },
  );
}

function pendingSession(): ExecutionSession {
  const session = createPendingSession(TENANT.value, requestOf("r-1"), {
    now: 10,
    submissionKey: "exec:tenant-a:r-1",
  });
  return {
    ...session,
    environmentId: "local-1",
    capabilityId: "local-1",
    submissionTicket: "local:local-1:1",
  };
}

describe("W006 semantic session lifecycle", () => {
  it("declares the aligned semantic vocabulary (pending/running/paused + three terminals)", () => {
    expect([...EXECUTION_SESSION_STATES]).toEqual([
      "pending",
      "running",
      "paused",
      "settled",
      "cancelled",
      "failed",
    ]);
    expect([...EXECUTION_SESSION_TERMINAL_STATES]).toEqual(["settled", "cancelled", "failed"]);
  });

  it("walks every legal pre-terminal transition and refuses illegal ones", () => {
    expect(executionTransitionLegal("pending", "running")).toBe(true);
    expect(executionTransitionLegal("pending", "paused")).toBe(true);
    expect(executionTransitionLegal("pending", "settled")).toBe(true);
    expect(executionTransitionLegal("running", "paused")).toBe(true);
    expect(executionTransitionLegal("running", "failed")).toBe(true);
    expect(executionTransitionLegal("paused", "running")).toBe(true);
    expect(executionTransitionLegal("paused", "settled")).toBe(true);
    expect(executionTransitionLegal("pending", "pending")).toBe(false);
    expect(executionTransitionLegal("running", "running")).toBe(false);
    expect(executionTransitionLegal("paused", "paused")).toBe(false);
    for (const terminal of EXECUTION_SESSION_TERMINAL_STATES) {
      for (const to of EXECUTION_SESSION_STATES) {
        expect(executionTransitionLegal(terminal, to)).toBe(false);
      }
    }
  });

  it("reports reachable transitions consistently with the legality function", () => {
    for (const from of EXECUTION_SESSION_STATES) {
      const reachable = legalExecutionTransitionsFrom(from);
      for (const to of EXECUTION_SESSION_STATES) {
        expect(reachable.includes(to)).toBe(executionTransitionLegal(from, to));
      }
    }
  });

  it("narrows states with guards and rejects foreign values", () => {
    for (const state of EXECUTION_SESSION_STATES) expect(isExecutionSessionState(state)).toBe(true);
    expect(isExecutionSessionState("succeeded")).toBe(false);
    expect(isExecutionSessionState(7)).toBe(false);
    for (const state of EXECUTION_SESSION_TERMINAL_STATES) {
      expect(isExecutionTerminalState(state)).toBe(true);
    }
    expect(isExecutionTerminalState("running")).toBe(false);
  });

  it("applies legal state transitions and refuses illegal ones (typed)", () => {
    const session = pendingSession();
    const running = withSessionState(session, "running", 20);
    expect(running.ok && running.value.state).toBe("running");
    expect(running.ok && running.value.updatedAt).toBe(20);
    const paused = running.ok ? withSessionState(running.value, "paused", 30) : err(undefined);
    expect(paused.ok && paused.value.state).toBe("paused");
    const illegal = running.ok ? withSessionState(running.value, "pending", 40) : err(undefined);
    expect(!illegal.ok && illegal.error.code).toBe("execution/lifecycle-illegal");
  });
});

describe("W006 exactly-once settlement (domain)", () => {
  it("settles once and suppresses an IDENTICAL duplicate delivery", () => {
    const session = pendingSession();
    const settlement = settlementFor(session, "settled");
    const first = settleSession(session, settlement, 50);
    expect(first.ok && first.value.firstSettlement).toBe(true);
    expect(first.ok && first.value.session.state).toBe("settled");
    expect(first.ok && first.value.session.settlement).toBeDefined();
    const duplicate = settleSession(first.ok ? first.value.session : session, settlement, 60);
    expect(duplicate.ok && duplicate.value.firstSettlement).toBe(false);
    expect(duplicate.ok && duplicate.value.session.settlement).toEqual(settlement);
  });

  it("refuses a DIVERGENT re-settlement as an invariant violation", () => {
    const session = pendingSession();
    const first = settleSession(session, settlementFor(session, "settled"), 50);
    if (!first.ok) throw new Error("setup failed");
    const divergent = buildExecutionSettlement(
      {
        tenantId: session.tenantId,
        requestId: session.requestId,
        authority: session.authority,
        environment: {
          environmentId: "local-1",
          environmentClass: "local",
          variant: "default",
          capabilityId: "local-1",
        },
      },
      {
        status: "failed",
        settledAt: 99,
        failure: { kind: "transport-failed", code: "x", message: "y", retryable: false },
      },
    );
    const refused = settleSession(first.value.session, divergent, 60);
    expect(!refused.ok && refused.error.code).toBe("execution/invariant");
  });

  it("refuses settlements that do not match the session identity", () => {
    const session = pendingSession();
    const foreign = settlementFor({ ...session, tenantId: "tenant-b" }, "settled");
    const refused = settleSession(session, foreign, 50);
    expect(!refused.ok && refused.error.code).toBe("execution/invariant");
  });
});

describe("W006 execution request validation", () => {
  it("accepts a well-formed request", () => {
    expect(executionRequestIssues(requestOf("r-1"))).toEqual([]);
  });

  it("refuses requests without an authority citation", () => {
    const issues = executionRequestIssues({ ...requestOf("r-1"), authority: {} });
    expect(issues.some((issue) => issue.field === "request.authority")).toBe(true);
  });

  it("refuses unknown environment classes and malformed payloads", () => {
    const badClass = executionRequestIssues({
      ...requestOf("r-1"),
      environmentClass: "mainframe" as never,
    });
    expect(badClass.some((issue) => issue.field === "request.environmentClass")).toBe(true);
    const badPayload = executionRequestIssues({ ...requestOf("r-1"), payload: "" });
    expect(badPayload.some((issue) => issue.field === "request.payload")).toBe(true);
    const badMedia = executionRequestIssues({ ...requestOf("r-1"), payloadMediaType: "" });
    expect(badMedia.some((issue) => issue.field === "request.payloadMediaType")).toBe(true);
    const badDeadline = executionRequestIssues({ ...requestOf("r-1"), deadlineEpochMs: -5 });
    expect(badDeadline.some((issue) => issue.field === "request.deadlineEpochMs")).toBe(true);
    const badRequestId = executionRequestIssues({ ...requestOf("r-1"), requestId: "" as never });
    expect(badRequestId.some((issue) => issue.field === "request.requestId")).toBe(true);
  });

  it("refuses malformed model occupancy", () => {
    const issues = executionRequestIssues({
      ...requestOf("r-1"),
      occupancy: { modelBindingRef: "" },
    });
    expect(issues.some((issue) => issue.field === "request.occupancy.modelBindingRef")).toBe(true);
  });
});

describe("W006 normalized envelope shape guard", () => {
  it("accepts real settlement shapes from the builder", () => {
    const session = pendingSession();
    expect(isExecutionSettlement(settlementFor(session, "settled"))).toBe(true);
    const failed = buildExecutionSettlement(
      {
        tenantId: session.tenantId,
        requestId: session.requestId,
        authority: session.authority,
        environment: {
          environmentId: "local-1",
          environmentClass: "local",
          variant: "default",
          capabilityId: "local-1",
        },
      },
      {
        status: "failed",
        settledAt: 1,
        failure: {
          kind: "platform-failed",
          code: "aurum-transport/internal",
          message: "x",
          retryable: false,
        },
      },
    );
    expect(isExecutionSettlement(failed)).toBe(true);
  });

  it("rejects malformed settlements (status/failure consistency + shapes)", () => {
    const session = pendingSession();
    const base = settlementFor(session, "settled");
    expect(isExecutionSettlement({ ...base, status: "running" })).toBe(false);
    expect(isExecutionSettlement({ ...base, status: "failed" })).toBe(false); // failed needs failure
    expect(isExecutionSettlement({ ...base, result: 7 })).toBe(false);
    expect(isExecutionSettlement({ ...base, settledAt: Number.NaN })).toBe(false);
    expect(isExecutionSettlement({ ...base, authority: undefined })).toBe(false);
    expect(isExecutionSettlement(null)).toBe(false);
    expect(
      isExecutionSettlement({
        ...base,
        cost: [{ unit: "u", quantity: Number.NaN }],
      }),
    ).toBe(false);
  });
});

describe("W006 Result convention", () => {
  it("ok/err construct discriminated results", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("x" as never)).toEqual({ ok: false, error: "x" });
  });
});
