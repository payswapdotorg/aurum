/**
 * The AgentBody: the PERSISTENT, MODEL-AGNOSTIC organizational identity.
 *
 * A body owns: role (+ history), communication behavior, information
 * acquisition behavior, company context access, memory policy, permitted
 * capabilities, escalation behavior, evidence + learning hooks, and
 * organizational relationships. None of that is a model. Models attach to
 * a body as append-only BodyModelBinding records (body-model-binding.ts):
 * swapping the model supersedes one attachment and appends another — the
 * BODY RECORD ITSELF IS NOT TOUCHED, not even its updatedAt. Identity,
 * memory, goals, evidence and permissions survive every model swap.
 *
 * Lifecycle is ONE-WAY: active -> retired (no reactivation path exists).
 * Free-text surfaces are sanitized with the provider package's unanchored
 * credential sanitizer (imported via the @aurum/provider entrypoint).
 */
import { sanitizeAndAssertClean } from "@aurum/provider";
import type { AgentBodyId, TenantId } from "./ids.js";
import { invalidTransition, validationFailed } from "./errors.js";
import {
  isAgentCapability,
  isAgentRelationshipKind,
  type AgentBodyLifecycleState,
  type AgentCapability,
  type AgentRelationshipKind,
  type EscalationPolicy,
  type MemoryRetention,
  type MemorySharing,
} from "./vocabulary.js";
import type { RecordBookkeeping, TenantScoped } from "./ports.js";

/** Current organizational role carried on the body. */
export interface AgentRole {
  readonly title: string;
  readonly description: string | null;
}

export interface AgentCommunicationBehavior {
  /** e.g. "concise and operational" (sanitized free text). */
  readonly style: string;
  readonly verbosity: "terse" | "standard" | "detailed";
  readonly languages: readonly string[];
}

export interface AgentInformationAcquisitionBehavior {
  /** Ask before assuming when information is missing? */
  readonly askBeforeAssuming: boolean;
  /** Preferred information sources (sanitized free-text descriptors). */
  readonly preferredSources: readonly string[];
  readonly freshnessRequirement: "live" | "recent" | "any";
}

/** What company context the body may read. */
export interface AgentCompanyContextAccess {
  readonly grantedScopes: readonly string[];
  readonly deniedScopes: readonly string[];
}

export interface AgentMemoryPolicy {
  readonly retention: MemoryRetention;
  readonly sharing: MemorySharing;
}

export interface AgentEscalationBehavior {
  readonly onUncertainty: EscalationPolicy;
  /** Role titles / body ids the body escalates to (sanitized). */
  readonly escalatesTo: readonly string[];
}

/** Where the body emits evidence and receives learning updates. */
export interface AgentEvidenceHook {
  readonly channel: string;
  readonly events: readonly string[];
}

export interface AgentLearningHook {
  readonly channel: string;
  readonly triggers: readonly string[];
}

export interface AgentRelationship {
  readonly kind: AgentRelationshipKind;
  /** Optional peer/supervisee body id. */
  readonly targetBodyId: string | null;
  /** Human/agent role title when not a body id. */
  readonly targetRole: string | null;
  readonly note: string | null;
}

export interface AgentBody extends TenantScoped, RecordBookkeeping {
  readonly id: AgentBodyId;
  readonly displayName: string;
  readonly role: AgentRole;
  readonly communication: AgentCommunicationBehavior;
  readonly informationAcquisition: AgentInformationAcquisitionBehavior;
  readonly companyContextAccess: AgentCompanyContextAccess;
  readonly memoryPolicy: AgentMemoryPolicy;
  readonly permittedCapabilities: readonly AgentCapability[];
  readonly escalation: AgentEscalationBehavior;
  readonly evidenceHooks: readonly AgentEvidenceHook[];
  readonly learningHooks: readonly AgentLearningHook[];
  readonly relationships: readonly AgentRelationship[];
  readonly lifecycle: {
    readonly state: AgentBodyLifecycleState;
    readonly retiredAt: string | null;
    readonly reason: string | null;
  };
}

export interface CreateAgentBodyInput {
  readonly displayName: string;
  readonly role: { readonly title: string; readonly description?: string };
  readonly communication?: Partial<AgentCommunicationBehavior>;
  readonly informationAcquisition?: Partial<AgentInformationAcquisitionBehavior>;
  readonly companyContextAccess?: Partial<AgentCompanyContextAccess>;
  readonly memoryPolicy?: Partial<AgentMemoryPolicy>;
  readonly permittedCapabilities?: readonly string[];
  readonly escalation?: Partial<AgentEscalationBehavior>;
  readonly evidenceHooks?: readonly AgentEvidenceHook[];
  readonly learningHooks?: readonly AgentLearningHook[];
  readonly relationships?: readonly AgentRelationship[];
}

