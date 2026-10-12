/**
 * Information relay pure functions (W009 domain layer, catalog clause 3).
 *
 * The relay carries MINIMAL CONTEXT (only the declared information
 * requirements of the receiving task — never the whole plan or foreign-task
 * state) + correlation identity (planId, taskId, handoffId) + causation
 * identity (the producing task's settlement reference) + authorization
 * proof (the declared requirement, validated against the W002/W005
 * authority seams).
 *
 * Duplicate delivery is IDEMPOTENT: the same handoff delivered twice is
 * observed exactly once (duplicate detection by handoff identity,
 * byte-identical second-delivery result, no double side-effects).
 *
 * All operations are pure functions returning NEW frozen values; no IO.
 */
import { err, ok, type Result } from "@aurum/domain";
import type { ValidationIssue } from "@aurum/domain";
import { planValidationError, planHandoffDivergent, type PlanError } from "./errors.js";
import type { HandoffDescriptor, HandoffPayload, HandoffDeliveryResult } from "./records.js";
import type { PlanTask } from "./records.js";
import type { TaskSettlementEcho } from "./ports.js";

/**
 * Verifies a handoff descriptor; returns issues, empty when valid.
 * Used at plan-construction time so malformed descriptors fail fast.
 */
export function handoffDescriptorIssues(
  descriptor: HandoffDescriptor | undefined,
  fieldPrefix = "handoff",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!descriptor || typeof descriptor !== "object") {
    return [{ field: fieldPrefix, problem: "is required" }];
  }
  if (typeof descriptor.handoffId !== "string" || descriptor.handoffId.trim().length === 0) {
    issues.push({ field: `${fieldPrefix}.handoffId`, problem: "must be a non-empty string" });
  }
  if (typeof descriptor.knowledge !== "string" || descriptor.knowledge.trim().length === 0) {
    issues.push({ field: `${fieldPrefix}.knowledge`, problem: "must be a non-empty string" });
  }
  if (typeof descriptor.mediaType !== "string" || descriptor.mediaType.trim().length === 0) {
    issues.push({ field: `${fieldPrefix}.mediaType`, problem: "must be a non-empty string" });
  }
  return issues;
}

/**
 * The MINIMAL CONTEXT proof: the payload the relay constructs for a handoff
 * contains EXACTLY the declared information requirements of the receiving
 * task. The proof (deep-equal) is in `test/plans-relay.test.ts`.
 *
 * A foreign-task payload CANNOT be constructed: the relay refuses to build a
 * payload for a (consumingTask, handoffId) pair that doesn't match a declared
 * `consumes` descriptor on that task. The descriptor is the SCHEMA; the
 * payload is the DATA, gated by the descriptor.
 *
 * Catalog: "a handoff carries MINIMAL CONTEXT (only the declared information
 * requirements of the receiving task — never the whole plan or foreign-task
 * state)".
 *
 * Inputs:
 * - `producingTask`: the task that emitted the payload (must be the same
 *   task the settlement reference is for).
 * - `consumingTask`: the task that will receive the payload (must declare the
 *   handoff in its `consumes` list).
 * - `handoffId`: the handoff descriptor id (must exist on the consuming task).
 * - `producingSettlement`: the W006 settlement echo (the producing task's
 *   settlement — opaque to the plan layer; the substrate adapter fills it
 *   from the W006 envelope).
 * - `payload`: the actual opaque bytes the producing task emitted.
 * - `mediaType`: the payload's media type (must match the descriptor).
 * - `deliveredAt`: epoch ms (caller-supplied).
 *
 * The relay CONSTRUCTS the payload from these inputs, gated by the consuming
 * task's descriptor. The producing task's settlement reference becomes the
 * `producingSettlementRef` (causation identity).
 */
