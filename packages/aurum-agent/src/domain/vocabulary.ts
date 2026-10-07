/**
 * Agent Body vocabulary: purposes, lifecycle, capabilities, relationships.
 *
 * The four MODEL ATTACHMENT PURPOSES are a closed set (cognition /
 * conversation / analysis / background) — they sit ON TOP of the provider
 * package's free-form binding purpose primitive. Lifecycle is ONE-WAY:
 * active -> retired, with no reactivation path anywhere in the fabric.
 */

/** Closed purpose vocabulary for body->model attachments. */
export const BODY_MODEL_PURPOSES = ["cognition", "conversation", "analysis", "background"] as const;

export type BodyModelPurpose = (typeof BODY_MODEL_PURPOSES)[number];

const PURPOSE_SET: ReadonlySet<string> = new Set(BODY_MODEL_PURPOSES);

export function isBodyModelPurpose(value: string): value is BodyModelPurpose {
  return PURPOSE_SET.has(value);
}

/** One-way body lifecycle. */
export const AGENT_BODY_LIFECYCLE_STATES = ["active", "retired"] as const;

export type AgentBodyLifecycleState = (typeof AGENT_BODY_LIFECYCLE_STATES)[number];

/** Attachment lifecycle — append-only like provider bindings. */
export const BODY_MODEL_BINDING_STATUSES = ["attached", "superseded"] as const;

export type BodyModelBindingStatus = (typeof BODY_MODEL_BINDING_STATUSES)[number];

/** What an Agent Body is permitted to DO (organizational permissions). */
export const AGENT_CAPABILITIES = [
  "conversation",
  "information-retrieval",
  "tool-invocation",
  "web-search",
  "code-execution",
  "file-access",
  "browser-use",
  "external-messaging",
  "payment-proposal",
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(AGENT_CAPABILITIES);

export function isAgentCapability(value: string): value is AgentCapability {
  return CAPABILITY_SET.has(value);
}

/** Organizational relationship kinds a body can hold. */
export const AGENT_RELATIONSHIP_KINDS = [
  "reports-to",
  "supervises",
  "collaborates-with",
  "escalates-to",
  "delegates-to",
] as const;

export type AgentRelationshipKind = (typeof AGENT_RELATIONSHIP_KINDS)[number];

const RELATIONSHIP_SET: ReadonlySet<string> = new Set(AGENT_RELATIONSHIP_KINDS);

export function isAgentRelationshipKind(value: string): value is AgentRelationshipKind {
  return RELATIONSHIP_SET.has(value);
}

/** How the body handles uncertainty that exceeds its authority. */
export const ESCALATION_POLICIES = ["ask-human", "proceed-with-caution", "block"] as const;

export type EscalationPolicy = (typeof ESCALATION_POLICIES)[number];

/** Memory retention semantics of the body. */
export const MEMORY_RETENTIONS = ["none", "session", "persistent"] as const;

export type MemoryRetention = (typeof MEMORY_RETENTIONS)[number];

/** With whom the body's memory may be shared. */
export const MEMORY_SHARING = ["private", "team", "organization"] as const;

export type MemorySharing = (typeof MEMORY_SHARING)[number];
