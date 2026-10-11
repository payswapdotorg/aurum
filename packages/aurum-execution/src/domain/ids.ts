/**
 * Execution-plane opaque identifiers (W006).
 *
 * Branded strings: structurally strings at runtime (wire friendly), nominally
 * distinct at compile time. This follows the W003 precedent (CR-W003 pattern:
 * each plane owns a local brand; a canonical cross-plane TenantId is a
 * deferred contract request owned by the domain owner). The constructor
 * validates exactly like the kernel's tenant rule so the application layer
 * can convert with `asExecutionTenantId(String(domainScope.tenantId))` — no
 * casts, no existence coupling.
 */
import { err, ok, type Result } from "./errors.js";
import { executionValidationError } from "./errors.js";
import type { ValidationIssue } from "./issues.js";

declare const executionBrand: unique symbol;

/** Execution-plane tenant identity (opaque string at runtime). */
export type ExecutionTenantId = string & { readonly [executionBrand]: "ExecutionTenantId" };

/** Caller-supplied execution request id (idempotency key, one per request). */
export type ExecutionRequestId = string & { readonly [executionBrand]: "ExecutionRequestId" };

/** Journal entry id (append-only execution event log). */
export type ExecutionJournalEntryId = string & {
  readonly [executionBrand]: "ExecutionJournalEntryId";
};

/** The tenant scope every execution record carries. */
export interface ExecutionScope {
  readonly kind: "execution-scope";
  readonly tenantId: ExecutionTenantId;
}

function brandRequestId(value: string): ExecutionRequestId {
  return value as ExecutionRequestId;
}

function brandJournalEntryId(value: string): ExecutionJournalEntryId {
  return value as ExecutionJournalEntryId;
}

/** Validates and brands a tenant id (mirrors the kernel tenant rules). */
export function asExecutionTenantId(value: string): Result<ExecutionTenantId> {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > 128) {
    return err(
      executionValidationError([
        { field: "tenantId", problem: "must be a non-empty string of at most 128 characters" },
      ]),
    );
  }
  if (/\p{Cc}/u.test(trimmed)) {
    return err(
      executionValidationError([
        { field: "tenantId", problem: "must not contain control characters" },
      ]),
    );
  }
  return ok(trimmed as ExecutionTenantId);
}

/** Builds the execution scope for one tenant. */
export function executionScope(tenantId: string): Result<ExecutionScope> {
  const branded = asExecutionTenantId(tenantId);
  if (!branded.ok) return branded;
  return ok({ kind: "execution-scope", tenantId: branded.value });
}

/** Validates and brands an execution request id. */
export function asExecutionRequestId(
  value: string,
): Result<ExecutionRequestId> {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > 200) {
    return err(
      executionValidationError([
        { field: "requestId", problem: "must be a non-empty string of at most 200 characters" },
      ]),
    );
  }
  if (/\p{Cc}/u.test(trimmed)) {
    return err(
      executionValidationError([
        { field: "requestId", problem: "must not contain control characters" },
      ]),
    );
  }
  return ok(brandRequestId(trimmed));
}

/** Validates and brands a journal entry id (used by the journal adapter). */
export function asExecutionJournalEntryId(value: string): ExecutionJournalEntryId {
  return brandJournalEntryId(value);
}

/** Shared request-id validation for composite inputs. */
export function requestIdIssues(value: unknown, field = "requestId"): ValidationIssue[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [{ field, problem: "must be a non-empty string" }];
  }
  return [];
}
