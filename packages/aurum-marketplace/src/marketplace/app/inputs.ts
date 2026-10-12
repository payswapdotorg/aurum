/**
 * Marketplace service input types + service interfaces (W011 app layer).
 *
 * The service is split into four separately-countable interfaces mirroring
 * the four governance machines + a read view, then composed into
 * `MarketplaceService` (the app factory's return type). There is
 * deliberately NO composite "deploy" method — publication, installation,
 * activation and execution citation are separate commands
 * (test/marketplace-tripwires.test.ts locks the structural separation).
 */
import type { Result } from "../domain/primitives.js";
import type {
  MarketplaceActorReference,
  MarketplaceProvenanceStamp,
  MarketplaceTenantScope,
  MarketplaceTimestamp,
} from "../domain/primitives.js";
import type { ActivationGrant, PackageActivation } from "../domain/activation.js";
import type { PackageInstallation } from "../domain/installation.js";
import type { AuthorityCitation, ExecutionApprovalRequest } from "../domain/executionApproval.js";
import type {
  MarketplacePackage,
  PackageVersionContents,
  PackageVersionRecord,
} from "../domain/records.js";
import type {
  RankedCandidatePackage,
  RecruitmentRequest,
  RecruitmentDemand,
} from "../domain/recruitment.js";
import type { MarketplaceAuditRecord } from "../domain/ports.js";
import type { MarketplaceError } from "../domain/errors.js";
import type { CatalogEntry } from "../domain/publication.js";

/** Input for drafting a package version (machine 1 entry). */
export interface DraftPackageInput {
  readonly packageId: string;
  readonly kind: string;
  readonly summary: string;
  readonly version: number;
  readonly contents: PackageVersionContents;
  readonly changelog: string;
  readonly evidenceRefs: readonly { evidenceKind: string; ref: string; summary?: string }[];
  readonly publisher: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
}

/** Input for a publication transition (submit / review). */
export interface PublicationTransitionInput {
  readonly packageId: string;
  readonly version: number;
  readonly actor: MarketplaceActorReference;
  readonly reason: string;
  readonly now: MarketplaceTimestamp;
  /** For reviewPublication: the human decision. */
  readonly decision?: "published" | "rejected";
}

/** Input for installing a published package version (machine 2). */
export interface InstallPackageInput {
  readonly installationId: string;
  readonly packageId: string;
  readonly version: number;
  readonly installedBy: MarketplaceActorReference;
  readonly configuration?: unknown;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
}

/** Input for revising an installation's configuration surface. */
export interface ReviseConfigurationInput {
  readonly installationId: string;
  readonly value: unknown;
  readonly revisedBy: MarketplaceActorReference;
  readonly revisedAt: MarketplaceTimestamp;
  readonly reason: string;
}

/** Input for activating an installed package (machine 3). */
export interface ActivatePackageInput {
  readonly activationId: string;
  readonly installationId: string;
  readonly actorRefs: readonly string[];
  readonly grants: readonly ActivationGrant[];
  readonly activatedBy: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
}

/** Input for an execution-approval request (machine 4). */
export interface ExecutionRequestInput {
  readonly requestId: string;
  readonly activationId: string;
  readonly consumerRef: string;
  readonly purpose: string;
  readonly requestedBy: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
}

/** Input for citing a W002 approval on an execution request. */
export interface CiteExecutionInput {
  readonly requestId: string;
  readonly citation: AuthorityCitation;
  readonly now: MarketplaceTimestamp;
}

/** Input for opening a recruitment request. */
export interface OpenRecruitmentInput {
  readonly requestId: string;
  readonly demand: readonly RecruitmentDemand[];
  readonly targetPackageKinds?: readonly string[];
  readonly requiredEvidenceKinds: readonly string[];
  readonly excludedPackageIds?: readonly string[];
  readonly requestedBy: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
}

/** Input for resolving a recruitment request (choose + land the package). */
export interface ResolveRecruitmentInput {
  readonly requestId: string;
  readonly chosenPackageId: string;
  readonly installationId: string;
  readonly activationId: string;
  /** The specific actors the recruited package is activated for. */
  readonly actorRefs: readonly string[];
  /** What the recruited package may touch (activation grant list). */
  readonly grants: readonly ActivationGrant[];
  /** The W002 authority citation — the DISPOSE side of propose/dispose. */
  readonly citation: AuthorityCitation;
  readonly resolvedBy: MarketplaceActorReference;
  readonly now: MarketplaceTimestamp;
}

