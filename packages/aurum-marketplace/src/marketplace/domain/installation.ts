/**
 * Machine 2 — INSTALLATION (W011 domain layer): a tenant installs a
 * PUBLISHED package version -> `installed` state, per-tenant, with a
 * configuration surface. installed -> uninstalled (terminal).
 *
 * SEPARATION LAW 2 (installation is separate from publication AND from
 * activation): `installPublishedVersion` REFUSES any version whose
 * publication state is not `published` in the REQUESTING tenant — a typed
 * `marketplace-unpublished` rejection, never a silent catalog drift. The
 * installation record never carries activation state; activation is
 * machine 3.
 *
 * VERSIONING LAW: the installation PINS the installed version. Publisher
 * updates (new published versions) never mutate an existing installation
 * record — `updateInstalledVersion` does not exist; updating = uninstall +
 * a NEW installation record of the new version.
 *
 * TENANT LAW: the installation is scoped to the REQUESTING tenant; the
 * prerequisite check reads the version record ONLY within the same scope
 * (foreign-tenant versions are not-visible, closed-failure).
 */
import { deepFreezeMarketplace, err, ok, type Result } from "./primitives.js";
import type {
  MarketplaceActorReference,
  MarketplaceProvenanceStamp,
  MarketplaceTenantScope,
  MarketplaceTenantScopedRecord,
  MarketplaceTimestamp,
} from "./primitives.js";
import {
  marketplaceUnpublished,
  type MarketplaceError,
} from "./errors.js";
import { installationTransitionLegal } from "./vocabulary.js";
import { marketplaceLifecycleIllegal } from "./errors.js";
import type { PackageVersionRecord } from "./records.js";
import type { MarketplaceValidationIssue } from "./primitives.js";

/** One per-tenant installation of a pinned package version. */
export interface PackageInstallation extends MarketplaceTenantScopedRecord {
  readonly installationId: string;
  readonly packageId: string;
  /** The PINNED version (never mutated after install). */
  readonly installedVersion: number;
  /** The package kind at install time (echo, immutable). */
  readonly packageKind: string;
  /**
   * The configuration surface: opaque tenant-supplied configuration
   * (bounded JSON value; never parsed by the marketplace). Revisions are
   * append-only history entries — the current value is the last entry.
   */
  readonly configuration: readonly {
    readonly value: unknown;
    readonly revisedBy: MarketplaceActorReference;
    readonly revisedAt: MarketplaceTimestamp;
    readonly reason: string;
  }[];
  readonly state: "installed" | "uninstalled";
  readonly installedBy: MarketplaceActorReference;
  readonly installedAt: MarketplaceTimestamp;
  readonly uninstalledAt?: MarketplaceTimestamp;
  readonly provenance: MarketplaceProvenanceStamp;
}

/** Validates an installation command's shape. */
export function installationIssues(input: {
  installationId?: unknown;
  configuration?: unknown;
}): MarketplaceValidationIssue[] {
  const issues: MarketplaceValidationIssue[] = [];
  if (typeof input.installationId !== "string" || input.installationId.trim().length === 0) {
    issues.push({ field: "installationId", problem: "must be a non-empty string" });
  }
  if (
    input.configuration !== undefined &&
    (input.configuration === null || typeof input.configuration !== "object")
  ) {
    issues.push({ field: "configuration", problem: "must be an object value when present" });
  }
  return issues;
}

/**
 * Installs a PUBLISHED version into the requesting tenant. The separation
 * proof core: the version record must exist IN THE SAME SCOPE with
 * publication.state === "published" — otherwise the typed
 * `marketplace-unpublished` refusal (draft/submitted/rejected all refuse).
 * The caller (app layer) resolves the version record tenant-scoped BEFORE
 * this call; foreign-tenant and never-existing ids fail as a uniform
 * `marketplace-not-found` at the store seam.
 */
export function installPublishedVersion(input: {
  readonly scope: MarketplaceTenantScope;
  readonly versionRecord: PackageVersionRecord;
  readonly installationId: string;
  readonly installedBy: MarketplaceActorReference;
  readonly configuration?: unknown;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
}): Result<PackageInstallation, MarketplaceError> {
  const versionRecord = input.versionRecord;
  if (versionRecord.publication.state !== "published") {
    return err(
      marketplaceUnpublished(versionRecord.packageId, versionRecord.version),
    );
  }
  const installation: PackageInstallation = deepFreezeMarketplace({
    scope: input.scope,
    installationId: input.installationId,
    packageId: versionRecord.packageId,
    installedVersion: versionRecord.version,
    packageKind: versionRecord.contents.kind,
    configuration: Object.freeze(
      input.configuration === undefined
        ? []
        : [
            {
              value: input.configuration,
              revisedBy: input.installedBy,
              revisedAt: input.now,
              reason: "initial installation configuration",
            },
          ],
    ),
    state: "installed",
    installedBy: input.installedBy,
    installedAt: input.now,
    provenance: input.provenance,
  });
  return ok(installation);
}

/**
 * Revises the configuration surface (append-only history). Only legal on a
 * record in `installed` state — the configuration surface is exactly the
 * "with configuration" clause of the catalog acceptance.
 */
export function reviseInstallationConfiguration(
  installation: PackageInstallation,
  revision: {
    readonly value: unknown;
    readonly revisedBy: MarketplaceActorReference;
    readonly revisedAt: MarketplaceTimestamp;
    readonly reason: string;
  },
): Result<PackageInstallation, MarketplaceError> {
  if (installation.state !== "installed") {
    return err(
      marketplaceLifecycleIllegal("installation", installation.state, "installed"),
    );
  }
  return ok(
    deepFreezeMarketplace({
      ...installation,
      configuration: Object.freeze([...installation.configuration, revision]),
    }),
  );
}

/** installed -> uninstalled (terminal). The pinned version is retained. */
export function uninstallInstallation(
  installation: PackageInstallation,
  at: MarketplaceTimestamp,
): Result<PackageInstallation, MarketplaceError> {
  if (!installationTransitionLegal(installation.state, "uninstalled")) {
    return err(
      marketplaceLifecycleIllegal("installation", installation.state, "uninstalled"),
    );
  }
  return ok(
    deepFreezeMarketplace({
      ...installation,
      state: "uninstalled" as const,
      uninstalledAt: at,
    }),
  );
}
