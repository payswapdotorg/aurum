/**
 * storage area public surface: the async storage boundary types (P001).
 * Types only — no runtime code is exported from this area.
 */
export type {
  ActionStorage,
  AsyncStore,
  AuditStorage,
  AuditStorageSink,
  CandidateStorage,
  CapabilityStorage,
  DomainStoragePorts,
  EpistemicsStorage,
  EventStorage,
  EvidenceStorage,
  GoalStorage,
  IdentityStorage,
  InquiryStorage,
  MemoryStorage,
  OrganizationStorage,
  ProcessStorage,
  StorageKernelMemberTwin,
  StorageResult,
  StorageRoleResolver,
  WorkforceInsightsStorage,
  WorkforceRecommendationStorage,
  WorkforceStorage,
} from "./ports.js";
