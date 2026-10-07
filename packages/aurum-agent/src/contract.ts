/**
 * aurum-agent composed contract surface.
 *
 * Narrow contracts live in domain/ (records + pure logic + ports) and app/
 * (service interfaces); this file composes the public cross-module surface.
 * The package imports @aurum/provider ONLY through its public entrypoint,
 * and only where provider-plane facts genuinely cross (sanitizer in domain
 * errors, facade bridging in adapters). The Agent Body never invokes
 * models; execution authority is the execution plane's.
 */
export type {
  TenantId,
  AgentBodyId,
  BodyModelBindingId,
  AgentRoleAssignmentId,
} from "./domain/ids.js";
export {
  asTenantId,
  asAgentBodyId,
  asBodyModelBindingId,
  asAgentRoleAssignmentId,
} from "./domain/ids.js";

export type { Clock, IdGenerator, TenantScoped, RecordBookkeeping } from "./domain/ports.js";

export {
  BODY_MODEL_PURPOSES,
  AGENT_BODY_LIFECYCLE_STATES,
  BODY_MODEL_BINDING_STATUSES,
  AGENT_CAPABILITIES,
  AGENT_RELATIONSHIP_KINDS,
  ESCALATION_POLICIES,
  MEMORY_RETENTIONS,
  MEMORY_SHARING,
  isBodyModelPurpose,
  isAgentCapability,
  isAgentRelationshipKind,
} from "./domain/vocabulary.js";
export type {
  BodyModelPurpose,
  AgentBodyLifecycleState,
  BodyModelBindingStatus,
  AgentCapability,
  AgentRelationshipKind,
  EscalationPolicy,
  MemoryRetention,
  MemorySharing,
} from "./domain/vocabulary.js";

export { AgentFabricError } from "./domain/errors.js";
export type { AgentFabricErrorCode } from "./domain/errors.js";

// The Agent Body and its facets
export type {
  AgentBody,
  AgentRole,
  AgentCommunicationBehavior,
  AgentInformationAcquisitionBehavior,
  AgentCompanyContextAccess,
  AgentMemoryPolicy,
  AgentEscalationBehavior,
  AgentEvidenceHook,
  AgentLearningHook,
  AgentRelationship,
  CreateAgentBodyInput,
  UpdateAgentBodyInput,
} from "./domain/agent-body.js";
export { buildAgentBody, updateAgentBody, retireAgentBody } from "./domain/agent-body.js";

// Role history (append-only ledger)
export type { AgentRoleAssignment } from "./domain/role-history.js";
export {
  buildRoleAssignment,
  supersedeRoleAssignment,
  roleHistoryOf,
} from "./domain/role-history.js";

// Body -> model attachments (append-only; body identity frozen across swaps)
export type { BodyModelBinding, AttachModelInput } from "./domain/body-model-binding.js";
export {
  buildBodyModelBinding,
  supersedeBodyModelBinding,
  attachmentTimeline,
  isAttached,
} from "./domain/body-model-binding.js";

// Provider lookup port (structural, provider-agnostic)
export type { ModelBindingSnapshot, ProviderBindingLookupPort } from "./domain/provider-lookup.js";

// Persistence seams
export type {
  AgentBodyStore,
  RoleHistoryStore,
  BodyModelBindingStore,
  AgentFabricStore,
} from "./domain/stores.js";

// Application services (the agent fabric facade)
export type { AgentBodyService } from "./app/agent-body-service.js";
export type { BodyModelBindingService, AttachResult } from "./app/body-model-binding-service.js";
export type { AgentFabric, AgentFabricDeps } from "./app/agent-fabric.js";
export { createAgentFabric } from "./app/agent-fabric.js";
