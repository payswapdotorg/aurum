/**
 * In-memory W002 authority double (W011 adapter): a deterministic fake of
 * the action-authority seam. Citations the double has been TAUGHT (via
 * `teach`) assert successfully; everything else — missing, foreign-tenant,
 * wrong-state — fails CLOSED as `marketplace-unauthorized` with no
 * existence leaks. The REAL adapter (post-CR-W011) is a thin pass-through
 * to the kernel's ActionAuthority (see
 * adapters/domain-kernel-registration-adapter.ts for the pattern).
 */
import { err, ok, type Result } from "../domain/primitives.js";
import type { MarketplaceTenantScope } from "../domain/primitives.js";
import { marketplaceUnauthorized } from "../domain/errors.js";
import type { MarketplaceError } from "../domain/errors.js";
import type { MarketplaceAuthorityPort } from "../domain/ports.js";
import type { AuthorityCitation } from "../domain/executionApproval.js";

export interface TaughtCitation {
  readonly tenantId: string;
  readonly actionId?: string;
  readonly auditRef?: string;
  readonly approvedBy: { readonly kind: string; readonly personId?: string; readonly name?: string };
}

/** One assertion attempt, for the runtime separation proofs. */
export interface AuthorityAssertionLogEntry {
  readonly tenantId: string;
  readonly citation: AuthorityCitation;
  readonly accepted: boolean;
}

export class InMemoryAuthorityDouble implements MarketplaceAuthorityPort {
  private readonly taught = new Map<string, TaughtCitation>();
  private readonly logged: AuthorityAssertionLogEntry[] = [];

  constructor(taught: readonly TaughtCitation[] = []) {
    for (const citation of taught) this.teach(citation);
  }

  /** Teaches the double one valid citation (tenant-scoped). */
  teach(citation: TaughtCitation): void {
    const key = InMemoryAuthorityDouble.keyOf(citation);
    this.taught.set(key, citation);
  }

  private static keyOf(citation: {
    tenantId: string;
    actionId?: string;
    auditRef?: string;
  }): string {
    return `${citation.tenantId}::${citation.actionId ?? "-"}::${citation.auditRef ?? "-"}`;
  }

  assertAuthorityCitation(
    scope: MarketplaceTenantScope,
    citation: AuthorityCitation,
  ): Result<{ readonly actionId?: string; readonly auditRef?: string }, MarketplaceError> {
    const key = InMemoryAuthorityDouble.keyOf({ tenantId: scope.tenantId, ...citation });
    const known = this.taught.get(key);
    const accepted = known !== undefined;
    this.logged.push({ tenantId: scope.tenantId, citation, accepted });
    if (!accepted) {
      return err(
        marketplaceUnauthorized(
          "authority citation is not valid in this tenant (closed failure)",
        ),
      );
    }
    return ok({
      ...(citation.actionId !== undefined ? { actionId: citation.actionId } : {}),
      ...(citation.auditRef !== undefined ? { auditRef: citation.auditRef } : {}),
    });
  }

  /** Read-back for proofs: every assertion attempt. */
  assertions(): readonly AuthorityAssertionLogEntry[] {
    return this.logged;
  }
}

export function createInMemoryAuthorityDouble(
  taught?: readonly TaughtCitation[],
): InMemoryAuthorityDouble {
  return new InMemoryAuthorityDouble(taught);
}
