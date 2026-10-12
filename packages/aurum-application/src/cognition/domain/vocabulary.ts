/**
 * Cognition vocabulary (W007 domain layer): the application-owned stage
 * machine of the canonical intelligence loop, mission lifecycle states,
 * effect kinds and the BOUNDED-CONTENT caps.
 *
 * STAGE ORDER IS APPLICATION-OWNED (catalog W007 clause 1): the stage
 * sequence below is the only legal mission trajectory; the next stage is
 * always DERIVED from the journal length — never accepted from a caller,
 * never present in model output (the bounded content schema has no
 * stage/control fields at all; tripwire-locked in
 * test/cognition-contract-hygiene.test.ts).
 *
 * Mapping to the canonical loop (spec/ARCHITECTURE.md "Cognition"):
 * - orient   <- observe; evidence/memory; (world update — read side)
 * - reason   <- knowledge acquisition (the ONLY model touchpoint; bounded)
 * - evaluate <- epistemic evaluation; goal evaluation; unknown/mission
 *               evaluation (pure derivation over persisted stages)
 * - propose  <- world update + model update + unknown evaluation (knowledge
 *               writes: claims / first-revision beliefs / raised unknowns)
 * - gate     <- recommendation/ask/proposal/action (EVERY consequential
 *               action enters the authority gate; stops at `recommended`)
 * - record   <- outcome; learning (mission outcome + organizational memory)
 */
import type { FreshnessClass, SubjectReference } from "@aurum/domain";

/** The fixed mission stage sequence. Index = journal position. */
export const MISSION_STAGES = [
  "orient",
  "reason",
  "evaluate",
  "propose",
  "gate",
  "record",
] as const;

export type MissionStage = (typeof MISSION_STAGES)[number];

export function isKnownMissionStage(value: string): value is MissionStage {
  return (MISSION_STAGES as readonly string[]).includes(value);
}

/** The stage that runs after `completed` journal entries (undefined = done). */
export function nextMissionStage(completed: number): MissionStage | undefined {
  return MISSION_STAGES[completed];
}

/** Journal position of a stage (its fixed index in MISSION_STAGES). */
export function missionStageIndex(stage: MissionStage): number {
  return MISSION_STAGES.indexOf(stage);
}

/** Mission lifecycle. Terminal: complete, cancelled. */
export const MISSION_STATUSES = ["pending", "running", "complete", "cancelled"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export function isKnownMissionStatus(value: string): value is MissionStatus {
  return (MISSION_STATUSES as readonly string[]).includes(value);
}

export function isTerminalMissionStatus(status: MissionStatus): boolean {
  return status === "complete" || status === "cancelled";
}

/** Honest end-of-loop disposition (record stage). */
export const MISSION_DISPOSITIONS = ["satisfied", "knowledge-gap-remains"] as const;
export type MissionDisposition = (typeof MISSION_DISPOSITIONS)[number];

export function isKnownMissionDisposition(value: string): value is MissionDisposition {
  return (MISSION_DISPOSITIONS as readonly string[]).includes(value);
}

/** Kinds of deterministic effects a mission can apply on domain seams. */
export const MISSION_EFFECT_KINDS = ["claim", "unknown", "belief", "action", "memory"] as const;
export type MissionEffectKind = (typeof MISSION_EFFECT_KINDS)[number];

export function isKnownMissionEffectKind(value: string): value is MissionEffectKind {
  return (MISSION_EFFECT_KINDS as readonly string[]).includes(value);
}

/** What the mission asks the authority gate for (proposal vocabulary). */
export const PROPOSAL_KINDS = ["recommendation", "ask", "proposal"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export function isKnownProposalKind(value: string): value is ProposalKind {
  return (PROPOSAL_KINDS as readonly string[]).includes(value);
}

/** Origins of gaps surfaced by the evaluate stage (honest reporting). */
export const GAP_ORIGINS = ["reasoned", "stale-evidence", "pre-existing"] as const;
export type GapOrigin = (typeof GAP_ORIGINS)[number];

export function isKnownGapOrigin(value: string): value is GapOrigin {
  return (GAP_ORIGINS as readonly string[]).includes(value);
}

/**
 * Bounded-content caps (catalog W007 clause 2: "LLM supplies bounded
 * content"). These bound BOTH directions of the reasoning boundary: the
 * orientation digest handed TO the model and the content accepted FROM it.
 * Anything outside the caps is refused with `mission-model-refused`.
 */
export const MISSION_BOUNDS = {
  /** Mission id cap (also keeps derived effect ids within the domain's 128). */
  missionIdMaxLength: 64,
  questionMaxLength: 500,
  consequenceMaxLength: 500,
  /** ReasonedContent caps (response side). */
  summaryMaxLength: 2000,
  statementMaxLength: 500,
  findingCitationsMax: 4,
  findingsMax: 8,
  gapsMax: 5,
  hypothesesMax: 4,
  proposalsMax: 5,
  titleMaxLength: 200,
  descriptionMaxLength: 1000,
  rationaleMaxLength: 500,
  /** Orientation digest caps (request side). */
  observationsMax: 12,
  beliefsMax: 8,
  memoryMax: 8,
  unknownsMax: 8,
  contradictionsMax: 8,
} as const;

/** Freshness classes that keep a finding admissible as asserted knowledge. */
export const ADMISSIBLE_FRESHNESS: readonly FreshnessClass[] = ["current", "aging"];

/** Subject-linked filter helper shared by the orientation assembly. */
export function subjectReferences(
  refs: readonly SubjectReference[],
  subject: SubjectReference,
): readonly SubjectReference[] {
  return refs.filter((ref) => ref.kind === subject.kind && ref.id === subject.id);
}
