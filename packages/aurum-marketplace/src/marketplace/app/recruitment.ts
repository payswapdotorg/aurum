/**
 * Recruitment orchestration (W011 app layer): request -> ranked proposal ->
 * sequenced resolution (install + activate + register, each its own audited
 * transition) -> resolved.
 *
 * PROPOSE/DISPOSE LAW: `handleOpenRecruitment` PROPOSES (the ranked
 * proposal). `handleResolveRecruitment` requires the W002 authority
 * citation (asserted against the authority port — the DISPOSE) BEFORE any
 * state changes; a refused citation leaves the request untouched.
 *
 * NO FUSED PRIMITIVE: resolution SEQUENCES machines 2 and 3 through the
 * same validated domain transitions used by the standalone commands, and
 * writes each record separately with its own audit entry. Publication is
 * never part of resolution — the chosen package must ALREADY be published
 * (it must appear in the ranked proposal, which only ranks published
 * versions).
 */
import { err, ok, type Result } from "../domain/primitives.js";
import type { MarketplaceActorReference, MarketplaceTenantScope } from "../domain/primitives.js";
import type { RecruitmentRequest } from "../domain/recruitment.js";
import {
  marketplaceConflict,
  marketplaceValidationError,
  type MarketplaceError,
} from "../domain/errors.js";
import { marketplaceProvenanceIssues } from "../domain/primitives.js";
import type {
  MarketplaceAuditPort,
  MarketplaceAuthorityPort,
  MarketplaceCatalogStore,
  MarketplaceGovernanceStore,
  WorkforceRegistrationPort,
} from "../domain/ports.js";
import {
  attachProposal,
  buildRecruitmentRequest,
  cancelRequest,
  packageSuppliesOf,
  rankCandidatePackages,
  recruitmentRequestIssues,
  resolveRequest,
} from "../domain/recruitment.js";
import type { PackageVersionRecord } from "../domain/records.js";
import { installPublishedVersion } from "../domain/installation.js";
import { activateInstallation } from "../domain/activation.js";
import type { OpenRecruitmentInput, ResolveRecruitmentInput } from "./inputs.js";

export interface RecruitmentHandlers {
  readonly catalog: MarketplaceCatalogStore;
  readonly governance: MarketplaceGovernanceStore;
  readonly audit: MarketplaceAuditPort;
  readonly authority: MarketplaceAuthorityPort;
  readonly registration: WorkforceRegistrationPort;
}

