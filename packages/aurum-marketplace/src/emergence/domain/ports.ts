/**
 * Emergence ports (W014 domain layer): the narrow seams the emergence area
 * consumes — the W013 evidence INTAKE (read-only, structural), READ PICKS
 * of the W011 marketplace surfaces (catalog versions + open recruitments —
 * the alternatives sources), the shared append-only audit port, and the
 * emergence area's OWN proposal store.
 *
 * READ-ONLY LAW: the W011 picks contain NO mutation methods (no put*, no
 * publication/installation/activation transitions). The emergence area's
 * only writes are its OWN proposal records + audit appends — it performs
 * ZERO catalog writes (the propose/never-publish law, R6/R7; tripwire in
 * test/emergence-tripwires.test.ts).
 *
 * The W013 intake port is the cross-package seam filed as
 * spec/contract-requests/CR-W014-emergence-evidence-wiring.md: the
 * composition that owns the learning service implements it (a REAL
 * OutcomeJoinRecord is structurally assignable to the intake shape — no
 * mapping code); tests use the deterministic in-memory double.
 */
import type { Result } from "../../marketplace/contract.marketplace.js";
import type {
  MarketplaceAuditPort,
  MarketplaceCatalogStore,
  MarketplaceGovernanceStore,
  MarketplaceTenantScope,
} from "../../marketplace/contract.marketplace.js";
import type { EmergenceOutcomeEvidence, EmergenceUnknownSignal } from "./evidence.js";
import type { EmergenceProposal } from "./proposals.js";
import type { EmergenceError } from "./errors.js";

/**
 * The W013 evidence intake (read-only, tenant-scoped). Returns the
 * tenant's outcome-join evidence and cognition unknown signals in the
 * structural mirror shapes — verbatim carried keys (contextClassKey,
 * demandSignature, shapeKey), never re-derived.
 */
export interface EmergenceEvidencePort {
  listOutcomeEvidence(scope: MarketplaceTenantScope): readonly EmergenceOutcomeEvidence[];
  listUnknownSignals(scope: MarketplaceTenantScope): readonly EmergenceUnknownSignal[];
}

/** The emergence area's own proposal store (tenant-scoped, closed-failure). */
export interface EmergenceProposalStore {
  putProposal(record: EmergenceProposal): Result<EmergenceProposal, EmergenceError>;
  getProposal(
    scope: MarketplaceTenantScope,
    proposalId: string,
  ): Result<EmergenceProposal, EmergenceError>;
  listProposals(scope: MarketplaceTenantScope): readonly EmergenceProposal[];
}

/** Dependencies of the emergence service factory (reads + own store + audit). */
export interface EmergenceServiceDeps {
  readonly evidence: EmergenceEvidencePort;
  readonly proposals: EmergenceProposalStore;
  /** READ pick: the tenant's catalog versions (alternatives derivation). */
  readonly catalog: Pick<MarketplaceCatalogStore, "listVersions">;
  /** READ pick: the tenant's recruitment requests (alternatives derivation). */
  readonly recruitments: Pick<MarketplaceGovernanceStore, "listRecruitments">;
  /** The shared append-only audit port (one entry per transition). */
  readonly audit: MarketplaceAuditPort;
}
