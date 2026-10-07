/**
 * capability area public surface (W005).
 */
export {
  GAP_KINDS,
  PROFICIENCY_MAX,
  PROFICIENCY_MIN,
  REQUIREMENT_SOURCES,
  assessCoverage,
  isKnownCapabilityGapKind,
  isKnownRequirementSource,
} from "./records.js";
export type {
  CapabilityGapKind,
  CapabilityGapRecord,
  CapabilityRecord,
  CapabilityRequirementRecord,
  CapabilitySupplyRecord,
  CoverageAssessment,
  CoverageStatus,
  RequirementSource,
  RequirementSourceKind,
} from "./records.js";
export { createCapabilityGraph } from "./capabilityStore.js";
export type {
  CapabilityGraph,
  GapFilter,
  RecomputeGapsInput,
  RegisterCapabilityInput,
  RegisterRequirementInput,
  RegisterSupplyInput,
  RequirementFilter,
  SupplyFilter,
} from "./ports.js";
