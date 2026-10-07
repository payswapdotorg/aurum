/**
 * Concern 1 of 8 — ProviderDefinition: what a provider IS.
 *
 * A definition is either a KNOWN REGISTRY ENTRY (one of the built-in known
 * providers, stamped with its registry key) or a CUSTOM definition that
 * rides an EXISTING wire protocol. A custom provider NEVER invents a
 * protocol dialect: the definition path only references protocol ids that
 * already exist (builtin or registered) — it cannot create one, and
 * creation fails closed when the referenced protocol is unknown.
 */
import {
  asProviderDefinitionId,
  asProviderProtocolId,
  type ProviderDefinitionId,
  type ProviderProtocolId,
  type TenantId,
} from "./ids.js";
import { sanitizeAndAssertClean } from "./sanitize.js";
import { validationFailed } from "./errors.js";
import {
  isProviderCapability,
  type ProviderCapability,
  type ProviderProvenance,
} from "./vocabulary.js";
import type { RecordBookkeeping, TenantScoped } from "./ports.js";

export interface ProviderDefinition extends TenantScoped, RecordBookkeeping {
  readonly id: ProviderDefinitionId;
  readonly name: string;
  readonly provenance: ProviderProvenance;
  /** MUST reference an existing ProviderProtocol. */
  readonly protocolId: ProviderProtocolId;
  /** Default endpoint base URL (sanitized; userinfo credentials redacted). */
  readonly endpointUrl: string | null;
  readonly description: string | null;
  readonly capabilities: readonly ProviderCapability[];
}

/** Known-provider registry entry (tenant-independent template). */
export interface KnownProviderTemplate {
  readonly registryKey: string;
  readonly name: string;
  readonly protocolId: ProviderProtocolId;
  readonly defaultEndpointUrl: string | null;
  readonly description: string;
  readonly capabilities: readonly ProviderCapability[];
}

const KNOWN_PROVIDERS: readonly KnownProviderTemplate[] = [
  {
    registryKey: "openai",
    name: "OpenAI",
    protocolId: asProviderProtocolId("proto:openai-responses"),
    defaultEndpointUrl: "https://api.openai.com/v1",
    description: "OpenAI official API",
    capabilities: ["chat", "embeddings", "vision", "tool-call", "streaming", "json-mode", "batch"],
  },
  {
    registryKey: "anthropic",
    name: "Anthropic",
    protocolId: asProviderProtocolId("proto:anthropic-messages"),
    defaultEndpointUrl: "https://api.anthropic.com",
    description: "Anthropic official API",
    capabilities: ["chat", "vision", "tool-call", "streaming", "prompt-caching"],
  },
  {
    registryKey: "openrouter",
    name: "OpenRouter",
    protocolId: asProviderProtocolId("proto:openai-chat-completions"),
    defaultEndpointUrl: "https://openrouter.ai/api/v1",
    description: "OpenRouter multi-provider gateway",
    capabilities: ["chat", "completion", "tool-call", "streaming"],
  },
  {
    registryKey: "ollama",
    name: "Ollama",
    protocolId: asProviderProtocolId("proto:ollama-native"),
    defaultEndpointUrl: "http://127.0.0.1:11434",
    description: "Local Ollama runtime",
    capabilities: ["chat", "completion", "embeddings", "tool-call", "streaming"],
  },
];

export function knownProviderTemplates(): readonly KnownProviderTemplate[] {
  return KNOWN_PROVIDERS;
}

export function findKnownProvider(registryKey: string): KnownProviderTemplate | undefined {
  return KNOWN_PROVIDERS.find((provider) => provider.registryKey === registryKey);
}

/** Build a definition from a known registry entry. */
export function buildRegistryDefinition(
  tenantId: TenantId,
  registryKey: string,
  deps: { id: string; now: string },
): ProviderDefinition {
  const template = findKnownProvider(registryKey);
  if (!template) {
    throw validationFailed(`unknown registry provider key: ${registryKey}`);
  }
  return {
    id: asProviderDefinitionId(deps.id),
    tenantId,
    name: template.name,
    provenance: { kind: "registry", registryKey: template.registryKey },
    protocolId: template.protocolId,
    endpointUrl: template.defaultEndpointUrl,
    description: template.description,
    capabilities: template.capabilities,
    createdAt: deps.now,
    updatedAt: deps.now,
  };
}

export interface CustomProviderInput {
  readonly name: string;
  /** Must reference an EXISTING protocol — never a new dialect. */
  readonly protocolId: string;
  readonly endpointUrl?: string;
  readonly description?: string;
  readonly capabilities: readonly ProviderCapability[];
}

/**
 * Build a custom definition over an existing wire protocol. The protocol
 * must already exist; the caller (app service) enforces that by resolving
 * `protocolId` BEFORE calling this builder — the builder itself still fails
 * closed on malformed input, and never creates protocol records.
 */
export function buildCustomDefinition(
  tenantId: TenantId,
  input: CustomProviderInput,
  deps: { id: string; now: string },
): ProviderDefinition {
  const name = sanitizeAndAssertClean(input.name.trim());
  if (name.length === 0 || name.length > 120) {
    throw validationFailed("provider name must be 1..120 characters");
  }
  if (input.capabilities.length === 0) {
    throw validationFailed("custom provider must declare at least one capability");
  }
  for (const capability of input.capabilities) {
    if (!isProviderCapability(capability)) {
      throw validationFailed(`unknown capability: ${capability}`);
    }
  }
  const endpointUrl =
    input.endpointUrl === undefined ? null : sanitizeAndAssertClean(input.endpointUrl.trim());
  if (endpointUrl !== null && !/^https?:\/\//i.test(endpointUrl)) {
    throw validationFailed("endpoint must be an http(s) URL");
  }
  const description =
    input.description === undefined ? null : sanitizeAndAssertClean(input.description.trim());
  return {
    id: asProviderDefinitionId(deps.id),
    tenantId,
    name,
    provenance: { kind: "custom" },
    protocolId: input.protocolId as ProviderProtocolId,
    endpointUrl,
    description,
    capabilities: [...new Set(input.capabilities)],
    createdAt: deps.now,
    updatedAt: deps.now,
  };
}

/** Reference shape used by account/evidence surfaces (no credential data). */
export interface ProviderDefinitionSummary {
  readonly id: ProviderDefinitionId;
  readonly name: string;
  readonly provenance: ProviderProvenance;
  readonly protocolId: ProviderProtocolId;
  readonly capabilities: readonly ProviderCapability[];
}

export function summarizeDefinition(definition: ProviderDefinition): ProviderDefinitionSummary {
  return {
    id: definition.id,
    name: definition.name,
    provenance: definition.provenance,
    protocolId: definition.protocolId,
    capabilities: definition.capabilities,
  };
}
