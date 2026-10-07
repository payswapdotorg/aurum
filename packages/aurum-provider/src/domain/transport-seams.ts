/**
 * Discovery/execution transport SEAM.
 *
 * The fabric speaks to the outside world ONLY through these interfaces.
 * They carry NORMALIZED shapes: no provider SDK types, no HTTP details, no
 * credential material — secret references cross the seam and the adapter on
 * the other side resolves them against the secret store it owns.
 *
 * Deterministic test doubles for both seams live in adapters/ and are the
 * ONLY implementations that exist in this package; real network adapters
 * (OpenAI/Anthropic/... SDK wrappers) are future adapter work and must stay
 * adapter-private when they land. No test ever touches a real network.
 */
import type { ProviderCapability } from "./vocabulary.js";
import type { DiscoveredModel } from "./model-catalog.js";
import type { SecretRef } from "./ids.js";

// The discovery seam's success shape is defined in terms of the catalog's
// discovered-model shape; re-export it so seam implementers need one import.
export type { DiscoveredModel };

/* ------------------------------------------------------------------ *
 * Discovery seam
 * ------------------------------------------------------------------ */

export interface DiscoveryRequest {
  readonly providerDefinitionId: string;
  readonly protocolId: string;
  /** Endpoint the adapter should talk to (already sanitized). */
  readonly endpointUrl: string | null;
  /** Opaque credential references; the adapter resolves material. */
  readonly credentialRefs: readonly SecretRef[];
}

export interface DiscoverySuccess {
  readonly ok: true;
  readonly models: readonly DiscoveredModel[];
}

export interface DiscoveryFailure {
  readonly ok: false;
  /** Free text; the fabric re-sanitizes before recording it anywhere. */
  readonly error: string;
}

export type DiscoveryResult = DiscoverySuccess | DiscoveryFailure;

/**
 * Transport seam for model discovery. Implementations talk to a real
 * provider (future adapters) or replay fixtures (test doubles). The seam
 * itself is the contract; nothing SDK-shaped crosses it.
 */
export interface ProviderDiscoveryPort {
  discoverModels(request: DiscoveryRequest): Promise<DiscoveryResult>;
}

/* ------------------------------------------------------------------ *
 * Account probe seam (connect/disconnect verification)
 * ------------------------------------------------------------------ */

export interface AccountProbeRequest {
  readonly providerDefinitionId: string;
  readonly protocolId: string;
  readonly endpointUrl: string | null;
  readonly credentialRefs: readonly SecretRef[];
}

export interface AccountProbeSuccess {
  readonly ok: true;
  readonly observedAt: string;
  readonly detail?: string;
}

export interface AccountProbeFailure {
  readonly ok: false;
  /** Free text; the fabric re-sanitizes before recording it anywhere. */
  readonly error: string;
}

export type AccountProbeResult = AccountProbeSuccess | AccountProbeFailure;

/**
 * Transport seam for verifying an account can actually reach its provider
 * (the "connect" flow). Implementations resolve credential references
 * against their own secret store; material never crosses back.
 */
export interface ProviderAccountProbePort {
  probeAccount(request: AccountProbeRequest): Promise<AccountProbeResult>;
}

/* ------------------------------------------------------------------ *
 * Execution transport seam (declared here, exercised elsewhere)
 * ------------------------------------------------------------------ */

/** Normalized, protocol-agnostic model input. No SDK shapes. */
export interface ProviderExecutionInput {
  readonly messages: readonly ExecutionMessage[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

export interface ExecutionMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** Normalized usage accounting. */
export interface ProviderExecutionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ProviderExecutionSuccess {
  readonly ok: true;
  readonly content: string;
  readonly usage: ProviderExecutionUsage | null;
  readonly finishedAt: string;
}

export interface ProviderExecutionFailure {
  readonly ok: false;
  readonly error: string;
}

export type ProviderExecutionResult = ProviderExecutionSuccess | ProviderExecutionFailure;

/**
 * Transport seam for EXECUTING a model call through a binding. The fabric
 * and the Agent Body NEVER invoke this themselves — execution authority
 * lives with the Agent Gateway / execution plane (spec/ARCHITECTURE.md).
 * The seam is declared here so provider-plane contracts own the normalized
 * wire shape, and so future execution adapters have a stable port to
 * implement against.
 */
export interface ProviderExecutionTransportPort {
  execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult>;
}

export interface ProviderExecutionRequest {
  readonly providerDefinitionId: string;
  readonly protocolId: string;
  readonly modelKey: string;
  readonly endpointUrl: string | null;
  readonly credentialRefs: readonly SecretRef[];
  readonly input: ProviderExecutionInput;
  /** Capabilities the caller needs (e.g. tool-call); advisory to adapters. */
  readonly requiredCapabilities: readonly ProviderCapability[];
}
