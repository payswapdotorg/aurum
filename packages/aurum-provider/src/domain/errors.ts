/**
 * Provider Fabric error vocabulary.
 *
 * Every error message that can carry free text (notes, adapter errors) is
 * passed through the credential sanitizer before the error object is built,
 * so a credential embedded in an upstream failure never survives into an
 * exception message. Errors are data: they carry a machine-readable `code`
 * and a tenant scope; cross-tenant lookups surface as uniform NOT_FOUND so
 * foreign ids are indistinguishable from missing ones.
 */
import { sanitizeAndAssertClean } from "./sanitize.js";

export type ProviderFabricErrorCode =
  | "PROVIDER_NOT_FOUND"
  | "ACCOUNT_NOT_FOUND"
  | "PROTOCOL_NOT_FOUND"
  | "CATALOG_ENTRY_NOT_FOUND"
  | "BINDING_NOT_FOUND"
  | "EVIDENCE_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "INVALID_STATE_TRANSITION"
  | "DUPLICATE"
  | "DISCOVERY_FAILED"
  | "PROBE_FAILED";

const NOT_FOUND_CODES: ReadonlySet<ProviderFabricErrorCode> = new Set([
  "PROVIDER_NOT_FOUND",
  "ACCOUNT_NOT_FOUND",
  "PROTOCOL_NOT_FOUND",
  "CATALOG_ENTRY_NOT_FOUND",
  "BINDING_NOT_FOUND",
  "EVIDENCE_NOT_FOUND",
]);

export class ProviderFabricError extends Error {
  readonly code: ProviderFabricErrorCode;
  readonly notFound: boolean;

  constructor(code: ProviderFabricErrorCode, message: string) {
    super(sanitizeAndAssertClean(message));
    this.name = "ProviderFabricError";
    this.code = code;
    this.notFound = NOT_FOUND_CODES.has(code);
  }
}

export function notFound(code: ProviderFabricErrorCode, what: string): ProviderFabricError {
  return new ProviderFabricError(code, `${what} not found`);
}

export function duplicate(what: string): ProviderFabricError {
  return new ProviderFabricError("DUPLICATE", `${what} already exists`);
}

export function validationFailed(reason: string): ProviderFabricError {
  return new ProviderFabricError("VALIDATION_FAILED", reason);
}

export function invalidTransition(reason: string): ProviderFabricError {
  return new ProviderFabricError("INVALID_STATE_TRANSITION", reason);
}
