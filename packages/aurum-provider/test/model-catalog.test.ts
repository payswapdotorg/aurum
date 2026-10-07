/**
 * ACCEPTANCE: manual AND discovered model entries as FIRST-CLASS catalog
 * rows. Same record shape, same queries, both bindable; source is
 * provenance, not a privilege flag. Failed discovery leaves the catalog
 * untouched and records honest failure evidence.
 */
import { describe, expect, it } from "vitest";
import { API_KEY_REF, TENANT_A, makeConnectedProvider, makeFabric } from "./helpers.js";

describe("model catalog", () => {
  it("adds manual entries that behave exactly like discovered ones", async () => {
    const harness = makeFabric();
    const { definitionId } = await makeConnectedProvider(harness);
    const manual = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "claude-opus-4-6",
      displayName: "Opus (manual)",
      capabilities: ["chat", "vision"],
      contextWindowTokens: 200_000,
    });
    expect(manual.source).toEqual({ kind: "manual" });
    const fetched = await harness.fabric.catalog.getEntry(TENANT_A, manual.id);
    expect(fetched.modelKey).toBe("claude-opus-4-6");
    const listed = await harness.fabric.catalog.listCatalog(TENANT_A);
    expect(listed.map((entry) => entry.id)).toContain(manual.id);
  });

  it("imports discovered entries through the discovery seam", async () => {
    const harness = makeFabric();
    const { definitionId, accountId } = await makeConnectedProvider(harness);
    harness.discovery.returns([
      { modelKey: "claude-sonnet-4-5", displayName: "Sonnet 4.5", capabilities: ["chat"] },
      { modelKey: "claude-haiku-4-5", capabilities: ["chat", "streaming"] },
    ]);
    const outcome = await harness.fabric.catalog.runDiscovery(TENANT_A, { accountId });
    expect(outcome.ok).toBe(true);
    expect(outcome.imported.map((entry) => entry.modelKey).sort()).toEqual([
      "claude-haiku-4-5",
      "claude-sonnet-4-5",
    ]);
    for (const entry of outcome.imported) {
      expect(entry.source.kind).toBe("discovered");
      expect(entry.providerDefinitionId).toBe(definitionId);
    }
    // The seam received references only:
    expect(harness.discovery.requests[0]?.credentialRefs).toEqual([API_KEY_REF]);
  });

  it("manual and discovered rows are interchangeable for bindings (first-class)", async () => {
    const harness = makeFabric();
    const { definitionId, accountId } = await makeConnectedProvider(harness);
    const manual = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "manual-model-x",
    });
    harness.discovery.returns([{ modelKey: "discovered-model-y" }]);
    const outcome = await harness.fabric.catalog.runDiscovery(TENANT_A, { accountId });
    const discovered = outcome.imported[0];
    expect(discovered).toBeDefined();
    // Both bindable through the same path:
    await harness.fabric.bindings.selectModel(TENANT_A, "analysis", manual.id);
    await harness.fabric.bindings.selectModel(TENANT_A, "background", discovered!.id);
    expect(
      (await harness.fabric.bindings.getActiveBinding(TENANT_A, "analysis"))?.catalogEntryId,
    ).toBe(manual.id);
    expect(
      (await harness.fabric.bindings.getActiveBinding(TENANT_A, "background"))?.catalogEntryId,
    ).toBe(discovered!.id);
  });

  it("discovery corroborates existing manual entries instead of overwriting them", async () => {
    const harness = makeFabric();
    const { definitionId, accountId } = await makeConnectedProvider(harness);
    const manual = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "claude-sonnet-4-5",
      displayName: "Kept Name",
    });
    harness.discovery.returns([{ modelKey: "claude-sonnet-4-5" }, { modelKey: "claude-opus-4-6" }]);
    const outcome = await harness.fabric.catalog.runDiscovery(TENANT_A, { accountId });
    expect(outcome.corroborated.map((entry) => entry.id)).toEqual([manual.id]);
    expect(outcome.imported.map((entry) => entry.modelKey)).toEqual(["claude-opus-4-6"]);
    const stillManual = await harness.fabric.catalog.getEntry(TENANT_A, manual.id);
    expect(stillManual.source).toEqual({ kind: "manual" });
    expect(stillManual.displayName).toBe("Kept Name");
  });

  it("failed discovery leaves the catalog untouched and records failure evidence", async () => {
    const harness = makeFabric();
    const { definitionId, accountId } = await makeConnectedProvider(harness);
    await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "only-manual",
    });
    harness.discovery.fails("503 with Bearer abcdefghijklmnop inside error text");
    const outcome = await harness.fabric.catalog.runDiscovery(TENANT_A, { accountId });
    expect(outcome.ok).toBe(false);
    expect(outcome.imported).toEqual([]);
    const catalog = await harness.fabric.catalog.listCatalog(TENANT_A);
    expect(catalog.map((entry) => entry.modelKey)).toEqual(["only-manual"]);
    const evidence = await harness.fabric.observations.listEvidence(TENANT_A, {
      kind: "provider-definition",
      definitionId,
    });
    const failure = evidence.find((row) => row.kind === "discovery-run");
    expect(failure?.outcome).toBe("failure");
    // Error text was sanitized before recording:
    expect(failure?.detail).not.toContain("abcdefghijklmnop");
  });

  it("rejects manual entries for unknown providers and duplicate model keys", async () => {
    const harness = makeFabric();
    const { definitionId } = await makeConnectedProvider(harness);
    await expect(
      harness.fabric.catalog.addManualEntry(TENANT_A, {
        providerDefinitionId: "provdef-missing",
        modelKey: "x",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_FOUND" });
    await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "dup-model",
    });
    await expect(
      harness.fabric.catalog.addManualEntry(TENANT_A, {
        providerDefinitionId: definitionId,
        modelKey: "dup-model",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });
});
