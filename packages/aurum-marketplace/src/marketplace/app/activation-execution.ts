/**
 * Activation + execution-approval orchestration (W011 app layer):
 * machines 3 and 4 command handlers. Each handler = validate -> resolve
 * tenant-scoped records -> apply ONE domain transition -> append ONE audit
 * entry. The execution-citation handler is the only place the W002
 * authority port is asserted (machine 4 dispose) — and it RECORDS the
 * citation; it never executes anything.
 */
import { err, ok, type Result } from "../domain/primitives.js";
import type {
  MarketplaceActorReference,
  MarketplaceTenantScope,
} from "../domain/primitives.js";
import { marketplaceProvenanceIssues } from "../domain/primitives.js";
import {
  marketplaceConflict,
  marketplaceLifecycleIllegal,
  marketplaceValidationError,
  type MarketplaceError,
} from "../domain/errors.js";
import {
  activateInstallation,
  activationIssues,
  deactivateActivation,
} from "../domain/activation.js";
import type { PackageActivation } from "../domain/activation.js";
import {
  citeExecutionApproval,
  openExecutionRequest,
  withdrawExecutionRequest,
} from "../domain/executionApproval.js";
import type { ExecutionApprovalRequest } from "../domain/executionApproval.js";
import { audited, type GovernanceHandlers } from "./governance.js";
import type { ActivatePackageInput } from "./inputs.js";
import type { ExecutionRequestInput, CiteExecutionInput } from "./inputs.js";

/** activatePackage: installed package -> activation (machine 3). */
export function handleActivatePackage(
  scope: MarketplaceTenantScope,
  input: ActivatePackageInput,
  deps: GovernanceHandlers,
): Result<PackageActivation, MarketplaceError> {
  const shapeIssues = [
    ...activationIssues({
      activationId: input.activationId,
      actorRefs: input.actorRefs,
      grants: input.grants,
    }),
    ...marketplaceProvenanceIssues(input.provenance),
  ];
  if (shapeIssues.length > 0) return err(marketplaceValidationError(shapeIssues));
  const existingActivation = deps.governance.getActivation(scope, input.activationId);
  if (existingActivation.ok) {
    return err(marketplaceConflict(`activation ${input.activationId} already exists in tenant`));
  }
  const fetchedInstallation = deps.governance.getInstallation(scope, input.installationId);
  if (!fetchedInstallation.ok) return fetchedInstallation;
  const activated = activateInstallation({
    scope,
    installation: fetchedInstallation.value,
    existingActivations: deps.governance.listActivations(scope),
    activationId: input.activationId,
    actorRefs: input.actorRefs,
    grants: input.grants,
    activatedBy: input.activatedBy,
    provenance: input.provenance,
    now: input.now,
  });
  if (!activated.ok) return activated;
  const put = deps.governance.putActivation(activated.value);
  if (!put.ok) return put;
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "activation", id: input.activationId },
    "marketplace.package-activated",
    input.activatedBy,
    input.now,
    `activated ${fetchedInstallation.value.packageId} v${fetchedInstallation.value.installedVersion}`,
    {
      installationId: input.installationId,
      actorRefs: input.actorRefs,
      grants: input.grants,
    },
  );
  if (!auditRef.ok) return auditRef;
  return ok(activated.value);
}

/** deactivateActivation: activated -> deactivated (terminal). */
export function handleDeactivateActivation(
  scope: MarketplaceTenantScope,
  input: { activationId: string; actor: MarketplaceActorReference; reason: string; now: number },
  deps: GovernanceHandlers,
): Result<PackageActivation, MarketplaceError> {
  const fetched = deps.governance.getActivation(scope, input.activationId);
  if (!fetched.ok) return fetched;
  const deactivated = deactivateActivation(fetched.value, input.now);
  if (!deactivated.ok) return deactivated;
  const put = deps.governance.putActivation(deactivated.value);
  if (!put.ok) return put;
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "activation", id: input.activationId },
    "marketplace.package-deactivated",
    input.actor,
    input.now,
    input.reason,
    { installationId: fetched.value.installationId },
  );
  if (!auditRef.ok) return auditRef;
  return ok(deactivated.value);
}

