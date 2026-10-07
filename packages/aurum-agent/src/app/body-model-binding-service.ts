/**
 * Body model attachment application service.
 *
 * THE IDENTITY-FREEZE GUARANTEE: attachModel and detachModel touch ONLY the
 * BodyModelBindingStore. They never read-for-write, mutate or re-put the
 * AgentBody — the body record, its facets and its updatedAt are preserved
 * byte-for-byte across every model swap (test-locked in
 * test/body-model-binding.test.ts). Attachments are append-only: a swap
 * supersedes the previous attachment and appends the next; exactly one
 * attachment is attached per (body, purpose).
 *
 * The referenced provider ModelBinding must resolve ACTIVE through the
 * ProviderBindingLookupPort at attach time; foreign-tenant and missing
 * references are rejected uniformly.
 */
import type { Clock, IdGenerator } from "../domain/ports.js";
import type { AgentFabricStore } from "../domain/stores.js";
import type { ProviderBindingLookupPort } from "../domain/provider-lookup.js";
import { notFound, validationFailed } from "../domain/errors.js";
import type { AgentBody } from "../domain/agent-body.js";
import {
  buildBodyModelBinding,
  supersedeBodyModelBinding,
  attachmentTimeline,
  type AttachModelInput,
  type BodyModelBinding,
} from "../domain/body-model-binding.js";
import { isBodyModelPurpose, type BodyModelPurpose } from "../domain/vocabulary.js";
import type { TenantId } from "../domain/ids.js";

export interface BodyModelBindingDeps {
  readonly store: AgentFabricStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly bindingLookup: ProviderBindingLookupPort;
}

export interface AttachResult {
  /** The attachment that was attached before this call (null when none). */
  readonly superseded: BodyModelBinding | null;
  /** The attached binding after this call. */
  readonly attached: BodyModelBinding;
  /** The body, UNTOUCHED — returned read-only for caller convenience. */
  readonly body: AgentBody;
}

export class BodyModelBindingService {
  constructor(private readonly deps: BodyModelBindingDeps) {}

  async attachModel(
    tenantId: TenantId,
    bodyId: string,
    input: AttachModelInput,
  ): Promise<AttachResult> {
    if (!isBodyModelPurpose(input.purpose)) {
      throw validationFailed(`unknown body model purpose: ${input.purpose}`);
    }
    const body = await this.deps.store.bodies.getById(tenantId, bodyId);
    if (body === null) {
      throw notFound("BODY_NOT_FOUND", `agent body ${bodyId}`);
    }
    if (body.lifecycle.state !== "active") {
      throw validationFailed("retired bodies cannot attach models");
    }
    // The referenced provider binding must be visible AND active for this
    // tenant. Foreign/missing references resolve to null uniformly.
    const snapshot = await this.deps.bindingLookup.getActiveModelBinding(
      tenantId,
      input.modelBindingRef,
    );
    if (snapshot === null) {
      throw validationFailed(
        `model binding ${input.modelBindingRef} is not an active binding for this tenant`,
      );
    }
    const purpose: BodyModelPurpose = input.purpose;
    const current = await this.deps.store.modelBindings.findAttachedByPurpose(
      tenantId,
      bodyId,
      purpose,
    );
    if (current !== null && current.modelBindingRef === input.modelBindingRef) {
      // Idempotent re-attachment of the same reference: no audit spam, no
      // body write, no new row.
      return { superseded: null, attached: current, body };
    }
    const now = this.deps.clock.now();
    const next = buildBodyModelBinding(tenantId, body.id, input, {
      id: this.deps.ids.next(),
      now,
    });
    let previous: BodyModelBinding | null = null;
    if (current !== null) {
      previous = supersedeBodyModelBinding(current, next.id, now);
      await this.deps.store.modelBindings.put(tenantId, previous);
    }
    await this.deps.store.modelBindings.put(tenantId, next);
    // Deliberately NO store.bodies write here: the body must not change.
    return { superseded: previous, attached: next, body };
  }

  /** Detach the attached binding for a purpose (supersede, never delete). */
  async detachModel(
    tenantId: TenantId,
    bodyId: string,
    purpose: BodyModelPurpose,
  ): Promise<BodyModelBinding | null> {
    if (!isBodyModelPurpose(purpose)) {
      throw validationFailed(`unknown body model purpose: ${purpose}`);
    }
    const current = await this.deps.store.modelBindings.findAttachedByPurpose(
      tenantId,
      bodyId,
      purpose,
    );
    if (current === null) return null;
    const superseded = supersedeBodyModelBinding(current, null, this.deps.clock.now());
    await this.deps.store.modelBindings.put(tenantId, superseded);
    return superseded;
  }

  async getAttachment(tenantId: TenantId, bindingId: string): Promise<BodyModelBinding> {
    const binding = await this.deps.store.modelBindings.getById(tenantId, bindingId);
    if (binding === null) {
      throw notFound("BODY_MODEL_BINDING_NOT_FOUND", `body model binding ${bindingId}`);
    }
    return binding;
  }

  async currentAttachment(
    tenantId: TenantId,
    bodyId: string,
    purpose: BodyModelPurpose,
  ): Promise<BodyModelBinding | null> {
    return this.deps.store.modelBindings.findAttachedByPurpose(tenantId, bodyId, purpose);
  }

  async attachmentHistory(
    tenantId: TenantId,
    bodyId: string,
  ): Promise<readonly BodyModelBinding[]> {
    return attachmentTimeline(await this.deps.store.modelBindings.listByBody(tenantId, bodyId));
  }
}
