/**
 * Agent Body errors. Free-text messages pass through the credential
 * sanitizer re-used from @aurum/provider (public entrypoint import), so a
 * credential pasted into a role description or escalation note cannot leak
 * through an exception either. Cross-tenant lookups fail closed with a
 * uniform NOT_FOUND.
 */
import { sanitizeAndAssertClean } from "@aurum/provider";

export type AgentFabricErrorCode =
  | "BODY_NOT_FOUND"
  | "ROLE_ASSIGNMENT_NOT_FOUND"
  | "BODY_MODEL_BINDING_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "INVALID_STATE_TRANSITION"
  | "DUPLICATE";

const NOT_FOUND_CODES: ReadonlySet<AgentFabricErrorCode> = new Set([
  "BODY_NOT_FOUND",
  "ROLE_ASSIGNMENT_NOT_FOUND",
  "BODY_MODEL_BINDING_NOT_FOUND",
]);

export class AgentFabricError extends Error {
  readonly code: AgentFabricErrorCode;
  readonly notFound: boolean;

  constructor(code: AgentFabricErrorCode, message: string) {
    super(sanitizeAndAssertClean(message));
    this.name = "AgentFabricError";
    this.code = code;
    this.notFound = NOT_FOUND_CODES.has(code);
  }
}

export function notFound(code: AgentFabricErrorCode, what: string): AgentFabricError {
  return new AgentFabricError(code, `${what} not found`);
}

export function validationFailed(reason: string): AgentFabricError {
  return new AgentFabricError("VALIDATION_FAILED", reason);
}

export function invalidTransition(reason: string): AgentFabricError {
  return new AgentFabricError("INVALID_STATE_TRANSITION", reason);
}

export function duplicate(what: string): AgentFabricError {
  return new AgentFabricError("DUPLICATE", `${what} already exists`);
}