const DEFAULT_COMMUNICATION: AgentCommunicationBehavior = {
  style: "standard",
  verbosity: "standard",
  languages: ["en"],
};

const DEFAULT_ACQUISITION: AgentInformationAcquisitionBehavior = {
  askBeforeAssuming: true,
  preferredSources: [],
  freshnessRequirement: "recent",
};

const DEFAULT_MEMORY: AgentMemoryPolicy = { retention: "session", sharing: "private" };

const DEFAULT_ESCALATION: AgentEscalationBehavior = {
  onUncertainty: "ask-human",
  escalatesTo: [],
};

function sanitizedList(values: readonly string[] | undefined, max: number, what: string): string[] {
  const list = values ?? [];
  if (list.length > max) {
    throw validationFailed(`${what} accepts at most ${max} entries`);
  }
  return [...new Set(list.map((value) => sanitizeAndAssertClean(value.trim())))].filter(
    (value) => value.length > 0,
  );
}

function sanitizedText(value: string | undefined | null, max: number, what: string): string | null {
  if (value === undefined || value === null) return null;
  const text = sanitizeAndAssertClean(value.trim());
  if (text.length > max) {
    throw validationFailed(`${what} exceeds ${max} characters`);
  }
  return text.length > 0 ? text : null;
}

function validatedCapabilities(values: readonly string[]): readonly AgentCapability[] {
  for (const capability of values) {
    if (!isAgentCapability(capability)) {
      throw validationFailed(`unknown agent capability: ${capability}`);
    }
  }
  return [...new Set(values)] as readonly AgentCapability[];
}

export function buildAgentBody(
  tenantId: TenantId,
  input: CreateAgentBodyInput,
  deps: { id: string; now: string },
): AgentBody {
  const displayName = sanitizeAndAssertClean(input.displayName.trim());
  if (displayName.length === 0 || displayName.length > 120) {
    throw validationFailed("body displayName must be 1..120 characters");
  }
  const title = sanitizeAndAssertClean(input.role.title.trim());
  if (title.length === 0 || title.length > 120) {
    throw validationFailed("role title must be 1..120 characters");
  }
  const capabilities = validatedCapabilities(input.permittedCapabilities ?? ["conversation"]);
  const relationships = (input.relationships ?? []).map((relationship) => {
    if (!isAgentRelationshipKind(relationship.kind)) {
      throw validationFailed(`unknown relationship kind: ${relationship.kind}`);
    }
    return {
      kind: relationship.kind,
      targetBodyId: relationship.targetBodyId ?? null,
      targetRole: sanitizedText(relationship.targetRole, 120, "relationship targetRole"),
      note: sanitizedText(relationship.note, 300, "relationship note"),
    };
  });
  const communication: AgentCommunicationBehavior = {
    style: sanitizeAndAssertClean(
      (input.communication?.style ?? DEFAULT_COMMUNICATION.style).trim(),
    ),
    verbosity: input.communication?.verbosity ?? DEFAULT_COMMUNICATION.verbosity,
    languages: sanitizedList(input.communication?.languages, 10, "communication languages"),
  };
  const informationAcquisition: AgentInformationAcquisitionBehavior = {
    askBeforeAssuming:
      input.informationAcquisition?.askBeforeAssuming ?? DEFAULT_ACQUISITION.askBeforeAssuming,
    preferredSources: sanitizedList(
      input.informationAcquisition?.preferredSources,
      20,
      "preferred sources",
    ),
    freshnessRequirement:
      input.informationAcquisition?.freshnessRequirement ??
      DEFAULT_ACQUISITION.freshnessRequirement,
  };
  const companyContextAccess: AgentCompanyContextAccess = {
    grantedScopes: sanitizedList(input.companyContextAccess?.grantedScopes, 50, "granted scopes"),
    deniedScopes: sanitizedList(input.companyContextAccess?.deniedScopes, 50, "denied scopes"),
  };
  const memoryPolicy: AgentMemoryPolicy = {
    retention: input.memoryPolicy?.retention ?? DEFAULT_MEMORY.retention,
    sharing: input.memoryPolicy?.sharing ?? DEFAULT_MEMORY.sharing,
  };
  const escalation: AgentEscalationBehavior = {
    onUncertainty: input.escalation?.onUncertainty ?? DEFAULT_ESCALATION.onUncertainty,
    escalatesTo: sanitizedList(input.escalation?.escalatesTo, 20, "escalation targets"),
  };
  const evidenceHooks = (input.evidenceHooks ?? []).map((hook) => ({
    channel: sanitizeAndAssertClean(hook.channel.trim()),
    events: sanitizedList(hook.events, 30, "evidence hook events"),
  }));
  const learningHooks = (input.learningHooks ?? []).map((hook) => ({
    channel: sanitizeAndAssertClean(hook.channel.trim()),
    triggers: sanitizedList(hook.triggers, 30, "learning hook triggers"),
  }));
  return {
    id: deps.id as AgentBodyId,
    tenantId,
    displayName,
    role: { title, description: sanitizedText(input.role.description, 1000, "role description") },
    communication,
    informationAcquisition,
    companyContextAccess,
    memoryPolicy,
    permittedCapabilities: capabilities,
    escalation,
    evidenceHooks,
    learningHooks,
    relationships,
    lifecycle: { state: "active", retiredAt: null, reason: null },
    createdAt: deps.now,
    updatedAt: deps.now,
  };
}