/** requestExecutionUse: open a citation request (machine 4 PROPOSE). */
export function handleRequestExecutionUse(
  scope: MarketplaceTenantScope,
  input: ExecutionRequestInput,
  deps: GovernanceHandlers,
): Result<ExecutionApprovalRequest, MarketplaceError> {
  const provenanceIssues = marketplaceProvenanceIssues(input.provenance);
  if (provenanceIssues.length > 0) return err(marketplaceValidationError(provenanceIssues));
  const existingRequest = deps.governance.getExecutionRequest(scope, input.requestId);
  if (existingRequest.ok) {
    return err(marketplaceConflict(`execution request ${input.requestId} already exists in tenant`));
  }
  const fetchedActivation = deps.governance.getActivation(scope, input.activationId);
  if (!fetchedActivation.ok) return fetchedActivation;
  const request = openExecutionRequest({
    scope,
    activation: fetchedActivation.value,
    requestId: input.requestId,
    consumerRef: input.consumerRef,
    purpose: input.purpose,
    requestedBy: input.requestedBy,
    provenance: input.provenance,
    now: input.now,
  });
  if (!request.ok) return request;
  const put = deps.governance.putExecutionRequest(request.value);
  if (!put.ok) return put;
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "execution-request", id: input.requestId },
    "marketplace.execution-requested",
    input.requestedBy,
    input.now,
    input.purpose,
    { activationId: input.activationId, consumerRef: input.consumerRef },
  );
  if (!auditRef.ok) return auditRef;
  return ok(request.value);
}

/**
 * citeExecutionApproval: record the W002-seam citation (machine 4
 * DISPOSE). The authority port is asserted FIRST — a refused citation
 * leaves the request in `requested` state (runtime proof: activation
 * grants nothing without the approval seam). Nothing is executed.
 */
export function handleCiteExecutionApproval(
  scope: MarketplaceTenantScope,
  input: CiteExecutionInput,
  deps: GovernanceHandlers,
): Result<ExecutionApprovalRequest, MarketplaceError> {
  const fetchedRequest = deps.governance.getExecutionRequest(scope, input.requestId);
  if (!fetchedRequest.ok) return fetchedRequest;
  const fetchedActivation = deps.governance.getActivation(
    scope,
    fetchedRequest.value.activationId,
  );
  if (!fetchedActivation.ok) return fetchedActivation;
  if (fetchedActivation.value.state !== "activated") {
    return err(
      marketplaceLifecycleIllegal(
        "execution-approval",
        fetchedActivation.value.state,
        "cited",
      ),
    );
  }
  const assertion = deps.authority.assertAuthorityCitation(scope, input.citation);
  if (!assertion.ok) return assertion;
  const cited = citeExecutionApproval(fetchedRequest.value, input.citation, input.now);
  if (!cited.ok) return cited;
  const put = deps.governance.putExecutionRequest(cited.value);
  if (!put.ok) return put;
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "execution-request", id: input.requestId },
    "marketplace.execution-cited",
    input.citation.approvedBy,
    input.now,
    `W002 citation recorded for ${input.requestId}`,
    {
      actionId: assertion.value.actionId,
      auditRef: assertion.value.auditRef,
      activationId: fetchedRequest.value.activationId,
    },
  );
  if (!auditRef.ok) return auditRef;
  return ok(cited.value);
}

/** withdrawExecutionRequest: requested -> withdrawn (terminal). */
export function handleWithdrawExecutionRequest(
  scope: MarketplaceTenantScope,
  input: { requestId: string; actor: MarketplaceActorReference; reason: string; now: number },
  deps: GovernanceHandlers,
): Result<ExecutionApprovalRequest, MarketplaceError> {
  const fetched = deps.governance.getExecutionRequest(scope, input.requestId);
  if (!fetched.ok) return fetched;
  const withdrawn = withdrawExecutionRequest(fetched.value);
  if (!withdrawn.ok) return withdrawn;
  const put = deps.governance.putExecutionRequest(withdrawn.value);
  if (!put.ok) return put;
  const auditRef = audited(
    scope,
    deps.audit,
    { kind: "execution-request", id: input.requestId },
    "marketplace.execution-withdrawn",
    input.actor,
    input.now,
    input.reason,
    { activationId: fetched.value.activationId },
  );
  if (!auditRef.ok) return auditRef;
  return ok(withdrawn.value);
}
