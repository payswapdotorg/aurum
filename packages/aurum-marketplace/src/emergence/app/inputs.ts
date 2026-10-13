/**
 * Emergence service input types (W014 app layer).
 *
 * The service is a 5-method facade (the W013 learning discipline): one
 * derivation read (detectGaps), two governed commands (propose /
 * reviewProposal) and two record reads (getProposal / listProposals). The
 * catalog-draft projection is deliberately NOT a service method — it is a
 * PURE domain function (`catalogDraftOfProposal`) the promoter invokes
 * with their own authority fields; the emergence surface holds no
 * publication-shaped capability at all (the propose/never-publish law).
 */
import type {
  MarketplaceActorReference,
  MarketplaceProvenanceStamp,
  MarketplaceTimestamp,
} from "../../marketplace/contract.marketplace.js";
import type { EmergenceQuery } from "../domain/gaps.js";
import type { EmergenceGap } from "../domain/gaps.js";
import type {
  EmergencePackageBundle,
  EmergenceProposal,
  EmergenceRoleShape,
} from "../domain/proposals.js";
import type { EmergenceError } from "../domain/errors.js";
import type { Result } from "../../marketplace/contract.marketplace.js";
import type { MarketplaceTenantScope } from "../../marketplace/contract.marketplace.js";

/** Input for proposing a governed role or package from a derived gap. */
export type ProposeEmergenceInput =
  | {
      readonly kind: "role";
      readonly proposalId: string;
      /** The gap this proposal is backed by (re-detected; never trusted from the caller). */
      readonly gapId: string;
      /** The detection query re-run at proposal time (verbatim reproducibility). */
      readonly query: EmergenceQuery;
      readonly roleShape: EmergenceRoleShape;
      readonly proposedBy: MarketplaceActorReference;
      readonly provenance: MarketplaceProvenanceStamp;
      readonly now: MarketplaceTimestamp;
    }
  | {
      readonly kind: "package";
      readonly proposalId: string;
      readonly gapId: string;
      readonly query: EmergenceQuery;
      readonly bundle: EmergencePackageBundle;
      readonly proposedBy: MarketplaceActorReference;
      readonly provenance: MarketplaceProvenanceStamp;
      readonly now: MarketplaceTimestamp;
    };

/** Input for the human-governed review (accept / decline). */
export interface ReviewEmergenceInput {
  readonly proposalId: string;
  readonly decision: "accepted" | "declined";
  /** MUST be a person actor — typed fail-closed refusal otherwise. */
  readonly reviewer: MarketplaceActorReference;
  readonly reason: string;
  readonly now: MarketplaceTimestamp;
}

/** The public emergence service surface (5 methods; policy limit 12). */
export interface EmergenceService {
  /**
   * Derives candidate recurring gaps from the tenant's W013 evidence.
   * PURE over the intake: same evidence + query -> byte-identical gaps.
   */
  detectGaps(
    scope: MarketplaceTenantScope,
    query: EmergenceQuery,
  ): Result<readonly EmergenceGap[], EmergenceError>;
  /**
   * Proposes a governed role/package backed by a CURRENTLY-derived gap
   * (re-detected from evidence — fabricated or stale gap ids are refused).
   * Alternatives are derived mechanically from the marketplace surfaces.
   */
  propose(
    scope: MarketplaceTenantScope,
    input: ProposeEmergenceInput,
  ): Result<EmergenceProposal, EmergenceError>;
  /** The human-governed dispose: accept or decline a PROPOSED proposal. */
  reviewProposal(
    scope: MarketplaceTenantScope,
    input: ReviewEmergenceInput,
  ): Result<EmergenceProposal, EmergenceError>;
  getProposal(
    scope: MarketplaceTenantScope,
    proposalId: string,
  ): Result<EmergenceProposal, EmergenceError>;
  listProposals(scope: MarketplaceTenantScope): readonly EmergenceProposal[];
}
