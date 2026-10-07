/**
 * Cross-package integration: a REAL @aurum/provider fabric (in-memory
 * doubles, fixture transports) wired to the agent fabric through the
 * ProviderFabricBindingLookup bridge. Proves the packages compose through
 * their public entrypoints and that the full provider-swap + body-swap
 * journey preserves body identity byte-for-byte end to end.
 */
import { describe, expect, it } from "vitest";
import {
  ProviderFabricBindingLookup,
  SequentialIdGenerator,
  SteppingClock,
  asTenantId,
  createAgentFabric,
  createInMemoryAgentFabricStore,
} from "../src/index.js";
import {
  FixtureAccountProbe,
  FixtureProviderDiscovery,
  asTenantId as providerTenant,
  createInMemoryProviderFabricStore,
  createProviderFabric,
} from "@aurum/provider";

// Same string values; separate branded constants keep each package's
// types honest (brands vanish at runtime; see the TenantId reconciliation
// note in adapters/provider-fabric-lookup.ts).
const TENANT_A = asTenantId("tenant-a");
const TENANT_B = asTenantId("tenant-b");
const TENANT_A_PROVIDER = providerTenant("tenant-a");

function makeStack() {
  const providerFabric = createProviderFabric({
    store: createInMemoryProviderFabricStore(),
    clock: new SteppingClock("2026-01-01T00:00:00.000Z", 1000),
    ids: new SequentialIdGenerator("prov-id"),
    discovery: new FixtureProviderDiscovery(),
    accountProbe: new FixtureAccountProbe(),
  });
  const agentFabric = createAgentFabric({
    store: createInMemoryAgentFabricStore(),
    clock: new SteppingClock("2026-01-01T00:00:00.000Z", 5000),
    ids: new SequentialIdGenerator("agent-id"),
    bindingLookup: new ProviderFabricBindingLookup(providerFabric),
  });
  return { providerFabric, agentFabric };
}

async function activeProviderBinding(stack: ReturnType<typeof makeStack>, modelKey: string) {
  const definition = await stack.providerFabric.registry.registerRegistryProvider(
    TENANT_A_PROVIDER,
    "anthropic",
  );
  const entry = await stack.providerFabric.catalog.addManualEntry(TENANT_A_PROVIDER, {
    providerDefinitionId: definition.id,
    modelKey,
  });
  const selection = await stack.providerFabric.bindings.selectModel(
    TENANT_A_PROVIDER,
    "cognition",
    entry.id,
  );
  return selection.active.id;
}

describe("agent <-> provider integration (public entrypoints only)", () => {
  it("end-to-end: provider binding swap + body model swap keeps body identity byte-for-byte", async () => {
    const stack = makeStack();
    const body = await stack.agentFabric.bodies.createBody(TENANT_A, {
      displayName: "Journey Agent",
      role: { title: "Ops" },
      memoryPolicy: { retention: "persistent", sharing: "organization" },
    });
    const bindingA = await activeProviderBinding(stack, "claude-sonnet-4-5");

    const before = JSON.stringify(await stack.agentFabric.bodies.getBody(TENANT_A, body.id));
    // Attach while bindingA is active:
    await stack.agentFabric.modelBindings.attachModel(TENANT_A, body.id, {
      purpose: "cognition",
      modelBindingRef: bindingA,
    });
    expect(JSON.stringify(await stack.agentFabric.bodies.getBody(TENANT_A, body.id))).toBe(before);
    // Provider-side swap: selecting opus for the same purpose supersedes
    // bindingA and activates bindingB — the body re-attaches to bindingB.
    const bindingB = await activeProviderBinding(stack, "claude-opus-4-6");
    await stack.agentFabric.modelBindings.attachModel(TENANT_A, body.id, {
      purpose: "cognition",
      modelBindingRef: bindingB,
    });
    expect(JSON.stringify(await stack.agentFabric.bodies.getBody(TENANT_A, body.id))).toBe(before);
    const current = await stack.agentFabric.modelBindings.currentAttachment(
      TENANT_A,
      body.id,
      "cognition",
    );
    expect(current?.modelBindingRef).toBe(bindingB);
    // The referenced provider binding resolves to the expected catalog entry:
    const providerBinding = await stack.providerFabric.bindings.getBinding(
      TENANT_A_PROVIDER,
      bindingB,
    );
    expect(providerBinding.status).toBe("active");
  });

  it("rejects attachments to superseded provider bindings (swaps require a live reference)", async () => {
    const stack = makeStack();
    const body = await stack.agentFabric.bodies.createBody(TENANT_A, {
      displayName: "Strict Agent",
      role: { title: "Ops" },
    });
    const definition = await stack.providerFabric.registry.registerRegistryProvider(
      TENANT_A_PROVIDER,
      "anthropic",
    );
    const entryA = await stack.providerFabric.catalog.addManualEntry(TENANT_A_PROVIDER, {
      providerDefinitionId: definition.id,
      modelKey: "model-a",
    });
    const entryB = await stack.providerFabric.catalog.addManualEntry(TENANT_A_PROVIDER, {
      providerDefinitionId: definition.id,
      modelKey: "model-b",
    });
    const first = await stack.providerFabric.bindings.selectModel(
      TENANT_A_PROVIDER,
      "cognition",
      entryA.id,
    );
    const second = await stack.providerFabric.bindings.selectModel(
      TENANT_A_PROVIDER,
      "cognition",
      entryB.id,
    );
    // first.active is now superseded at the provider level:
    await expect(
      stack.agentFabric.modelBindings.attachModel(TENANT_A, body.id, {
        purpose: "cognition",
        modelBindingRef: first.active.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    // The active one attaches fine:
    await expect(
      stack.agentFabric.modelBindings.attachModel(TENANT_A, body.id, {
        purpose: "cognition",
        modelBindingRef: second.active.id,
      }),
    ).resolves.toBeDefined();
  });

  it("foreign-tenant provider bindings are invisible through the bridge", async () => {
    const stack = makeStack();
    // The body belongs to tenant B:
    const body = await stack.agentFabric.bodies.createBody(TENANT_B, {
      displayName: "Isolated Agent",
      role: { title: "Ops" },
    });
    // Tenant A creates a binding:
    const definition = await stack.providerFabric.registry.registerRegistryProvider(
      TENANT_A_PROVIDER,
      "anthropic",
    );
    const entry = await stack.providerFabric.catalog.addManualEntry(TENANT_A_PROVIDER, {
      providerDefinitionId: definition.id,
      modelKey: "model-a",
    });
    const selection = await stack.providerFabric.bindings.selectModel(
      TENANT_A_PROVIDER,
      "cognition",
      entry.id,
    );
    // Tenant B cannot attach to it — uniform rejection, indistinguishable
    // from a missing binding:
    await expect(
      stack.agentFabric.modelBindings.attachModel(TENANT_B, body.id, {
        purpose: "cognition",
        modelBindingRef: selection.active.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
