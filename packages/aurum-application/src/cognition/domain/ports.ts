/**
 * Cognition ports (W007 domain layer): the narrow seams the intelligence
 * loop consumes from the composed domain kernel, plus the loop's own ports.
 *
 * Following the W004/W008/W009 patterns, the seams are STRUCTURAL PICKS of
 * the kernel interfaces so the composed kernel satisfies them directly,
 * while tests can supply minimal deterministic doubles. Errors crossing
 * these seams are kernel `DomainError`s; the service translates them into
 * the cognition `MissionError` namespace (never a second authority).
 *
 * THE AUTHORITY LAW (catalog W007 clause 3): the action seam is picked as
 * `proposeAction | recommendAction | getAction` ONLY. approve / authorize /
 * recordExecution / reject are structurally absent — cognition proposes and
 * (as analysis) recommends; humans approve and authorize
 * (spec/REBUILD-CONSTITUTION.md). Source-scan tripwire:
 * test/cognition-contract-hygiene.test.ts.
 *
 * THE BOUNDED-MODEL LAW (catalog W007 clause 2): `ReasoningPort` is the only
 * model touchpoint. Its request/response types are port-local (provider SDK
 * types never enter); the response is validated against the bounded schema
 * before it is accepted.
 */
import type {
  ActionAuthority,
  ActionRecord,
  ActorReference,
  DomainTimestamp,
  EpistemicsLedger,
  EvidenceLedger,
  GoalLedger,
  InquiryLedger,
  OrganizationalMemory,
  Result,
  SubjectReference,
  TenantScope,
  ValidationIssue,
} from "@aurum/domain";
import type { MissionError } from "./errors.js";
import type { MissionRecord } from "./records.js";
import type { MissionStatus } from "./vocabulary.js";
import type { ReasonedContent, ReasoningRequest } from "./bounded.js";

/** Read seams the orient stage consumes (tenant-scoped queries only). */
export interface CognitionReadSeams {
  readonly goals: Pick<GoalLedger, "getGoal">;
  readonly evidence: Pick<EvidenceLedger, "getObservation" | "listObservations">;
  readonly epistemics: Pick<EpistemicsLedger, "listBeliefs">;
  readonly inquiry: Pick<InquiryLedger, "listOpenUnknowns" | "listOpenContradictions">;
  readonly memory: Pick<OrganizationalMemory, "listMemory">;
}

/**
 * Knowledge seams the propose/record stages write through. Every write is a
 * CREATE with a deterministic id (claim / unknown / first-revision belief /
 * first-version memory) — the idempotency contract that makes stage replay
 * side-effect-free on duplicates. The reads back the already-applied checks.
 */
export interface CognitionKnowledgeSeams {
  readonly epistemics: Pick<
    EpistemicsLedger,
    "registerClaim" | "getClaim" | "reviseBelief" | "getBelief"
  >;
  readonly inquiry: Pick<InquiryLedger, "raiseUnknown" | "getUnknown">;
  readonly memory: Pick<OrganizationalMemory, "recordMemory" | "getMemory">;
}

/**
 * The authority gate (catalog W007 clause 3). Every consequential action a
 * mission produces enters the domain action authority here and STOPS at
 * `recommended`. Structurally compatible with the kernel's `ActionAuthority`
 * (a structural pick), so the composed kernel satisfies it directly.
 */
export interface MissionAuthorityGate extends Pick<
  ActionAuthority,
  "proposeAction" | "recommendAction" | "getAction"
> {}

/**
 * The bounded reasoning port (catalog W007 clause 2). Adapters live in the
 * adapters layer (a deterministic scripted double today; provider-plane
 * adapters later). `name` identifies the adapter on the reason stage record
 * so the evidence chain shows WHICH model produced the content.
 */
export interface ReasoningPort {
  readonly name: string;
  requestReasoning(request: ReasoningRequest): Promise<Result<ReasonedContent, MissionError>>;
}

/**
 * The mission store — the application's OWN in-memory truth for missions
 * (P-series debt for PostgreSQL storage). Tenant-scoped; cross-tenant reads
 * fail closed as a uniform not-found (no existence leaks).
 */
export interface MissionStore {
  putMission(mission: MissionRecord): Result<MissionRecord, MissionError>;
  getMission(scope: TenantScope, missionId: string): Result<MissionRecord, MissionError>;
  listMissions(scope: TenantScope, filter?: MissionFilter): readonly MissionRecord[];
}

export interface MissionFilter {
  readonly status?: MissionStatus;
}

/** Policy applied to every action the mission proposes through the gate. */
export interface MissionProposalPolicy {
  readonly approvalRoles: readonly string[];
  readonly authorizationRoles: readonly string[];
}

/** Dependencies of the cognition service factory. */
export interface CognitionServiceDeps {
  readonly reads: CognitionReadSeams;
  readonly knowledge: CognitionKnowledgeSeams;
  readonly gate: MissionAuthorityGate;
  readonly model: ReasoningPort;
  readonly missions: MissionStore;
  readonly proposalPolicy: MissionProposalPolicy;
}

/** Timestamped read helper shared by the app layer (deterministic `now`). */
export type Now = DomainTimestamp;

/** Re-exports for adapter implementations (single import point). */
export type { ActionRecord, ActorReference, SubjectReference, TenantScope, ValidationIssue };
