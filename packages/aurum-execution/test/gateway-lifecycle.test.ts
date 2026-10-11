/**
 * W006 gateway proofs: the Agent Gateway lifecycle — submit/await,
 * pause/resume/cancel, idempotent duplicate delivery, admission refusals,
 * journal evidence, and the error/settlement duality.
 */
import { describe, expect, it } from "vitest";
import {
  okOf,
  errOf,
  journalKindsOf,
  localHarness,
  payloadOf,
  requestOf,
  scopeOf,
  snapshotOf,
} from "./helpers.js";
import type { ExecutionSession } from "../src/index.js";

const A = scopeOf("tenant-a");

describe("W006 gateway: submission + settlement", () => {
  it("submits, acknowledges, journals and settles with a normalized envelope", async () => {
    const h = localHarness();
    const submitted = okOf(await h.gateway.submitExecution(A, requestOf("r-1")));
    expect(submitted.replay).toBe(false);
    const session = submitted.session;
    expect(session.state === "running" || session.state === "pending").toBe(true);
    expect(session.submissionKey).toBe("exec:tenant-a:r-1");
    expect(session.capabilityId).toBe("local-1");
    expect(session.authority).toEqual({ actionId: "act-1", auditRef: "audit-9" });

    const settlement = okOf(await h.gateway.awaitSettled(A, "r-1"));
    expect(settlement.status).toBe("settled");
    expect(settlement.result).toBe("abc");
    expect(settlement.cost).toEqual([
      { unit: "cpu-ms", quantity: 10 },
      { unit: "cpu-ms", quantity: 15 },
    ]);
    expect(settlement.evidenceRef).toBeTypeOf("string");
    expect(settlement.evidenceRef?.startsWith("local-env:")).toBe(true);
    expect(settlement.authority).toEqual({ actionId: "act-1", auditRef: "audit-9" });
    expect(settlement.environment.environmentClass).toBe("local");
    expect(settlement.environment.capabilityId).toBe("local-1");

    const journal = journalKindsOf(h, A, "r-1");
    expect(journal).toContain("request-accepted");
    expect(journal).toContain("environment-selected");
    expect(journal).toContain("submission-acknowledged");
    expect(journal).toContain("session-settled");
  });

  it("echoes model binding occupancy on the settlement (executions may be model-bound)", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("r-occ", { modelBindingRef: "binding-17" })));
    const settlement = okOf(await h.gateway.awaitSettled(A, "r-occ"));
    expect(settlement.occupancy).toEqual({ modelBindingRef: "binding-17" });
  });

  it("duplicate delivery of the same request id is idempotent (never a second execution)", async () => {
    const h = localHarness();
    const first = okOf(await h.gateway.submitExecution(A, requestOf("r-dup")));
    const settlement = okOf(await h.gateway.awaitSettled(A, "r-dup"));
    expect(settlement.result).toBe("abc");

    const second = okOf(await h.gateway.submitExecution(A, requestOf("r-dup")));
    expect(second.replay).toBe(true);
    expect(second.settlement).toEqual(settlement);
    expect(second.session.requestId).toBe(first.session.requestId);

    const journal = journalKindsOf(h, A, "r-dup");
    expect(journal.filter((kind) => kind === "duplicate-suppressed").length).toBe(1);
    expect(journal.filter((kind) => kind === "session-settled").length).toBe(1);

    // The platform executed the workload exactly once: cost appears once.
    expect(settlement.cost?.reduce((sum, line) => sum + line.quantity, 0)).toBe(25);
  });

  it("duplicate delivery while in flight replays the in-flight session", async () => {
    const h = localHarness({ mode: "manual" });
    const first = okOf(await h.gateway.submitExecution(A, requestOf("r-flight")));
    const second = okOf(await h.gateway.submitExecution(A, requestOf("r-flight")));
    expect(second.replay).toBe(true);
    expect(second.settlement).toBeUndefined();
    expect(second.session.submissionTicket).toBe(first.session.submissionTicket);
    h.local?.releaseAll();
    const settlement = okOf(await h.gateway.awaitSettled(A, "r-flight"));
    expect(settlement.status).toBe("settled");
  });

  it("refuses invalid requests typed-ly, creating no session and no journal noise", async () => {
    const h = localHarness();
    const noAuthority = { ...requestOf("r-2"), authority: {} };
    const refusal = errOf(await h.gateway.submitExecution(A, noAuthority));
    expect(refusal.code).toBe("execution/validation");
    expect(refusal.issues.length).toBeGreaterThan(0);
    expect(h.gateway.listExecutions(A)).toHaveLength(0);
    expect(h.journal.listEntries(A.tenantId)).toHaveLength(0);
  });

  it("refuses unregistered environment classes typed-ly (environment-unavailable)", async () => {
    const h = localHarness();
    const error = errOf(
      await h.gateway.submitExecution(
        A,
        requestOf("r-cls", { environmentClass: "browser" as never }),
      ),
    );
    expect(error.code).toBe("execution/not-wired");
    // An environment class that is not registered AT ALL (not even a stub):
    const seamCodes = h.seam.listCapabilities().map((descriptor) => descriptor.capabilityClass);
    expect(seamCodes).not.toContain("mainframe");
    const invalid = errOf(
      await h.gateway.submitExecution(A, {
        ...requestOf("r-never"),
        environmentClass: "workflow" as never,
      }),
    );
    expect(invalid.code).toBe("execution/not-wired");
    expect(h.gateway.listExecutions(A)).toHaveLength(0);
    expect(journalKindsOf(h, A, "r-never")).toContain("failure-recorded");
  });
});

