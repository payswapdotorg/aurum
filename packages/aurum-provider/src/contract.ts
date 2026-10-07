/**
 * aurum-provider composed contract surface.
 *
 * The narrow contracts live in domain/ (records + pure logic + ports) and
 * app/ (service interfaces); this file composes them into the single
 * cross-module surface re-exported by index.ts. Provider SDK types NEVER
 * appear here: transport is a seam (domain/transport-seams.ts) with
 * normalized shapes only, and SDK wrappers (when they exist) stay
 * adapter-private inside adapters/.
 */
export type {
  TenantId,
  ProviderProtocolId,
  ProviderDefinitionId,
  ProviderAccountId,
  ModelCatalogEntryId,
  ModelBindingId,
  ProviderHealthObservationId,
  ProviderEvidenceId,
  SecretRef,
} from "./domain/ids.js";
export {
  asTenantId,
  asProviderProtocolId,
  asProviderDefinitionId,
  asProviderAccountId,
  asModelCatalogEntryId,
  asModelBindingId,
  asSecretRef,
} from "./domain/ids.js";

export type { Clock, IdGenerator, RecordBookkeeping, TenantScoped } from "./domain/ports.js";

export {
  PROVIDER_CAPABILITIES,
  PROTOCOL_KINDS,
  ACCOUNT_CONNECTION_STATES,
  PROVIDER_HEALTH_STATUSES,
  PROVIDER_AVAILABILITY_STATES,
  MODEL_BINDING_STATUSES,
  isProviderCapability,
  isProtocolKind,
} from "./domain/vocabulary.js";
export type {
  ProviderCapability,
  ProtocolKind,
  AccountConnectionState,
  ProviderHealthStatus,
  ProviderAvailabilityState,
  ProviderProvenance,
  ModelCatalogSource,
  ModelBindingStatus,
} from "./domain/vocabulary.js";

export {
  sanitizeFreeText,
  containsCredentialMaterial,
  sanitizeAndAssertClean,
  REDACTED,
} from "./domain/sanitize.js";

export { ProviderFabricError } from "./domain/errors.js";
export type { ProviderFabricErrorCode } from "./domain/errors.js";

// Concern 1 — ProviderDefinition
export type {
  ProviderDefinition,
  KnownProviderTemplate,
  CustomProviderInput,
  ProviderDefinitionSummary,
} from "./domain/provider-definition.js";
export {
  knownProviderTemplates,
  findKnownProvider,
  buildRegistryDefinition,
  buildCustomDefinition,
  summarizeDefinition,
} from "./domain/provider-definition.js";

// Concern 2 — ProviderAccount
export type {
  ProviderAccount,
  ProviderConnectionState,
  CredentialSpec,
  CredentialKind,
  CreateAccountInput,
} from "./domain/provider-account.js";
export { buildAccount, transitionConnection, credentialRefsOf } from "./domain/provider-account.js";

// Concern 3 — ProviderProtocol + capability vocabulary
export type {
  ProviderProtocol,
  ProviderProtocolTemplate,
  RegisterProtocolInput,
} from "./domain/provider-protocol.js";
export {
  builtinProtocolTemplates,
  findBuiltinProtocolTemplate,
  materializeProtocol,
  buildProtocol,
} from "./domain/provider-protocol.js";

// Concern 4 — ModelCatalogEntry
export type {
  ModelCatalogEntry,
  ManualCatalogInput,
  DiscoveredModel,
} from "./domain/model-catalog.js";
export {
  buildManualCatalogEntry,
  buildDiscoveredCatalogEntry,
  catalogEntryKey,
  entryKeyOf,
} from "./domain/model-catalog.js";

// Concern 5 — ModelBinding
export type { ModelBinding, ModelBindingPurpose } from "./domain/model-binding.js";
export {
  validatePurpose,
  buildActiveBinding,
  supersedeActiveBinding,
  bindingTimeline,
  isActiveBinding,
} from "./domain/model-binding.js";

// Concern 6 — ProviderHealth
export type {
  ProviderHealthObservation,
  HealthSubject,
  RecordHealthInput,
} from "./domain/provider-health.js";
export {
  subjectKey,
  buildHealthObservation,
  latestObservation,
  currentHealthOf,
} from "./domain/provider-health.js";

// Concern 7 — ProviderAvailability
export type {
  ProviderAvailability,
  AvailabilitySubject,
  AvailabilityObservation,
  RecordAvailabilityInput,
} from "./domain/provider-availability.js";
export {
  availabilitySubjectKey,
  buildAvailabilityObservation,
  evaluateAvailability,
  DEFAULT_AVAILABILITY_FRESHNESS_MS,
} from "./domain/provider-availability.js";

// Concern 8 — ProviderEvidence
export type {
  ProviderEvidence,
  ProviderEvidenceKind,
  ProviderEvidenceOutcome,
  EvidenceSubject,
  AppendEvidenceInput,
} from "./domain/provider-evidence.js";
export {
  PROVIDER_EVIDENCE_KINDS,
  evidenceSubjectKey,
  buildEvidence,
  evidenceForSubject,
} from "./domain/provider-evidence.js";

// Transport seams (discovery / probe / execution) — interface + normalized shapes
export type {
  DiscoveryRequest,
  DiscoveryResult,
  DiscoverySuccess,
  DiscoveryFailure,
  ProviderDiscoveryPort,
  AccountProbeRequest,
  AccountProbeResult,
  AccountProbeSuccess,
  AccountProbeFailure,
  ProviderAccountProbePort,
  ProviderExecutionInput,
  ExecutionMessage,
  ProviderExecutionUsage,
  ProviderExecutionResult,
  ProviderExecutionSuccess,
  ProviderExecutionFailure,
  ProviderExecutionRequest,
  ProviderExecutionTransportPort,
} from "./domain/transport-seams.js";

// Persistence seams
export type {
  RecordStore,
  ProviderProtocolStore,
  ProviderDefinitionStore,
  ProviderAccountStore,
  ModelCatalogStore,
  ModelBindingStore,
  ProviderHealthStore,
  ProviderAvailabilityStore,
  ProviderEvidenceStore,
  ProviderFabricStore,
} from "./domain/stores.js";

// Application services (the fabric facade)
export type { ProviderRegistryService } from "./app/provider-registry-service.js";
export type { ProviderAccountService } from "./app/provider-account-service.js";
export type { ModelCatalogService, DiscoveryRunOutcome } from "./app/model-catalog-service.js";
export type { ModelBindingService, SelectionResult } from "./app/model-binding-service.js";
export type { ProviderObservationService } from "./app/provider-observation-service.js";
export type { ProviderFabric, ProviderFabricDeps } from "./app/fabric.js";
export { createProviderFabric } from "./app/fabric.js";
