/**
 * Goal ledger port. Revisions are append-only; getting a goal returns the full
 * history. All operations tenant-scoped.
 */
import type { Result } from "../core/result.js";
import type { TenantScope } from "../core/scope.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { AuditInput } from "../audit/records.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type {
  ExpectedEvidence,
  GoalPriority,
  GoalRecord,
  GoalRevision,
  SuccessCriterion,
} from "./records.js";

/** Fields of a goal revision supplied by the caller. */
export interface GoalRevisionContent {
  readonly objective: string;
  readonly desiredState: string;
  readonly metrics?: readonly GoalMetricInput[];
  readonly horizonStart: DomainTimestamp;
  readonly horizonEnd: DomainTimestamp;
  readonly ownerId: string;
  readonly ownerLabels?: readonly string[];
  readonly priority: string;
  readonly expectedEvidence?: readonly ExpectedEvidence[];
  readonly successCriteria?: readonly SuccessCriterion[];
}

export interface GoalMetricInput {
  readonly name: string;
  readonly unit?: string;
  readonly target: number;
  readonly threshold: number;
  readonly direction: string;
}

export interface CreateGoalInput extends GoalRevisionContent {
  readonly goalId: string;
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

export interface ReviseGoalInput extends GoalRevisionContent {
  readonly goalId: string;
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

export interface GoalFilter {
  readonly priority?: GoalPriority;
}

/** Goal administration surface. */
export interface GoalLedger {
  createGoal(scope: TenantScope, input: CreateGoalInput): Result<GoalRecord>;
  /** Appends the next revision; previous revisions are never modified. */
  reviseGoal(scope: TenantScope, input: ReviseGoalInput): Result<GoalRecord>;
  getGoal(scope: TenantScope, goalId: string): Result<GoalRecord>;
  getGoalRevision(scope: TenantScope, goalId: string, revisionNumber: number): Result<GoalRevision>;
  listGoals(scope: TenantScope, filter?: GoalFilter): readonly GoalRecord[];
}