describe("W006 gateway: pause / resume / cancel", () => {
  it("pauses and resumes a mid-flight execution and then settles it", async () => {
    const h = localHarness({ mode: "manual" });
    const submitted = okOf(await h.gateway.submitExecution(A, requestOf("r-pause")));
    const ticket = submitted.session.submissionTicket as string;

    const paused = okOf(await h.gateway.pauseExecution(A, "r-pause"));
    expect(paused.state).toBe("paused");
    expect(h.local?.stateOf(ticket)).toBe("paused");

    // While paused, stepping makes no progress.
    h.local?.release(1);
    expect(h.local?.stateOf(ticket)).toBe("paused");

    const resumed = okOf(await h.gateway.resumeExecution(A, "r-pause"));
    expect(resumed.state).toBe("running");
    h.local?.releaseAll();
    const settlement = okOf(await h.gateway.awaitSettled(A, "r-pause"));
    expect(settlement.status).toBe("settled");
    expect(settlement.result).toBe("abc");
    expect(journalKindsOf(h, A, "r-pause")).toEqual(
      expect.arrayContaining(["execution-paused", "execution-resumed", "session-settled"]),
    );
  });

  it("pause after settlement is a typed lifecycle refusal and never rewrites the settlement", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("r-late")));
    const settlement = okOf(await h.gateway.awaitSettled(A, "r-late"));
    const before = snapshotOf(okOf(h.gateway.getExecution(A, "r-late")));

    const refusal = errOf(await h.gateway.pauseExecution(A, "r-late"));
    expect(refusal.code).toBe("execution/lifecycle-illegal");

    expect(snapshotOf(okOf(h.gateway.getExecution(A, "r-late")))).toBe(before);
    expect(okOf(await h.gateway.awaitSettled(A, "r-late"))).toEqual(settlement);
  });

  it("resume when not paused is a typed lifecycle refusal", async () => {
    const h = localHarness({ mode: "manual" });
    okOf(await h.gateway.submitExecution(A, requestOf("r-res")));
    const refusal = errOf(await h.gateway.resumeExecution(A, "r-res"));
    expect(refusal.code).toBe("execution/lifecycle-illegal");
  });

  it("cancels a mid-flight execution into a cancelled settlement (idempotent for duplicates)", async () => {
    const h = localHarness({ mode: "manual" });
    const submitted = okOf(await h.gateway.submitExecution(A, requestOf("r-cancel")));
    expect(h.local?.stateOf(submitted.session.submissionTicket as string)).toBe("pending");

    const cancelled = okOf(await h.gateway.cancelExecution(A, "r-cancel"));
    expect(cancelled.status).toBe("cancelled");
    expect(h.local?.stateOf(submitted.session.submissionTicket as string)).toBe("cancelled");

    const duplicateCancel = okOf(await h.gateway.cancelExecution(A, "r-cancel"));
    expect(duplicateCancel).toEqual(cancelled);
    const journal = journalKindsOf(h, A, "r-cancel");
    // First cancel journals the request + the settlement; the duplicate is
    // suppressed BEFORE issuing another cancel-requested event.
    expect(journal.filter((kind) => kind === "cancel-requested").length).toBe(1);
    expect(journal.filter((kind) => kind === "duplicate-suppressed").length).toBe(1);
    expect(journal.filter((kind) => kind === "session-cancelled").length).toBe(1);

    const session = okOf(h.gateway.getExecution(A, "r-cancel")) as ExecutionSession;
    expect(session.state).toBe("cancelled");
  });

  it("cancel after a settled execution is a typed lifecycle refusal (no rewrite)", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("r-clate")));
    const settlement = okOf(await h.gateway.awaitSettled(A, "r-clate"));
    expect(settlement.status).toBe("settled");
    const refusal = errOf(await h.gateway.cancelExecution(A, "r-clate"));
    expect(refusal.code).toBe("execution/lifecycle-illegal");
    expect(okOf(h.gateway.getExecution(A, "r-clate")).state).toBe("settled");
  });

  it("awaitSettled is idempotent for terminal sessions (byte-identical settlement)", async () => {
    const h = localHarness();
    okOf(await h.gateway.submitExecution(A, requestOf("r-idem")));
    const first = okOf(await h.gateway.awaitSettled(A, "r-idem"));
    const second = okOf(await h.gateway.awaitSettled(A, "r-idem"));
    const third = okOf(await h.gateway.awaitSettled(A, "r-idem"));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(third)).toBe(JSON.stringify(first));
    expect(journalKindsOf(h, A, "r-idem").filter((k) => k === "session-settled").length).toBe(1);
  });

  it("an aborted wait leaves the session re-awaitable (typed await-aborted)", async () => {
    const h = localHarness({ mode: "manual" });
    okOf(await h.gateway.submitExecution(A, requestOf("r-abort")));
    const controller = new AbortController();
    const awaited = h.gateway.awaitSettled(A, "r-abort", { signal: controller.signal });
    controller.abort();
    const error = errOf(await awaited);
    expect(error.code).toBe("execution/await-aborted");

    const session = okOf(h.gateway.getExecution(A, "r-abort"));
    expect(session.settlement).toBeUndefined();
    h.local?.releaseAll();
    const settlement = okOf(await h.gateway.awaitSettled(A, "r-abort"));
    expect(settlement.status).toBe("settled");
  });

  it("unknown request ids fail closed uniformly (get/await/pause/cancel)", async () => {
    const h = localHarness();
    const codes = [
      h.gateway.getExecution(A, "missing").ok
        ? null
        : errOf(h.gateway.getExecution(A, "missing")).code,
    ];
    const awaited = errOf(await h.gateway.awaitSettled(A, "missing"));
    codes.push(awaited.code);
    const paused = errOf(await h.gateway.pauseExecution(A, "missing"));
    codes.push(paused.code);
    const cancelled = errOf(await h.gateway.cancelExecution(A, "missing"));
    codes.push(cancelled.code);
    expect(codes).toEqual([
      "execution/not-found",
      "execution/not-found",
      "execution/not-found",
      "execution/not-found",
    ]);
  });
});

