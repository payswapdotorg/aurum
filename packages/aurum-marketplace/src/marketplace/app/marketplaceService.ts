/**
 * The Marketplace service facade (W011 app layer). Composes the governance
 * handlers (machines 1-4), the recruitment handlers and the read views
 * into the public `MarketplaceService`. In-memory state machine over the
 * store ports (house pattern — PostgreSQL persistence is the TL-tracked
 * P-series debt, recorded in README.md).
 *
 * NO FUSED PRIMITIVE: the service exposes exactly the four machines'
 * commands + recruitment + views. There is no deploy/install-and-activate
 * single-step method, and no execution anywhere
 * (test/marketplace-tripwires.test.ts).
 */
import { err, ok, type Result } from "../domain/primitives.js";
import type { MarketplaceError } from "../domain/errors.js";
import { marketplaceNotFound } from "../domain/errors.js";
import type { MarketplaceServiceDeps } from "../domain/ports.js";
import type { MarketplaceService } from "./inputs.js";
import {
  handleDraftPackage,
  handleInstallPackage,
  handleReviewPublication,
  handleReviseConfiguration,
  handleSubmitPackageVersion,
  handleUninstallInstallation,
  listCatalogEntries,
} from "./governance.js";
import {
  handleActivatePackage,
  handleCiteExecutionApproval,
  handleDeactivateActivation,
  handleRequestExecutionUse,
  handleWithdrawExecutionRequest,
} from "./activation-execution.js";
import {
  handleCancelRecruitment,
  handleOpenRecruitment,
  handleResolveRecruitment,
} from "./recruitment.js";
import { rankCandidatePackages } from "../domain/recruitment.js";
import type { RankedCandidatePackage } from "../domain/recruitment.js";

/** Builds the Marketplace service over its ports. */
export function createMarketplaceService(deps: MarketplaceServiceDeps): MarketplaceService {
  const governanceHandlers = {
    catalog: deps.catalog,
    governance: deps.governance,
    audit: deps.audit,
    authority: deps.authority,
  };
  const recruitmentHandlers = {
    catalog: deps.catalog,
    governance: deps.governance,
    audit: deps.audit,
    authority: deps.authority,
    registration: deps.registration,
  };
  return {
    draftPackage: (scope, input) => handleDraftPackage(scope, input, governanceHandlers),
    submitPackageVersion: (scope, input) =>
      handleSubmitPackageVersion(scope, input, governanceHandlers),
    reviewPublication: (scope, input) => handleReviewPublication(scope, input, governanceHandlers),
    installPackage: (scope, input) => handleInstallPackage(scope, input, governanceHandlers),
    reviseInstallationConfiguration: (scope, input) =>
      handleReviseConfiguration(scope, input, governanceHandlers),
    uninstallInstallation: (scope, input) =>
      handleUninstallInstallation(scope, input, governanceHandlers),
    activatePackage: (scope, input) => handleActivatePackage(scope, input, governanceHandlers),
    deactivateActivation: (scope, input) =>
      handleDeactivateActivation(scope, input, governanceHandlers),
    requestExecutionUse: (scope, input) =>
      handleRequestExecutionUse(scope, input, governanceHandlers),
    citeExecutionApproval: (scope, input) =>
      handleCiteExecutionApproval(scope, input, governanceHandlers),
    withdrawExecutionRequest: (scope, input) =>
      handleWithdrawExecutionRequest(scope, input, governanceHandlers),
    openRecruitment: (scope, input) => handleOpenRecruitment(scope, input, recruitmentHandlers),
    resolveRecruitment: (scope, input) =>
      handleResolveRecruitment(scope, input, recruitmentHandlers),
    cancelRecruitment: (scope, input) => handleCancelRecruitment(scope, input, recruitmentHandlers),
    listCatalog: (scope) => listCatalogEntries(scope, deps.catalog),
    getPackageVersion: (scope, packageId, version) =>
      deps.catalog.getVersion(scope, packageId, version),
    getPackage: (scope, packageId) => deps.catalog.getPackage(scope, packageId),
    getInstallation: (scope, installationId) =>
      deps.governance.getInstallation(scope, installationId),
    listInstallations: (scope) => deps.governance.listInstallations(scope),
    getActivation: (scope, activationId) => deps.governance.getActivation(scope, activationId),
    listActivations: (scope) => deps.governance.listActivations(scope),
    getExecutionRequest: (scope, requestId) =>
      deps.governance.getExecutionRequest(scope, requestId),
    getRecruitment: (scope, requestId) => deps.governance.getRecruitment(scope, requestId),
    listRecruitments: (scope) => deps.governance.listRecruitments(scope),
    rankedCandidates: (
      scope,
      requestId,
    ): Result<readonly RankedCandidatePackage[], MarketplaceError> => {
      const fetched = deps.governance.getRecruitment(scope, requestId);
      if (!fetched.ok) return fetched;
      const proposal = fetched.value.proposal;
      if (proposal !== undefined) return ok(proposal);
      return ok(rankCandidatePackages(fetched.value, deps.catalog.listVersions(scope)));
    },
    listAudit: (scope) => deps.audit.listAudit(scope),
  };
}

/** Uniform not-found helper re-exported for view consumers. */
export function marketplaceRecordNotFound(recordKind: string): Result<never, MarketplaceError> {
  return err(marketplaceNotFound(recordKind));
}
