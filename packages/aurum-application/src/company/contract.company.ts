/**
 * Company area public surface (W004): authorized company query and
 * intelligence — read-only projections over the domain kernel. The company
 * slice queries; it never mutates domain state (no second authority), and
 * insufficient evidence produces honest Unknown / LearningMission answers
 * rather than fabricated certainty (spec/WORK-ITEM-CATALOG.md W004).
 *
 * Cross-module consumption: @aurum/domain is imported ONLY through its
 * public package entrypoint. No aurum-execution import exists anywhere in
 * the company module (tripwire in test/company-contract-hygiene.test.ts).
 */
// --- typed errors (domain) ---
export { CompanyError, isCompanyError } from "./domain/errors.js";
export type { CompanyErrorCode } from "./domain/errors.js";

// --- honesty vocabulary + record types (domain) ---
export {
  ANSWER_CLASSIFICATIONS,
  ATTENTION_CRITERIA,
  BLIND_SPOT_KINDS,
  QUERY_KINDS,
  isKnownAnswerClassification,
  isKnownAttentionCriterion,
  isKnownBlindSpotKind,
} from "./domain/records.js";
export type {
  AnswerClassification,
  AttentionCriterion,
  AttentionReport,
  AuditEntry,
  BeliefEntry,
  BlindSpot,
  BlindSpotKind,
  ChangeEntry,
  ChangeReport,
  ClaimEntry,
  ClaimSupportStatus,
  CompanyAnswer,
  CompanyQueryLogRecord,
  CoverageEntry,
  CoverageReport,
  CoverageStatus,
  CriterionFinding,
  GoalAttention,
  GoalRevisionEntry,
  GoalSituation,
  HorizonState,
  MembershipEntry,
  MemoryEntry,
  MissingEntry,
  ObservationEntry,
  OwnershipAnswer,
  OwnershipBasis,
  OwnershipEntry,
  ProvenanceStamp,
  QueryKind,
  RecordFreshness,
  RevisionEnrichment,
  RevisionEnrichmentKind,
  SituationReport,
  StaleEntry,
  UnknownEntry,
  UnknownReport,
} from "./domain/records.js";

// --- pure honesty derivations (domain) ---
export {
  beliefIsAsserted,
  claimSupportStatus,
  classifySubjectKnowledge,
  worstSupportFreshness,
} from "./domain/classification.js";
export type {
  BeliefAssertionInput,
  ClassificationInput,
  ClassificationOutcome,
  ClaimSupportInput,
  SupportFreshnessInput,
} from "./domain/classification.js";

// --- chain builders (domain) ---
export {
  auditEntry,
  beliefRevisionEntry,
  claimEntry,
  goalRevisionEntry,
  membershipEntry,
  memoryEntry,
  observationEntry,
} from "./domain/chain.js";

// --- ports (domain) ---
export type {
  CompanyDomainViews,
  CompanyIntelligenceDeps,
  CompanyQueryLog,
} from "./domain/ports.js";

// --- query builders + service (app) ---
export { askAboutSubject, blindSpotsOfSubject, classifyEvidence } from "./app/subjectQuery.js";
export { whatChangedSince } from "./app/changesQuery.js";
export { reportCoverage } from "./app/coverageQuery.js";
export {
  DEFAULT_HORIZON_CLOSING_MS,
  goalAttentionQuery,
  situationQuery,
} from "./app/situationQuery.js";
export { reportUnknowns } from "./app/unknownsQuery.js";
export { createCompanyIntelligenceService } from "./app/companyService.js";
export type { CompanyIntelligence } from "./app/companyService.js";

// --- adapters ---
export { createInMemoryQueryLog } from "./adapters/in-memory-query-log.js";
