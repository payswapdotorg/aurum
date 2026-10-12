/**
 * Governance orchestration (W011 app layer): the publication and
 * installation command handlers (machines 1 and 2; machines 3 and 4 live
 * in activation-execution.ts). Each handler = validate -> resolve
 * tenant-scoped records -> apply ONE domain transition -> append ONE
 * audit entry. NO handler touches more than one machine's transition
 * (the structural separation tripwire).
 */
import { err, ok, type Result } from "../domain/primitives.js";
import type { MarketplaceActorReference, MarketplaceTenantScope } from "../domain/primitives.js";
import {
  marketplaceConflict,
  marketplaceValidationError,
  type MarketplaceError,
} from "../domain/errors.js";
import type {
  MarketplaceAuditPort,
  MarketplaceCatalogStore,
  MarketplaceGovernanceStore,
} from "../domain/ports.js";
import type { MarketplaceAuthorityPort } from "../domain/ports.js";
import { buildDraftPackageVersion, packageVersionIssues } from "../domain/records.js";
import type { PackageVersionRecord } from "../domain/records.js";
import {
  catalogEntryOf,
  isPublishedVersion,
  reviewPublication,
  submitForPublication,
} from "../domain/publication.js";
import {
  installPublishedVersion,
  installationIssues,
  reviseInstallationConfiguration,
  uninstallInstallation,
} from "../domain/installation.js";
import type { PackageInstallation } from "../domain/installation.js";
import { marketplaceProvenanceIssues } from "../domain/primitives.js";
import type { DraftPackageInput } from "./inputs.js";
import type {
  PublicationTransitionInput,
  InstallPackageInput,
  ReviseConfigurationInput,
} from "./inputs.js";

export interface GovernanceHandlers {
  readonly catalog: MarketplaceCatalogStore;
  readonly governance: MarketplaceGovernanceStore;
  readonly audit: MarketplaceAuditPort;
  readonly authority: MarketplaceAuthorityPort;
}

export function audited(
  scope: MarketplaceTenantScope,
  audit: MarketplaceAuditPort,
  subject: { kind: string; id: string },
  action: string,
  actor: MarketplaceActorReference,
  at: number,
  reason: string,
  details?: unknown,
): Result<{ auditRef: string }, MarketplaceError> {
  return audit.append(scope, { subject, action, actor, at, reason, details });
}

/** draftPackage: creates the package identity + the DRAFT version record. */
export function handleDraftPackage(
  scope: MarketplaceTenantScope,
  input: DraftPackageInput,
  deps: GovernanceHandlers,
): Result<PackageVersionRecord, MarketplaceError> {
  const kindMismatch =
    input.kind !== input.contents?.kind
      ? [
          {
            field: "kind",
            problem: `must match contents.kind (${String(input.contents?.kind)})`,
          },
        ]
      : [];
  const issues = [
    ...kindMismatch,
    ...packageVersionIssues({
      packageId: input.packageId,
      version: input.version,
      contents: input.contents,
      changelog: input.changelog,
      evidenceRefs: input.evidenceRefs,
    }),
    ...marketplaceProvenanceIssues(input.provenance),
    ...(typeof input.summary !== "string" || input.summary.trim().length === 0
      ? [{ field: "summary", problem: "must be a non-empty string" }]
      : []),
  ];
  if (issues.length > 0) return err(marketplaceValidationError(issues));
  const existingPackage = deps.catalog.getPackage(scope, input.packageId);
  const versionRecord = buildDraftPackageVersion({
    scope,
    packageId: input.packageId,
    version: input.version,
    contents: input.contents,
    changelog: input.changelog,
    evidenceRefs: input.evidenceRefs,
    publisher: input.publisher,
    provenance: input.provenance,
    now: input.now,
  });
  if (existingPackage.ok && existingPackage.value.kind !== input.kind) {
    return err(
      marketplaceConflict(
        `package ${input.packageId} already exists with kind ${existingPackage.value.kind}`,
      ),
    );
  }
  const existingVersion = deps.catalog.getVersion(scope, input.packageId, input.version);
  if (existingVersion.ok) {
    return err(
      marketplaceConflict(
        `package ${input.packageId} version ${input.version} already exists in tenant`,
      ),
    );
  }
  const putVersion = deps.catalog.putVersion(versionRecord);
  if (!putVersion.ok) return putVersion;
  if (!existingPackage.ok) {
    const putPackage = deps.catalog.putPackage({
      scope,
      packageId: input.packageId,
      kind: input.contents.kind,
      summary: input.summary.trim(),
      publisher: input.publisher,
      provenance: input.provenance,
      createdAt: input.now,
    });
    if (!putPackage.ok) return putPackage;
  }
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "package-version", id: `${input.packageId}@${input.version}` },
    "marketplace.package-drafted",
    input.publisher,
    input.now,
    `package ${input.packageId} v${input.version} drafted`,
    { packageId: input.packageId, version: input.version, evidenceRefs: input.evidenceRefs },
  );
  if (!auditRef.ok) return auditRef;
  return ok(versionRecord);
}

/** submitPackageVersion: draft -> submitted (machine 1). */
export function handleSubmitPackageVersion(
  scope: MarketplaceTenantScope,
  input: PublicationTransitionInput,
  deps: GovernanceHandlers,
): Result<PackageVersionRecord, MarketplaceError> {
  const fetched = deps.catalog.getVersion(scope, input.packageId, input.version);
  if (!fetched.ok) return fetched;
  const transition = submitForPublication(fetched.value, {
    actor: input.actor,
    at: input.now,
    reason: input.reason,
  });
  if (!transition.ok) return transition;
  const put = deps.catalog.putVersion(transition.value);
  if (!put.ok) return put;
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "package-version", id: `${input.packageId}@${input.version}` },
    "marketplace.package-submitted",
    input.actor,
    input.now,
    input.reason,
    { packageId: input.packageId, version: input.version },
  );
  if (!auditRef.ok) return auditRef;
  return ok(transition.value);
}