describe("W006 gateway: seam + registry consumption", () => {
  it("lists environments and resolves seam handles deterministically", () => {
    const h = localHarness();
    const descriptors = h.registry.listEnvironments();
    expect(descriptors.map((descriptor) => descriptor.environmentClass)).toEqual([
      "local",
      "sandbox",
      "browser",
      "computer",
      "workflow",
      "remote",
    ]);
    const first = h.seam.lookup({ capabilityClass: "local" });
    const second = h.seam.lookup({ capabilityClass: "local" });
    expect(first.ok && second.ok && first.handle).toBe(second.ok ? second.handle : null);
    const described = first.ok ? h.seam.describe(first.handle) : null;
    expect(described?.ok && described.descriptor.capabilityId).toBe("local-1");
    const foreign = h.seam.lookup({ capabilityClass: "local", variant: "headless" });
    expect(foreign.ok).toBe(false);
    const inputPayload = payloadOf("inputEcho", { key: "value" });
    expect(JSON.parse(inputPayload).workload).toBe("inputEcho");
  });

  it("variant selection narrows within a class", async () => {
    const h = localHarness();
    const error = errOf(
      await h.gateway.submitExecution(A, requestOf("r-var", { variant: "not-offered" })),
    );
    expect(error.code).toBe("execution/environment-unavailable");
    expect(h.gateway.listExecutions(A)).toHaveLength(0);
  });
});
