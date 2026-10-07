/**
 * Action authority port. Approval and authorization are human-only and
 * role-checked through the injected `RoleResolver` (wired by the kernel to the
 * tenant-scoped identity directory — roles never cross tenants).
 */
import type { Result } from "../core/result.js";
import type { TenantScope } from "../core/scope.js";
import type { DomainTimestamp, PersonId } from "../core/branding.js";
import type { ActorReference, SubjectReference } from "../core/refs.js";
import type { AuditInput } from "../audit/records.js";
import type { ActionRecord, ActionState } from "./records.js";
import type { RoleName } from "../identity/records.js";

/** Resolves the active roles of an actor in one tenant as of `at`. */
export type RoleResolver = (
  scope: TenantScope,
  actor: ActorReference,
  at: DomainTimestamp,
) => readonly RoleName[];

export interface ProposeActionInput {
  readonly actionId: string;
  readonly title: string;
  readonly description?: string;
  readonly subject: SubjectReference;
  readonly policy: {
    readonly approvalRoles: readonly string[];
    readonly authorizationRoles: readonly string[];
    readonly employmentImpacting: boolean;
  };
  readonly createdBy: ActorReference;
  readonly expectedEvidence?: string;
  readonly now: DomainTimestamp;
}

export interface ActionTransitionInput {
  readonly actionId: string;
  /** Optimistic concurrency: the state the caller believes the action is in. */
  readonly expectedState: ActionState;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
  /** Required for approving employment-impacting actions. */
  readonly humanDecision?: {
    readonly decidedBy: PersonId;
    readonly decidedAt: DomainTimestamp;
  };
  readonly outcome?: string;
}

export interface ActionFilter {
  readonly state?: ActionState;
}

/** Action authority surface. */
export interface ActionAuthority {
  proposeAction(scope: TenantScope, input: ProposeActionInput): Result<ActionRecord>;
  /** proposed -> recommended. Analysis (Lab/system) may recommend. */
  recommendAction(scope: TenantScope, input: ActionTransitionInput): Result<ActionRecord>;
  /** recommended -> approved. Human-only, requires a policy approval role. */
  approveAction(scope: TenantScope, input: ActionTransitionInput): Result<ActionRecord>;
  /** approved -> authorized. Human-only, requires a policy authorization role. */
  authorizeAction(scope: TenantScope, input: ActionTransitionInput): Result<ActionRecord>;
  /** authorized -> executed, with outcome evidence. */
  recordExecution(scope: TenantScope, input: ActionTransitionInput): Result<ActionRecord>;
  /** Any pre-execution state -> rejected (human decision). */
  rejectAction(scope: TenantScope, input: ActionTransitionInput): Result<ActionRecord>;
  getAction(scope: TenantScope, actionId: string): Result<ActionRecord>;
  listActions(scope: TenantScope, filter?: ActionFilter): readonly ActionRecord[];
}
