/**
 * In-memory catalog store (W011 adapter): the marketplace's own truth for
 * packages + version records, tenant-scoped with closed-failure semantics
 * (a foreign-tenant record and a never-existing id are indistinguishable
 * `marketplace-not-found` errors). Persistence is the TL-tracked P-series
 * debt (README.md).
 */
import { err, ok, type Result } from "../domain/primitives.js";
import type { MarketplaceTenantScope } from "../domain/primitives.js";
import { marketplaceNotFound } from "../domain/errors.js";
import type { MarketplaceError } from "../domain/errors.js";
import type { MarketplaceCatalogStore } from "../domain/ports.js";
import type { MarketplacePackage, PackageVersionRecord } from "../domain/records.js";

export class InMemoryMarketplaceCatalogStore implements MarketplaceCatalogStore {
  private readonly packagesByTenant = new Map<string, Map<string, MarketplacePackage>>();
  private readonly versionsByTenant = new Map<string, Map<string, PackageVersionRecord>>();

  private packageMap(scope: MarketplaceTenantScope): Map<string, MarketplacePackage> {
    let map = this.packagesByTenant.get(scope.tenantId);
    if (!map) {
      map = new Map();
      this.packagesByTenant.set(scope.tenantId, map);
    }
    return map;
  }

  private versionMap(scope: MarketplaceTenantScope): Map<string, PackageVersionRecord> {
    let map = this.versionsByTenant.get(scope.tenantId);
    if (!map) {
      map = new Map();
      this.versionsByTenant.set(scope.tenantId, map);
    }
    return map;
  }

  putPackage(record: MarketplacePackage): Result<MarketplacePackage, MarketplaceError> {
    const map = this.packageMap(record.scope);
    map.set(record.packageId, record);
    return ok(record);
  }

  getPackage(
    scope: MarketplaceTenantScope,
    packageId: string,
  ): Result<MarketplacePackage, MarketplaceError> {
    const record = this.packageMap(scope).get(packageId);
    if (!record) return err(marketplaceNotFound("package"));
    return ok(record);
  }

  listPackages(scope: MarketplaceTenantScope): readonly MarketplacePackage[] {
    return [...this.packageMap(scope).values()].sort((a, b) =>
      a.packageId.localeCompare(b.packageId),
    );
  }

  putVersion(record: PackageVersionRecord): Result<PackageVersionRecord, MarketplaceError> {
    const map = this.versionMap(record.scope);
    const key = `${record.packageId}@${record.version}`;
    const existing = map.get(key);
    if (existing && existing === record) return ok(record);
    map.set(key, record);
    return ok(record);
  }

  getVersion(
    scope: MarketplaceTenantScope,
    packageId: string,
    version: number,
  ): Result<PackageVersionRecord, MarketplaceError> {
    const record = this.versionMap(scope).get(`${packageId}@${version}`);
    if (!record) return err(marketplaceNotFound("package version"));
    return ok(record);
  }

  listVersions(scope: MarketplaceTenantScope): readonly PackageVersionRecord[] {
    return [...this.versionMap(scope).values()].sort(
      (a, b) => a.packageId.localeCompare(b.packageId) || a.version - b.version,
    );
  }
}

export function createInMemoryMarketplaceCatalogStore(): InMemoryMarketplaceCatalogStore {
  return new InMemoryMarketplaceCatalogStore();
}
