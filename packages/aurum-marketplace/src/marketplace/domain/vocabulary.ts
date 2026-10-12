/**
 * Marketplace vocabulary (W011 domain layer): the four package kinds, the
 * four governance state machines' closed state sets, and the closed
 * sub-vocabularies the package kinds declare against.
 *
 * MIRRORED FROZEN VOCABULARIES (structural re-declarations pending the
 * CR-W011 dep wiring — identical members, documented kernel/fabric source):
 * - MARKETPLACE_AGENT_CAPABILITIES mirrors @aurum/agent domain/vocabulary
 *   AGENT_CAPABILITIES (the W003 fabric's closed permitted-capability set).
 * - MARKETPLACE_BODY_MODEL_PURPOSES mirrors @aurum/agent BODY_MODEL_PURPOSES
 *   (the four model-attachment purposes).
 * - MARKETPLACE_CANDIDATE_ACTOR_KINDS mirrors @aurum/domain
 *   domain/candidate/actors CANDIDATE_ACTOR_KINDS (the W005 actor kinds).
 * The post-CR adapters assert equality with the upstream sets.
 *
 * TRANSITION TABLES: each machine's legal transitions are declared here as
 * data and every transition is validated against its table — the four
 * machines are structurally separate (no shared transition function, no
 * shared state field).
 */

// --- the four package kinds (spec/ARCHITECTURE.md "Marketplace governs") ---

export const MARKETPLACE_PACKAGE_KINDS = ["agent", "extension", "role", "capability"] as const;

export type MarketplacePackageKind = (typeof MARKETPLACE_PACKAGE_KINDS)[number];

export function isKnownMarketplacePackageKind(value: string): value is MarketplacePackageKind {
  return (MARKETPLACE_PACKAGE_KINDS as readonly string[]).includes(value);
}

// --- machine 1: PUBLICATION (the catalog gate; review is human-governed) ---

export const PUBLICATION_STATES = ["draft", "submitted", "published", "rejected"] as const;

export type PublicationState = (typeof PUBLICATION_STATES)[number];

export function isKnownPublicationState(value: string): value is PublicationState {
  return (PUBLICATION_STATES as readonly string[]).includes(value);
}

/** draft -> submitted; submitted -> published | rejected; rejected -> submitted (revision loop). */
const PUBLICATION_TRANSITIONS: Readonly<Record<PublicationState, readonly PublicationState[]>> = {
  draft: ["submitted"],
  submitted: ["published", "rejected"],
  published: [],
  rejected: ["submitted"],
};

export function publicationTransitionLegal(from: PublicationState, to: PublicationState): boolean {
  return (PUBLICATION_TRANSITIONS[from] as readonly string[]).includes(to);
}

// --- machine 2: INSTALLATION (per-tenant; configuration surface) ---

export const INSTALLATION_STATES = ["installed", "uninstalled"] as const;

export type InstallationState = (typeof INSTALLATION_STATES)[number];

export function isKnownInstallationState(value: string): value is InstallationState {
  return (INSTALLATION_STATES as readonly string[]).includes(value);
}

/** installed -> uninstalled (terminal). Re-install creates a NEW record. */
const INSTALLATION_TRANSITIONS: Readonly<Record<InstallationState, readonly InstallationState[]>> =
  {
    installed: ["uninstalled"],
    uninstalled: [],
  };

export function installationTransitionLegal(
  from: InstallationState,
  to: InstallationState,
): boolean {
  return (INSTALLATION_TRANSITIONS[from] as readonly string[]).includes(to);
}

// --- machine 3: ACTIVATION (per installed package, for specific actors/scopes) ---

export const ACTIVATION_STATES = ["activated", "deactivated"] as const;

export type ActivationState = (typeof ACTIVATION_STATES)[number];

export function isKnownActivationState(value: string): value is ActivationState {
  return (ACTIVATION_STATES as readonly string[]).includes(value);
}

/** activated -> deactivated (terminal). Re-activation creates a NEW record. */
const ACTIVATION_TRANSITIONS: Readonly<Record<ActivationState, readonly ActivationState[]>> = {
  activated: ["deactivated"],
  deactivated: [],
};

export function activationTransitionLegal(from: ActivationState, to: ActivationState): boolean {
  return (ACTIVATION_TRANSITIONS[from] as readonly string[]).includes(to);
}

// --- machine 4: EXECUTION APPROVAL (citation ledger; the seam disposes) ---

export const EXECUTION_REQUEST_STATES = ["requested", "cited", "withdrawn"] as const;

export type ExecutionRequestState = (typeof EXECUTION_REQUEST_STATES)[number];

export function isKnownExecutionRequestState(value: string): value is ExecutionRequestState {
  return (EXECUTION_REQUEST_STATES as readonly string[]).includes(value);
}

/** requested -> cited | withdrawn. cited/withdrawn are terminal. */
const EXECUTION_REQUEST_TRANSITIONS: Readonly<
  Record<ExecutionRequestState, readonly ExecutionRequestState[]>