function audited(
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

/** openRecruitment: build the request + attach the deterministic ranking. */
export function handleOpenRecruitment(
  scope: MarketplaceTenantScope,
  input: OpenRecruitmentInput,
  deps: RecruitmentHandlers,
): Result<RecruitmentRequest, MarketplaceError> {
  const issues = [
    ...recruitmentRequestIssues({
      requestId: input.requestId,
      demand: input.demand,
      requiredEvidenceKinds: input.requiredEvidenceKinds,
    }),
    ...marketplaceProvenanceIssues(input.provenance),
  ];
  if (issues.length > 0) return err(marketplaceValidationError(issues));
  const existing = deps.governance.getRecruitment(scope, input.requestId);
  if (existing.ok) {
    return err(marketplaceConflict(`recruitment request ${input.requestId} already exists`));
  }
  const request = buildRecruitmentRequest({
    scope,
    requestId: input.requestId,
    demand: input.demand,
    ...(input.targetPackageKinds ? { targetPackageKinds: input.targetPackageKinds } : {}),
    requiredEvidenceKinds: input.requiredEvidenceKinds,
    excludedPackageIds: input.excludedPackageIds ?? [],
    requestedBy: input.requestedBy,
    provenance: input.provenance,
    now: input.now,
  });
  const proposal = rankCandidatePackages(request, deps.catalog.listVersions(scope));
  const withProposal = attachProposal(request, proposal);
  if (!withProposal.ok) return withProposal;
  const put = deps.governance.putRecruitment(withProposal.value);
  if (!put.ok) return put;
  const openedAudit = audited(
    scope,
    deps.audit,
    { kind: "recruitment", id: input.requestId },
    "marketplace.recruitment-opened",
    input.requestedBy,
    input.now,
    `recruitment request ${input.requestId} opened`,
    { demand: input.demand, requiredEvidenceKinds: input.requiredEvidenceKinds },
  );
  if (!openedAudit.ok) return openedAudit;
  const rankedAudit = audited(
    scope,
    deps.audit,
    { kind: "recruitment", id: input.requestId },
    "marketplace.recruitment-ranked",
    input.requestedBy,
    input.now,
    `ranked ${proposal.length} candidate packages`,
    { weights: request.weights, candidates: proposal },
  );
  if (!rankedAudit.ok) return rankedAudit;
  return ok(withProposal.value);
}

/**
 * resolveRecruitment: assert the W002 citation (DISPOSE), then SEQUENCE
 * install (machine 2) -> activate (machine 3) -> W005 registration -> mark
 * resolved. Nothing is written unless every step succeeds.
 */
export function handleResolveRecruitment(
  scope: MarketplaceTenantScope,
  input: ResolveRecruitmentInput,
  deps: RecruitmentHandlers,
): Result<RecruitmentRequest, MarketplaceError> {
  const fetched = deps.governance.getRecruitment(scope, input.requestId);
  if (!fetched.ok) return fetched;
  const request = fetched.value;
  if (request.state !== "open") {
    return err(marketplaceConflict(`recruitment request ${input.requestId} is ${request.state}`));
  }
  const proposal = request.proposal ?? [];
  const chosen = proposal.find((candidate) => candidate.packageId === input.chosenPackageId);
  if (!chosen) {
    return err(
      marketplaceValidationError([
        {
          field: "chosenPackageId",
          problem: "must be among the ranked candidate packages of this request",
        },
      ]),
    );
  }
  const installationExists = deps.governance.getInstallation(scope, input.installationId);
  if (installationExists.ok) {
    return err(marketplaceConflict(`installation ${input.installationId} already exists`));
  }
  const activationExists = deps.governance.getActivation(scope, input.activationId);
  if (activationExists.ok) {
    return err(marketplaceConflict(`activation ${input.activationId} already exists`));
  }
  // THE DISPOSE: the W002 authority seam decides; recruitment only proposes.
  const assertion = deps.authority.assertAuthorityCitation(scope, input.citation);
  if (!assertion.ok) return assertion;
  // Machine 2 (same validated transition as the standalone install command).
  const versionRecord = deps.catalog.getVersion(scope, chosen.packageId, chosen.version);
  if (!versionRecord.ok) return versionRecord;
  const installed = installPublishedVersion({
    scope,
    versionRecord: versionRecord.value,
    installationId: input.installationId,
    installedBy: input.resolvedBy,
    provenance: versionRecord.value.provenance,
    now: input.now,
  });
  if (!installed.ok) return installed;
  // Machine 3 (same validated transition as the standalone activate command).
  const activated = activateInstallation({
    scope,
    installation: installed.value,
    existingActivations: deps.governance.listActivations(scope),
    activationId: input.activationId,
    actorRefs: input.actorRefs,
    grants: input.grants,
    activatedBy: input.resolvedBy,
    provenance: versionRecord.value.provenance,
    now: input.now,
  });
  if (!activated.ok) return activated;
  // W005 registration BY REFERENCE (the seam owns the registered record).
  const registration = registerRecruit(scope, versionRecord.value, installed.value, input, deps);
  if (!registration.ok) return registration;
  // Writes happen only after every step validated.
  const putInstallation = deps.governance.putInstallation(installed.value);
  if (!putInstallation.ok) return putInstallation;
  const putActivation = deps.governance.putActivation(activated.value);
  if (!putActivation.ok) return putActivation;
  const resolved = resolveRequest(request, {
    chosenPackageId: chosen.packageId,
    chosenVersion: chosen.version,
    installationId: input.installationId,
    activationId: input.activationId,
    registrationRef: registration.value.registrationRef,
    resolvedBy: input.resolvedBy,
    resolvedAt: input.now,
  });
  if (!resolved.ok) return resolved;
  const putRequest = deps.governance.putRecruitment(resolved.value);
  if (!putRequest.ok) return putRequest;
  const installAudit = audited(
    scope,
    deps.audit,
    { kind: "installation", id: input.installationId },
    "marketplace.package-installed",
    input.resolvedBy,
    input.now,
    `recruitment ${input.requestId}: installed ${chosen.packageId} v${chosen.version}`,
    { packageId: chosen.packageId, version: chosen.version },
  );
  if (!installAudit.ok) return installAudit;
  const activationAudit = audited(
    scope,
    deps.audit,
    { kind: "activation", id: input.activationId },
    "marketplace.package-activated",
    input.resolvedBy,
    input.now,
    `recruitment ${input.requestId}: activated for ${input.actorRefs.length} actor(s)`,
    { installationId: input.installationId, actorRefs: input.actorRefs, grants: input.grants },
  );
  if (!activationAudit.ok) return activationAudit;
  const registrationAudit = audited(
    scope,
    deps.audit,
    { kind: "recruitment", id: input.requestId },
    "marketplace.recruitment-registered",
    input.resolvedBy,
    input.now,
    `registered ${chosen.packageId} into the workforce seams by reference`,
    {
      registrationRef: registration.value.registrationRef,
      packageRef: chosen.packageId,
      installationRef: input.installationId,
    },
  );
  if (!registrationAudit.ok) return registrationAudit;
  const resolveAudit = audited(
    scope,
    deps.audit,
    { kind: "recruitment", id: input.requestId },
    "marketplace.recruitment-resolved",
    input.resolvedBy,
    input.now,
    `recruitment ${input.requestId} resolved with ${chosen.packageId}`,
    {
      actionId: assertion.value.actionId,
      auditRef: assertion.value.auditRef,
      installationId: input.installationId,
      activationId: input.activationId,
    },
  );
  if (!resolveAudit.ok) return resolveAudit;
  return ok(resolved.value);
}

/** Maps the package kind onto the W005 registration seam (by reference). */
function registerRecruit(
  scope: MarketplaceTenantScope,
  versionRecord: PackageVersionRecord,
  installation: { installationId: string; packageId: string },
  input: ResolveRecruitmentInput,
  deps: RecruitmentHandlers,
): Result<{ registrationRef: string }, MarketplaceError> {
  const provenance = {
    actor: input.resolvedBy,
    source: "system-captured" as const,
    recordedAt: input.now,
    note: `recruited via marketplace request ${input.requestId}`,
  };
  if (versionRecord.contents.kind === "role") {
    return deps.registration.registerRecruitedRole(scope, {
      packageRef: installation.packageId,
      installationRef: installation.installationId,
      title: versionRecord.contents.roleDefinition.title,
      ...(versionRecord.contents.roleDefinition.description
        ? { description: versionRecord.contents.roleDefinition.description }
        : {}),
      requiredCapabilities: versionRecord.contents.requiredCapabilities,
      requestRef: input.requestId,
      proposedBy: input.resolvedBy,
      provenance,
      now: input.now,
    });
  }
  const actorKind = versionRecord.contents.kind === "agent" ? "agent" : "software";
  return deps.registration.registerRecruitedActor(scope, {
    packageRef: installation.packageId,
    installationRef: installation.installationId,
    activationRef: input.activationId,
    actorKind,
    displayName: versionRecord.changelog.slice(0, 64),
    capabilitySupplies: packageSuppliesOf(versionRecord).map((supply) => ({
      capabilityId: supply.capabilityId,
      level: supply.level,
      capacityPerPeriod: supply.capacityPerPeriod,
    })),
    requestRef: input.requestId,
    proposedBy: input.resolvedBy,
    provenance,
    now: input.now,
  });
}

/** cancelRecruitment: open -> cancelled. */
export function handleCancelRecruitment(
  scope: MarketplaceTenantScope,
  input: { requestId: string; actor: MarketplaceActorReference; reason: string; now: number },
  deps: RecruitmentHandlers,
): Result<RecruitmentRequest, MarketplaceError> {
  const fetched = deps.governance.getRecruitment(scope, input.requestId);
  if (!fetched.ok) return fetched;
  const cancelled = cancelRequest(fetched.value);
  if (!cancelled.ok) return cancelled;
  const put = deps.governance.putRecruitment(cancelled.value);
  if (!put.ok) return put;
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "recruitment", id: input.requestId },
    "marketplace.recruitment-cancelled",
    input.actor,
    input.now,
    input.reason,
    {},
  );
  if (!auditRef.ok) return auditRef;
  return ok(cancelled.value);
}
