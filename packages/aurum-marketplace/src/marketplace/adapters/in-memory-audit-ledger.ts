/**
 * In-memory audit ledger (W011 adapter): the audit port double with
 * sequential deterministic `audit-N` refs. Every governance transition
 * appends exactly one entry (the audit-completeness proof reads this back
 * tenant-scoped). Persistence is the TL-tracked P-series debt.
 */
import { err, ok, type Result } from "../domain/primitives.js";
import type { MarketplaceActorReference, MarketplaceTenantScope } from "../domain/primitives.js";
import { marketplaceConflict } from "../domain/errors.js";
import type { MarketplaceError } from "../domain/errors.js";
import type { MarketplaceAuditPort, MarketplaceAuditRecord } from "../domain/ports.js";

export class InMemoryMarketplaceAuditLedger implements MarketplaceAuditPort {
  private readonly records: MarketplaceAuditRecord[] = [];
  private counter = 0;

  append(
    scope: MarketplaceTenantScope,
    entry: {
      readonly subject: { readonly kind: string; readonly id: string };
      readonly action: string;
      readonly actor: MarketplaceActorReference;
      readonly at: number;
      readonly reason: string;
      readonly details?: unknown;
    },
  ): Result<{ readonly auditRef: string }, MarketplaceError> {
    if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      return err(marketplaceConflict("audit reason must be non-empty"));
    }
    this.counter += 1;
    const auditRef = `audit-${this.counter}`;
    this.records.push({
      auditRef,
      scope,
      subject: entry.subject,
      action: entry.action,
      actor: entry.actor,
      at: entry.at,
      reason: entry.reason.trim(),
      ...(entry.details !== undefined ? { details: entry.details } : {}),
    });
    return ok({ auditRef });
  }

  listAudit(scope: MarketplaceTenantScope): readonly MarketplaceAuditRecord[] {
    return this.records.filter((record) => record.scope.tenantId === scope.tenantId);
  }

  /** Test hook: all entries regardless of tenant (isolation proofs). */
  allEntries(): readonly MarketplaceAuditRecord[] {
    return this.records;
  }
}

export function createInMemoryMarketplaceAuditLedger(): InMemoryMarketplaceAuditLedger {
  return new InMemoryMarketplaceAuditLedger();
}
