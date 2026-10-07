/**
 * Tenant-scoped in-memory index used by every store. Centralizing the lookup
 * here makes tenant isolation uniform by construction: a record is only ever
 * visible through the scope that created it, so a foreign-tenant reference and
 * a never-existing id produce the same miss (no existence leaks).
 *
 * The index is pure in-memory state — the persistence authority for semantic
 * truth remains PostgreSQL; this kernel owns semantics, not storage.
 */
import type { TenantScope } from "./scope.js";
import { deepFreeze } from "./freeze.js";

export class TenantIndex<R> {
  private readonly byTenant = new Map<string, Map<string, R>>();

  /** Stores a frozen record under the given scope and id. */
  put(scope: TenantScope, id: string, record: R): R {
    const frozen = deepFreeze(record);
    this.tenantBucket(scope).set(id, frozen);
    return frozen;
  }

  /** Tenant-scoped lookup. Returns undefined for foreign and missing ids alike. */
  get(scope: TenantScope, id: string): R | undefined {
    return this.tenantBucket(scope).get(id);
  }

  has(scope: TenantScope, id: string): boolean {
    return this.tenantBucket(scope).has(id);
  }

  /** All records of one tenant, insertion-ordered, as a frozen array. */
  list(scope: TenantScope): readonly R[] {
    return Object.freeze([...this.tenantBucket(scope).values()]);
  }

  private tenantBucket(scope: TenantScope): Map<string, R> {
    let bucket = this.byTenant.get(scope.tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(scope.tenantId, bucket);
    }
    return bucket;
  }
}
