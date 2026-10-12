/**
 * Plan record types (W009 domain layer): ExecutionPlan + the task DAG +
 * information handoff + escalation records. The plan is SEMANTIC TRUTH
 * (catalog: "plan remains Aurum truth while ZCode workflow is execution
 * substrate") — execution sessions (W006) are substrate projections that
 * REFERENCE plan tasks; plan records NEVER reference execution-session ids
 * (truth-law tripwire: `test/plans-truth-law.test.ts`).
 *
 * Plans reference W005 `OrganizationCandidate` / `ActorAssignment` /
 * `CapabilityAllocation` BY ID, never copies (catalog clause 1: "resource
 * allocations ... references — by id, never copies"). The plan is also
 * approved via the W002 action authority — approval is human-gated; the
 * action's `policy.approvalRoles` is checked by the action authority port
 * (NOT here — domain layer has no IO).
 *
 * Nothing here mutates domain state. Plans are the application layer's OWN
 * in-memory truth (P-series persistence is the TL-tracked P003+ debt).
 */
import type {
  ActorReference,
  DomainTimestamp,
  GoalId,
  OrganizationCandidateId,
  ProvenanceRecord,
  SubjectReference,
  TenantScopedRecord,
} from "@aurum/domain";
import type { PlanApprovalState, PlanLifecycleState, PlanTaskKind } from "./vocabulary.js";
import type { PlanEnvironmentClass, TaskAuthorityRequirement } from "./vocabulary.js";
import type { EscalationDecision, EscalationTrigger } from "./vocabulary.js";
import type { HandoffDeliveryOutcome } from "./vocabulary.js";

/**
 * A typed information handoff descriptor — what knowledge a task consumes
 * (input) or produces (output). Catalog clause 2: per-task information
 * requirements (typed handoff descriptors). Catalog clause 3: the relay
 * carries MINIMAL CONTEXT — only the declared information requirements of the
 * receiving task — never the whole plan or foreign-task state.
 *
 * The descriptor is the SCHEMA; the actual `HandoffPayload` (data) is
 * constructed at relay time from the producing task's settlement, gated by
 * this descriptor (see `relay.ts`).
 */
export interface HandoffDescriptor {
  readonly handoffId: string;
  /** What knowledge this handoff carries (free-form, caller-defined). */
  readonly knowledge: string;
  /** Opaque media-type label (e.g. "application/json"). */
  readonly mediaType: string;
  /**
   * Optional schema descriptor for the payload (free-form — never parsed by
   * the plan layer; the executor and the relay layer agree on encoding).
   * Useful for inspectability and for the minimal-context deep-equal proof.
   */
  readonly schemaRef?: string;
}

/**
 * One task of the plan's task DAG. Tasks are plain records: identity, kind,
 * dependencies (declared as a list of upstream task ids — the DAG is built
 * from these), per-task authorization requirements (declared; checked at
 * relay time against the W002 action authority port), and per-task
 * information requirements (typed handoff descriptors — what the task
 * consumes and what it produces).
 *
 * A task is READY (catalog clause 2: readiness computation) when:
 * - all its dependency tasks are settled (have a completion record with a
 *   successful settlement); AND
 * - all its declared input handoffs have been delivered (payloads available).
 *
 * Per-task authorization is DECLARED here and CHECKED at relay time
 * (catalog: "authorization-aware — declared, checked at relay time"). The
 * declared requirement is data; the proof comes from the executor at
 * handoff-issuance time.
 */
export interface PlanTask {
  readonly taskId: string;
  readonly kind: PlanTaskKind;
  readonly title: string;
  readonly description?: string;
  /** Upstream task ids — used to build the DAG. Cycle-rejected at construction. */
  readonly dependsOn: readonly string[];
  /** Authority the executor must cite (catalog: declared, checked at relay). */
  readonly authorityRequirement: TaskAuthorityRequirement;
  /** Information the task consumes (delivered handoffs from upstream tasks). */
  readonly consumes: readonly HandoffDescriptor[];
  /** Information the task produces (handoffs issued to downstream tasks). */
  readonly produces: readonly HandoffDescriptor[];
  /** Required execution environment class (W006 vocabulary, W009 re-declared). */
  readonly environmentClass?: PlanEnvironmentClass;
  /** Optional variant narrowing within the environment class. */
  readonly environmentVariant?: string;
  /** Optional opaque payload descriptor (executor + relay agree on encoding). */
  readonly payloadSchema?: string;
  /** Wall-clock completion deadline in epoch milliseconds, if bounded. */
  readonly deadlineEpochMs?: number;
  /**
   * Per-task W005 resource allocations — references BY ID, never copies.
   * Each entry names a W005 `OrganizationCandidate` (the candidate whose
   * assignments/allocations are being used) plus the assignment / allocation
   * ids within that candidate. The validators
   * (`actorAssignmentIssues` / `capabilityAllocationIssues`) are run at
   * plan-construction time (catalog clause 1: "validates DAG + allocations
   * against W005 validators").
   */
  readonly resourceAllocations: readonly TaskResourceAllocation[];
}

