/**
 * W006 recovery proofs: resume-after-interruption with EXACTLY-ONCE semantic
 * settlement (catalog acceptance: "recovery"; work-order clause 5).
 *
 * Crash windows (domain/recovery.ts):
 * 1. session persisted, platform acknowledgement never stored → recovery
 *    RESUBMITS with the idempotency submission key (the platform contract
 *    dedups: same ticket, replay, never executes twice);
 * 2. acknowledgement stored, gateway crashed before settlement → recovery
 *    REAWAITS the ticket and applies the settlement exactly once.
 */
import { describe, expect, it } from "vitest";
import {
  asExecutionTenantId,
  createPendingSession,
  submissionKeyOf,
  withEnvironmentSelected,
} from "../src/index.js";
import {
  okOf,
  localHarness,
  requestOf,
  sandboxHarness,
  scopeOf,
  journalKindsOf,
} from "./helpers.js";

const A = scopeOf("tenant-a");

/**
 * Simulates crash window 1: the gateway persisted the pending session (with
 * environment selection) but crashed before the platform acknowledgement —
 * no ticket is stored. Composed with the domain constructors exactly as the
 * gateway would have (the store is the same port the gateway writes through).
 */
function seedUnacknowledgedSession(
  harness: ReturnType<typeof localHarness>,
  requestId: string,
  environmentClass: "local" | "sandbox" = "local",
): void {
  const tenant = asExecutionTenantId("tenant-a");
  if (!tenant.ok) throw new Error("setup failed");
  const session = withEnvironmentSelected(
    createPendingSession(tenant.value, requestOf(requestId, { environmentClass }), {
      now: 1,
      submissionKey: submissionKeyOf(tenant.value, requestOf(requestId).requestId),
    }),
    { environmentId: `${environmentClass}-1`, capabilityId: `${environmentClass}-1` },
    2,
  );
  const stored = harness.sessions.putSession(session);
  if (!stored.ok) throw new Error(stored.error.message);
}

describe("W006 recovery: crash window 1 (resubmit)", () => {
  it("resumes an unacknowledged session, executes once and settles exactly once", async () => {
    const h = localHarness();
    seedUnacknowledgedSession(h, "rec-1");

    const report = okOf(await h.gateway.recoverInterrupted(A));
    expect(report.examined).toBe(1);
    expect(report.settled).toBe(1);
    expect(report.outcomes).toEqual([
      { requestId: expect.any(String), outcome: "settled", finalState: "settled" },
    ]);

    const settlement = okOf(await h.gateway.awaitSettled(A, "rec-1"));
    expect(settlement.status).toBe("settled");
    expect(settlement.result).toBe("abc");
    // The workload executed EXACTLY once: the cost lines appear once.
    expect(settlement.cost?.reduce((sum, line) => sum + line.quantity, 0)).toBe(25);

    const journal = journalKindsOf(h, A, "rec-1");
    expect(journal).toEqual(
      expect.arrayContaining([
        "recovery-opened",
        "submission-acknowledged",
        "recovery-settled",
        "session-settled",
      ]),
    );
    expect(journal.filter((kind) => kind === "session-settled").length).toBe(1);
  });

  it("keeps the recovery idempotent: a second pass finds nothing to recover", async () => {
    const h = localHarness();
    seedUnacknowledgedSession(h, "rec-2");
    okOf(await h.gateway.recoverInterrupted(A));
    const second = okOf(await h.gateway.recoverInterrupted(A));
    expect(second.examined).toBe(0);
    expect(second.settled).toBe(0);
    const settlement = okOf(await h.gateway.awaitSettled(A, "rec-2"));
    expect(journalKindsOf(h, A, "rec-2").filter((kind) => kind === "session-settled").length).toBe(
      1,
    );
    expect(settlement.result).toBe("abc");
  });

  it("duplicate gateway delivery after recovery replays the recovered settlement", async () => {
    const h = localHarness();
    seedUnacknowledgedSession(h, "rec-3");
    okOf(await h.gateway.recoverInterrupted(A));
    const recovered = okOf(await h.gateway.awaitSettled(A, "rec-3"));

    const replayed = okOf(await h.gateway.submitExecution(A, requestOf("rec-3")));
    expect(replayed.replay).toBe(true);
    expect(replayed.settlement).toEqual(recovered);
    // Still exactly one settlement and one platform execution.
    expect(journalKindsOf(h, A, "rec-3").filter((kind) => kind === "session-settled").length).toBe(
      1,
    );
  });

  it("settles an unrecoverable resubmission as failed(interrupted) typed-ly", async () => {
    // The sandbox double rejects every submit: the resubmission cannot land.
    const h = sandboxHarness({ submitRejection: { message: "sandbox closed" } });
    const tenant = asExecutionTenantId("tenant-a");
    if (!tenant.ok) throw new Error("setup failed");
    const session = withEnvironmentSelected(
      createPendingSession(tenant.value, requestOf("rec-4", { environmentClass: "sandbox" }), {
        now: 1,
        submissionKey: submissionKeyOf(tenant.value, requestOf("rec-4").requestId),
      }),
      { environmentId: "sandbox-1", capabilityId: "sandbox-1" },
      2,
    );
    if (!h.sessions.putSession(session).ok) throw new Error("setup failed");

    const report = okOf(await h.gateway.recoverInterrupted(A));
    expect(report.failed).toBe(1);
    expect(report.outcomes[0]?.outcome).toBe("failed");
    const settlement = okOf(await h.gateway.awaitSettled(A, "rec-4"));
    expect(settlement.status).toBe("failed");
    expect(settlement.failure?.kind).toBe("transport-failed");
    expect(journalKindsOf(h, A, "rec-4")).toContain("failure-recorded");
  });
});

