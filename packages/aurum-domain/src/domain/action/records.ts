/**
 * Action authority vocabulary: proposed / recommended / approved /
 * authorized / executed (+ rejected) with policy descriptors. The Lab may
 * propose and recommend but never approve, authorize or execute
 * (spec/REBUILD-CONSTITUTION.md); employment-impacting actions require an
 * explicit recorded human decision.
 */
import type { ActionId, DomainTimestamp } from "../core/branding.js";
import type { TenantScopedRecord } from "../core/scope.js";
import type { ActorReference, SubjectReference } from "../core/refs.js";
import type { RoleName } from "../identity/records.js";

export const ACTION_STATES = [
  "proposed",
  "recommended",
  "approved",
  "authorized",
  "executed",
  "rejected",
] as const;

export type ActionState = (typeof ACTION_STATES)[number];

export function isKnownActionState(value: string): value is ActionState {
  return (ACTION_STATES as readonly string[]).includes(value);
}

/**
 * Policy descriptor attached to every action: which roles may approve,
 * which may authorize, and whether the action impacts employment (which
 * demands a recorded human decision on approval).
 */
export interface ActionPolicyDescriptor {
  readonly approvalRoles: readonly RoleName[];
  readonly authorizationRoles: readonly RoleName[];
  readonly employmentImpacting: boolean;
}

/** One immutable state transition entry (append-only lifecycle). */
export interface ActionStateTransition {
  readonly from: ActionState | undefined;
  readonly to: ActionState;
  readonly at: DomainTimestamp;
  readonly actor: ActorReference;
  readonly reason: string;
}

/** The authority lifecycle record. */
export interface ActionRecord extends TenantScopedRecord {
  readonly actionId: ActionId;
  readonly title: string;
  readonly description?: string;
  readonly subject: SubjectReference;
  readonly policy: ActionPolicyDescriptor;
  readonly state: ActionState;
  readonly stateHistory: readonly ActionStateTransition[];
  readonly createdBy: ActorReference;
  readonly createdAt: DomainTimestamp;
  readonly expectedEvidence?: string;
}

/**
 * Pure legality of the authority state graph. Stages must be walked in
 * order; executed and rejected are terminal.
 */
export function actionTransitionLegal(from: ActionState, to: ActionState): boolean {
  if (to === from) return false;
  switch (from) {
    case "proposed":
      return to === "recommended" || to === "rejected";
    case "recommended":
      return to === "approved" || to === "rejected";
    case "approved":
      return to === "authorized" || to === "rejected";
    case "authorized":
      return to === "executed" || to === "rejected";
    case "executed":
    case "rejected":
      return false;
  }
}

/** States from which an action may still be rejected. */
export function isTerminalActionState(state: ActionState): boolean {
  return state === "executed" || state === "rejected";
}
