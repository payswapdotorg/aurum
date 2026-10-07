/**
 * Provider-plane vocabulary: capabilities, protocol kinds, connection and
 * health states, availability states, provenance and catalog sources.
 *
 * These unions are the closed vocabulary of the fabric. Notably:
 * - Availability is a THREE-state fact (available/unavailable/unknown) that
 *   is deliberately separate from catalog listing ("listed" is never
 *   evidence of "available").
 * - ProviderAccount connection state is an observed lifecycle, distinct from
 *   both health and availability.
 */

/** Capabilities a protocol/definition/model can express. Closed vocabulary. */
export const PROVIDER_CAPABILITIES = [
  "chat",
  "completion",
  "embeddings",
  "rerank",
  "vision",
  "audio-input",
  "audio-output",
  "tool-call",
  "streaming",
  "json-mode",
  "batch",
  "prompt-caching",
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(PROVIDER_CAPABILITIES);

export function isProviderCapability(value: string): value is ProviderCapability {
  return CAPABILITY_SET.has(value);
}

/** Well-known wire protocol dialects. Custom providers reuse one of these. */
export const PROTOCOL_KINDS = [
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
  "ollama-native",
  "google-generative",
] as const;

export type ProtocolKind = (typeof PROTOCOL_KINDS)[number];

const PROTOCOL_KIND_SET: ReadonlySet<string> = new Set(PROTOCOL_KINDS);

export function isProtocolKind(value: string): value is ProtocolKind {
  return PROTOCOL_KIND_SET.has(value);
}

/** Observed connection lifecycle of a provider account. */
export const ACCOUNT_CONNECTION_STATES = [
  "disconnected",
  "connecting",
  "connected",
  "error",
] as const;

export type AccountConnectionState = (typeof ACCOUNT_CONNECTION_STATES)[number];

/** Observed health of a provider subject. "unknown" is explicit, not absent. */
export const PROVIDER_HEALTH_STATUSES = ["healthy", "degraded", "unavailable", "unknown"] as const;

export type ProviderHealthStatus = (typeof PROVIDER_HEALTH_STATUSES)[number];

/**
 * Availability NOW, as a separate fact from catalog listing. "unknown" is a
 * first-class state: no observation has (recently) been made.
 */
export const PROVIDER_AVAILABILITY_STATES = ["available", "unavailable", "unknown"] as const;

export type ProviderAvailabilityState = (typeof PROVIDER_AVAILABILITY_STATES)[number];

/** Where a provider definition comes from. */
export type ProviderProvenance =
  | { readonly kind: "registry"; readonly registryKey: string }
  | { readonly kind: "custom" };

/** Where a catalog entry comes from: both sources are first-class. */
export type ModelCatalogSource =
  | { readonly kind: "manual" }
  | {
      readonly kind: "discovered";
      readonly discoveredAt: string;
      readonly discoveryRunId?: string;
    };

/** Binding lifecycle — append-only: supersede, never delete. */
export const MODEL_BINDING_STATUSES = ["active", "superseded"] as const;

export type ModelBindingStatus = (typeof MODEL_BINDING_STATUSES)[number];