describe("W006 recovery: crash window 2 (reawait)", () => {
  it("settles an acknowledged-but-unawaited session from the platform envelope", async () => {
    const h = localHarness();
    const submitted = okOf(await h.gateway.submitExecution(A, requestOf("rec-5")));
    expect(submitted.session.submissionTicket).toBeDefined();
    // (crash: the gateway never awaited — the platform settles on its own)

    const report = okOf(await h.gateway.recoverInterrupted(A));
    expect(report.examined).toBe(1);
    expect(report.settled).toBe(1);
    const settlement = okOf(await h.gateway.awaitSettled(A, "rec-5"));
    expect(settlement.status).toBe("settled");
    expect(settlement.result).toBe("abc");
    expect(journalKindsOf(h, A, "rec-5")).toContain("recovery-settled");
  });

  it("recovery after a platform failure settles the failed envelope exactly once", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("rec-6", { workload: "boom" })));
    const report = okOf(await h.gateway.recoverInterrupted(A));
    expect(report.failed).toBe(1);
    const settlement = okOf(await h.gateway.awaitSettled(A, "rec-6"));
    expect(settlement.status).toBe("failed");
    expect(settlement.failure?.kind).toBe("platform-failed");
    expect(settlement.failure?.message).toBe("injected boom");
  });

  it("recovery settles a hung execution as failed(deadline-exceeded) via the deadline", async () => {
    const h = sandboxHarness({ hangAfterSteps: 1, stepLatencyMs: 1, startupLatencyMs: 1 });
    const deadline = Date.now() + 40;
    okOf(
      await h.gateway.submitExecution(
        A,
        requestOf("rec-7", { environmentClass: "sandbox", deadlineEpochMs: deadline }),
      ),
    );
    const report = okOf(await h.gateway.recoverInterrupted(A));
    expect(report.failed).toBe(1);
    const settlement = okOf(await h.gateway.awaitSettled(A, "rec-7"));
    expect(settlement.status).toBe("failed");
    expect(settlement.failure?.kind).toBe("deadline-exceeded");
  });
});

describe("W006 recovery: tenant scoping", () => {
  it("recovers only the requesting tenant's sessions", async () => {
    const h = localHarness();
    const B = scopeOf("tenant-b");
    seedUnacknowledgedSession(h, "rec-a");
    const tenant = asExecutionTenantId("tenant-b");
    if (!tenant.ok) throw new Error("setup failed");
    const foreign = withEnvironmentSelected(
      createPendingSession(tenant.value, requestOf("rec-b"), {
        now: 1,
        submissionKey: submissionKeyOf(tenant.value, requestOf("rec-b").requestId),
      }),
      { environmentId: "local-1", capabilityId: "local-1" },
      2,
    );
    if (!h.sessions.putSession(foreign).ok) throw new Error("setup failed");

    const reportA = okOf(await h.gateway.recoverInterrupted(A));
    expect(reportA.examined).toBe(1);
    expect(reportA.outcomes.map((outcome) => outcome.finalState)).toEqual(["settled"]);

    const reportB = okOf(await h.gateway.recoverInterrupted(B));
    expect(reportB.examined).toBe(1);
    expect(reportB.outcomes.map((outcome) => outcome.finalState)).toEqual(["settled"]);

    // Distinct sessions, distinct platforms executions, distinct settlements.
    const settlementA = okOf(await h.gateway.awaitSettled(A, "rec-a"));
    const settlementB = okOf(await h.gateway.awaitSettled(B, "rec-b"));
    expect(settlementA.tenantId).not.toBe(settlementB.tenantId);
  });
});

describe("W006 platform idempotency contract (transport level)", () => {
  it("resubmitting the same submission key returns the SAME ticket and never re-executes", async () => {
    const h = localHarness({ mode: "manual" });
    const seamLookup = h.seam.lookup({ capabilityClass: "local" });
    if (!seamLookup.ok) throw new Error("setup failed");
    const local = h.registry.resolveByCapabilityId("local-1");
    if (!local.ok) throw new Error("setup failed");

    const spec = {
      capability: seamLookup.handle,
      payload: JSON.stringify({ workload: "multi", input: {} }),
      payloadMediaType: "application/json",
      submissionKey: "exec:tenant-a:dup-key",
    } as const;
    const first = await local.value.transport.submit(spec);
    const second = await local.value.transport.submit(spec);
    expect(second.ticket).toBe(first.ticket);
    expect(second.replay).toBe(true);
    expect(first.replay).toBe(false);

    h.local?.releaseAll();
    const envelope = await local.value.transport.awaitCompletion(second.ticket);
    expect(envelope.status).toBe("settled");
    // Executed exactly once: cost total 25 (10 + 15), not 50.
    expect(envelope.cost?.reduce((sum, line) => sum + line.quantity, 0)).toBe(25);
  });
});
