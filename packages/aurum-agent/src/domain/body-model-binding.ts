/**
 * BodyModelBinding: the append-only attachment between an Agent Body and a
 * provider ModelBinding, for one of the four closed purposes.
 *
 * THE IDENTITY LAW: attaching or swapping a model NEVER writes the body
 * record — not its facets and not its updatedAt. A swap supersedes the old
 * attachment (recording the successor) and appends a new one; body
 * identity, memory policy, goals, evidence and permissions are untouched.
 * The body itself NEVER invokes models: these records reference a
 * ModelBinding; execution authority lives in the execution plane.
 */
import { sanitizeAndAssertClean } from "@aurum/provider";
import type { AgentBodyId, BodyModelBindingId, TenantId } from "./ids.js";
import { validationFailed } from "./errors.js";
import type { BodyModelBindingStatus, BodyModelPurpose } from "./vocabulary.js";
import type { RecordBookkeeping, TenantScoped } from "./ports.js";

export interface BodyModelBinding extends TenantScoped, RecordBookkeeping {
  readonly id: BodyModelBindingId;
  readonly bodyId: AgentBodyId;
  readonly purpose: BodyModelPurpose;
  /** Reference to an ACTIVE @aurum/provider ModelBinding. */
  readonly modelBindingRef: string;
  readonly status: BodyModelBindingStatus;
  readonly supersededBy: BodyModelBindingId | null;
  readonly supersededAt: string | null;
  readonly attachedAt: string;
}

export interface AttachModelInput {
  readonly purpose: BodyModelPurpose;
  readonly modelBindingRef: string;
  readonly note?: string;
}

export function buildBodyModelBinding(
  tenantId: TenantId,
  bodyId: AgentBodyId,
  input: AttachModelInput,
  deps: { id: string; now: string },
): BodyModelBinding {
  const note = input.note === undefined ? null : sanitizeAndAssertClean(input.note.trim());
  if (note !== null && note.length > 300) {
    throw validationFailed("attachment note too long (max 300)");
  }
  return {
    id: deps.id as BodyModelBindingId,
    tenantId,
    bodyId,
    purpose: input.purpose,
    modelBindingRef: input.modelBindingRef,
    status: "attached",
    supersededBy: null,
    supersededAt: null,
    attachedAt: deps.now,
    createdAt: deps.now,
    updatedAt: deps.now,
  };
}

export function supersedeBodyModelBinding(
  binding: BodyModelBinding,
  successor: BodyModelBindingId | null,
  at: string,
): BodyModelBinding {
  if (binding.status !== "attached") {
    throw validationFailed(`only attached bindings can be superseded, found ${binding.status}`);
  }
  return {
    ...binding,
    status: "superseded",
    supersededBy: successor,
    supersededAt: at,
    updatedAt: at,
  };
}

/** Attachment history for a body+purpose, oldest first. */
export function attachmentTimeline(
  bindings: readonly BodyModelBinding[],
): readonly BodyModelBinding[] {
  return [...bindings].sort((a, b) =>
    `${a.attachedAt}${a.id}`.localeCompare(`${b.attachedAt}${b.id}`),
  );
}

export function isAttached(binding: BodyModelBinding): boolean {
  return binding.status === "attached";
}
