/**
 * ACCEPTANCE: ProviderDefinition — registry entries and custom definitions
 * over EXISTING wire protocols. A custom provider NEVER invents a protocol
 * dialect; definition creation has no code path that mints protocols.
 */
import { describe, expect, it } from "vitest";
import { ProviderFabricError } from "../src/domain/errors.js";
import { TENANT_A, makeFabric } from "./helpers.js";

describe("provider definitions", () => {
  it("registers a known registry provider with registry provenance", async () => {
    const { fabric } = makeFabric();
    const definition = await fabric.registry.registerRegistryProvider(TENANT_A, "anthropic");
    expect(definition.provenance).toEqual({ kind: "registry", registryKey: "anthropic" });
    expect(definition.protocolId).toBe("proto:anthropic-messages");
    expect(definition.capabilities).toContain("chat");
    const fetched = await fabric.registry.getDefinition(TENANT_A, definition.id);
    expect(fetched.id).toBe(definition.id);
  });

  it("rejects unknown registry keys", async () => {
    const { fabric } = makeFabric();
    await expect(
      fabric.registry.registerRegistryProvider(TENANT_A, "not-a-provider"),
    ).rejects.toBeInstanceOf(ProviderFabricError);
  });

  it("registers a custom provider over an existing builtin protocol", async () => {
    const { fabric } = makeFabric();
    const definition = await fabric.registry.registerCustomProvider(TENANT_A, {
      name: "My Gateway",
      protocolId: "proto:openai-chat-completions",
      endpointUrl: "https://gateway.internal/v1",
      capabilities: ["chat", "streaming"],
    });
    expect(definition.provenance).toEqual({ kind: "custom" });
    expect(definition.protocolId).toBe("proto:openai-chat-completions");
    expect(definition.endpointUrl).toBe("https://gateway.internal/v1");
  });

  it("rejects a custom provider referencing a protocol that does not exist", async () => {
    const { fabric } = makeFabric();
    // THE LAW: custom definitions never invent protocol dialects.
    const attempt = fabric.registry.registerCustomProvider(TENANT_A, {
      name: "Fancy New Dialect",
      protocolId: "proto:does-not-exist",
      capabilities: ["chat"],
    });
    await expect(attempt).rejects.toMatchObject({
      code: "PROTOCOL_NOT_FOUND",
      notFound: true,
    });
    // And no protocol was created as a side effect:
    const protocols = await fabric.registry.listProtocols(TENANT_A);
    expect(protocols.find((protocol) => protocol.id === "proto:does-not-exist")).toBeUndefined();
  });

  it("rejects a custom provider with an endpoint embedding URL credentials (sanitized at build)", async () => {
    const { fabric } = makeFabric();
    const definition = await fabric.registry.registerCustomProvider(TENANT_A, {
      name: "Leaky Gateway",
      protocolId: "proto:openai-chat-completions",
      endpointUrl: "https://user:SuperSecret123@gateway.internal/v1",
      capabilities: ["chat"],
    });
    // The stored endpoint is sanitized — no credential material survives.
    expect(definition.endpointUrl).toBe("https://[REDACTED]@gateway.internal/v1");
  });

  it("registers tenant-scoped protocols as their own operation, then allows custom providers over them", async () => {
    const { fabric } = makeFabric();
    const protocol = await fabric.registry.registerProtocol(TENANT_A, {
      kind: "openai-chat-completions",
      name: "Internal Compatible Dialect",
      capabilities: ["chat"],
    });
    expect(protocol.origin).toEqual({ kind: "registered" });
    const definition = await fabric.registry.registerCustomProvider(TENANT_A, {
      name: "Over Registered",
      protocolId: protocol.id,
      capabilities: ["chat"],
    });
    expect(definition.protocolId).toBe(protocol.id);
  });

  it("rejects duplicate custom provider names within a tenant", async () => {
    const { fabric } = makeFabric();
    await fabric.registry.registerCustomProvider(TENANT_A, {
      name: "Same Name",
      protocolId: "proto:openai-chat-completions",
      capabilities: ["chat"],
    });
    await expect(
      fabric.registry.registerCustomProvider(TENANT_A, {
        name: "Same Name",
        protocolId: "proto:openai-chat-completions",
        capabilities: ["chat"],
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("lists builtin protocols for every tenant", async () => {
    const { fabric } = makeFabric();
    const protocols = await fabric.registry.listProtocols(TENANT_A);
    const ids = protocols.map((protocol) => protocol.id);
    expect(ids).toContain("proto:anthropic-messages");
    expect(ids).toContain("proto:openai-responses");
    expect(protocols.every((protocol) => protocol.capabilities.length > 0)).toBe(true);
  });
});