/**
 * Per-task W005 resource allocation reference (BY ID, never a copy).
 * Catalog clause 1: "resource allocations (W005 ActorAssignment /
 * CapabilityAllocation references — by id, never copies)".
 */
export interface TaskResourceAllocation {
  /** W005 `OrganizationCandidateRegistry` id of the candidate this allocation cites. */
  readonly candidateId: OrganizationCandidateId;
  /** W005 `ActorAssignment.assignmentId` ids within that candidate. */
  readonly actorAssignmentIds: readonly string[];
  /** W005 `CapabilityAllocation.allocationId` ids within that candidate. */
  readonly capabilityAllocationIds: readonly string[];
}

/**
 * The plan's task DAG (catalog clause 2). Built from the tasks' `dependsOn`
 * lists. Cycle-rejected at construction with a typed error and the offending
 * cycle path. Inspectable: topological order, critical path (longest
 * dependency chain), readiness computation.
 */
export interface TaskDag {
  readonly tasks: readonly PlanTask[];
  /** Adjacency: taskId -> the tasks that depend on it (downstream). */
  readonly downstream: ReadonlyMap<string, readonly string[]>;
  /** Adjacency: taskId -> the tasks it depends on (upstream). */
  readonly upstream: ReadonlyMap<string, readonly string[]>;
  /** Topological order (deterministic, stable on input order). */
  readonly topologicalOrder: readonly string[];
  /**
   * Critical path: the longest dependency chain in the DAG (by task count).
   * Multiple critical paths may exist; the constructor returns the
   * lexicographically smallest one for determinism.
   */
  readonly criticalPath: readonly string[];
}

/**
 * The plan's approval citation — the W002 action authority record (and the
 * audit ref) that authorized the plan's activation. Catalog clause 1:
 * "approvals are human-gated per the W005/W002 authority laws". The proof
 * is recorded at approve time; the executor cites it at relay time.
 */
export interface PlanApprovalCitation {
  /** Domain ActionRecord id in state `approved` or `authorized`. */
  readonly actionId?: string;
  /** Domain AuditRecord id recording the human approval decision. */
  readonly auditRef?: string;
  /** The human who approved (kind: "person"; personId required). */
  readonly approvedBy: ActorReference;
  /** When the approval was recorded (epoch ms). */
  readonly approvedAt: DomainTimestamp;
  /** Free-form reason for the approval (audit-attached). */
  readonly reason: string;
}

/** One immutable approval transition entry (append-only history). */
export interface PlanApprovalTransition {
  readonly from: PlanApprovalState | undefined;
  readonly to: PlanApprovalState;
  readonly at: DomainTimestamp;
  readonly actor: ActorReference;
  readonly reason: string;
  /** Present when the transition is the approval citation. */
  readonly citation?: PlanApprovalCitation;
}

/** One immutable lifecycle transition entry (active/completed/cancelled). */
export interface PlanLifecycleTransition {
  readonly from: PlanLifecycleState | undefined;
  readonly to: PlanLifecycleState;
  readonly at: DomainTimestamp;
  readonly actor: ActorReference;
  readonly reason: string;
  /** Audit ref recording the transition (always required for lifecycle moves). */
  readonly auditRef: string;
}

/**
 * The ExecutionPlan (W009). Tenant-scoped, versioned, immutable-once-approved.
 *
 * PLAN-IS-TRUTH LAW: a plan record NEVER contains execution-session ids
 * (`ExecutionRequestId`, `submissionTicket`, `ExecutionSession`, etc.). The
 * substrate adapter references the plan; the plan does not reference the
 * substrate. Source-scan tripwire: `test/plans-truth-law.test.ts`.
 *
 * The plan's `approval.state` machine is draft → submitted → approved /
 * rejected; approval is human-gated (citation required for the approved
 * transition). The plan's `lifecycleState` is active / completed / cancelled;
 * lifecycle transitions are audit-cited (an audit ref is required).
 */
export interface ExecutionPlan extends TenantScopedRecord {
  readonly planId: string;
  /** W002 goal this plan serves, if any. */
  readonly goalId?: GoalId;
  /** W005 `OrganizationCandidate` the plan instantiates (the resource pool). */
  readonly candidateId: OrganizationCandidateId;
  /** Plan version — bumped on every revision; immutable once approved. */
  readonly version: number;
  readonly taskDag: TaskDag;
  readonly approval: {
    readonly state: PlanApprovalState;
    readonly history: readonly PlanApprovalTransition[];
    /** Present iff `state === "approved"`. */
    readonly citation?: PlanApprovalCitation;
    /** Present iff `state === "rejected"`. */
    readonly rejection?: {
      readonly reason: string;
      readonly rejectedBy: ActorReference;
      readonly rejectedAt: DomainTimestamp;
    };
  };
  readonly lifecycleState: PlanLifecycleState;
  readonly lifecycleHistory: readonly PlanLifecycleTransition[];
  readonly createdBy: ActorReference;
  readonly createdAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
  /** Evidence the plan cites (non-empty — plans are evidence-bearing). */
  readonly evidenceRefs: readonly SubjectReference[];
}

