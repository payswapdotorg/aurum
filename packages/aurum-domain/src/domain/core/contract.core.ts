/**
 * core area public surface: identity/value primitives every other area uses.
 */
export type {
  ActionId,
  AlternativeExplanationId,
  AuditId,
  BeliefId,
  Brand,
  CapabilityGapId,
  CapabilityId,
  CapabilityRequirementId,
  CapabilitySupplyId,
  CapacityDeclarationId,
  ClaimId,
  ContradictionId,
  DomainTimestamp,
  EventId,
  GoalId,
  HypothesisId,
  MembershipId,
  MemoryId,
  ObservationId,
  OrganizationCandidateId,
  OrganizationId,
  PersonId,
  ProcessId,
  RecordId,
  SiteId,
  TenantId,
  UnknownId,
  UnitId,
  WorkAssignmentId,
  WorkOutcomeId,
  WorkforceRecommendationId,
  WorkforceRoleId,
} from "./branding.js";
export {
  actionId,
  alternativeExplanationId,
  auditId,
  beliefId,
  capabilityGapId,
  capabilityId,
  capabilityRequirementId,
  capabilitySupplyId,
  capacityDeclarationId,
  claimId,
  contradictionId,
  eventId,
  goalId,
  hypothesisId,
  membershipId,
  memoryId,
  observationId,
  organizationCandidateId,
  organizationId,
  personId,
  processId,
  siteId,
  unknownId,
  unitId,
  workAssignmentId,
  workOutcomeId,
  workforceRecommendationId,
  workforceRoleId,
} from "./ids.js";
export {
  DomainError,
  conflictError,
  forbiddenError,
  invariantError,
  isDomainError,
  notFound,
  staleError,
  validationError,
} from "./errors.js";
export type { DomainErrorCode, ValidationIssue } from "./errors.js";
export { err, ok, unwrap } from "./result.js";
export type { Result } from "./result.js";
export { createValidator, finishValidation } from "./validation.js";
export type { Validator } from "./validation.js";
export { domainTime, isValidTimeWindow } from "./time.js";
export type { TimeWindow } from "./time.js";
export {
  ACTOR_KINDS,
  SUBJECT_KINDS,
  isKnownActorKind,
  isKnownSubjectKind,
  personActor,
  systemActor,
} from "./refs.js";
export type { ActorKind, ActorReference, SubjectKind, SubjectReference } from "./refs.js";
export { SUPPLIER_KINDS, isKnownSupplierKind, supplierIssues } from "./suppliers.js";
export type { SupplierKind, SupplierReference } from "./suppliers.js";
export { tenantScope } from "./scope.js";
export type { TenantScope, TenantScopedRecord } from "./scope.js";
export { deepFreeze } from "./freeze.js";
export { isDomainJsonValue } from "./value.js";
export type { DomainJsonValue } from "./value.js";
export { TenantIndex } from "./tenantIndex.js";
