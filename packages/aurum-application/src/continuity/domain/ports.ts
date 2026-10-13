/**
 * Continuity ports (W012 domain layer): the ledger, the attachment surface,
 * the runtime composer/replayer seams and the public service surface.
 *
 * Layer discipline: this area's app layer never imports adapters; the
 * recording composition + replay fold are INJECTED through the
 * `TowerRuntimeComposer` / `TowerReplayer` seams (implemented in
 * adapters/session-kernel.ts over the canonical W010 local composition).
 * The `LocalControlTowerRuntime` type arrives through the sibling
 * control-tower CONTRACT — the same intra-package pattern the tower used for
 * the four areas.
 */
import type {
  ActionAuthority,
  ActorReference,
  DomainTimestamp,
  EpistemicsLedger,
  InquiryLedger,
  OrganizationalMemory,
  Result,
  TenantScope,
} from "@aurum/domain";
import type { MissionStore } from "../../cognition/contract.cognition.js";
import type { MissionRecord } from "../../cognition/contract.cognition.js";
import type { MissionError } from "../../cognition/contract.cognition.js";
import type {
  EscalationStore,
  HandoffRelayStore,
  PlanAuditPort,
  PlanError,
  PlanStore,
  TaskCompletionStore,
} from "../../plans/contract.plans.js";
import type { ExecutionPlan, TaskCompletionRecord } from "../../plans/contract.plans.js";
import type { LabEvaluationStore } from "../../lab/contract.lab.js";
import type { CompanyQueryLog } from "../../company/contract.company.js";
import type { LocalControlTowerRuntime } from "../../control-tower/contract.control-tower.js";
import type {
  ControlTowerError,
  ControlTowerOverview,
  ControlTowerService,
  ConversationTopic,
  ConversationViewModel,
  TowerReadInput,
} from "../../control-tower/contract.control-tower.js";
import type { ContinuityError } from "./errors.js";
import type {
  AttachmentDigest,
  AttachmentView,
  ContinuityEntry,
  ContinuityMode,
  ContinuityRecord,
  ReplayReport,
  SessionInfo,
  SessionVariant,
} from "./records.js";

/**
 * The append-only continuity ledger (APPROACH R1). Dumb by design: it
 * stamps identity + order, refuses duplicate record ids, and lists back what
 * was appended. NO update, NO delete — replay is a fold over the full
 * sequence (tripwire-locked in the proof suite).
 */
export interface ContinuityLedger {
  append(sessionId: string, entry: ContinuityEntry): Result<ContinuityRecord, ContinuityError>;
  /** All records of one session in append order (empty when unknown). */
  list(sessionId: string): readonly ContinuityRecord[];
  /** Every session id with at least one record, in first-seen order. */
  listSessions(): readonly string[];
}

/**
 * The substrate attachment surface (APPROACH R5): materializes attachment
 * content on the hosting platform and returns a durable reference. Runtime
 * plane only — the semantic layers never see bytes. Production adapter: the
 * desktop main process (over the ZCode prompt-attachment machinery);
 * reference adapter: the in-memory surface.
 */
export interface TowerAttachmentSurface {
  readonly name: string;
  materialize(input: {
    readonly sessionId: string;
    readonly attachmentId: string;
    readonly name: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
  }): Promise<Result<{ readonly materializedRef: string }, ContinuityError>>;
}

/** The inner stores/seams a replay fold applies recorded entries to. */
export interface TowerReplayTargets {
  readonly missions: MissionStore;
  readonly plans: PlanStore;
  readonly handoffs: HandoffRelayStore;
  readonly completions: TaskCompletionStore;
  readonly escalations: EscalationStore;
  readonly evaluations: LabEvaluationStore;
  readonly queryLog: CompanyQueryLog;
  readonly planAudit: PlanAuditPort;
  readonly kernel: {
    readonly epistemics: Pick<EpistemicsLedger, "registerClaim" | "reviseBelief">;
    readonly inquiry: Pick<InquiryLedger, "raiseUnknown">;
    readonly memory: Pick<OrganizationalMemory, "recordMemory">;
    readonly gate: Pick<ActionAuthority, "proposeAction" | "recommendAction">;
  };
}

/** A freshly composed, journaling runtime + its replay targets. */
export interface ComposedTowerSession {
  readonly runtime: LocalControlTowerRuntime;
  readonly replayTargets: TowerReplayTargets;
}

/** Binding passed to every composition (the journal's session identity). */
export interface TowerSessionBinding {
  readonly sessionId: string;
  readonly scope: TenantScope;
  readonly variant: SessionVariant;
  readonly mode: ContinuityMode;
}

/** Composes a FRESH recording runtime bound to one session (adapters seam). */
export type TowerRuntimeComposer = (binding: TowerSessionBinding) => ComposedTowerSession;

/**
 * Replays recorded entries into a fresh composition (adapters seam,
 * APPROACH R2): applies records through the real stores/seams, NEVER through
 * the reasoning port or the execution substrate.
 */
export type TowerReplayer = (
  records: readonly ContinuityRecord[],
  binding: TowerSessionBinding,
) => Result<
  { readonly composed: ComposedTowerSession; readonly report: ReplayReport },
  ContinuityError
>;

/** A live (process-resident) session handle — the desktop-continuous shape. */
export interface LiveTowerSession {
  readonly sessionId: string;
  readonly scope: TenantScope;
  readonly variant: SessionVariant;
  readonly mode: ContinuityMode;
  readonly runtime: LocalControlTowerRuntime;
  readonly openedAt: number;
}

export interface OpenSessionInput {
  readonly sessionId: string;
  readonly operator: ActorReference;
  readonly variant: SessionVariant;
  readonly mode: ContinuityMode;
  readonly now: DomainTimestamp;
}

