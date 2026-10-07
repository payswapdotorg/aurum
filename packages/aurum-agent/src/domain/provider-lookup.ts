/**
 * Provider lookup port: the ONLY thing the agent fabric needs from the
 * provider fabric at the domain level. Deliberately structural and
 * provider-agnostic — no @aurum/provider types cross into agent domain
 * logic; the adapter (adapters/provider-fabric-lookup.ts) bridges the
 * public @aurum/provider facade to this port.
 */
import type { TenantId } from "./ids.js";

/** Minimal structural snapshot of a provider ModelBinding. */
export interface ModelBindingSnapshot {
  readonly id: string;
  readonly purpose: string;
  readonly status: "active" | "superseded";
  readonly catalogEntryId: string;
}

export interface ProviderBindingLookupPort {
  /**
   * Resolve a ModelBinding for a tenant. Returns the snapshot when the
   * binding exists AND is active; null when it is missing, foreign-tenant
   * or no longer active (uniformly, without existence leakage).
   */
  getActiveModelBinding(
    tenantId: TenantId,
    bindingId: string,
  ): Promise<ModelBindingSnapshot | null>;
}
