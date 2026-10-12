/**
 * Marketplace ports (W011 domain layer): the narrow seams the marketplace
 * consumes from the composed domain kernel + the execution approval
 * authority, plus its OWN tenant-scoped truth stores.
 *
 * Following the W008 lab / W009 plans pattern, these are typed as
 * STRUCTURAL PICKS of the kernel interfaces so the composed kernel
 * satisfies them directly (post-CR-W011 wiring), while tests supply
 * minimal deterministic doubles from `adapters/`.
 *
 * BY-REFERENCE LAW: the workforce registration port carries
 * package/installation/activation REFERENCES only — the W005 seam owns the
 * registered records; the marketplace never copies package contents into
 * them (catalog: "by reference, never by copying records").
 */
import type { Result } from "./primitives.js";
import type {
  MarketplaceActorReference,
  MarketplaceProvenanceStamp,
  MarketplaceTenantScope,
  MarketplaceTimestamp,
} from "./primitives.js";
import type { AuthorityCitation } from "./executionApproval.js";
import type { MarketplaceError } from "./errors.js";
import type { PackageActivation } from "./activation.js";
import type { PackageInstallation } from "./installation.js";
import type { PackageVersionRecord, MarketplacePackage } from "./records.js";
import type { ExecutionApprovalRequest } from "./executionApproval.js";
import type { RecruitmentRequest } from "./recruitment.js";

/** The tenant-scoped catalog store (packages + version records). */
export interface MarketplaceCatalogStore {
  putPackage(record: MarketplacePackage): Result<MarketplacePackage, MarketplaceError>;
  getPackage(
    scope: MarketplaceTenantScope,
    packageId: string,
  ): Result<MarketplacePackage, MarketplaceError>;
  listPackages(scope: MarketplaceTenantScope): readonly MarketplacePackage[];
  putVersion(record: PackageVersionRecord): Result<PackageVersionRecord, MarketplaceError>;
  getVersion(
    scope: MarketplaceTenantScope,
    packageId: string,
    version: number,
  ): Result<PackageVersionRecord, MarketplaceError>;
  listVersions(scope: MarketplaceTenantScope): readonly PackageVersionRecord[];
}

/** The tenant-scoped governance store (machines 2+3+4 + recruitment). */
export interface MarketplaceGovernanceStore {
  putInstallation(record: PackageInstallation): Result<PackageInstallation, MarketplaceError>;
  getInstallation(
    scope: MarketplaceTenantScope,
    installationId: string,
  ): Result<PackageInstallation, MarketplaceError>;
  listInstallations(scope: MarketplaceTenantScope): readonly PackageInstallation[];
  putActivation(record: PackageActivation): Result<PackageActivation, MarketplaceError>;
  getActivation(
    scope: MarketplaceTenantScope,
    activationId: string,
  ): Result<PackageActivation, MarketplaceError>;
  listActivations(scope: MarketplaceTenantScope): readonly PackageActivation[];
  putExecutionRequest(
    record: ExecutionApprovalRequest,
  ): Result<ExecutionApprovalRequest, MarketplaceError>;
  getExecutionRequest(
    scope: MarketplaceTenantScope,
    requestId: string,
  ): Result<ExecutionApprovalRequest, MarketplaceError>;
  listExecutionRequests(scope: MarketplaceTenantScope): readonly ExecutionApprovalRequest[];
  putRecruitment(record: RecruitmentRequest): Result<RecruitmentRequest, MarketplaceError>;
  getRecruitment(
    scope: MarketplaceTenantScope,
    requestId: string,
  ): Result<RecruitmentRequest, MarketplaceError>;
  listRecruitments(scope: MarketplaceTenantScope): readonly RecruitmentRequest[];
}

/** One append-only audit entry (mirrors the kernel AuditRecord shape). */
export interface MarketplaceAuditRecord {
  readonly auditRef: string;
  readonly scope: MarketplaceTenantScope;
  readonly subject: { readonly kind: string; readonly id: string };
  readonly action: string;
  readonly actor: MarketplaceActorReference;
  readonly at: MarketplaceTimestamp;
  readonly reason: string;
  /** Machine-specific details (bounded JSON value; includes evidence refs). */
  readonly details?: unknown;
}

/** The audit append port — every governance transition records here. */
export interface MarketplaceAuditPort {
  append(
    scope: MarketplaceTenantScope,
    entry: {
      readonly subject: { readonly kind: string; readonly id: string };
      readonly action: string;
      readonly actor: MarketplaceActorReference;
      readonly at: MarketplaceTimestamp;
      readonly reason: string;
      readonly details?: unknown;
    },
  ): Result<{ readonly auditRef: string }, MarketplaceError>;
  /** Read-back for tests + consumers; not used for governance decisions. */
  listAudit(scope: MarketplaceTenantScope): readonly MarketplaceAuditRecord[];
}

/**
 * The W002 action-authority seam (structural pick, mirrors W009's
 * PlanApprovalAuthority.assertApprovalCitation). The marketplace NEVER
 * decides authority — it ASSERTS a citation the human/W002 seam already
 * recorded, closed-failure on missing/foreign/wrong-state citations.
 */
export interface MarketplaceAuthorityPort {
  assertAuthorityCitation(
    scope: MarketplaceTenantScope,
    citation: AuthorityCitation,
  ): Result<{ readonly actionId?: string; readonly auditRef?: string }, MarketplaceError>;
}

/**
 * The W005 workforce/candidate registration seam (structural against the
 * kernel's OrganizationCandidateRegistry.registerCandidate /
 * WorkforceDirectory.registerRole surfaces — the REAL adapter post-CR-W011
 * composes the kernel inputs; see
 * adapters/domain-kernel-registration-adapter.ts). BY REFERENCE ONLY.
 */
export interface WorkforceRegistrationPort {
  registerRecruitedActor(
    scope: MarketplaceTenantScope,
    input: {
      readonly packageRef: string;
      readonly installationRef: string;
      readonly activationRef?: string;
      readonly actorKind: string;
      readonly displayName?: string;
      readonly capabilitySupplies: readonly {
        readonly capabilityId: string;
        readonly level: number;
        readonly capacityPerPeriod: number;
      }[];
      readonly requestRef: string;
      readonly proposedBy: MarketplaceActorReference;
      readonly provenance: MarketplaceProvenanceStamp;
      readonly now: MarketplaceTimestamp;
    },
  ): Result<{ readonly registrationRef: string }, MarketplaceError>;
  registerRecruitedRole(
    scope: MarketplaceTenantScope,
    input: {
      readonly packageRef: string;
      readonly installationRef: string;
      readonly title: string;
      readonly description?: string;
      readonly requiredCapabilities: readonly string[];
      readonly requestRef: string;
      readonly proposedBy: MarketplaceActorReference;
      readonly provenance: MarketplaceProvenanceStamp;
      readonly now: MarketplaceTimestamp;
    },
  ): Result<{ readonly registrationRef: string }, MarketplaceError>;
  /** By-reference read-back view (for eligibility proofs + consumers). */
  listRegistrations(
    scope: MarketplaceTenantScope,
  ): readonly {
    readonly registrationRef: string;
    readonly packageRef: string;
    readonly installationRef: string;
    readonly requestRef: string;
  }[];
}

/** The marketplace service's composed dependencies. */
export interface MarketplaceServiceDeps {
  readonly catalog: MarketplaceCatalogStore;
  readonly governance: MarketplaceGovernanceStore;
  readonly audit: MarketplaceAuditPort;
  readonly authority: MarketplaceAuthorityPort;
  readonly registration: WorkforceRegistrationPort;
}
