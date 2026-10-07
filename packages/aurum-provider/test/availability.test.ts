/**
 * ACCEPTANCE: explicit unavailable/unknown states everywhere; "listed in
 * catalog" NEVER equals "available". Availability is evaluated ONLY from
 * recorded observations; missing or stale observations produce the explicit
 * unknown state with visible uncertainty.
 */
import { describe, expect, it } from "vitest";
import { TENANT_A, makeConnectedProvider, makeFabric } from "./helpers.js";

describe("provider availability and health", () => {
  it("a listed catalog model with no observations is UNKNOWN, never available", async () => {
    const harness = makeFabric();
    const { definitionId } = await makeConnectedProvider(harness);
    const entry = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "listed-but-unobserved",
    });
    const availability = await harness.fabric.observations.availabilityOf(TENANT_A, {
      kind: "model",
      catalogEntryId: entry.id,
    });
    expect(availability.state).toBe("unknown");
    expect(availability.lastObservedAt).toBeNull();
    expect(availability.stale).toBe(false);
  });

  it("marking available/unavailable produces explicit states with reasons", async () => {
    const harness = makeFabric();
    const { definitionId } = await makeConnectedProvider(harness);
    const entry = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "observed-model",
    });
    const subject = { kind: "model", catalogEntryId: entry.id } as const;
    await harness.fabric.observations.markUnavailable(TENANT_A, subject, "capacity full");
    expect((await harness.fabric.observations.availabilityOf(TENANT_A, subject)).state).toBe(
      "unavailable",
    );
    await harness.fabric.observations.markAvailable(TENANT_A, subject, "capacity recovered");
    const available = await harness.fabric.observations.availabilityOf(TENANT_A, subject);
    expect(available.state).toBe("available");
    expect(available.reason).toBe("capacity recovered");
  });

  it("availability observations age into explicit unknown + stale", async () => {
    const harness = makeFabric();
    const { definitionId } = await makeConnectedProvider(harness);
    const entry = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "aging-model",
    });
    const subject = { kind: "model", catalogEntryId: entry.id } as const;
    await harness.fabric.observations.markAvailable(TENANT_A, subject, "fresh now");
    // Fresh observation:
    expect((await harness.fabric.observations.availabilityOf(TENANT_A, subject)).state).toBe(
      "available",
    );
    // Far future evaluation window: the observation is stale -> unknown.
    const future = makeFabric("2030-01-01T00:00:00.000Z");
    // Reuse the same store: simulate by evaluating with a freshness of 0.
    const expired = await harness.fabric.observations.availabilityOf(TENANT_A, subject, {
      freshnessMs: 0,
    });
    expect(expired.state).toBe("unknown");
    expect(expired.stale).toBe(true);
    expect(expired.lastObservedAt).not.toBeNull();
    expect(future).toBeDefined();
  });

  it("connect probes drive account availability; disconnect does not fabricate availability", async () => {
    const harness = makeFabric();
    const definition = await harness.fabric.registry.registerRegistryProvider(
      TENANT_A,
      "anthropic",
    );
    const account = await harness.fabric.accounts.createAccount(TENANT_A, {
      providerDefinitionId: definition.id,
      label: "primary",
      credentials: [{ kind: "api-key", secretRef: "secret:x" }],
    });
    const subject = { kind: "provider-account", accountId: account.id } as const;
    // Before any probe: unknown.
    expect((await harness.fabric.observations.availabilityOf(TENANT_A, subject)).state).toBe(
      "unknown",
    );
    harness.probe.succeed();
    await harness.fabric.accounts.connectAccount(TENANT_A, account.id);
    expect((await harness.fabric.observations.availabilityOf(TENANT_A, subject)).state).toBe(
      "available",
    );
    // Disconnect changes connection state but is NOT an availability claim:
    await harness.fabric.accounts.disconnectAccount(TENANT_A, account.id);
    const after = await harness.fabric.observations.availabilityOf(TENANT_A, subject);
    expect(after.state).toBe("available"); // last observation still stands
    expect(after.stale).toBe(false);
  });

  it("health is an observation log with explicit unknown default", async () => {
    const harness = makeFabric();
    const { definitionId } = await makeConnectedProvider(harness);
    const entry = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "health-model",
    });
    const subject = { kind: "model-endpoint", definitionId, modelKey: entry.modelKey } as const;
    expect((await harness.fabric.observations.currentHealth(TENANT_A, subject)).status).toBe(
      "unknown",
    );
    await harness.fabric.observations.recordHealth(TENANT_A, {
      subject,
      status: "degraded",
      detail: "elevated latency",
    });
    const degraded = await harness.fabric.observations.currentHealth(TENANT_A, subject);
    expect(degraded.status).toBe("degraded");
    expect(degraded.observedAt).not.toBeNull();
    await harness.fabric.observations.recordHealth(TENANT_A, { subject, status: "healthy" });
    expect((await harness.fabric.observations.currentHealth(TENANT_A, subject)).status).toBe(
      "healthy",
    );
  });

  it("sanitizes availability reasons and health details at record time", async () => {
    const harness = makeFabric();
    const { definitionId } = await makeConnectedProvider(harness);
    const entry = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "sanitize-model",
    });
    const subject = { kind: "model", catalogEntryId: entry.id } as const;
    await harness.fabric.observations.markUnavailable(
      TENANT_A,
      subject,
      "rejected key sk-abc123def456ghi789jkl",
    );
    const availability = await harness.fabric.observations.availabilityOf(TENANT_A, subject);
    expect(availability.reason).not.toContain("sk-abc123def456ghi789jkl");
    expect(availability.reason).toContain("[REDACTED]");
  });
});
