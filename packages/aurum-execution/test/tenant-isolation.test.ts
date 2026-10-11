/**
 * W006 tenant-scoping proofs: executions are tenant-scoped; foreign
 * execution references are uniformly not-found (no existence leakage,
 * spec/ARCHITECTURE.md "Tenant isolation"), and the idempotency key
 * derivation is tenant-disjoint (two tenants may use the same request id
 * without colliding on the platform).
 */
import { describe, expect, it } from "vitest";
import { asExecutionTenantId, submissionKeyOf } from "../src/index.js";
import { errOf, localHarness, okOf, requestOf, scopeOf, journalKindsOf } from "./helpers.js";

const A = scopeOf("tenant-a");
const B = scopeOf("tenant-b");

describe("W006 tenant isolation (uniform not-found)", () => {
  it("hides tenant A sessions from tenant B identically to never-existing ids", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("iso-tenant-1")));
    okOf(await h.gateway.awaitSettled(A, "iso-tenant-1"));

    const foreign = h.gateway.getExecution(B, "iso-tenant-1");
    const missing = h.gateway.getExecution(B, "never-existed");
    expect(foreign.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (!foreign.ok && !missing.ok) {
      // Byte-identical failures: no existence leakage.
      expect(foreign.error.message).toBe(missing.error.message);
      expect(foreign.error.code).toBe(missing.error.code);
    }
  });

  it("fails closed on foreign awaits, pauses and cancels (uniform not-found)", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("iso-tenant-2")));

    const awaited = errOf(await h.gateway.awaitSettled(B, "iso-tenant-2"));
    expect(awaited.code).toBe("execution/not-found");
    const paused = errOf(await h.gateway.pauseExecution(B, "iso-tenant-2"));
    expect(paused.code).toBe("execution/not-found");
    const cancelled = errOf(await h.gateway.cancelExecution(B, "iso-tenant-2"));
    expect(cancelled.code).toBe("execution/not-found");
    // The owner's session is untouched by the foreign control attempts.
    expect(okOf(h.gateway.getExecution(A, "iso-tenant-2")).settlement).toBeUndefined();
  });

  it("scopes session listing per tenant", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("list-a")));
    okOf(await h.gateway.submitExecution(B, requestOf("list-b")));
    expect(h.gateway.listExecutions(A).map((session) => session.requestId as string)).toEqual([
      "list-a",
    ]);
    expect(h.gateway.listExecutions(B).map((session) => session.requestId as string)).toEqual([
      "list-b",
    ]);
  });

  it("scopes the journal per tenant (foreign reads see nothing)", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("journal-a")));
    okOf(await h.gateway.awaitSettled(A, "journal-a"));
    expect(journalKindsOf(h, A, "journal-a").length).toBeGreaterThan(0);
    expect(h.journal.listEntries(B.tenantId)).toHaveLength(0);
  });

  it("recovery for one tenant never touches another tenant's sessions", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("rec-tenant-a")));
    const reportB = okOf(await h.gateway.recoverInterrupted(B));
    expect(reportB.examined).toBe(0);
    const reportA = okOf(await h.gateway.recoverInterrupted(A));
    expect(reportA.examined).toBe(1);
    expect(reportA.settled).toBe(1);
  });

  it("derives tenant-disjoint submission keys (same request id, two tenants, two executions)", async () => {
    const tenantA = asExecutionTenantId("tenant-a");
    const tenantB = asExecutionTenantId("tenant-b");
    if (!tenantA.ok || !tenantB.ok) throw new Error("setup failed");
    const requestId = requestOf("shared-id").requestId;
    expect(submissionKeyOf(tenantA.value, requestId)).toBe("exec:tenant-a:shared-id");
    expect(submissionKeyOf(tenantB.value, requestId)).toBe("exec:tenant-b:shared-id");
    expect(submissionKeyOf(tenantA.value, requestId)).not.toBe(
      submissionKeyOf(tenantB.value, requestId),
    );

    // End-to-end: both tenants execute the same request id independently.
    const h = localHarness();
    const a = okOf(await h.gateway.submitExecution(A, requestOf("shared-id")));
    const b = okOf(await h.gateway.submitExecution(B, requestOf("shared-id")));
    expect(a.session.submissionTicket).not.toBe(b.session.submissionTicket);
    const settlementA = okOf(await h.gateway.awaitSettled(A, "shared-id"));
    const settlementB = okOf(await h.gateway.awaitSettled(B, "shared-id"));
    expect(settlementA.tenantId).toBe("tenant-a");
    expect(settlementB.tenantId).toBe("tenant-b");
    // Distinct evidence references (distinct platform executions).
    expect(settlementA.evidenceRef).not.toBe(settlementB.evidenceRef);
  });
});
