/**
 * Cognition area public surface (W007): the explicit asynchronous, resumable
 * canonical intelligence loop (catalog: "explicit asynchronous/resumable
 * canonical intelligence loop"). Stage order is application-owned; the LLM
 * supplies bounded content only; every consequential action enters the
 * authority gate (and stops at `recommended` — humans approve/authorize);
 * the evidence chain is reconstructable from the mission record + domain
 * provenance (test-locked acceptance, spec/WORK-ITEM-CATALOG.md W007).
 *
 * Cross-module consumption: `@aurum/domain` is imported ONLY through its
 * public package entrypoint (no deep imports; no provider SDK types; no
 * `@aurum/execution` or `@zcode/shared` anywhere in src/cognition —
 * tripwires in test/cognition-contract-hygiene.test.ts).
 */
// --- typed errors (domain) ---
export { MissionError, isMissionError, mapDomainError } from "./domain/errors.js";
export type { MissionErrorCode } from "./domain/errors.js";
export {
  missionConflict,
  missionInvariant,
  missionModelRefused,
  missionNotFound,
  missionStateIllegal,
  missionSubjectNotFound,
  missionValidationError,
  missionAuthorityRefused,
} from "./domain/errors.js";

// --- stage machine vocabulary + bounds (domain) ---
export {
  ADMISSIBLE_FRESHNESS,
  GAP_ORIGINS,
  MISSION_BOUNDS,
  MISSION_DISPOSITIONS,
  MISSION_EFFECT_KINDS,
  MISSION_STAGES,
  MISSION_STATUSES,
  PROPOSAL_KINDS,
  isKnownGapOrigin,
  isKnownMissionDisposition,
  isKnownMissionEffectKind,
  isKnownMissionStage,
  isKnownMissionStatus,
  isKnownProposalKind,
  isTerminalMissionStatus,
  missionStageIndex,
  nextMissionStage,
} from "./domain/vocabulary.js";
export type {
  GapOrigin,
  MissionDisposition,
  MissionEffectKind,
  MissionStage,
  MissionStatus,
  ProposalKind,
} from "./domain/vocabulary.js";

// --- bounded reasoning boundary (domain) ---
export { reasonedContentIssues } from "./domain/bounded.js";
export type {
  MissionOrientation,
  OrientationBelief,
  OrientationContradiction,
  OrientationGoal,
  OrientationMemory,
  OrientationObservation,
  OrientationTruncation,
  OrientationUnknown,
  ReasonedContent,
  ReasonedFinding,
  ReasonedGap,
  ReasonedHypothesis,
  ReasonedProposal,
  ReasoningRequest,
} from "./domain/bounded.js";

// --- records (domain) ---
export type {
  ActionEffect,
  AppliedEffect,
  BeliefEffect,
  ClaimEffect,
  EvaluatedGap,
  EvaluateStageRecord,
  FindingEvaluation,
  GateStageRecord,
  GatedAction,
  MemoryEffect,
  MissionCharter,
  MissionEffectManifest,
  MissionEvaluation,
  MissionOutcome,
  MissionRecord,
  MissionStageRecord,
  OrientStageRecord,
  ProposeStageRecord,
  ReasonStageRecord,
  RecordStageRecord,
  UnknownEffect,
} from "./domain/records.js";

// --- deterministic effect derivation (domain) ---
export {
  COGNITION_ACTOR_NAME,
  deriveEffectManifest,
  effectId,
  manifestContainsTarget,
  manifestEffectCount,
} from "./domain/effects.js";
export type { DeriveManifestInput } from "./domain/effects.js";

// --- ports (domain) ---
export type {
  CognitionKnowledgeSeams,
  CognitionReadSeams,
  CognitionServiceDeps,
  MissionAuthorityGate,
  MissionFilter,
  MissionProposalPolicy,
  MissionStore,
  ReasoningPort,
} from "./domain/ports.js";

// --- service (app) ---
export { createCognitionService } from "./app/cognitionService.js";
export type { CognitionService, CreateMissionInput } from "./app/cognitionService.js";
export { buildOrientation, reasoningRequestFromOrientation } from "./app/orient.js";
export { evaluateMission } from "./app/evaluate.js";
export { cognitionActor } from "./app/apply.js";
export { missionTrajectoryOf } from "./app/trajectory.js";
export type {
  MissionTrajectory,
  TrajectoryEvidenceChain,
  TrajectoryStage,
} from "./app/trajectory.js";

// --- reference adapters (adapters) ---
export {
  createInMemoryMissionStore,
  InMemoryMissionStore,
} from "./adapters/in-memory-mission-store.js";
export { createScriptedReasoner } from "./adapters/scripted-reasoner.js";
export type { ReasonerScriptEntry, ScriptedReasoner } from "./adapters/scripted-reasoner.js";
export { createKernelCognitionSeams } from "./adapters/kernel-cognition-seams.js";
export type { KernelCognitionSeams } from "./adapters/kernel-cognition-seams.js";
