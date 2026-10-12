/**
 * Machine 4 — EXECUTION APPROVAL (W011 domain layer): the citation ledger
 * for an activated package's use. requested -> cited | withdrawn.
 *
 * THE MARKETPLACE NEVER EXECUTES (constitution: "marketplace bypass" is an
 * architecture-review trigger; catalog: "approval is separate from
 * execution"). This machine PROPOSES (`requestExecutionUse` records a
 * request) and RECORDS the DISPOSE (`citeExecutionApproval` records the
 * W002-seam citation the consumer brought back) — there is no operation
 * anywhere in this package that runs, submits, invokes or dispatches a
 * package. The `cited` record is the input the W009 plan/execution plane
 * consumes through ITS OWN approval seam.
 *
 * SEPARATION LAW 4 (approval is separate from execution): the citation
 * must be ASSERTED against the W002 action-authority seam (the
 * `MarketplaceAuthorityPort`, app layer) BEFORE the domain transition
 * applies — an unasserted or refused citation leaves the request in
 * `requested` state with a typed `marketplace-unauthorized` error.
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
  marketplaceLifecycleIllegal,
  marketplaceUnauthorized,
} from "./errors.js";
import type { MarketplaceError } from "./errors.js";
import { executionRequestTransitionLegal } from "./vocabulary.js";
import type { PackageActivation } from "./activation.js";

/**
 * The W002-shaped authority citation (structurally compatible with the
 * kernel's action-authority citation and W009's PlanApprovalCitation):
 * an action id and/or an audit ref, plus the human decider identity.
 */
export interface AuthorityCitation {
  readonly actionId?: string;
  readonly auditRef?: string;
  readonly approvedBy: MarketplaceActorReference;
  readonly approvedAt: MarketplaceTimestamp;
}

/** One execution-use request against an activation (machine 4 record). */
export interface ExecutionApprovalRequest extends MarketplaceTenantScopedRecord {
  readonly requestId: string;
  readonly activationId: string;
  /** Opaque consumer reference (e.g. a W009 plan id) — by reference only. */
  readonly consumerRef: string;
  /** Why the consumer wants to use the activated package. */
  readonly purpose: string;
  readonly state: "requested" | "cited" | "withdrawn";
  readonly requestedBy: MarketplaceActorReference;
  readonly requestedAt: MarketplaceTimestamp;
  /** Present iff state === "cited": the recorded W002-seam citation. */
  readonly citation?: AuthorityCitation;
  readonly citedAt?: MarketplaceTimestamp;
  readonly provenance: MarketplaceProvenanceStamp;
}

/**
 * Opens an execution-use request. PROPOSING only: no authority is required
 * to request (the dispose happens at citation time), but the target
 * activation must be in `activated` state in the requesting tenant.
 */
export function openExecutionRequest(input: {
  readonly scope: MarketplaceTenantScope;
  readonly activation: PackageActivation | undefined;
  readonly requestId: string;
  readonly consumerRef: string;
  readonly purpose: string;
  readonly requestedBy: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
}): Result<ExecutionApprovalRequest, MarketplaceError> {
  const activation = input.activation;
  if (!activation || activation.state !== "activated") {
    return err(
      marketplaceLifecycleIllegal(
        "execution-approval",
        activation?.state ?? "missing",
        "requested",
      ),
    );
  }
  return ok(
    deepFreezeMarketplace({
      scope: input.scope,
      requestId: input.requestId,
      activationId: activation.activationId,
      consumerRef: input.consumerRef,
      purpose: input.purpose,
      state: "requested" as const,
      requestedBy: input.requestedBy,
      requestedAt: input.now,
      provenance: input.provenance,
    }),
  );
}

/**
 * Records the W002-seam citation on a request: requested -> cited. The
 * citation has ALREADY been asserted against the authority port by the app
 * layer (closed-failure: a refused citation never reaches this function);
 * the domain still validates the citation's own shape — approvedBy must be
 * a person (approval authority is human) and actionId/auditRef may not
 * both be absent.
 */
export function citeExecutionApproval(
  request: ExecutionApprovalRequest,
  citation: AuthorityCitation,
  at: MarketplaceTimestamp,
): Result<ExecutionApprovalRequest, MarketplaceError> {
  if (!executionRequestTransitionLegal(request.state, "cited")) {
    return err(marketplaceLifecycleIllegal("execution-approval", request.state, "cited"));
  }
  if (citation.approvedBy.kind !== "person") {
    return err(marketplacePersonRequired());
  }
  if (!citation.actionId && !citation.auditRef) {
    return err(marketplaceCitationRequired());
  }
  return ok(
    deepFreezeMarketplace({
      ...request,
      state: "cited" as const,
      citation,
      citedAt: at,
    }),
  );
}

/** requested -> withdrawn (terminal). */
export function withdrawExecutionRequest(
  request: ExecutionApprovalRequest,
): Result<ExecutionApprovalRequest, MarketplaceError> {
  if (!executionRequestTransitionLegal(request.state, "withdrawn")) {
    return err(marketplaceLifecycleIllegal("execution-approval", request.state, "withdrawn"));
  }
  return ok(deepFreezeMarketplace({ ...request, state: "withdrawn" as const }));
}

function marketplacePersonRequired(): MarketplaceError {
  return marketplaceUnauthorized(
    "execution citations must be approved by a person actor (W002 authority law)",
  );
}

function marketplaceCitationRequired(): MarketplaceError {
  return marketplaceUnauthorized(
    "an execution citation must carry an actionId and/or an auditRef",
  );
}
