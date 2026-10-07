/**
 * action area public surface.
 */
export {
  ACTION_STATES,
  actionTransitionLegal,
  isKnownActionState,
  isTerminalActionState,
} from "./records.js";
export type {
  ActionPolicyDescriptor,
  ActionRecord,
  ActionState,
  ActionStateTransition,
} from "./records.js";
export { createActionAuthority } from "./actionStore.js";
export type {
  ActionAuthority,
  ActionFilter,
  ActionTransitionInput,
  ProposeActionInput,
  RoleResolver,
} from "./ports.js";