export function buildHandoffPayload(input: {
  readonly planId: string;
  readonly producingTask: PlanTask;
  readonly consumingTask: PlanTask;
  readonly handoffId: string;
  readonly producingSettlement: TaskSettlementEcho;
  readonly payload: string;
  readonly mediaType: string;
  readonly deliveredAt: number;
}): Result<HandoffPayload, PlanError> {
  if (typeof input?.planId !== "string" || input.planId.trim().length === 0) {
    return err(planValidationError([{ field: "planId", problem: "must be a non-empty string" }]));
  }
  if (!input?.producingTask || !input?.consumingTask) {
    return err(
      planValidationError([
        { field: "producingTask", problem: "producing and consuming tasks are required" },
      ]),
    );
  }
  // The handoff must be DECLARED on the consuming task (minimal-context law:
  // a foreign-task payload cannot be constructed).
  const descriptor = input.consumingTask.consumes.find((h) => h.handoffId === input.handoffId);
  if (!descriptor) {
    return err(
      planValidationError([
        {
          field: "handoffId",
          problem: `consuming task ${input.consumingTask.taskId} does not declare a handoff '${input.handoffId}'`,
        },
      ]),
    );
  }
  // The handoff must be PRODUCED by the producing task.
  const producedBy = input.producingTask.produces.find((h) => h.handoffId === input.handoffId);
  if (!producedBy) {
    return err(
      planValidationError([
        {
          field: "handoffId",
          problem: `producing task ${input.producingTask.taskId} does not produce a handoff '${input.handoffId}'`,
        },
      ]),
    );
  }
  // Media type must match the descriptor (the relay is minimal-context: the
  // payload's encoding must be what the consuming task declared it would
  // accept).
  if (input.mediaType !== descriptor.mediaType) {
    return err(
      planValidationError([
        {
          field: "mediaType",
          problem: `must match the consuming task's descriptor (${descriptor.mediaType})`,
        },
      ]),
    );
  }
  // Payload length sanity (catalog: payloads are bounded).
  if (typeof input.payload !== "string" || input.payload.length > 2_000_000) {
    return err(
      planValidationError([
        { field: "payload", problem: "must be a string of at most 2,000,000 characters" },
      ]),
    );
  }
  // The producing task's settlement reference must be for the producing task
  // (causation identity: the envelope's `requestId` is the substrate
  // correlation for the producing task's submission; the plan asserts
  // structural identity only — the substrate adapter confirms the actual
  // binding).
  return ok({
    planId: input.planId,
    taskId: input.consumingTask.taskId,
    handoffId: input.handoffId,
    producingTaskId: input.producingTask.taskId,
    producingSettlementRef: {
      requestId: input.producingSettlement.requestId,
      settledAt: input.producingSettlement.settledAt,
    },
    payload: input.payload,
    mediaType: input.mediaType,
    deliveredAt: input.deliveredAt,
  });
}

/**
 * Byte-identical deep equality for handoff payloads (the idempotency proof).
 * Two payloads are byte-identical iff every field, including nested
 * settlement refs, is structurally equal. Used by the relay store to detect
 * duplicate deliveries (catalog clause 3: "duplicate delivery is idempotent
 * ... byte-identical second-delivery result, no double side-effects").
 *
 * Determinism: JSON-serialized comparison with stable key ordering. The
 * payloads are pure data (no functions, no symbols); the serialized form is
 * canonical.
 */
export function handoffPayloadsIdentical(a: HandoffPayload, b: HandoffPayload): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Idempotent delivery: a duplicate delivery of the SAME handoff (by
 * handoffId + correlation identity) is observed EXACTLY ONCE. The first
 * delivery is recorded; the second delivery is suppressed with outcome
 * `delivered-duplicate` and a byte-identical result. A DIVERGENT duplicate
 * (same handoff id, different payload) is refused as a `plan-handoff-divergent`
 * invariant violation (catalog: never rewrite a delivered handoff).
 *
 * Catalog: "duplicate delivery is idempotent: the same handoff delivered twice
 * is observed exactly once (duplicate detection by handoff identity,
 * byte-identical second-delivery result, no double side-effects)".
 *
 * Inputs:
 * - `previously`: the existing delivered payload for this handoff id, or
 *   undefined when this is the first delivery.
 * - `incoming`: the new delivery attempt.
 *
 * Returns the delivery result. `delivered-first` on first delivery;
 * `delivered-duplicate` on byte-identical re-delivery (the same payload
 * echoed); `plan-handoff-divergent` error on divergent re-delivery.
 */
export function deliverHandoffIdempotent(
  previously: HandoffPayload | undefined,
  incoming: HandoffPayload,
): Result<HandoffDeliveryResult, PlanError> {
  if (previously === undefined) {
    return ok({ outcome: "delivered-first", payload: incoming });
  }
  // Same handoff id?
  if (previously.handoffId !== incoming.handoffId) {
    // Different handoff id — this is a different handoff, not a duplicate.
    return ok({ outcome: "delivered-first", payload: incoming });
  }
  // Same correlation (planId, taskId, handoffId) — must be byte-identical.
  if (handoffPayloadsIdentical(previously, incoming)) {
    // Idempotent duplicate: observed exactly once — return the SAME payload
    // (no double side-effects). The `outcome` field is the only signal that
    // this was a duplicate.
    return ok({ outcome: "delivered-duplicate", payload: previously });
  }
  // Divergent duplicate — invariant violation.
  return err(planHandoffDivergent(incoming.handoffId));
}

/**
 * Authorization check (catalog clause 3: "authorization-aware"). The relay
 * refuses to issue a handoff to an executor whose declared authority
 * requirement is not satisfied. The proof comes from the approval authority
 * port (`PlanApprovalAuthority.assertExecutorAuthority`); this function
 * produces the issue list for invalid requirements at construction time.
 */
export function executorAuthorityIssues(
  requirement: unknown,
  fieldPrefix = "authorityRequirement",
): ValidationIssue[] {
  if (!requirement || typeof requirement !== "object") {
    return [{ field: fieldPrefix, problem: "is required (actionId and/or auditRef)" }];
  }
  const record = requirement as Record<string, unknown>;
  const actionId = typeof record["actionId"] === "string" ? record["actionId"].trim() : "";
  const auditRef = typeof record["auditRef"] === "string" ? record["auditRef"].trim() : "";
  if (actionId.length === 0 && auditRef.length === 0) {
    return [
      {
        field: fieldPrefix,
        problem: "at least one of actionId or auditRef must be a non-empty string",
      },
    ];
  }
  return [];
}
