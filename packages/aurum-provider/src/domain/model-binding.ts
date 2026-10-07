/**
 * Concern 5 of 8 — ModelBinding: the tenant's EXPLICIT selection of a model
 * for a purpose.
 *
 * Bindings are APPEND-ONLY audit records: supersede, never hard-delete.
 * Selecting a new model for a purpose marks the previous active binding as
 * superseded (recording its successor) and appends a new active binding.
 * Exactly ONE binding is active per (tenant, purpose) at any time.
 *
 * A binding references a catalog entry — which is a LISTING fact, not an
 * availability fact. Evaluating whether the bound model is usable NOW is the
 * availability concern's job.
 */
import {
  asModelBindingId,
  type ModelBindingId,
  type ModelCatalogEntryId,
  type TenantId,
} from "./ids.js";
import { sanitizeAndAssertClean } from "./sanitize.js";
import { validationFailed } from "./errors.js";
import type { ModelBindingStatus } from "./vocabulary.js";
import type { RecordBookkeeping, TenantScoped } from "./ports.js";

/**
 * Purpose identifies the slot a binding occupies. Free-form within a tenant
 * (e.g. "cognition", "conversation", "analysis", "background"); the agent
 * package constrains its own body attachments to a closed purpose set on
 * top of this primitive.
 */
export type ModelBindingPurpose = string;

export interface ModelBinding extends TenantScoped, RecordBookkeeping {
  readonly id: ModelBindingId;
  readonly purpose: ModelBindingPurpose;
  readonly catalogEntryId: ModelCatalogEntryId;
  readonly status: ModelBindingStatus;
  /** Successor binding when superseded with a replacement. */
  readonly supersededBy: ModelBindingId | null;
  readonly supersededAt: string | null;
  readonly supersedeReason: string | null;
  readonly selectedAt: string;
}

export function validatePurpose(purpose: string): ModelBindingPurpose {
  const trimmed = purpose.trim();
  if (trimmed.length === 0 || trimmed.length > 64) {
    throw validationFailed("binding purpose must be 1..64 characters");
  }
  if (!/^[\w.-]+$/.test(trimmed)) {
    throw validationFailed("binding purpose may only contain word characters, '.' and '-'");
  }
  return trimmed;
}

/** Build a fresh active binding (the append side of a supersede). */
export function buildActiveBinding(
  tenantId: TenantId,
  purpose: ModelBindingPurpose,
  catalogEntryId: string,
  deps: { id: string; now: string },
): ModelBinding {
  return {
    id: asModelBindingId(deps.id),
    tenantId,
    purpose,
    catalogEntryId: catalogEntryId as ModelCatalogEntryId,
    status: "active",
    supersededBy: null,
    supersededAt: null,
    supersedeReason: null,
    selectedAt: deps.now,
    createdAt: deps.now,
    updatedAt: deps.now,
  };
}

/**
 * Mark an active binding superseded. Returns a NEW record — the original
 * row is never mutated in place beyond this explicit append-only rewrite,
 * and never removed.
 */
export function supersedeActiveBinding(
  binding: ModelBinding,
  successor: ModelBindingId | null,
  reason: string | undefined,
  at: string,
): ModelBinding {
  if (binding.status !== "active") {
    throw validationFailed(`only active bindings can be superseded, found ${binding.status}`);
  }
  return {
    ...binding,
    status: "superseded",
    supersededBy: successor,
    supersededAt: at,
    supersedeReason: reason === undefined ? null : sanitizeAndAssertClean(reason),
    updatedAt: at,
  };
}

/** Audit view over a purpose's binding timeline (oldest first). */
export function bindingTimeline(bindings: readonly ModelBinding[]): readonly ModelBinding[] {
  return [...bindings].sort((a, b) =>
    `${a.selectedAt}${a.id}`.localeCompare(`${b.selectedAt}${b.id}`),
  );
}

export function isActiveBinding(binding: ModelBinding): boolean {
  return binding.status === "active";
}
