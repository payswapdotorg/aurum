/**
 * Marketplace area public surface (W011): package-kind governance (the
 * four package kinds + the four separate state machines) and the
 * recruitment lifecycle.
 *
 * Cross-module consumption laws:
 * - The four separations are STRUCTURAL: publication, installation,
 *   activation and execution-approval are separate commands with separate
 *   audited transitions (tripwire: test/marketplace-tripwires.test.ts).
 * - The marketplace NEVER executes: no run/submit/invoke/execute-shaped
 *   export exists anywhere on this surface; execution approval is a
 *   W002-seam citation ledger only.
 * - Everything is tenant-scoped with closed-failure semantics
 *   (foreign-tenant ≡ missing, no existence leaks).
 * - `@aurum/domain` / `@aurum/agent` are consumed through structural
 *   local re-declarations until CR-W011 wires the deps (the lockfile is
 *   TL-owned); the domain layer imports nothing foreign (pure local).
 */
// --- typed errors + Result (domain) ---
export { MarketplaceError, isMarketplaceError } from "./domain/errors.js";
export type { MarketplaceErrorCode } from "./domain/errors.js";
export {
  marketplaceConflict,
  marketplaceInvariant,
  marketplaceLifecycleIllegal,
  marketplaceNotFound,
  marketplaceNotInstalled,
  marketplaceUnauthorized,
  marketplaceUnpublished,
  marketplaceValidationError,
} from "./domain/errors.js";

// --- primitives (domain; structural mirrors of the kernel vocabulary) ---
export {
  MARKETPLACE_ACTOR_KINDS,
  MARKETPLACE_SOURCE_KINDS,
  isKnownMarketplaceActorKind,
  isKnownMarketplaceSourceKind,
  marketplaceAuditStampIssues,
  marketplacePersonActor,
  marketplaceProvenanceIssues,
  marketplaceSystemActor,
  marketplaceTenantScope,
} from "./domain/primitives.js";
export type {
  MarketplaceActorKind,
  MarketplaceActorReference,
  MarketplaceAuditStamp,
  MarketplaceProvenanceStamp,
  MarketplaceSourceKind,
  MarketplaceTenantId,
  MarketplaceTenantScope,
  MarketplaceTenantScopedRecord,
  MarketplaceTimestamp,
  MarketplaceValidationIssue,
} from "./domain/primitives.js";
export type { Result } from "./domain/result.js";
export { err, ok } from "./domain/result.js";
export { deepFreezeMarketplace, unwrapMarketplace } from "./domain/primitives.js";

// --- vocabulary (domain) ---
export {
  ACTIVATION_GRANT_KINDS,
  ACTIVATION_STATES,
  CAPABILITY_SUPPLY_KINDS,
  EXECUTION_REQUEST_STATES,
  INSTALLATION_STATES,
  MARKETPLACE_AGENT_CAPABILITIES,
  MARKETPLACE_AUDIT_ACTIONS,
  MARKETPLACE_BODY_MODEL_PURPOSES,
  MARKETPLACE_CANDIDATE_ACTOR_KINDS,
  MARKETPLACE_EVIDENCE_KINDS,
  MARKETPLACE_PACKAGE_KINDS,
  PUBLICATION_STATES,
  RECRUITMENT_STATES,
  activationTransitionLegal,
  executionRequestTransitionLegal,
  installationTransitionLegal,
  isKnownActivationGrantKind,
  isKnownActivationState,
  isKnownCapabilitySupplyKind,
  isKnownMarketplaceAgentCapability,
  isKnownMarketplaceAuditAction,
  isKnownMarketplaceBodyModelPurpose,
  isKnownMarketplaceCandidateActorKind,
  isKnownMarketplaceEvidenceKind,
  isKnownMarketplacePackageKind,
  isKnownPublicationState,
  isKnownRecruitmentState,
  publicationTransitionLegal,
} from "./domain/vocabulary.js";
export type {
  ActivationGrantKind,
  ActivationState,
  CapabilitySupplyKind,
  ExecutionRequestState,
  InstallationState,
  MarketplaceAuditActionKind,
  MarketplaceBodyModelPurpose,
  MarketplaceCandidateActorKind,
  MarketplaceEvidenceKind,
  MarketplacePackageKind,
  PublicationState,
  RecruitmentState,
} from "./domain/vocabulary.js";

