/**
 * Validating factories for branded record ids. Ids are caller-supplied opaque
 * strings (the kernel does not generate identity), validated once here and
 * then trusted as branded values.
 */
import { ok, err, type Result } from "./result.js";
import { validationError } from "./errors.js";
import type {
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
  SiteId,
  UnknownId,
  UnitId,
  WorkAssignmentId,
  WorkOutcomeId,
  WorkforceRecommendationId,
  WorkforceRoleId,
} from "./branding.js";

function toId<B extends string>(field: string, value: string): Result<Brand<string, B>> {
  if (typeof value !== "string") {
    return err(validationError([{ field, problem: "must be a string" }]));
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return err(
      validationError([{ field, problem: "must be a non-empty string of at most 128 characters" }]),
    );
  }
  if (/\p{Cc}/u.test(trimmed)) {
    return err(validationError([{ field, problem: "must not contain control characters" }]));
  }
  return ok(trimmed as Brand<string, B>);
}

export const personId = (value: string): Result<PersonId> => toId("personId", value);
export const membershipId = (value: string): Result<MembershipId> => toId("membershipId", value);
export const organizationId = (value: string): Result<OrganizationId> =>
  toId("organizationId", value);
export const siteId = (value: string): Result<SiteId> => toId("siteId", value);
export const unitId = (value: string): Result<UnitId> => toId("unitId", value);
export const eventId = (value: string): Result<EventId> => toId("eventId", value);
export const observationId = (value: string): Result<ObservationId> => toId("observationId", value);
export const claimId = (value: string): Result<ClaimId> => toId("claimId", value);
export const beliefId = (value: string): Result<BeliefId> => toId("beliefId", value);
export const hypothesisId = (value: string): Result<HypothesisId> => toId("hypothesisId", value);
export const contradictionId = (value: string): Result<ContradictionId> =>
  toId("contradictionId", value);
export const unknownId = (value: string): Result<UnknownId> => toId("unknownId", value);
export const goalId = (value: string): Result<GoalId> => toId("goalId", value);
export const memoryId = (value: string): Result<MemoryId> => toId("memoryId", value);
export const actionId = (value: string): Result<ActionId> => toId("actionId", value);
export const auditId = (value: string): Result<AuditId> => toId("auditId", value);
export const processId = (value: string): Result<ProcessId> => toId("processId", value);
export const capabilityId = (value: string): Result<CapabilityId> => toId("capabilityId", value);
export const capabilitySupplyId = (value: string): Result<CapabilitySupplyId> =>
  toId("capabilitySupplyId", value);
export const capabilityRequirementId = (value: string): Result<CapabilityRequirementId> =>
  toId("capabilityRequirementId", value);
export const capabilityGapId = (value: string): Result<CapabilityGapId> =>
  toId("capabilityGapId", value);
export const workforceRoleId = (value: string): Result<WorkforceRoleId> =>
  toId("workforceRoleId", value);
export const capacityDeclarationId = (value: string): Result<CapacityDeclarationId> =>
  toId("capacityDeclarationId", value);
export const workAssignmentId = (value: string): Result<WorkAssignmentId> =>
  toId("workAssignmentId", value);
export const workOutcomeId = (value: string): Result<WorkOutcomeId> => toId("workOutcomeId", value);
export const alternativeExplanationId = (value: string): Result<AlternativeExplanationId> =>
  toId("alternativeExplanationId", value);
export const workforceRecommendationId = (value: string): Result<WorkforceRecommendationId> =>
  toId("workforceRecommendationId", value);
export const organizationCandidateId = (value: string): Result<OrganizationCandidateId> =>
  toId("organizationCandidateId", value);
