/**
 * Machine 3 — ACTIVATION (W011 domain layer): an INSTALLED package is
 * activated for specific actors/scopes -> `activated` state. activated ->
 * deactivated (terminal).
 *
 * SEPARATION LAW 3 (activation is separate from installation AND grants
 * nothing by itself): `activateInstallation` REFUSES unless the referenced
 * installation exists in the REQUESTING tenant AND is in `installed`
 * state — a typed `marketplace-not-installed` refusal. The activation
 * DECLARES what the package may touch (the grant list); it GRANTS nothing:
 * actual use still requires a machine-4 execution citation (the W002/W009
 * approval seams) and the marketplace never executes (tripwire-locked).
 *
 * The activation pins the installation's package id + version + kind so
 * later uninstalling or superseding cannot silently re-scope it.
 */
import { deepFreezeMarketplace, err, ok, type Result } from "./primitives.js";
import type {
  MarketplaceActorReference,
  MarketplaceProvenanceStamp,
  MarketplaceTenantScope,
  MarketplaceTenantScopedRecord,
  MarketplaceTimestamp,
  MarketplaceValidationIssue,
} from "./primitives.js";
import { marketplaceConflict, marketplaceLifecycleIllegal, marketplaceNotInstalled } from "./errors.js";
import type { MarketplaceError } from "./errors.js";
import { activationTransitionLegal, isKnownActivationGrantKind } from "./vocabulary.js";
import type { PackageInstallation } from "./installation.js";

/** One declared grant: WHAT the activated package may touch. */
export interface ActivationGrant {
  readonly grantKind: "capability" | "tool" | "data-scope" | "environment";
  /** Opaque target reference (capability id, tool id, data scope, env id). */
  readonly ref: string;
  /** Optional level bound (0..5) for capability grants. */
  readonly level?: number;
}

/**
 * One activation of an installed package for SPECIFIC actors under a
 * DECLARED grant list. The activation record is the marketplace's whole
 * authority statement — nothing else exists downstream of it inside this
 * package except machine-4 citation records.
 */
export interface PackageActivation extends MarketplaceTenantScopedRecord {
  readonly activationId: string;
  readonly installationId: string;
  readonly packageId: string;
  readonly version: number;
  readonly packageKind: string;
  /** The specific actors the package is activated for (opaque refs). */
  readonly actorRefs: readonly string[];
  /** The declared grant list — what the package MAY touch. */
  readonly grants: readonly ActivationGrant[];
  readonly state: "activated" | "deactivated";
  readonly activatedBy: MarketplaceActorReference;
  readonly activatedAt: MarketplaceTimestamp;
  readonly deactivatedAt?: MarketplaceTimestamp;
  readonly provenance: MarketplaceProvenanceStamp;
}

/** Validates an activation command's shape. */
export function activationIssues(input: {
  activationId?: unknown;
  actorRefs?: unknown;
  grants?: unknown;
}): MarketplaceValidationIssue[] {
  const issues: MarketplaceValidationIssue[] = [];
  if (typeof input.activationId !== "string" || input.activationId.trim().length === 0) {
    issues.push({ field: "activationId", problem: "must be a non-empty string" });
  }
  const actorRefs = input.actorRefs;
  if (!Array.isArray(actorRefs) || actorRefs.length === 0) {
    issues.push({ field: "actorRefs", problem: "must list at least one actor reference" });
  } else {
    actorRefs.forEach((ref, index) => {
      if (typeof ref !== "string" || ref.trim().length === 0) {
        issues.push({ field: `actorRefs[${index}]`, problem: "must be a non-empty string" });
      }
    });
  }
  const grants = input.grants;
  if (!Array.isArray(grants) || grants.length === 0) {
    issues.push({ field: "grants", problem: "must declare at least one grant" });
  } else {
    grants.forEach((grant, index) => {
      const field = `grants[${index}]`;
      if (!grant || typeof grant !== "object") {
        issues.push({ field, problem: "is required" });
        return;
      }
      if (!isKnownActivationGrantKind(grant.grantKind)) {
        issues.push({ field: `${field}.grantKind`, problem: "must be a known grant kind" });
      }
      if (typeof grant.ref !== "string" || grant.ref.trim().length === 0) {
        issues.push({ field: `${field}.ref`, problem: "must be a non-empty string" });
      }
      if (
        grant.level !== undefined &&
        (!Number.isInteger(grant.level) || grant.level < 0 || grant.level > 5)
      ) {
        issues.push({ field: `${field}.level`, problem: "must be an integer in 0..5 when present" });
      }
    });
  }
  return issues;
}

/**
 * Activates an installed package for specific actors/scopes. REFUSES
 * unless the installation is `installed` in the requesting tenant (typed
 * `marketplace-not-installed`) and no other ACTIVE activation exists for
 * the same installation with an identical actor+grant target (conflict).
 */
export function activateInstallation(input: {
  readonly scope: MarketplaceTenantScope;
  readonly installation: PackageInstallation | undefined;
  readonly existingActivations: readonly PackageActivation[];
  readonly activationId: string;
  readonly actorRefs: readonly string[];
  readonly grants: readonly ActivationGrant[];
  readonly activatedBy: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
}): Result<PackageActivation, MarketplaceError> {
  const installation = input.installation;
  if (!installation || installation.state !== "installed") {
    return err(marketplaceNotInstalled(input.activationId));
  }
  const targetKey = activationTargetKey(input.actorRefs, input.grants);
  const conflicting = input.existingActivations.some(
    (existing) =>
      existing.state === "activated" &&
      existing.installationId === installation.installationId &&
      activationTargetKey(existing.actorRefs, existing.grants) === targetKey,
  );
  if (conflicting) {
    return err(
      marketplaceConflict(
        `an active activation for installation ${installation.installationId} with the same actor+grant target already exists`,
      ),
    );
  }
  const activation: PackageActivation = deepFreezeMarketplace({
    scope: input.scope,
    activationId: input.activationId,
    installationId: installation.installationId,
    packageId: installation.packageId,
    version: installation.installedVersion,
    packageKind: installation.packageKind,
    actorRefs: Object.freeze([...input.actorRefs]),
    grants: Object.freeze([...input.grants]),
    state: "activated",
    activatedBy: input.activatedBy,
    activatedAt: input.now,
    provenance: input.provenance,
  });
  return ok(activation);
}

/** activated -> deactivated (terminal). */
export function deactivateActivation(
  activation: PackageActivation,
  at: MarketplaceTimestamp,
): Result<PackageActivation, MarketplaceError> {
  if (!activationTransitionLegal(activation.state, "deactivated")) {
    return err(marketplaceLifecycleIllegal("activation", activation.state, "deactivated"));
  }
  return ok(
    deepFreezeMarketplace({
      ...activation,
      state: "deactivated" as const,
      deactivatedAt: at,
    }),
  );
}

/** Deterministic identity of an activation target (actor+grant shape). */
export function activationTargetKey(
  actorRefs: readonly string[],
  grants: readonly ActivationGrant[],
): string {
  const actors = [...actorRefs].sort().join("|");
  const grantKeys = grants
    .map((grant) => `${grant.grantKind}:${grant.ref}${grant.level !== undefined ? `@${grant.level}` : ""}`)
    .sort()
    .join("|");
  return `${actors};;${grantKeys}`;
}
