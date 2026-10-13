/**
 * In-memory emergence proposal store (W014 adapter): the emergence area's
 * own truth for proposal records, tenant-scoped with closed-failure
 * semantics (foreign-tenant ≡ missing — byte-identical not-found). A
 * terminal (accepted/declined) record refuses overwrites (typed conflict):
 * reviews are append-only outcomes, never rewrites. Persistence is the
 * TL-tracked P-series debt (README.md).
 */
import { err, ok, type Result } from "../../marketplace/contract.marketplace.js";
import type { MarketplaceTenantScope } from "../../marketplace/contract.marketplace.js";
import { emergenceConflict, emergenceNotFound } from "../domain/errors.js";
import type { EmergenceError } from "../domain/errors.js";
import type { EmergenceProposalStore } from "../domain/ports.js";
import type { EmergenceProposal } from "../domain/proposals.js";

export class InMemoryEmergenceProposalStore implements EmergenceProposalStore {
  private readonly proposals = new Map<string, EmergenceProposal>();

  private static key(scope: MarketplaceTenantScope, proposalId: string): string {
    return `${scope.tenantId}::${proposalId}`;
  }

  putProposal(record: EmergenceProposal): Result<EmergenceProposal, EmergenceError> {
    const key = InMemoryEmergenceProposalStore.key(record.scope, record.proposalId);
    const existing = this.proposals.get(key);
    if (existing && existing.state !== "proposed" && record.state === "proposed") {
      return err(
        emergenceConflict(
          `emergence proposal ${record.proposalId} is already ${existing.state} (terminal — reviews are never rewritten)`,
        ),
      );
    }
    this.proposals.set(key, record);
    return ok(record);
  }

  getProposal(
    scope: MarketplaceTenantScope,
    proposalId: string,
  ): Result<EmergenceProposal, EmergenceError> {
    const record = this.proposals.get(InMemoryEmergenceProposalStore.key(scope, proposalId));
    if (!record) return err(emergenceNotFound("emergence proposal"));
    return ok(record);
  }

  listProposals(scope: MarketplaceTenantScope): readonly EmergenceProposal[] {
    return [...this.proposals.values()]
      .filter((record) => record.scope.tenantId === scope.tenantId)
      .sort((a, b) => a.proposalId.localeCompare(b.proposalId));
  }
}

export function createInMemoryEmergenceProposalStore(): InMemoryEmergenceProposalStore {
  return new InMemoryEmergenceProposalStore();
}
