/**
 * In-memory governance store (W011 adapter): the marketplace's own truth
 * for installation / activation / execution-request / recruitment records,
 * tenant-scoped with closed-failure semantics (foreign-tenant ≡ missing).
 * Persistence is the TL-tracked P-series debt (README.md).
 */
import { err, ok, type Result } from "../domain/primitives.js";
import type { MarketplaceTenantScope } from "../domain/primitives.js";
import { marketplaceNotFound } from "../domain/errors.js";
import type { MarketplaceError } from "../domain/errors.js";
import type { MarketplaceGovernanceStore } from "../domain/ports.js";
import type { PackageInstallation } from "../domain/installation.js";
import type { PackageActivation } from "../domain/activation.js";
import type { ExecutionApprovalRequest } from "../domain/executionApproval.js";
import type { RecruitmentRequest } from "../domain/recruitment.js";

export class InMemoryMarketplaceGovernanceStore implements MarketplaceGovernanceStore {
  private readonly installations = new Map<string, PackageInstallation>();
  private readonly activations = new Map<string, PackageActivation>();
  private readonly executionRequests = new Map<string, ExecutionApprovalRequest>();
  private readonly recruitments = new Map<string, RecruitmentRequest>();

  private static key(scope: MarketplaceTenantScope, id: string): string {
    return `${scope.tenantId}::${id}`;
  }

  putInstallation(record: PackageInstallation): Result<PackageInstallation, MarketplaceError> {
    this.installations.set(
      InMemoryMarketplaceGovernanceStore.key(record.scope, record.installationId),
      record,
    );
    return ok(record);
  }

  getInstallation(
    scope: MarketplaceTenantScope,
    installationId: string,
  ): Result<PackageInstallation, MarketplaceError> {
    const record = this.installations.get(
      InMemoryMarketplaceGovernanceStore.key(scope, installationId),
    );
    if (!record) return err(marketplaceNotFound("installation"));
    return ok(record);
  }

  listInstallations(scope: MarketplaceTenantScope): readonly PackageInstallation[] {
    return [...this.installations.values()]
      .filter((record) => record.scope.tenantId === scope.tenantId)
      .sort((a, b) => a.installationId.localeCompare(b.installationId));
  }

  putActivation(record: PackageActivation): Result<PackageActivation, MarketplaceError> {
    this.activations.set(
      InMemoryMarketplaceGovernanceStore.key(record.scope, record.activationId),
      record,
    );
    return ok(record);
  }

  getActivation(
    scope: MarketplaceTenantScope,
    activationId: string,
  ): Result<PackageActivation, MarketplaceError> {
    const record = this.activations.get(
      InMemoryMarketplaceGovernanceStore.key(scope, activationId),
    );
    if (!record) return err(marketplaceNotFound("activation"));
    return ok(record);
  }

  listActivations(scope: MarketplaceTenantScope): readonly PackageActivation[] {
    return [...this.activations.values()]
      .filter((record) => record.scope.tenantId === scope.tenantId)
      .sort((a, b) => a.activationId.localeCompare(b.activationId));
  }

  putExecutionRequest(
    record: ExecutionApprovalRequest,
  ): Result<ExecutionApprovalRequest, MarketplaceError> {
    this.executionRequests.set(
      InMemoryMarketplaceGovernanceStore.key(record.scope, record.requestId),
      record,
    );
    return ok(record);
  }

  getExecutionRequest(
    scope: MarketplaceTenantScope,
    requestId: string,
  ): Result<ExecutionApprovalRequest, MarketplaceError> {
    const record = this.executionRequests.get(
      InMemoryMarketplaceGovernanceStore.key(scope, requestId),
    );
    if (!record) return err(marketplaceNotFound("execution request"));
    return ok(record);
  }

  listExecutionRequests(scope: MarketplaceTenantScope): readonly ExecutionApprovalRequest[] {
    return [...this.executionRequests.values()]
      .filter((record) => record.scope.tenantId === scope.tenantId)
      .sort((a, b) => a.requestId.localeCompare(b.requestId));
  }

  putRecruitment(record: RecruitmentRequest): Result<RecruitmentRequest, MarketplaceError> {
    this.recruitments.set(
      InMemoryMarketplaceGovernanceStore.key(record.scope, record.requestId),
      record,
    );
    return ok(record);
  }

  getRecruitment(
    scope: MarketplaceTenantScope,
    requestId: string,
  ): Result<RecruitmentRequest, MarketplaceError> {
    const record = this.recruitments.get(InMemoryMarketplaceGovernanceStore.key(scope, requestId));
    if (!record) return err(marketplaceNotFound("recruitment request"));
    return ok(record);
  }

  listRecruitments(scope: MarketplaceTenantScope): readonly RecruitmentRequest[] {
    return [...this.recruitments.values()]
      .filter((record) => record.scope.tenantId === scope.tenantId)
      .sort((a, b) => a.requestId.localeCompare(b.requestId));
  }
}

export function createInMemoryMarketplaceGovernanceStore(): InMemoryMarketplaceGovernanceStore {
  return new InMemoryMarketplaceGovernanceStore();
}