/** Facet updates permitted on an ACTIVE body (role goes through assignRole). */
export interface UpdateAgentBodyInput {
  readonly displayName?: string;
  readonly communication?: Partial<AgentCommunicationBehavior>;
  readonly informationAcquisition?: Partial<AgentInformationAcquisitionBehavior>;
  readonly companyContextAccess?: Partial<AgentCompanyContextAccess>;
  readonly memoryPolicy?: Partial<AgentMemoryPolicy>;
  readonly permittedCapabilities?: readonly string[];
  readonly escalation?: Partial<AgentEscalationBehavior>;
  readonly relationships?: readonly AgentRelationship[];
}

/**
 * Apply a facet update. Returns a NEW record with bumped updatedAt — used
 * for every body mutation EXCEPT model swaps, which never call this.
 */
export function updateAgentBody(
  body: AgentBody,
  input: UpdateAgentBodyInput,
  now: string,
): AgentBody {
  if (body.lifecycle.state !== "active") {
    throw validationFailed("retired bodies are immutable");
  }
  const next: AgentBody = {
    ...body,
    displayName:
      input.displayName === undefined
        ? body.displayName
        : sanitizeAndAssertClean(input.displayName.trim()),
    communication:
      input.communication === undefined
        ? body.communication
        : { ...body.communication, ...sanitizeFacets(input.communication) },
    informationAcquisition:
      input.informationAcquisition === undefined
        ? body.informationAcquisition
        : { ...body.informationAcquisition, ...input.informationAcquisition },
    companyContextAccess:
      input.companyContextAccess === undefined
        ? body.companyContextAccess
        : { ...body.companyContextAccess, ...input.companyContextAccess },
    memoryPolicy:
      input.memoryPolicy === undefined
        ? body.memoryPolicy
        : { ...body.memoryPolicy, ...input.memoryPolicy },
    permittedCapabilities:
      input.permittedCapabilities === undefined
        ? body.permittedCapabilities
        : validatedCapabilities(input.permittedCapabilities),
    escalation:
      input.escalation === undefined
        ? body.escalation
        : { ...body.escalation, ...input.escalation },
    relationships: input.relationships === undefined ? body.relationships : input.relationships,
    updatedAt: now,
  };
  if (next.displayName.length === 0 || next.displayName.length > 120) {
    throw validationFailed("body displayName must be 1..120 characters");
  }
  return next;
}

function sanitizeFacets(
  facet: Partial<AgentCommunicationBehavior>,
): Partial<AgentCommunicationBehavior> {
  return {
    ...facet,
    ...(facet.style === undefined ? {} : { style: sanitizeAndAssertClean(facet.style) }),
  };
}

/** One-way retirement. No reactivation path exists anywhere in the fabric. */
export function retireAgentBody(
  body: AgentBody,
  reason: string | undefined,
  now: string,
): AgentBody {
  if (body.lifecycle.state !== "active") {
    throw invalidTransition("body is already retired (lifecycle is one-way)");
  }
  return {
    ...body,
    lifecycle: {
      state: "retired",
      retiredAt: now,
      reason: sanitizedText(reason, 500, "retirement reason"),
    },
    updatedAt: now,
  };
}
