/**
 * Provider registry application service: protocols + provider definitions.
 *
 * Owns the "custom providers never invent protocol dialects" law at the
 * use-case level: a custom definition is only built AFTER its referenced
 * protocol resolves (builtin or registered). The definition path exposes
 * no code path that mints protocols.
 */
import type { Clock, IdGenerator } from "../domain/ports.js";
import type { ProviderFabricStore } from "../domain/stores.js";
import { duplicate, notFound } from "../domain/errors.js";
import type { ProviderProtocolId, TenantId } from "../domain/ids.js";
import {
  buildCustomDefinition,
  buildRegistryDefinition,
  type CustomProviderInput,
  type ProviderDefinition,
} from "../domain/provider-definition.js";
import {
  builtinProtocolTemplates,
  buildProtocol,
  findBuiltinProtocolTemplate,
  materializeProtocol,
  type ProviderProtocol,
  type RegisterProtocolInput,
} from "../domain/provider-protocol.js";

export interface ProviderRegistryDeps {
  readonly store: ProviderFabricStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class ProviderRegistryService {
  constructor(private readonly deps: ProviderRegistryDeps) {}

  async registerProtocol(
    tenantId: TenantId,
    input: RegisterProtocolInput,
  ): Promise<ProviderProtocol> {
    const protocol = buildProtocol(tenantId, input, {
      id: this.deps.ids.next(),
      now: this.deps.clock.now(),
    });
    await this.deps.store.protocols.putRegistered(protocol);
    return protocol;
  }

  async getProtocol(tenantId: TenantId, protocolId: string): Promise<ProviderProtocol> {
    const registered = await this.deps.store.protocols.getRegisteredById(tenantId, protocolId);
    if (registered !== null) return registered;
    const builtin = findBuiltinProtocolTemplate(protocolId as ProviderProtocolId);
    if (builtin !== undefined) return materializeProtocol(builtin, tenantId);
    throw notFound("PROTOCOL_NOT_FOUND", `protocol ${protocolId}`);
  }

  async listProtocols(tenantId: TenantId): Promise<ProviderProtocol[]> {
    const registered = await this.deps.store.protocols.listForTenant(tenantId);
    const builtin = builtinProtocolTemplates().map((template) =>
      materializeProtocol(template, tenantId),
    );
    const seen = new Set(registered.map((protocol) => protocol.id));
    return [...registered, ...builtin.filter((protocol) => !seen.has(protocol.id))];
  }

  async registerRegistryProvider(
    tenantId: TenantId,
    registryKey: string,
  ): Promise<ProviderDefinition> {
    const definition = buildRegistryDefinition(tenantId, registryKey, {
      id: this.deps.ids.next(),
      now: this.deps.clock.now(),
    });
    await this.deps.store.definitions.put(tenantId, definition);
    return definition;
  }

  async registerCustomProvider(
    tenantId: TenantId,
    input: CustomProviderInput,
  ): Promise<ProviderDefinition> {
    // THE LAW: the protocol must already exist before a custom definition
    // can reference it. Definition creation never mints protocols.
    await this.getProtocol(tenantId, input.protocolId);
    const definition = buildCustomDefinition(tenantId, input, {
      id: this.deps.ids.next(),
      now: this.deps.clock.now(),
    });
    const existing = await this.deps.store.definitions.findByNaturalKey(tenantId, definition.name);
    if (existing !== null) {
      throw duplicate(`custom provider named ${definition.name}`);
    }
    await this.deps.store.definitions.put(tenantId, definition);
    return definition;
  }

  async getDefinition(tenantId: TenantId, definitionId: string): Promise<ProviderDefinition> {
    const definition = await this.deps.store.definitions.getById(tenantId, definitionId);
    if (definition === null) {
      throw notFound("PROVIDER_NOT_FOUND", `provider definition ${definitionId}`);
    }
    return definition;
  }

  async listDefinitions(tenantId: TenantId): Promise<ProviderDefinition[]> {
    return this.deps.store.definitions.listByTenant(tenantId);
  }
}
