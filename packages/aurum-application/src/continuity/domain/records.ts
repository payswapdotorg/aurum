/**
 * Continuity records (W012 domain layer): the append-only session journal a
 * platform variant writes while its composition runs, and the replay source
 * a reconstructing variant (web/mobile/CLI) folds into a FRESH composition.
 *
 * THE RECORD LAW (APPROACH R1): these records journal WHAT THE SESSION'S
 * REAL COMPOSITION DID — they are the replay source, never a second decision
 * authority. Every record below is a copy-on-write of a record that already
 * lives in an owning store (mission/plan/relay/completion/escalation/
 * evaluation/query-log/audit), a kernel effect-write the cognition seams
 * already applied, or a runtime-plane lifecycle event (session, attachment).
 *
 * NO SECOND AGENT BODY (APPROACH R4): records carry actor REFERENCES and
 * substrate attachment REFERENCES only — never body state, model bindings,
 * or credentials. Tripwire: test/continuity-contract-hygiene.test.ts.
 */
import type {
  ActionTransitionInput,
  ActorReference,
  ProposeActionInput,
  RaiseUnknownInput,
  RecordMemoryInput,
  RegisterClaimInput,
  ReviseBeliefInput,
  TenantScope,
} from "@aurum/domain";
import type { MissionRecord } from "../../cognition/contract.cognition.js";
import type {
  EscalationRecord,
  ExecutionPlan,
  HandoffDeliveryResult,
  HandoffPayload,
  TaskCompletionRecord,
} from "../../plans/contract.plans.js";
import type { LabEvaluationRecord } from "../../lab/contract.lab.js";
import type { CompanyQueryLogRecord } from "../../company/contract.company.js";
import type { AuditRecord } from "@aurum/domain";

/** The platform variant that ran the session (one per mount). */
export type SessionVariant = "desktop" | "web" | "mobile" | "cli";

/**
 * The EXPLICIT continuity mode (APPROACH R3): `continuous` sessions keep a
 * live runtime that re-attaches (desktop); `replay` sessions reconstruct
 * state from these records (web/mobile/CLI). The mode is chosen at the mount
 * and recorded here — never inferred.
 */
export type ContinuityMode = "continuous" | "replay";

/** The composition identity that produced the session's runtime. */
export const CONTINUITY_COMPOSITION_ID = "local-control-tower-v1";

/** Content digest on attachment records (algorithm-labeled, honest). */
export interface AttachmentDigest {
  readonly algorithm: "sha256" | "fnv1a-64";
  readonly value: string;
}

/** A recorded kernel effect-write (re-applied verbatim on replay). */
export type KernelWriteEntry =
  | { readonly kind: "claim-registered"; readonly scope: TenantScope; readonly input: RegisterClaimInput }
  | { readonly kind: "belief-revised"; readonly scope: TenantScope; readonly input: ReviseBeliefInput }
  | { readonly kind: "unknown-raised"; readonly scope: TenantScope; readonly input: RaiseUnknownInput }
  | { readonly kind: "memory-recorded"; readonly scope: TenantScope; readonly input: RecordMemoryInput }
  | { readonly kind: "action-proposed"; readonly scope: TenantScope; readonly input: ProposeActionInput }
  | { readonly kind: "action-recommended"; readonly scope: TenantScope; readonly input: ActionTransitionInput };

/**
 * The journal entry payloads. `session-opened` must be the FIRST record of a
 * session; every other kind may follow in any order the composition
 * produced them in (the fold is order-preserving, not order-constrained).
 */
export type ContinuityEntry =
  | {
      readonly kind: "session-opened";
      readonly tenantId: string;
      readonly operator: ActorReference;
      readonly variant: SessionVariant;
      readonly mode: ContinuityMode;
      readonly composition: string;
      readonly openedAt: number;
    }
  | { readonly kind: "session-resumed"; readonly resumedAt: number; readonly cause: string; readonly recordsReplayed: number }
  | { readonly kind: "mission-recorded"; readonly mission: MissionRecord }
  | { readonly kind: "plan-recorded"; readonly plan: ExecutionPlan }
  | { readonly kind: "handoff-delivered"; readonly payload: HandoffPayload; readonly result: HandoffDeliveryResult }
  | { readonly kind: "completion-recorded"; readonly completion: TaskCompletionRecord }
  | { readonly kind: "escalation-appended"; readonly escalation: EscalationRecord }
  | { readonly kind: "evaluation-recorded"; readonly evaluation: LabEvaluationRecord }
  | { readonly kind: "query-logged"; readonly entry: CompanyQueryLogRecord }
  | { readonly kind: "plan-audit-appended"; readonly record: AuditRecord }
  | KernelWriteEntry
  | {
      readonly kind: "attachment-opened";
      readonly attachmentId: string;
      readonly name: string;
      readonly contentType: string;
      readonly digest: AttachmentDigest;
      readonly surface: string;
      readonly materializedRef: string;
      readonly openedAt: number;
    }
  | { readonly kind: "attachment-closed"; readonly attachmentId: string; readonly closedAt: number };

/** A journaled entry, stamped by the ledger with identity + order. */
export interface ContinuityRecord {
  /** Deterministic: `<sessionId>/<seq>` (append-only, conflict-checked). */
  readonly recordId: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly entry: ContinuityEntry;
}

/** Lifecycle view of one session (derived, read-only). */
export interface SessionInfo {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly operator: ActorReference;
  readonly variant: SessionVariant;
  readonly mode: ContinuityMode;
  readonly composition: string;
  readonly openedAt: number;
  /** Whether a live runtime is registered in THIS process. */
  readonly live: boolean;
  readonly resumes: readonly { readonly resumedAt: number; readonly cause: string; readonly recordsReplayed: number }[];
  readonly recordCount: number;
  readonly attachmentCount: number;
}

/** Replay outcome view (what a resume reconstructed, never re-ran). */
export interface ReplayReport {
  readonly sessionId: string;
  readonly recordsApplied: number;
  readonly byKind: Readonly<Record<string, number>>;
}

/** An attachment's recorded lifecycle (runtime-plane projection). */
export interface AttachmentView {
  readonly attachmentId: string;
  readonly name: string;
  readonly contentType: string;
  readonly digest: AttachmentDigest;
  readonly surface: string;
  readonly materializedRef: string;
  readonly openedAt: number;
  readonly closedAt?: number;
}
