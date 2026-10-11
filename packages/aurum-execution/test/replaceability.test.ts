/**
 * W006 environment REPLACEABILITY proof (catalog acceptance: "execution
 * environment can be replaced behind the port"; work-order clause 3,
 * test-locked: "same gateway suite passes against two different adapter
 * doubles").
 *
 * One scenario suite — submission, settlement normalization, failure
 * normalization, cancel, recovery, idempotency — executed against TWO
 * different environment adapter doubles (the local in-process double and
 * the sandbox latency double). The gateway, session store, journal and
 * ports are composed identically; only the ADAPTER behind the
 * ExecutionEnvironment port changes. Semantic outcomes must agree.
 */
import { describe, expect, it } from "vitest";
import {
  errOf,
  localHarness,
  okOf,
  requestOf,
  sandboxHarness,
  scopeOf,
  journalKindsOf,
  type ExecutionHarness,
} from "./helpers.js";

const A = scopeOf("tenant-a");

type DoubleName = "local" | "sandbox";

function harnessFor(double: DoubleName): ExecutionHarness {
  return double === "local" ? localHarness() : sandboxHarness();
}

/**
 * Cancel-scenario harnesses: the execution must be genuinely IN FLIGHT when
 * the cancel lands — manual stepping for the local double, real latency for
 * the sandbox double. (With auto-stepping local, the workload completes
 * before the cancel and the gateway correctly refuses the raced control.)
 */
function inFlightHarnessFor(double: DoubleName): ExecutionHarness {
  return double === "local" ? localHarness({ mode: "manual" }) : sandboxHarness();
}

function classFor(double: DoubleName): "local" | "sandbox" {
  return double;
}

/** The shared scenario suite, parameterized over the adapter double. */
function scenarioSuite(double: DoubleName): void {
  const environmentClass = classFor(double);

  it(`[${double}] submits, settles and journals the same semantic lifecycle`, async () => {
    const h = harnessFor(double);
    const submitted = okOf(
      await h.gateway.submitExecution(A, requestOf("swap-1", { environmentClass })),
    );
    expect(submitted.session.capabilityId).toBe(`${environmentClass}-1`);
    const settlement = okOf(await h.gateway.awaitSettled(A, "swap-1"));
    expect(settlement.status).toBe("settled");
    expect(settlement.result).toBe("abc");
    expect(settlement.environment.environmentClass).toBe(environmentClass);
    expect(journalKindsOf(h, A, "swap-1")).toEqual(
      expect.arrayContaining(["request-accepted", "session-settled"]),
    );
  });

  it(`[${double}] normalizes platform failures identically (verbatim failure detail)`, async () => {
    const h = harnessFor(double);
    okOf(
      await h.gateway.submitExecution(
        A,
        requestOf("swap-2", { environmentClass, workload: "boom" }),
      ),
    );
    const settlement = okOf(await h.gateway.awaitSettled(A, "swap-2"));
    expect(settlement.status).toBe("failed");
    expect(settlement.failure?.kind).toBe("platform-failed");
    expect(settlement.failure?.message).toBe("injected boom");
  });

  it(`[${double}] cancels mid-flight into the same cancelled settlement`, async () => {
    const h = inFlightHarnessFor(double);
    // Latency keeps the sandbox execution in flight; manual mode keeps the
    // local one in flight — the gateway path is identical either way.
    okOf(
      await h.gateway.submitExecution(
        A,
        requestOf("swap-3", { environmentClass, deadlineEpochMs: Date.now() + 5000 }),
      ),
    );
    const cancelled = okOf(await h.gateway.cancelExecution(A, "swap-3"));
    expect(cancelled.status).toBe("cancelled");
    expect(okOf(h.gateway.getExecution(A, "swap-3")).state).toBe("cancelled");
    expect(journalKindsOf(h, A, "swap-3")).toContain("session-cancelled");
  });

  it(`[${double}] recovers interrupted sessions with exactly-once settlement`, async () => {
    const h = harnessFor(double);
    okOf(await h.gateway.submitExecution(A, requestOf("swap-4", { environmentClass })));
    const report = okOf(await h.gateway.recoverInterrupted(A));
    expect(report.settled + report.alreadySettled).toBe(1);
    const settlement = okOf(await h.gateway.awaitSettled(A, "swap-4"));
    expect(settlement.status).toBe("settled");
    expect(settlement.result).toBe("abc");
    expect(journalKindsOf(h, A, "swap-4").filter((kind) => kind === "session-settled").length).toBe(
      1,
    );
  });

  it(`[${double}] enforces idempotent duplicate delivery (same request id settles once)`, async () => {
    const h = harnessFor(double);
    okOf(await h.gateway.submitExecution(A, requestOf("swap-5", { environmentClass })));
    const settlement = okOf(await h.gateway.awaitSettled(A, "swap-5"));
    const replay = okOf(
      await h.gateway.submitExecution(A, requestOf("swap-5", { environmentClass })),
    );
    expect(replay.replay).toBe(true);
    expect(replay.settlement).toEqual(settlement);
    expect(settlement.cost?.reduce((sum, line) => sum + line.quantity, 0)).toBe(25);
  });

  it(`[${double}] fails closed on unknown request ids`, async () => {
    const h = harnessFor(double);
    const error = errOf(await h.gateway.awaitSettled(A, "swap-missing"));
    expect(error.code).toBe("execution/not-found");
    expect(error.message).toBe("execution session not found");
  });

  it(`[${double}] carries the authority citation + occupancy echo verbatim`, async () => {
    const h = harnessFor(double);
    okOf(
      await h.gateway.submitExecution(
        A,
        requestOf("swap-6", {
          environmentClass,
          authority: { auditRef: "audit-77" },
          modelBindingRef: "binding-3",
        }),
      ),
    );
    const settlement = okOf(await h.gateway.awaitSettled(A, "swap-6"));
    expect(settlement.authority).toEqual({ auditRef: "audit-77" });
    expect(settlement.occupancy).toEqual({ modelBindingRef: "binding-3" });
  });
}

describe("W006 replaceability: the same gateway suite over two adapter doubles", () => {
  scenarioSuite("local");
  scenarioSuite("sandbox");
});

describe("W006 replaceability: semantic outcomes agree across the doubles", () => {
  it("settles the same authority/cost/result shape on both adapters", async () => {
    const results: Record<DoubleName, Record<string, unknown>> = { local: {}, sandbox: {} };
    for (const double of ["local", "sandbox"] as const) {
      const h = harnessFor(double);
      okOf(await h.gateway.submitExecution(A, requestOf("agree", { environmentClass: double })));
      const settlement = okOf(await h.gateway.awaitSettled(A, "agree"));
      results[double] = {
        status: settlement.status,
        result: settlement.result,
        authority: settlement.authority,
        cost: settlement.cost,
        environmentClass: settlement.environment.environmentClass,
      };
    }
    expect(results.local.status).toBe(results.sandbox.status);
    expect(results.local.result).toBe(results.sandbox.result);
    expect(results.local.authority).toEqual(results.sandbox.authority);
    expect(results.local.cost).toEqual(results.sandbox.cost);
    expect(results.local.environmentClass).toBe("local");
    expect(results.sandbox.environmentClass).toBe("sandbox");
  });
});
