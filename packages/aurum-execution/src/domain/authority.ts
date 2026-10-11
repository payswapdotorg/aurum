/**
 * Domain authority citations (W006) — how executions CITE kernel authority
 * without importing it.
 *
 * architecture-policy.yaml allows aurum-execution to require only [shared]:
 * the kernel's ActionId/audit ids are therefore opaque strings here. The
 * shapes align with the kernel's action-authority vocabulary
 * (packages/aurum-domain: ActionRecord.actionId, AuditRecord.auditId,
 * SubjectReference/ActorReference) so the application layer (the semantic
 * integration point, W009) can pass kernel values straight through — the
 * branded kernel ids are structurally assignable to these plain string
 * fields, and results are branded back by the caller when recording through
 * the domain seams. The gateway never verifies authority (it cannot: that is
 * application policy); it records and echoes the citation verbatim.
 */
import type { ValidationIssue } from "./issues.js";

/**
 * The domain authority an execution cites. At least one of `actionId` /
 * `auditRef` must be present: every execution request carries its authority
 * citation (spec/WORK-ITEM-CATALOG.md §W006: "citing domain authority —
 * action id/audit ref").
 */
export interface AuthorityCitation {
  /** Domain ActionRecord id of the (authorized) action being executed. */
  readonly actionId?: string;
  /** Domain audit entry id the caller associates with this execution. */
  readonly auditRef?: string;
}

/** Validates a citation in isolation; empty array when valid. */
export function authorityCitationIssues(
  citation: unknown,
  fieldPrefix = "authority",
): ValidationIssue[] {
  if (!citation || typeof citation !== "object") {
    return [{ field: fieldPrefix, problem: "is required (actionId and/or auditRef)" }];
  }
  const record = citation as Record<string, unknown>;
  const actionId = typeof record["actionId"] === "string" ? record["actionId"].trim() : "";
  const auditRef = typeof record["auditRef"] === "string" ? record["auditRef"].trim() : "";
  if (actionId.length === 0 && auditRef.length === 0) {
    return [
      {
        field: `${fieldPrefix}`,
        problem: "at least one of actionId or auditRef must be a non-empty string",
      },
    ];
  }
  if (actionId.length > 200) {
    return [{ field: `${fieldPrefix}.actionId`, problem: "must be at most 200 characters" }];
  }
  if (auditRef.length > 200) {
    return [{ field: `${fieldPrefix}.auditRef`, problem: "must be at most 200 characters" }];
  }
  return [];
}

/**
 * Model binding occupancy: an execution MAY be model-bound
 * (spec/ARCHITECTURE.md "model binding occupancy"). The reference is opaque —
 * the provider/agent plane owns the binding registries (@aurum/provider
 * ModelBinding / @aurum/agent BodyModelBinding); the execution plane records
 * the occupancy and echoes it on the settlement so outcome learning (W013)
 * can join executions to the model that occupied them. It is never resolved
 * here.
 */
export interface ModelOccupancy {
  /** Opaque reference to the provider-plane model binding. */
  readonly modelBindingRef: string;
}

/** Validates model occupancy in isolation; empty array when valid. */
export function modelOccupancyIssues(
  occupancy: unknown,
  fieldPrefix = "occupancy",
): ValidationIssue[] {
  if (occupancy === undefined || occupancy === null) return [];
  if (!occupancy || typeof occupancy !== "object") {
    return [{ field: fieldPrefix, problem: "must be a modelBindingRef object" }];
  }
  const ref = (occupancy as Record<string, unknown>)["modelBindingRef"];
  if (typeof ref !== "string" || ref.trim().length === 0) {
    return [{ field: `${fieldPrefix}.modelBindingRef`, problem: "must be a non-empty string" }];
  }
  if (ref.length > 200) {
    return [{ field: `${fieldPrefix}.modelBindingRef`, problem: "must be at most 200 characters" }];
  }
  return [];
}
