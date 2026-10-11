/**
 * W006 normalized-result proofs (catalog acceptance: "normalized
 * result/evidence/cost"): the settlement envelope's field discipline —
 * result payloads joined from workload output, cost lines carried through
 * verbatim (opaque units), evidence references opaque + stable, platform
 * failure details verbatim inside normalized failure details, environment
 * provenance, and the wire-safe guard over REAL gateway outputs.
 */
import { describe, expect, it } from "vitest";
import { localHarness, okOf, requestOf, sandboxHarness, scopeOf } from "./helpers.js";
import {
  EXECUTION_FAILURE_KINDS,
  isExecutionSettlement,
  platformStatusToSemantic,
  type ExecutionSettlement,
} from "../src/index.js";

const A = scopeOf("tenant-a");

describe("W006 normalized result / cost / evidence", () => {
  it("settles with joined result payloads and cost carried verbatim from the platform envelope", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("env-1", { workload: "multi" })));
    const settlement = okOf(await h.gateway.awaitSettled(A, "env-1"));

    expect(settlement.result).toBe("abc");
    expect(settlement.cost).toEqual([
      { unit: "cpu-ms", quantity: 10 },
      { unit: "cpu-ms", quantity: 15 },
    ]);
    // The platform's own envelope carries the SAME lines — normalization
    // passes cost through opaquely (unit labels are never parsed here).
    const local = h.registry.resolveByCapabilityId("local-1");
    if (!local.ok) throw new Error(local.error.message);
    const ticket = okOf(h.gateway.getExecution(A, "env-1")).submissionTicket as string;
    const snapshot = await local.value.transport.poll(ticket as never);
    expect(snapshot.envelope?.cost).toEqual(settlement.cost);
  });

  it("produces opaque, stable evidence references resolvable only by the caller", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("env-2")));
    const first = okOf(await h.gateway.awaitSettled(A, "env-2"));
    const second = okOf(await h.gateway.awaitSettled(A, "env-2"));

    expect(first.evidenceRef).toBe(
      `local-env:local-1:${okOf(h.gateway.getExecution(A, "env-2")).submissionTicket}`,
    );
    expect(second.evidenceRef).toBe(first.evidenceRef);
    // Opaque: a plain string, never an object graph, never parsed here.
    expect(typeof first.evidenceRef).toBe("string");
  });

  it("carries platform failure details VERBATIM inside the normalized failure detail", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("env-3", { workload: "boom" })));
    const settlement = okOf(await h.gateway.awaitSettled(A, "env-3"));

    expect(settlement.status).toBe("failed");
    expect(settlement.failure).toEqual({
      kind: "platform-failed",
      code: "aurum-transport/internal",
      message: "injected boom",
      retryable: false,
    });
    // Failed settlements carry no result payload.
    expect(settlement.result).toBeUndefined();
  });

  it("normalizes platform terminal states onto the semantic statuses", () => {
    expect(platformStatusToSemantic("settled")).toBe("settled");
    expect(platformStatusToSemantic("failed")).toBe("failed");
    expect(platformStatusToSemantic("cancelled")).toBe("cancelled");
  });

  it("declares the closed failure-kind vocabulary", () => {
    expect([...EXECUTION_FAILURE_KINDS]).toEqual([
      "platform-failed",
      "transport-failed",
      "deadline-exceeded",
      "not-wired",
      "environment-unavailable",
      "interrupted",
    ]);
  });

  it("echoes authority citations and environment provenance on every settlement", async () => {
    const h = sandboxHarness();
    okOf(
      await h.gateway.submitExecution(
        A,
        requestOf("env-4", {
          environmentClass: "sandbox",
          authority: { actionId: "act-42", auditRef: "audit-42" },
          modelBindingRef: "binding-9",
        }),
      ),
    );
    const settlement = okOf(await h.gateway.awaitSettled(A, "env-4"));
    expect(settlement.authority).toEqual({ actionId: "act-42", auditRef: "audit-42" });
    expect(settlement.occupancy).toEqual({ modelBindingRef: "binding-9" });
    expect(settlement.environment).toEqual({
      environmentId: "sandbox-1",
      environmentClass: "sandbox",
      variant: "default",
      capabilityId: "sandbox-1",
    });
    expect(settlement.tenantId).toBe("tenant-a");
    expect(settlement.requestId).toBe("env-4");
  });

  it("passes the wire-safe settlement guard on real gateway outputs", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("env-5")));
    const settlement: ExecutionSettlement = okOf(await h.gateway.awaitSettled(A, "env-5"));
    expect(isExecutionSettlement(settlement)).toBe(true);

    okOf(await h.gateway.submitExecution(A, requestOf("env-6", { workload: "boom" })));
    const failed = okOf(await h.gateway.awaitSettled(A, "env-6"));
    expect(isExecutionSettlement(failed)).toBe(true);
  });

  it("sandbox settlements carry the sandbox evidence reference namespace", async () => {
    const h = sandboxHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("env-7", { environmentClass: "sandbox" })));
    const settlement = okOf(await h.gateway.awaitSettled(A, "env-7"));
    expect(settlement.evidenceRef?.startsWith("sandbox-env:sandbox-1:")).toBe(true);
    expect(settlement.environment.environmentClass).toBe("sandbox");
  });

  it("input-driven workloads reflect the opaque payload through the result", async () => {
    const h = localHarness();
    okOf(
      await h.gateway.submitExecution(
        A,
        requestOf("env-8", { workload: "inputEcho", input: { some: "input" } }),
      ),
    );
    const settlement = okOf(await h.gateway.awaitSettled(A, "env-8"));
    expect(settlement.result).toBe(JSON.stringify({ some: "input" }));
  });
});

describe("W006 sandbox isolation", () => {
  it("gives every submission its own isolated workspace (no cross-ticket state)", async () => {
    const h = sandboxHarness();
    const first = okOf(
      await h.gateway.submitExecution(
        A,
        requestOf("iso-1", {
          environmentClass: "sandbox",
          workload: "isolated",
          input: { slot: "one" },
        }),
      ),
    );
    const second = okOf(
      await h.gateway.submitExecution(
        A,
        requestOf("iso-2", {
          environmentClass: "sandbox",
          workload: "isolated",
          input: { slot: "two" },
        }),
      ),
    );
    okOf(await h.gateway.awaitSettled(A, "iso-1"));
    okOf(await h.gateway.awaitSettled(A, "iso-2"));

    const workspaceOne = h.sandbox?.workspaceOf(first.session.submissionTicket as string);
    const workspaceTwo = h.sandbox?.workspaceOf(second.session.submissionTicket as string);
    expect(workspaceOne?.get("slot")).toBe("one");
    expect(workspaceTwo?.get("slot")).toBe("two");
    expect(workspaceOne === workspaceTwo).toBe(false);

    const settlementOne = okOf(await h.gateway.awaitSettled(A, "iso-1"));
    const settlementTwo = okOf(await h.gateway.awaitSettled(A, "iso-2"));
    expect(settlementOne.result).toBe("wrote:one");
    expect(settlementTwo.result).toBe("wrote:two");
  });
});
