/**
 * Control-tower record types (W010 domain layer): the READ-ONLY view models
 * the management control tower renders. Every type here is a PROJECTION of
 * records the four public areas already own (company intelligence W004,
 * cognition missions W007, the organizational lab W008, execution plans
 * W009) — the tower invents no facts: each field is copied or counted from
 * an existing record, and the derivation functions live in
 * `overview.ts` / `conversation.ts` where they are unit-proven.
 *
 * UI-NEVER-TRUTH LAW (catalog W010 clause 3): these view models are derived
 * values, never a store of record. Nothing writes them back; the only way
 * state changes is a semantic action through the public contracts (the
 * tower service delegates those 1:1 — see `app/towerService.ts`).
 */
import type { ActorReference, DomainTimestamp, SubjectReference } from "@aurum/domain";
import type {
  AttentionReport,
  SituationReport,
  UnknownReport,
} from "../../company/contract.company.js";
import type { MissionDisposition, MissionStatus } from "../../cognition/contract.cognition.js";
import type { PlanApprovalState, PlanLifecycleState } from "../../plans/contract.plans.js";

// --- the overview (the tower's primary "Today" board) ---

/** One goal rendered as a tower card (situation + attention + children). */
export interface GoalTowerCard {
  readonly goalId: string;
  readonly revision: number;
  readonly objective: string;
  readonly priority: string;
  readonly horizonState: string;
  readonly horizonEnd: DomainTimestamp;
  readonly ownerPersonId: string;
  readonly openUnknowns: number;
  readonly openContradictions: number;
  readonly expectedEvidenceCoverage: string;
  readonly freshness: string;
  /** Attention criteria that fired for this goal (empty when none did). */
  readonly attentionCriteria: readonly string[];
  /** Plans that serve this goal (ids only — cards carry the detail). */
  readonly planIds: readonly string[];
  /** Missions chartered for this goal (ids only). */
  readonly missionIds: readonly string[];
}

/** One cognition mission rendered as a tower card. */
export interface MissionTowerCard {
  readonly missionId: string;
  readonly question: string;
  readonly status: MissionStatus;
  readonly stagesCompleted: number;
  readonly totalStages: number;
  readonly disposition?: MissionDisposition;
  readonly goalId?: string;
  readonly createdAt: DomainTimestamp;
}

/** One execution plan rendered as a tower card. */
export interface PlanTowerCard {
  readonly planId: string;
  readonly goalId?: string;
  readonly candidateId: string;
  readonly version: number;
  readonly approvalState: PlanApprovalState;
  readonly lifecycleState: PlanLifecycleState;
  readonly taskCount: number;
  /** Present only for active plans (readiness is an active-plan concern). */
  readonly readyTaskCount?: number;
  readonly escalationCount?: number;
  readonly createdAt: DomainTimestamp;
}

/** One lab evaluation summarized for the tower (the Lab panel). */
export interface LabEvaluationSummary {
  readonly evaluationId: string;
  readonly goalId?: string;
  readonly fingerprintDigest: string;
  readonly rankedCount: number;
  readonly topCandidateId?: string;
  readonly topScore?: number;
  readonly createdAt: DomainTimestamp;
}

/** The Lab panel: latest evaluations, newest first (bounded by the caller). */
export interface LabTowerSummary {
  readonly evaluations: readonly LabEvaluationSummary[];
}

/**
 * A consequential item awaiting a HUMAN decision. Two sources only:
 * - cognition gate stages whose actions stopped at `recommended`
 *   (mission-record derived — the gate never approves);
 * - plans in `submitted` approval state (plan-record derived).
 */
export interface PendingApproval {
  readonly kind: "mission-action" | "plan";
  readonly sourceId: string;
  readonly actionId?: string;
  readonly title: string;
  readonly description?: string;
  readonly subject?: SubjectReference;
  readonly raisedAt: DomainTimestamp;
}

/** The tower's primary read model: everything the "Today" board renders. */
export interface ControlTowerOverview {
  readonly asOf: DomainTimestamp;
  readonly situation: SituationReport;
  readonly attention: AttentionReport;
  readonly unknowns: UnknownReport;
  readonly goals: readonly GoalTowerCard[];
  readonly missions: readonly MissionTowerCard[];
  readonly plans: readonly PlanTowerCard[];
  readonly lab: LabTowerSummary;
  readonly pendingApprovals: readonly PendingApproval[];
}

// --- the conversation experience ---

/** What a conversation thread is over (a mission or a plan record). */
export type ConversationTopic =
  | { readonly kind: "mission"; readonly missionId: string }
  | { readonly kind: "plan"; readonly planId: string };

/** Who a turn speaks for (mirrors the record's own provenance). */
export type ConversationRole = "human" | "system" | "model";

/** The record a turn was derived from (one per turn kind). */
export type ConversationTurnKind =
  | "mission-charter"
  | "mission-orient"
  | "mission-reason"
  | "mission-evaluate"
  | "mission-propose"
  | "mission-gate"
  | "mission-record"
  | "mission-cancelled"
  | "plan-created"
  | "plan-approval"
  | "plan-lifecycle";

/**
 * One conversation turn — a READ-ONLY projection of one stage journal entry
 * (missions) or one immutable history entry (plans). `awaitsHuman` marks
 * turns whose underlying record stopped where a human decision is required
 * (gate stage with recommended actions; submitted plans).
 */
export interface ConversationTurn {
  readonly turnId: string;
  readonly role: ConversationRole;
  readonly kind: ConversationTurnKind;
  readonly at: DomainTimestamp;
  readonly actor?: ActorReference;
  readonly title: string;
  readonly detail: string;
  readonly awaitsHuman: boolean;
  /** Record ids the turn cites (mission stage refs, action ids, audit refs). */
  readonly citations: readonly string[];
}

/** A full conversation thread view model over one topic. */
export interface ConversationViewModel {
  readonly topic: ConversationTopic;
  readonly title: string;
  readonly subtitle: string;
  readonly status: string;
  readonly turns: readonly ConversationTurn[];
  /** Human-decision items surfaced at the end of the thread. */
  readonly pendingApprovals: readonly PendingApproval[];
}