> = {
  requested: ["cited", "withdrawn"],
  cited: [],
  withdrawn: [],
};

export function executionRequestTransitionLegal(
  from: ExecutionRequestState,
  to: ExecutionRequestState,
): boolean {
  return (EXECUTION_REQUEST_TRANSITIONS[from] as readonly string[]).includes(to);
}

// --- recruitment lifecycle states (lands packages into the workforce) ---

export const RECRUITMENT_STATES = ["open", "resolved", "cancelled"] as const;

export type RecruitmentState = (typeof RECRUITMENT_STATES)[number];

export function isKnownRecruitmentState(value: string): value is RecruitmentState {
  return (RECRUITMENT_STATES as readonly string[]).includes(value);
}

// --- mirrored fabric vocabulary (see file header) ---

export const MARKETPLACE_AGENT_CAPABILITIES = [
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

export type MarketplaceAgentCapability = (typeof MARKETPLACE_AGENT_CAPABILITIES)[number];

export function isKnownMarketplaceAgentCapability(
  value: string,
): value is MarketplaceAgentCapability {
  return (MARKETPLACE_AGENT_CAPABILITIES as readonly string[]).includes(value);
}

export const MARKETPLACE_BODY_MODEL_PURPOSES = [
  "cognition",
  "conversation",
  "analysis",
  "background",
] as const;

export type MarketplaceBodyModelPurpose = (typeof MARKETPLACE_BODY_MODEL_PURPOSES)[number];

export function isKnownMarketplaceBodyModelPurpose(
  value: string,
): value is MarketplaceBodyModelPurpose {
  return (MARKETPLACE_BODY_MODEL_PURPOSES as readonly string[]).includes(value);
}

export const MARKETPLACE_CANDIDATE_ACTOR_KINDS = [
  "human",
  "team",
  "agent",
  "agent-team",
  "software",
  "automation",
  "supplier",
  "partner",
  "external-service",
] as const;

export type MarketplaceCandidateActorKind = (typeof MARKETPLACE_CANDIDATE_ACTOR_KINDS)[number];

export function isKnownMarketplaceCandidateActorKind(
  value: string,
): value is MarketplaceCandidateActorKind {
  return (MARKETPLACE_CANDIDATE_ACTOR_KINDS as readonly string[]).includes(value);
}

// --- capability supply vocabulary (CapabilityPackage / supplies) ---

export const CAPABILITY_SUPPLY_KINDS = ["tool", "connector", "software"] as const;

export type CapabilitySupplyKind = (typeof CAPABILITY_SUPPLY_KINDS)[number];

export function isKnownCapabilitySupplyKind(value: string): value is CapabilitySupplyKind {
  return (CAPABILITY_SUPPLY_KINDS as readonly string[]).includes(value);
}

// --- activation grant vocabulary (what an activation may touch) ---

export const ACTIVATION_GRANT_KINDS = ["capability", "tool", "data-scope", "environment"] as const;

export type ActivationGrantKind = (typeof ACTIVATION_GRANT_KINDS)[number];

export function isKnownActivationGrantKind(value: string): value is ActivationGrantKind {
  return (ACTIVATION_GRANT_KINDS as readonly string[]).includes(value);
}

// --- evidence kinds accepted on marketplace claims (provenance of claims) ---

export const MARKETPLACE_EVIDENCE_KINDS = [
  "benchmark",
  "certification",
  "audit-report",
  "reference-customer",
  "usage-telemetry",
  "test-suite",
  "provenance-statement",
] as const;

export type MarketplaceEvidenceKind = (typeof MARKETPLACE_EVIDENCE_KINDS)[number];

export function isKnownMarketplaceEvidenceKind(value: string): value is MarketplaceEvidenceKind {
  return (MARKETPLACE_EVIDENCE_KINDS as readonly string[]).includes(value);
}

// --- audit action vocabulary (one kind per governance transition) ---

export const MARKETPLACE_AUDIT_ACTIONS = [
  "marketplace.package-drafted",
  "marketplace.package-submitted",
  "marketplace.package-published",
  "marketplace.package-rejected",
  "marketplace.package-installed",
  "marketplace.package-configuration-revised",
  "marketplace.package-uninstalled",
  "marketplace.package-activated",
  "marketplace.package-deactivated",
  "marketplace.execution-requested",
  "marketplace.execution-cited",
  "marketplace.execution-withdrawn",
  "marketplace.recruitment-opened",
  "marketplace.recruitment-ranked",
  "marketplace.recruitment-resolved",
  "marketplace.recruitment-registered",
  "marketplace.recruitment-cancelled",
] as const;

export type MarketplaceAuditActionKind = (typeof MARKETPLACE_AUDIT_ACTIONS)[number];

export function isKnownMarketplaceAuditAction(value: string): value is MarketplaceAuditActionKind {
  return (MARKETPLACE_AUDIT_ACTIONS as readonly string[]).includes(value);
}