/** Machine 1 + 2 + 3 commands (publication/installation/activation). */
export interface MarketplaceGovernance {
  draftPackage(scope: MarketplaceTenantScope, input: DraftPackageInput): Result<PackageVersionRecord, MarketplaceError>;
  submitPackageVersion(scope: MarketplaceTenantScope, input: PublicationTransitionInput): Result<PackageVersionRecord, MarketplaceError>;
  reviewPublication(scope: MarketplaceTenantScope, input: PublicationTransitionInput): Result<PackageVersionRecord, MarketplaceError>;
  installPackage(scope: MarketplaceTenantScope, input: InstallPackageInput): Result<PackageInstallation, MarketplaceError>;
  reviseInstallationConfiguration(scope: MarketplaceTenantScope, input: ReviseConfigurationInput): Result<PackageInstallation, MarketplaceError>;
  uninstallInstallation(scope: MarketplaceTenantScope, input: { installationId: string; actor: MarketplaceActorReference; reason: string; now: MarketplaceTimestamp }): Result<PackageInstallation, MarketplaceError>;
  activatePackage(scope: MarketplaceTenantScope, input: ActivatePackageInput): Result<PackageActivation, MarketplaceError>;
  deactivateActivation(scope: MarketplaceTenantScope, input: { activationId: string; actor: MarketplaceActorReference; reason: string; now: MarketplaceTimestamp }): Result<PackageActivation, MarketplaceError>;
}

/** Machine 4 commands (execution approval — propose + record the dispose). */
export interface MarketplaceExecutionApproval {
  requestExecutionUse(scope: MarketplaceTenantScope, input: ExecutionRequestInput): Result<ExecutionApprovalRequest, MarketplaceError>;
  citeExecutionApproval(scope: MarketplaceTenantScope, input: CiteExecutionInput): Result<ExecutionApprovalRequest, MarketplaceError>;
  withdrawExecutionRequest(scope: MarketplaceTenantScope, input: { requestId: string; actor: MarketplaceActorReference; reason: string; now: MarketplaceTimestamp }): Result<ExecutionApprovalRequest, MarketplaceError>;
}

/** Recruitment commands. */
export interface MarketplaceRecruitment {
  openRecruitment(scope: MarketplaceTenantScope, input: OpenRecruitmentInput): Result<RecruitmentRequest, MarketplaceError>;
  resolveRecruitment(scope: MarketplaceTenantScope, input: ResolveRecruitmentInput): Result<RecruitmentRequest, MarketplaceError>;
  cancelRecruitment(scope: MarketplaceTenantScope, input: { requestId: string; actor: MarketplaceActorReference; reason: string; now: MarketplaceTimestamp }): Result<RecruitmentRequest, MarketplaceError>;
}

/** Read views (catalog / installations / activations / requests / audit). */
export interface MarketplaceViews {
  listCatalog(scope: MarketplaceTenantScope): readonly CatalogEntry[];
  getPackageVersion(scope: MarketplaceTenantScope, packageId: string, version: number): Result<PackageVersionRecord, MarketplaceError>;
  getPackage(scope: MarketplaceTenantScope, packageId: string): Result<MarketplacePackage, MarketplaceError>;
  getInstallation(scope: MarketplaceTenantScope, installationId: string): Result<PackageInstallation, MarketplaceError>;
  listInstallations(scope: MarketplaceTenantScope): readonly PackageInstallation[];
  getActivation(scope: MarketplaceTenantScope, activationId: string): Result<PackageActivation, MarketplaceError>;
  listActivations(scope: MarketplaceTenantScope): readonly PackageActivation[];
  getExecutionRequest(scope: MarketplaceTenantScope, requestId: string): Result<ExecutionApprovalRequest, MarketplaceError>;
  getRecruitment(scope: MarketplaceTenantScope, requestId: string): Result<RecruitmentRequest, MarketplaceError>;
  listRecruitments(scope: MarketplaceTenantScope): readonly RecruitmentRequest[];
  rankedCandidates(scope: MarketplaceTenantScope, requestId: string): Result<readonly RankedCandidatePackage[], MarketplaceError>;
  listAudit(scope: MarketplaceTenantScope): readonly MarketplaceAuditRecord[];
}

/** The composed service surface (four interfaces, no fused primitives). */
export interface MarketplaceService
  extends MarketplaceGovernance,
    MarketplaceExecutionApproval,
    MarketplaceRecruitment,
    MarketplaceViews {}