// --- records (domain: the four package kinds) ---
export {
  buildDraftPackageVersion,
  packageContentsIssues,
  packageVersionIssues,
} from "./domain/records.js";
export type {
  AgentPackageContents,
  CapabilityPackageContents,
  CapabilitySupplyDeclaration,
  ExtensionPackageContents,
  MarketplacePackage,
  PackageEvidenceRef,
  PackageVersionContents,
  PackageVersionRecord,
  RolePackageContents,
} from "./domain/records.js";

// --- machine 1: publication ---
export {
  catalogEntryOf,
  isPublishedVersion,
  reviewPublication,
  submitForPublication,
} from "./domain/publication.js";
export type { CatalogEntry } from "./domain/publication.js";

// --- machine 2: installation ---
export {
  installPublishedVersion,
  installationIssues,
  reviseInstallationConfiguration,
  uninstallInstallation,
} from "./domain/installation.js";
export type { PackageInstallation } from "./domain/installation.js";

// --- machine 3: activation ---
export {
  activationIssues,
  activationTargetKey,
  activateInstallation,
  deactivateActivation,
} from "./domain/activation.js";
export type { ActivationGrant, PackageActivation } from "./domain/activation.js";

// --- machine 4: execution approval (citation ledger; never executes) ---
export {
  citeExecutionApproval,
  openExecutionRequest,
  withdrawExecutionRequest,
} from "./domain/executionApproval.js";
export type { AuthorityCitation, ExecutionApprovalRequest } from "./domain/executionApproval.js";

// --- recruitment ---
export {
  DEFAULT_RECRUITMENT_WEIGHTS,
  attachProposal,
  buildRecruitmentRequest,
  cancelRequest,
  packageSuppliesOf,
  rankCandidatePackages,
  recruitmentRequestIssues,
  resolveRequest,
} from "./domain/recruitment.js";
export type {
  RankedCandidatePackage,
  RecruitmentCriteria,
  RecruitmentDemand,
  RecruitmentRequest,
  RecruitmentResolution,
  RecruitmentWeights,
} from "./domain/recruitment.js";

// --- ports (domain) ---
export type {
  MarketplaceAuditPort,
  MarketplaceAuditRecord,
  MarketplaceAuthorityPort,
  MarketplaceCatalogStore,
  MarketplaceGovernanceStore,
  MarketplaceServiceDeps,
  WorkforceRegistrationPort,
} from "./domain/ports.js";

// --- app service ---
export { createMarketplaceService } from "./app/marketplaceService.js";
export type {
  ActivatePackageInput,
  CiteExecutionInput,
  DraftPackageInput,
  ExecutionRequestInput,
  InstallPackageInput,
  MarketplaceExecutionApproval,
  MarketplaceGovernance,
  MarketplaceRecruitment,
  MarketplaceService,
  MarketplaceViews,
  OpenRecruitmentInput,
  PublicationTransitionInput,
  ResolveRecruitmentInput,
  ReviseConfigurationInput,
} from "./app/inputs.js";

// --- reference adapters (adapters) ---
export {
  createInMemoryMarketplaceAuditLedger,
  InMemoryMarketplaceAuditLedger,
} from "./adapters/in-memory-audit-ledger.js";
export {
  createInMemoryMarketplaceCatalogStore,
  InMemoryMarketplaceCatalogStore,
} from "./adapters/in-memory-catalog-store.js";
export {
  createInMemoryMarketplaceGovernanceStore,
  InMemoryMarketplaceGovernanceStore,
} from "./adapters/in-memory-governance-store.js";
export {
  createInMemoryAuthorityDouble,
  InMemoryAuthorityDouble,
} from "./adapters/in-memory-authority.js";
export type { AuthorityAssertionLogEntry, TaughtCitation } from "./adapters/in-memory-authority.js";
export {
  createInMemoryWorkforceRegistrationDouble,
  InMemoryWorkforceRegistrationDouble,
} from "./adapters/in-memory-workforce-registration.js";
export type { RecordedRegistration } from "./adapters/in-memory-workforce-registration.js";
export {
  DETERMINISTIC_CATALOG_PACKAGE_IDS,
  populateDeterministicCatalog,
} from "./adapters/deterministic-catalog-double.js";
