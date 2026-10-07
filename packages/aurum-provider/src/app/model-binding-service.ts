/**
 * Model binding application service: the tenant's explicit model selection.
 *
 * APPEND-ONLY LAW: selectModel supersedes the previous active binding and
 * appends a new one — records are never hard-deleted. Exactly one binding
 * is active per (tenant, purpose) at any moment. Re-selecting the model
 * that is already active is an idempotent no-op (no audit spam).
 */
import type { Clock, IdGenerator } from "../domain/ports.js";
import type { ProviderFabricStore } from "../domain/stores.js";
import { notFound } from "../domain/errors.js";
import {
  buildActiveBinding,
  bindingTimeline,
  supersedeActiveBinding,
  validatePurpose,
  type ModelBinding,
  type ModelBindingPurpose,
} from "../domain/model-binding.js";
import { buildEvidence } from "../domain/provider-evidence.js";
import type { TenantId } from "../domain/ids.js";

export interface ModelBindingDeps {
  readonly store: ProviderFabricStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface SelectionResult {
  /** The binding that was active before this call (null when none). */
  readonly superseded: ModelBinding | null;
  /** The active binding after this call. */
  readonly active: ModelBinding;
}

export class ModelBindingService {
  constructor(private readonly deps: ModelBindingDeps) {}

  async selectModel(
    tenantId: TenantId,
    purpose: ModelBindingPurpose,
    catalogEntryId: string,
    options?: { readonly reason?: string },
  ): Promise<SelectionResult> {
    const validPurpose = validatePurpose(purpose);
    const entry = await this.deps.store.catalog.getById(tenantId, catalogEntryId);
    if (entry === null) {
      throw notFound("CATALOG_ENTRY_NOT_FOUND", `catalog entry ${catalogEntryId}`);
    }
    const current = await this.deps.store.bindings.findActiveByPurpose(tenantId, validPurpose);
    if (current !== null && current.catalogEntryId === entry.id) {
      // Idempotent re-selection: keep the audit trail clean.
      return { superseded: null, active: current };
    }
    const now = this.deps.clock.now();
    const newId = this.deps.ids.next();
    const next = buildActiveBinding(tenantId, validPurpose, entry.id, { id: newId, now });
    let previous: ModelBinding | null = null;
    if (current !== null) {
      previous = supersedeActiveBinding(current, next.id, options?.reason, now);
      await this.deps.store.bindings.put(tenantId, previous);
    }
    await this.deps.store.bindings.put(tenantId, next);
    await this.deps.store.evidence.append(
      tenantId,
      buildEvidence(
        tenantId,
        {
          kind: "lifecycle",
          subject: { kind: "model-catalog-entry", catalogEntryId: entry.id },
          outcome: "success",
          detail:
            previous === null
              ? `model selected for purpose ${validPurpose}`
              : `model selection superseded for purpose ${validPurpose}`,
        },
        { id: this.deps.ids.next(), now: this.deps.clock.now() },
      ),
    );
    return { superseded: previous, active: next };
  }

  /** Supersede the active binding for a purpose without a successor. */
  async clearBinding(
    tenantId: TenantId,
    purpose: ModelBindingPurpose,
    reason?: string,
  ): Promise<ModelBinding | null> {
    const validPurpose = validatePurpose(purpose);
    const current = await this.deps.store.bindings.findActiveByPurpose(tenantId, validPurpose);
    if (current === null) return null;
    const superseded = supersedeActiveBinding(current, null, reason, this.deps.clock.now());
    await this.deps.store.bindings.put(tenantId, superseded);
    return superseded;
  }

  async getActiveBinding(
    tenantId: TenantId,
    purpose: ModelBindingPurpose,
  ): Promise<ModelBinding | null> {
    const validPurpose = validatePurpose(purpose);
    return this.deps.store.bindings.findActiveByPurpose(tenantId, validPurpose);
  }

  async getBinding(tenantId: TenantId, bindingId: string): Promise<ModelBinding> {
    const binding = await this.deps.store.bindings.getById(tenantId, bindingId);
    if (binding === null) {
      throw notFound("BINDING_NOT_FOUND", `model binding ${bindingId}`);
    }
    return binding;
  }

  async listBindingHistory(
    tenantId: TenantId,
    purpose: ModelBindingPurpose,
  ): Promise<readonly ModelBinding[]> {
    const validPurpose = validatePurpose(purpose);
    return bindingTimeline(await this.deps.store.bindings.listByPurpose(tenantId, validPurpose));
  }
}
