/**
 * Concern 3 of 8 — ProviderProtocol: the wire protocol + capability
 * vocabulary. A protocol describes HOW models are spoken to on the wire
 * (dialect + expressible capabilities). It is a SEPARATE record from both
 * the provider definition (who) and the account (credentials).
 *
 * Protocols are vocabulary-level facts: they originate from the built-in
 * registry or are registered explicitly as their own operation. A custom
 * ProviderDefinition can only REFERENCE an existing protocol — the
 * definition-creation path can never mint a new protocol dialect.
 */
import { asProviderProtocolId, type ProviderProtocolId, type TenantId } from "./ids.js";
import { sanitizeAndAssertClean } from "./sanitize.js";
import { validationFailed } from "./errors.js";
import {
  isProtocolKind,
  isProviderCapability,
  type ProviderCapability,
  type ProtocolKind,
} from "./vocabulary.js";
import type { RecordBookkeeping, TenantScoped } from "./ports.js";

/**
 * Tenant-independent protocol template. Builtin wire dialects live here;
 * tenants never own them, they reference them.
 */
export interface ProviderProtocolTemplate {
  readonly id: ProviderProtocolId;
  readonly kind: ProtocolKind;
  readonly name: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly origin: { readonly kind: "builtin" } | { readonly kind: "registered" };
}

/** A protocol as seen by one tenant (template + tenant stamp). */
export interface ProviderProtocol
  extends ProviderProtocolTemplate, TenantScoped, RecordBookkeeping {}

const EPOCH = "1970-01-01T00:00:00.000Z";

const BUILTIN_PROTOCOL_TEMPLATES: readonly ProviderProtocolTemplate[] = [
  {
    id: asProviderProtocolId("proto:openai-chat-completions"),
    kind: "openai-chat-completions",
    name: "OpenAI Chat Completions",
    capabilities: [
      "chat",
      "completion",
      "embeddings",
      "tool-call",
      "streaming",
      "json-mode",
      "batch",
      "vision",
    ],
    origin: { kind: "builtin" },
  },
  {
    id: asProviderProtocolId("proto:openai-responses"),
    kind: "openai-responses",
    name: "OpenAI Responses API",
    capabilities: [
      "chat",
      "completion",
      "tool-call",
      "streaming",
      "json-mode",
      "batch",
      "vision",
      "prompt-caching",
    ],
    origin: { kind: "builtin" },
  },
  {
    id: asProviderProtocolId("proto:anthropic-messages"),
    kind: "anthropic-messages",
    name: "Anthropic Messages",
    capabilities: ["chat", "completion", "tool-call", "streaming", "vision", "prompt-caching"],
    origin: { kind: "builtin" },
  },
  {
    id: asProviderProtocolId("proto:ollama-native"),
    kind: "ollama-native",
    name: "Ollama Native",
    capabilities: ["chat", "completion", "embeddings", "tool-call", "streaming"],
    origin: { kind: "builtin" },
  },
  {
    id: asProviderProtocolId("proto:google-generative"),
    kind: "google-generative",
    name: "Google Generative Language",
    capabilities: [
      "chat",
      "completion",
      "embeddings",
      "vision",
      "audio-input",
      "audio-output",
      "tool-call",
      "streaming",
      "json-mode",
    ],
    origin: { kind: "builtin" },
  },
];

/** Builtin wire-protocol templates (deterministic, tenant-independent). */
export function builtinProtocolTemplates(): readonly ProviderProtocolTemplate[] {
  return BUILTIN_PROTOCOL_TEMPLATES;
}

export function findBuiltinProtocolTemplate(
  id: ProviderProtocolId,
): ProviderProtocolTemplate | undefined {
  return BUILTIN_PROTOCOL_TEMPLATES.find((template) => template.id === id);
}

/** Stamp a tenant view over a template. */
export function materializeProtocol(
  template: ProviderProtocolTemplate,
  tenantId: TenantId,
): ProviderProtocol {
  return { ...template, tenantId, createdAt: EPOCH, updatedAt: EPOCH };
}

export interface RegisterProtocolInput {
  readonly kind: ProtocolKind;
  readonly name: string;
  readonly capabilities: readonly ProviderCapability[];
}

/** Pure validation + normalization for registering a tenant-scoped protocol. */
export function buildProtocol(
  tenantId: TenantId,
  input: RegisterProtocolInput,
  deps: { id: string; now: string },
): ProviderProtocol {
  if (!isProtocolKind(input.kind)) {
    throw validationFailed(`unknown protocol kind: ${input.kind}`);
  }
  const name = sanitizeAndAssertClean(input.name.trim());
  if (name.length === 0 || name.length > 120) {
    throw validationFailed("protocol name must be 1..120 characters");
  }
  const capabilities = [...new Set(input.capabilities)];
  if (capabilities.length === 0) {
    throw validationFailed("protocol must declare at least one capability");
  }
  for (const capability of capabilities) {
    if (!isProviderCapability(capability)) {
      throw validationFailed(`unknown capability: ${capability}`);
    }
  }
  return {
    id: asProviderProtocolId(deps.id),
    tenantId,
    kind: input.kind,
    name,
    capabilities,
    origin: { kind: "registered" },
    createdAt: deps.now,
    updatedAt: deps.now,
  };
}
