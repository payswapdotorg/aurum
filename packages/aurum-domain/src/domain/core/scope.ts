/**
 * The explicit tenant scope type. Every record and every contract operation
 * carries a `TenantScope`. Tenant identity is independent from filesystem
 * path or runtime session, and cross-tenant access fails closed as a uniform
 * not-found (spec/ARCHITECTURE.md "Tenant isolation").
 */
import { ok, err, type Result } from "./result.js";
import { validationError } from "./errors.js";
import type { TenantId } from "./branding.js";

export interface TenantScope {
  readonly kind: "tenant-scope";
  readonly tenantId: TenantId;
}

/** Validates a tenant id string and produces the branded scope. */
export function tenantScope(tenantId: string): Result<TenantScope> {
  const trimmed = typeof tenantId === "string" ? tenantId.trim() : "";
  if (trimmed.length === 0 || trimmed.length > 128) {
    return err(
      validationError([
        { field: "tenantId", problem: "must be a non-empty string of at most 128 characters" },
      ]),
    );
  }
  if (/\p{Cc}/u.test(trimmed)) {
    return err(
      validationError([{ field: "tenantId", problem: "must not contain control characters" }]),
    );
  }
  return ok({ kind: "tenant-scope", tenantId: trimmed as TenantId });
}

/** Marker interface implemented by every tenant-scoped record. */
export interface TenantScopedRecord {
  readonly scope: TenantScope;
}