/** reviewPublication: submitted -> published | rejected (HUMAN reviewer). */
export function handleReviewPublication(
  scope: MarketplaceTenantScope,
  input: PublicationTransitionInput,
  deps: GovernanceHandlers,
): Result<PackageVersionRecord, MarketplaceError> {
  const decision = input.decision ?? "published";
  const fetched = deps.catalog.getVersion(scope, input.packageId, input.version);
  if (!fetched.ok) return fetched;
  const transition = reviewPublication(fetched.value, decision, input.actor, {
    actor: input.actor,
    at: input.now,
    reason: input.reason,
  });
  if (!transition.ok) return transition;
  const put = deps.catalog.putVersion(transition.value);
  if (!put.ok) return put;
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "package-version", id: `${input.packageId}@${input.version}` },
    decision === "published" ? "marketplace.package-published" : "marketplace.package-rejected",
    input.actor,
    input.now,
    input.reason,
    {
      packageId: input.packageId,
      version: input.version,
      evidenceRefs: fetched.value.evidenceRefs,
    },
  );
  if (!auditRef.ok) return auditRef;
  return ok(transition.value);
}

/** installPackage: published version -> per-tenant installation (machine 2). */
export function handleInstallPackage(
  scope: MarketplaceTenantScope,
  input: InstallPackageInput,
  deps: GovernanceHandlers,
): Result<PackageInstallation, MarketplaceError> {
  const shapeIssues = [
    ...installationIssues({
      installationId: input.installationId,
      configuration: input.configuration,
    }),
    ...marketplaceProvenanceIssues(input.provenance),
  ];
  if (shapeIssues.length > 0) return err(marketplaceValidationError(shapeIssues));
  const existing = deps.governance.getInstallation(scope, input.installationId);
  if (existing.ok) {
    return err(
      marketplaceConflict(`installation ${input.installationId} already exists in tenant`),
    );
  }
  const fetchedPackage = deps.catalog.getPackage(scope, input.packageId);
  if (!fetchedPackage.ok) return fetchedPackage;
  const fetchedVersion = deps.catalog.getVersion(scope, input.packageId, input.version);
  if (!fetchedVersion.ok) return fetchedVersion;
  const installed = installPublishedVersion({
    scope,
    versionRecord: fetchedVersion.value,
    installationId: input.installationId,
    installedBy: input.installedBy,
    configuration: input.configuration,
    provenance: input.provenance,
    now: input.now,
  });
  if (!installed.ok) return installed;
  const put = deps.governance.putInstallation(installed.value);
  if (!put.ok) return put;
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "installation", id: input.installationId },
    "marketplace.package-installed",
    input.installedBy,
    input.now,
    `installed ${input.packageId} v${input.version}`,
    {
      packageId: input.packageId,
      version: input.version,
      evidenceRefs: fetchedVersion.value.evidenceRefs,
    },
  );
  if (!auditRef.ok) return auditRef;
  return ok(installed.value);
}

/** reviseInstallationConfiguration: the per-tenant configuration surface. */
export function handleReviseConfiguration(
  scope: MarketplaceTenantScope,
  input: ReviseConfigurationInput,
  deps: GovernanceHandlers,
): Result<PackageInstallation, MarketplaceError> {
  const fetched = deps.governance.getInstallation(scope, input.installationId);
  if (!fetched.ok) return fetched;
  const revised = reviseInstallationConfiguration(fetched.value, {
    value: input.value,
    revisedBy: input.revisedBy,
    revisedAt: input.revisedAt,
    reason: input.reason,
  });
  if (!revised.ok) return revised;
  const put = deps.governance.putInstallation(revised.value);
  if (!put.ok) return put;
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "installation", id: input.installationId },
    "marketplace.package-configuration-revised",
    input.revisedBy,
    input.revisedAt,
    input.reason,
    { packageId: fetched.value.packageId, version: fetched.value.installedVersion },
  );
  if (!auditRef.ok) return auditRef;
  return ok(revised.value);
}

/** uninstallInstallation: installed -> uninstalled (terminal). */
export function handleUninstallInstallation(
  scope: MarketplaceTenantScope,
  input: { installationId: string; actor: MarketplaceActorReference; reason: string; now: number },
  deps: GovernanceHandlers,
): Result<PackageInstallation, MarketplaceError> {
  const fetched = deps.governance.getInstallation(scope, input.installationId);
  if (!fetched.ok) return fetched;
  const uninstalled = uninstallInstallation(fetched.value, input.now);
  if (!uninstalled.ok) return uninstalled;
  const put = deps.governance.putInstallation(uninstalled.value);
  if (!put.ok) return put;
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "installation", id: input.installationId },
    "marketplace.package-uninstalled",
    input.actor,
    input.now,
    input.reason,
    { packageId: fetched.value.packageId, version: fetched.value.installedVersion },
  );
  if (!auditRef.ok) return auditRef;
  return ok(uninstalled.value);
}

/** Exported for the views: catalog entries of published versions only. */
export function listCatalogEntries(
  scope: MarketplaceTenantScope,
  catalog: MarketplaceCatalogStore,
): ReturnType<typeof catalogEntryOf>[] {
  return catalog
    .listVersions(scope)
    .filter(isPublishedVersion)
    .map(catalogEntryOf)
    .sort((a, b) => a.packageId.localeCompare(b.packageId) || a.version - b.version);
}
