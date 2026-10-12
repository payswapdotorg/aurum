/**
 * Cognition record types (W007 domain layer): the mission record, the
 * append-only stage journal (one entry per completed stage — the persisted,
 * replayable step), the deterministic effect manifest and the outcome.
 *
 * The stage journal IS the resumability mechanism: the next stage is always
 * `MISSION_STAGES[journal.length]`, and every effect a stage applies carries
 * a deterministic id derived from (missionId, kind, index) so re-execution
 * after an interruption converges without duplicate semantic writes.
 */
import type {
  ActorReference,
  DomainTimestamp,
  FreshnessClass,
  ProvenanceRecord,
  SubjectReference,
  TenantScopedRecord,
} from "@aurum/domain";
import type {
  GapOrigin,
  MissionDisposition,
  MissionEffectKind,
  MissionStatus,
  ProposalKind,
} from "./vocabulary.js";
import type { MissionOrientation, ReasonedContent, ReasoningRequest } from "./bounded.js";

/** What the mission is chartered to resolve (the learning question). */
export interface MissionCharter {
  readonly subject: SubjectReference;
  readonly question: string;
  readonly consequence: string;
  readonly goalId?: string;
}

// --- stage journal (discriminated by stage; index == stage order) ---

export interface OrientStageRecord {
  readonly stage: "orient";
  readonly stageIndex: 0;
  readonly at: DomainTimestamp;
  readonly actor: ActorReference;
  readonly orientation: MissionOrientation;
}

export interface ReasonStageRecord {
  readonly stage: "reason";
  readonly stageIndex: 1;
  readonly at: DomainTimestamp;
  readonly actor: ActorReference;
  /** The bounded digest the model saw (evidence chain: inputs). */
  readonly request: ReasoningRequest;
  /** The bounded content the model returned (evidence chain: output). */
  readonly content: ReasonedContent;
  /** Which reasoning adapter produced the content (evidence chain: model). */
  readonly modelName: string;
}

/** One evaluated finding: freshness-admissibility decided at evaluate time. */
export interface FindingEvaluation {
  readonly statement: string;
  readonly basedOn: readonly string[];
  readonly freshness: FreshnessClass;
  readonly admissible: boolean;
}

/** A gap the mission surfaces (reasoned, stale-evidence, or pre-existing). */
export interface EvaluatedGap {
  readonly question: string;
  readonly consequence: string;
  readonly origin: GapOrigin;
}

export interface MissionEvaluation {
  readonly findings: readonly FindingEvaluation[];
  readonly admittedFindings: number;
  readonly staleFindings: number;
  readonly gaps: readonly EvaluatedGap[];
  readonly hypotheses: readonly {
    readonly statement: string;
    readonly explains: readonly SubjectReference[];
  }[];
  readonly goalAddressed?: boolean;
  readonly disposition: MissionDisposition;
}

export interface EvaluateStageRecord {
  readonly stage: "evaluate";
  readonly stageIndex: 2;
  readonly at: DomainTimestamp;
  readonly actor: ActorReference;
  readonly evaluation: MissionEvaluation;
}

// --- deterministic effect manifest (derived in propose; applied across
// --- propose/gate/record; ids are stable across replays) ---

export interface ClaimEffect {
  readonly effectId: string;
  readonly claimId: string;
  readonly statement: string;
  readonly derivedFrom: readonly string[];
}

export interface UnknownEffect {
  readonly effectId: string;
  readonly unknownId: string;
  readonly question: string;
  readonly consequence: string;
}

export interface BeliefEffect {
  readonly effectId: string;
  readonly beliefId: string;
  readonly statement: string;
  readonly supportingClaimIds: readonly string[];
}

export interface ActionEffect {
  readonly effectId: string;
  readonly actionId: string;
  readonly kind: ProposalKind;
  readonly title: string;
  readonly description?: string;
  readonly subject: SubjectReference;
  readonly rationale: string;
  /** Claim ids backing the proposal (evidence chain into the gate). */
  readonly expectedEvidence: readonly string[];
}

export interface MemoryEffect {
  readonly effectId: string;
  readonly memoryId: string;
  readonly content: string;
}

/** The full, deterministically-derived effect plan of one mission run. */
export interface MissionEffectManifest {
  readonly subject: SubjectReference;
  readonly claims: readonly ClaimEffect[];
  readonly unknowns: readonly UnknownEffect[];
  readonly belief?: BeliefEffect;
  readonly actions: readonly ActionEffect[];
  readonly memory: MemoryEffect;
}

/** A applied-effect trace entry (what actually landed, and where). */
export interface AppliedEffect {
  readonly effectId: string;
  readonly kind: MissionEffectKind;
  readonly targetId: string;
}

export interface ProposeStageRecord {
  readonly stage: "propose";
  readonly stageIndex: 3;
  readonly at: DomainTimestamp;
  readonly actor: ActorReference;
  readonly manifest: MissionEffectManifest;
  readonly applied: readonly AppliedEffect[];
}

/** Final state observed for a gated action (idempotent re-runs skip). */
export interface GatedAction {
  readonly effectId: string;
  readonly actionId: string;
  readonly finalState: string;
}

export interface GateStageRecord {
  readonly stage: "gate";
  readonly stageIndex: 4;
  readonly at: DomainTimestamp;
  readonly actor: ActorReference;
  readonly gated: readonly GatedAction[];
}

export interface MissionOutcome {
  readonly disposition: MissionDisposition;
  readonly admittedFindings: number;
  readonly gapsRaised: number;
  readonly actionsProposed: number;
}

export interface RecordStageRecord {
  readonly stage: "record";
  readonly stageIndex: 5;
  readonly at: DomainTimestamp;
  readonly actor: ActorReference;
  readonly outcome: MissionOutcome;
}

export type MissionStageRecord =
  | OrientStageRecord
  | ReasonStageRecord
  | EvaluateStageRecord
  | ProposeStageRecord
  | GateStageRecord
  | RecordStageRecord;

// --- the mission record ---

/** The mission: chartered question + append-only stage journal + status. */
export interface MissionRecord extends TenantScopedRecord {
  readonly missionId: string;
  readonly charter: MissionCharter;
  readonly status: MissionStatus;
  readonly disposition?: MissionDisposition;
  readonly stages: readonly MissionStageRecord[];
  readonly createdBy: ActorReference;
  readonly createdAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
  readonly cancelled?: {
    readonly at: DomainTimestamp;
    readonly by: ActorReference;
    readonly reason: string;
  };
}