/**
 * A delivered handoff payload (catalog clause 3: the relay). Carries
 * MINIMAL CONTEXT — only the declared information requirements of the
 * receiving task; never the whole plan or foreign-task state. The relay
 * constructs the payload from the producing task's settlement, gated by the
 * consuming task's `consumes` descriptor.
 *
 * CORRELATION: (planId, taskId, handoffId) — the consuming task's id and the
 * handoff descriptor's id. CAUSATION: the producing task's settlement
 * reference (the W006 settlement envelope's `requestId` + `settledAt` —
 * opaque to the plan layer; the substrate adapter fills it in).
 *
 * The payload is the actual opaque bytes the producing task emitted. The
 * minimal-context proof (`test/plans-relay.test.ts`) deep-equals the payload
 * against the consuming task's `consumes` descriptor — a foreign-task payload
 * cannot be constructed.
 */
export interface HandoffPayload {
  /** Correlation: which plan this handoff belongs to. */
  readonly planId: string;
  /** Correlation: which task is consuming this handoff (the receiver). */
  readonly taskId: string;
  /** Correlation: which handoff descriptor (within the consuming task). */
  readonly handoffId: string;
  /**
   * Causation: the producing task's id (who emitted this payload). Always a
   * task in the same plan (no foreign-task state).
   */
  readonly producingTaskId: string;
  /**
   * Causation: the producing task's settlement reference (opaque to the plan
   * layer; filled in by the substrate adapter from the W006 envelope).
   * Catalog: "causation identity (the producing task's settlement reference)".
   * Truth law: this is NOT an execution-session id stored ON the plan; it is
   * a CORRELATION identity carried ON the handoff (handoffs live in the relay,
   * not on the plan record).
   */
  readonly producingSettlementRef: {
    readonly requestId: string;
    readonly settledAt: number;
  };
  /** The opaque payload bytes (executor + relay agree on encoding). */
  readonly payload: string;
  /** The payload's media type (mirrors the descriptor). */
  readonly mediaType: string;
  /** When the relay delivered this payload (epoch ms, caller-supplied). */
  readonly deliveredAt: number;
}

/** The outcome of a handoff delivery (catalog clause 3: idempotent delivery). */
export interface HandoffDeliveryResult {
  readonly outcome: HandoffDeliveryOutcome;
  /** The handoff that was delivered (or re-delivered). */
  readonly payload: HandoffPayload;
}

/**
 * A task completion record (catalog clause 3: "every task completion cites
 * the settling execution envelope"). A task is COMPLETE when its execution
 * session settled (settled / cancelled / failed) and the plan service
 * recorded the completion. The settlement reference is opaque to the plan
 * layer (filled in by the substrate adapter from the W006 envelope); the
 * plan-is-truth law still holds — the reference is a CORRELATION identity
 * on the completion record, not an execution-session id stored ON the plan
 * record (completions live in the relay/completions store, not on the plan).
 */
export interface TaskCompletionRecord {
  readonly planId: string;
  readonly taskId: string;
  /** Terminal status of the task's execution session. */
  readonly status: "settled" | "cancelled" | "failed";
  /** Causation: the settlement envelope reference (opaque; substrate-filled). */
  readonly settlementRef: {
    readonly requestId: string;
    readonly settledAt: number;
  };
  /** Failure detail, present iff `status === "failed"`. */
  readonly failure?: {
    readonly kind: string;
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
  /** When the completion was recorded (epoch ms). */
  readonly completedAt: number;
}

/**
 * An escalation record (catalog clause 4). Escalation rules are DATA: when
 * a task's execution settles failed, OR its deadline passes, OR a dependency
 * settles failed, an escalation record is produced. The escalation PROPOSES
 * (who is asked, what decision is requested); the AUTHORITY SEAMS DISPOSE.
 *
 * Escalation records NEVER mutate plans directly (tripwire:
 * `test/plans-escalation.test.ts`). They live in their own append-only
 * store; the authority port reads them and resolves them through the W002
 * action authority (separate records).
 */
export interface EscalationRecord {
  readonly escalationId: string;
  readonly planId: string;
  readonly taskId: string;
  readonly trigger: EscalationTrigger;
  /** The decision the escalation is requesting (retry/replace/cancel-branch/cancel-plan). */
  readonly requestedDecision: EscalationDecision;
  /** Who the escalation is addressed to (the human/role/system that can dispose). */
  readonly addressedTo: ActorReference;
  /** Why the escalation was raised (free-form, audit-attached). */
  readonly reason: string;
  /** The settlement ref of the failed task (present iff `trigger === "task-failed"`). */
  readonly failureSettlementRef?: { readonly requestId: string; readonly settledAt: number };
  /** The dependency task id that failed (present iff `trigger === "dependency-failed"`). */
  readonly failedDependencyTaskId?: string;
  readonly raisedAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
}
