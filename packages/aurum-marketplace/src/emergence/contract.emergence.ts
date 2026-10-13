/**
 * Emergence area public surface (W014): recurring gap detection over W013
 * evidence + governed role/package proposals with MANDATORY typed
 * alternatives. The area PROPOSES — never publishes: there is no
 * publication-shaped capability on this surface, and no code path reaches
 * a W011 publication mutation (tripwire: test/emergence-tripwires.test.ts).
 * The catalog bridge is the PURE `catalogDraftOfProposal` projection, valid
 * only for ACCEPTED (person-reviewed) proposals; the W011 governance path
 * runs unchanged afterwards.
 *
 * Cross-area consumption law: the W011 marketplace surface is imported
 * through its AREA CONTRACT (`../marketplace/contract.marketplace.js`) and
 * consumed as READ PICKS only; the W013 evidence enters through the
 * structural INTAKE port (CR-W014-emergence-evidence-wiring); no
 * `@aurum/application` import exists anywhere in this module.
 */
// --- typed errors (domain) ---
export { EmergenceError, isEmergenceError } from "./domain/errors.js";
export type { EmergenceErrorCode } from "./domain/errors.js";
export {
  emergenceConflict,
  emergenceInvariant,
  emergenceLifecycleIllegal,
  emergenceNotFound,
  emergencePublicationRefused,
  emergenceUnauthorized,
  emergenceValidationError,
} from "./domain/errors.js";

// --- vocabulary (domain) ---
export {
  EMERGENCE_AUDIT_ACTIONS,
  EMERGENCE_ALTERNATIVES_RULE,
  EMERGENCE_CATALOG_DRAFT_RULE,
  EMERGENCE_GAP_RULES,
  EMERGENCE_PROPOSAL_STATES,
  EMERGENCE_PROPOSAL_TRANSITIONS,
  EMERGENCE_SIGNAL_KINDS,
  EMERGENCE_THRESHOLDS,
  emergenceProposalTransitionLegal,
  isKnownEmergenceAuditAction,
  isKnownEmergenceProposalState,
  isKnownEmergenceSignalKind,
} from "./domain/vocabulary.js";
export type {
  EmergenceAuditActionKind,
  EmergenceProposalState,
  EmergenceSignalKind,
  EmergenceThresholds,
} from "./domain/vocabulary.js";

// --- evidence intake (domain: the W013 structural mirror) ---
export {
  EMERGENCE_OUTCOME_STATUSES,
  demandedCapabilitiesOf,
  isFailedEmergenceOutcomeStatus,
  isKnownEmergenceOutcomeStatus,
} from "./domain/evidence.js";
export type {
  EmergenceAllocationJoin,
  EmergenceContextClassPick,
  EmergenceOutcomeEvidence,
  EmergenceOutcomeObservation,
  EmergenceOutcomeStatus,
  EmergenceShapePick,
  EmergenceUnknownSignal,
} from "./domain/evidence.js";

// --- gap detection (domain, pure) ---
export { detectEmergenceGaps, emergenceGapIdOf } from "./domain/gaps.js";
export type { EmergenceGap, EmergenceQuery } from "./domain/gaps.js";

// --- alternatives (domain, pure + mechanical) ---
export {
  TOP_ALTERNATIVES_LIMIT,
  alternativesRuleId,
  deriveEmergenceAlternatives,
} from "./domain/alternatives.js";
export type {
  CatalogPackageAlternative,
  EmergenceAlternative,
  NoneAvailableAlternative,
  OpenRecruitmentAlternative,
} from "./domain/alternatives.js";

// --- proposals (domain: the governed records + lifecycle) ---
export {
  alternativesIssues,
  buildEmergenceProposal,
  reviewEmergenceProposal,
} from "./domain/proposals.js";
export type {
  EmergenceDemandBlock,
  EmergenceEvidenceBlock,
  EmergencePackageBundle,
  EmergencePackageProposal,
  EmergenceProposal,
  EmergenceProposalReview,
  EmergenceRoleProposal,
  EmergenceRoleShape,
} from "./domain/proposals.js";

// --- catalog-draft projection (domain, pure — the ONLY catalog bridge) ---
export { catalogDraftOfProposal } from "./domain/catalogDraft.js";
export type { EmergenceCatalogDraft, EmergenceCatalogDraftInput } from "./domain/catalogDraft.js";

// --- ports (domain) ---
export type {
  EmergenceEvidencePort,
  EmergenceProposalStore,
  EmergenceServiceDeps,
} from "./domain/ports.js";

// --- app service ---
export {
  createEmergenceService,
  emergenceRecordNotFound,
  mapMarketplaceError,
} from "./app/emergenceService.js";
export type {
  EmergenceService,
  ProposeEmergenceInput,
  ReviewEmergenceInput,
} from "./app/inputs.js";

// --- reference adapters (adapters) ---
export {
  createInMemoryEmergenceEvidenceDouble,
  InMemoryEmergenceEvidenceDouble,
} from "./adapters/in-memory-emergence-evidence.js";
export {
  createInMemoryEmergenceProposalStore,
  InMemoryEmergenceProposalStore,
} from "./adapters/in-memory-emergence-proposal-store.js";
