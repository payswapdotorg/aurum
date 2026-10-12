/**
 * Bridge from the @aurum/provider public facade to the agent fabric's
 * ProviderBindingLookupPort.
 *
 * This is the ONLY place in @aurum/agent that imports @aurum/provider, and
 * it imports strictly through the package's public entrypoint (never a
 * deep path), as required by architecture-policy.yaml and the work order.
 * Provider-fabric errors are mapped uniformly: a missing or foreign-tenant
 * binding (BINDING_NOT_FOUND) and an inactive binding both resolve to
 * `null` — no existence leakage across tenants.
 *
 * CR-W003 (canonical TenantId adoption): both packages now carry the SAME
 * canonical TenantId from @aurum/domain, so the tenant id passes straight
 * through to the provider fabric — no cast, no brand reconciliation.
 */
import type { ProviderFabric, ProviderFabricError } from "@aurum/provider";
import type { ModelBindingSnapshot, ProviderBindingLookupPort } from "../domain/provider-lookup.js";
import type { TenantId } from "../domain/ids.js";

export class ProviderFabricBindingLookup implements ProviderBindingLookupPort {
  constructor(private readonly fabric: ProviderFabric) {}

  async getActiveModelBinding(
    tenantId: TenantId,
    bindingId: string,
  ): Promise<ModelBindingSnapshot | null> {
    let binding;
    try {
      binding = await this.fabric.bindings.getBinding(tenantId, bindingId);
    } catch (error) {
      if (isProviderFabricNotFound(error)) return null;
      throw error;
    }
    if (binding.status !== "active") return null;
    return {
      id: binding.id,
      purpose: binding.purpose,
      status: binding.status,
      catalogEntryId: binding.catalogEntryId,
    };
  }
}

function isProviderFabricNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as ProviderFabricError).name === "ProviderFabricError" &&
    (error as ProviderFabricError).notFound === true
  );
}