export interface ResumeSessionInput {
  readonly now: DomainTimestamp;
  readonly cause: string;
}

/**
 * Mount-friendly open-or-attach-or-resume (projection-only outcome — safe
 * over transport; the runtime handle is NOT carried).
 */
export interface EnsureSessionInput {
  readonly sessionId: string;
  readonly tenantName: string;
  readonly operator: ActorReference;
  readonly variant: SessionVariant;
  readonly mode: ContinuityMode;
  readonly now: DomainTimestamp;
  readonly cause: string;
}

export interface EnsuredSession {
  readonly sessionId: string;
  readonly scope: TenantScope;
  readonly disposition: "opened" | "attached" | "replayed";
  readonly report?: ReplayReport;
}

export interface OpenAttachmentInput {
  readonly sessionId: string;
  readonly attachmentId?: string;
  readonly name: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly now: DomainTimestamp;
}

export interface CloseAttachmentInput {
  readonly sessionId: string;
  readonly attachmentId: string;
  readonly now: DomainTimestamp;
}

/** A value that is either resolved (in-process) or arrives later (RPC). */
export type MaybePromise<T> = T | Promise<T>;

/**
 * The transport-target widening of the tower service (APPROACH R6): the
 * SAME 11-method surface with reads/results permitted to arrive as
 * promises. The canonical local tower satisfies it synchronously
 * (`ControlTowerService` is structurally assignable — proven in the hygiene
 * suite); an RPC client satisfies it asynchronously. This is the type a
 * platform variant's session composition hands its UI — the UI code is
 * therefore composition-independent (W010's "one composition swapped per
 * variant" ruling, made transport-ready).
 */
export interface TowerServiceAccess {
  readonly overview: (
    scope: TenantScope,
    input: TowerReadInput,
  ) => MaybePromise<Result<ControlTowerOverview, ControlTowerError>>;
  readonly conversation: (
    scope: TenantScope,
    topic: ConversationTopic,
  ) => MaybePromise<Result<ConversationViewModel, ControlTowerError>>;

  // --- cognition delegation (the service's own signatures, maybe-async) ---
  readonly createMission: (
    ...args: Parameters<ControlTowerService["createMission"]>
  ) => MaybePromise<Result<MissionRecord, MissionError>>;
  readonly advanceMission: (
    ...args: Parameters<ControlTowerService["advanceMission"]>
  ) => MaybePromise<Result<MissionRecord, MissionError>>;
  readonly runMissionToCompletion: (
    ...args: Parameters<ControlTowerService["runMissionToCompletion"]>
  ) => MaybePromise<Result<MissionRecord, MissionError>>;
  readonly cancelMission: (
    ...args: Parameters<ControlTowerService["cancelMission"]>
  ) => MaybePromise<Result<MissionRecord, MissionError>>;

  // --- plans delegation (the service's own signatures, maybe-async) ---
  readonly submitPlanForApproval: (
    ...args: Parameters<ControlTowerService["submitPlanForApproval"]>
  ) => MaybePromise<Result<ExecutionPlan, PlanError>>;
  readonly approvePlan: (
    ...args: Parameters<ControlTowerService["approvePlan"]>
  ) => MaybePromise<Result<ExecutionPlan, PlanError>>;
  readonly rejectPlan: (
    ...args: Parameters<ControlTowerService["rejectPlan"]>
  ) => MaybePromise<Result<ExecutionPlan, PlanError>>;
  readonly activatePlan: (
    ...args: Parameters<ControlTowerService["activatePlan"]>
  ) => MaybePromise<Result<ExecutionPlan, PlanError>>;
  readonly dispatchTask: (
    ...args: Parameters<ControlTowerService["dispatchTask"]>
  ) => MaybePromise<Result<TaskCompletionRecord, PlanError>>;
}

/** Dependencies of the continuity service factory. */
export interface ContinuityServiceDeps {
  readonly ledger: ContinuityLedger;
  readonly surface: TowerAttachmentSurface;
  readonly compose: TowerRuntimeComposer;
  readonly replay: TowerReplayer;
  /** Content digest override (defaults to sha-256 with an honest fallback). */
  readonly digestOf?: (bytes: Uint8Array) => AttachmentDigest | Promise<AttachmentDigest>;
}

/**
 * The public continuity service surface (9 methods; policy limit is 12).
 *
 * Recovery idempotency (catalog: "remote recovery does not duplicate runs"):
 * `resumeSession` on a LIVE session id returns that session UNCHANGED — no
 * replay, no re-execution; `attachSession` returns the SAME live runtime
 * (reference-equal) — the desktop continuity law.
 */
export interface ContinuityService {
  openSession(
    scope: TenantScope,
    input: OpenSessionInput,
  ): Result<LiveTowerSession, ContinuityError>;
  attachSession(sessionId: string): Result<LiveTowerSession, ContinuityError>;
  resumeSession(
    sessionId: string,
    input: ResumeSessionInput,
  ): Promise<Result<LiveTowerSession, ContinuityError>>;
  ensureSession(input: EnsureSessionInput): Promise<Result<EnsuredSession, ContinuityError>>;
  sessionInfo(sessionId: string): Result<SessionInfo, ContinuityError>;
  listSessions(): readonly SessionInfo[];
  openAttachment(
    scope: TenantScope,
    input: OpenAttachmentInput,
  ): Promise<Result<AttachmentView, ContinuityError>>;
  closeAttachment(
    scope: TenantScope,
    input: CloseAttachmentInput,
  ): Result<AttachmentView, ContinuityError>;
  listAttachments(
    scope: TenantScope,
    sessionId: string,
  ): Result<readonly AttachmentView[], ContinuityError>;
}
