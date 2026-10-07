/**
 * ACCEPTANCE: two-tenant isolation on EVERY store — foreign ids are
 * uniformly NOT-FOUND, indistinguishable from missing ids (no existence
 * leakage), for every concern the fabric persists.
 */
import { describe, expect, it } from "vitest";
import { TENANT_A, TENANT_B, makeConnectedProvider, makeFabric } from "./helpers.js";

describe("two-tenant isolation", () => {
  it("definitions: foreign tenant sees not-found, uniform with missing id", async () => {
    const harness = makeFabric();
    const definition = await harness.fabric.registry.registerRegistryProvider(
      TENANT_A,
      "anthropic",
    );
    const foreignError = await captureError(() =>
      harness.fabric.registry.getDefinition(TENANT_B, definition.id),
    );
    const missingError = await captureError(() =>
      harness.fabric.registry.getDefinition(TENANT_B, "provdef-nonexistent"),
    );
    // Same code, same shape — the only difference is the caller-supplied id.
    expect(foreignError?.code).toBe("PROVIDER_NOT_FOUND");
    expect(foreignError?.code).toBe(missingError?.code);
    expect(foreignError?.shape).toBe(missingError?.shape);
    expect(await harness.fabric.registry.listDefinitions(TENANT_B)).toEqual([]);
  });

  it("accounts: foreign tenant cannot read, connect or list", async () => {
    const harness = makeFabric();
    const { accountId } = await makeConnectedProvider(harness);
    const foreignError = await captureError(() =>
      harness.fabric.accounts.getAccount(TENANT_B, accountId),
    );
    const missingError = await captureError(() =>
      harness.fabric.accounts.getAccount(TENANT_B, "provacct-x"),
    );
    expect(foreignError?.code).toBe("ACCOUNT_NOT_FOUND");
    expect(foreignError?.code).toBe(missingError?.code);
    expect(foreignError?.shape).toBe(missingError?.shape);
    await expect(harness.fabric.accounts.connectAccount(TENANT_B, accountId)).rejects.toMatchObject(
      {
        code: "ACCOUNT_NOT_FOUND",
      },
    );
    expect(await harness.fabric.accounts.listAccounts(TENANT_B)).toEqual([]);
  });

  it("catalog: foreign tenant cannot read or bind foreign entries", async () => {
    const harness = makeFabric();
    const { definitionId } = await makeConnectedProvider(harness);
    const entry = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "isolated-model",
    });
    const foreignError = await captureError(() =>
      harness.fabric.catalog.getEntry(TENANT_B, entry.id),
    );
    const missingError = await captureError(() =>
      harness.fabric.catalog.getEntry(TENANT_B, "cat-x"),
    );
    expect(foreignError?.code).toBe("CATALOG_ENTRY_NOT_FOUND");
    expect(foreignError?.code).toBe(missingError?.code);
    expect(foreignError?.shape).toBe(missingError?.shape);
    await expect(
      harness.fabric.bindings.selectModel(TENANT_B, "cognition", entry.id),
    ).rejects.toMatchObject({ code: "CATALOG_ENTRY_NOT_FOUND" });
    expect(await harness.fabric.catalog.listCatalog(TENANT_B)).toEqual([]);
  });

  it("bindings: foreign tenant sees not-found for foreign binding ids", async () => {
    const harness = makeFabric();
    const { definitionId } = await makeConnectedProvider(harness);
    const entry = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "isolated-model",
    });
    const { active } = await harness.fabric.bindings.selectModel(TENANT_A, "cognition", entry.id);
    const foreignError = await captureError(() =>
      harness.fabric.bindings.getBinding(TENANT_B, active.id),
    );
    const missingError = await captureError(() =>
      harness.fabric.bindings.getBinding(TENANT_B, "bind-x"),
    );
    expect(foreignError?.code).toBe("BINDING_NOT_FOUND");
    expect(foreignError?.code).toBe(missingError?.code);
    expect(foreignError?.shape).toBe(missingError?.shape);
    expect(await harness.fabric.bindings.getActiveBinding(TENANT_B, "cognition")).toBeNull();
  });

  it("evidence + health + availability: subject logs are tenant-scoped", async () => {
    const harness = makeFabric();
    const { accountId } = await makeConnectedProvider(harness);
    const subject = { kind: "provider-account", accountId } as const;
    // Tenant A has observations from the connect probe:
    expect((await harness.fabric.observations.availabilityOf(TENANT_A, subject)).state).toBe(
      "available",
    );
    // Tenant B sees nothing — not even that the subject exists:
    expect((await harness.fabric.observations.availabilityOf(TENANT_B, subject)).state).toBe(
      "unknown",
    );
    expect(await harness.fabric.observations.listEvidence(TENANT_B, subject)).toEqual([]);
    expect(await harness.fabric.observations.currentHealth(TENANT_B, subject)).toEqual({
      status: "unknown",
      observedAt: null,
    });
  });

  it("stores: raw store faces are tenant-scoped too (uniform null)", async () => {
    const harness = makeFabric();
    const { definitionId, accountId } = await makeConnectedProvider(harness);
    const entry = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "isolated-model",
    });
    const { active } = await harness.fabric.bindings.selectModel(TENANT_A, "cognition", entry.id);
    expect(await harness.store.definitions.getById(TENANT_B, definitionId)).toBeNull();
    expect(await harness.store.accounts.getById(TENANT_B, accountId)).toBeNull();
    expect(await harness.store.catalog.getById(TENANT_B, entry.id)).toBeNull();
    expect(await harness.store.bindings.getById(TENANT_B, active.id)).toBeNull();
    const evidenceRows = await harness.store.evidence.listByTenant(TENANT_A);
    for (const row of evidenceRows) {
      expect(await harness.store.evidence.getById(TENANT_B, row.id)).toBeNull();
    }
  });

  it("tenant B can build a fully independent fabric life on the same store", async () => {
    const harness = makeFabric();
    await makeConnectedProvider(harness);
    const definitionB = await harness.fabric.registry.registerRegistryProvider(TENANT_B, "openai");
    const accountB = await harness.fabric.accounts.createAccount(TENANT_B, {
      providerDefinitionId: definitionB.id,
      label: "b-only",
      credentials: [{ kind: "api-key", secretRef: "secret:b" }],
    });
    harness.probe.succeed();
    await harness.fabric.accounts.connectAccount(TENANT_B, accountB.id);
    expect((await harness.fabric.accounts.listAccounts(TENANT_B)).map((a) => a.id)).toEqual([
      accountB.id,
    ]);
    expect((await harness.fabric.accounts.listAccounts(TENANT_A)).length).toBe(1);
  });
});

async function captureError(
  action: () => Promise<unknown>,
): Promise<{ code: string; shape: string; notFound: boolean } | null> {
  try {
    await action();
    return null;
  } catch (error) {
    if (error instanceof Error) {
      const code = (error as { code?: string }).code ?? "";
      const notFound = (error as { notFound?: boolean }).notFound === true;
      // Shape = entity prefix of the message (id stripped): foreign and
      // missing failures must be indistinguishable beyond the id the caller
      // itself provided.
      const shape = error.message.split(" ").slice(0, 2).join(" ");
      return { code, shape, notFound };
    }
    throw error;
  }
}
