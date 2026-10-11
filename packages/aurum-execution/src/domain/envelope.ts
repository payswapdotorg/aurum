/**
 * The normalized execution settlement envelope (W006) — the ONE shape in
 * which execution results cross from the execution plane to the caller.
 *
 * The caller (application layer) resolves it into semantic records through
 * the domain seams: this envelope is a MESSAGE, not a record of authority.
 * THE AUTHORITY LAW holds end-to-end: settlements are returned, journaled
 * (execution-plane) and stored on the session; they never mutate kernel
 * state.
 *
 * Field discipline:
 * - `status` is a semantic terminal state (settled/cancelled/failed);
 * - `result` is present iff the platform produced an output payload (opaque,
 *   adapter-defined encoding — never parsed here);
 * - `failure` is present iff `status === "failed"`;
 * - `cost` lines are opaque usage lines carried through from the platform
 *   envelope verbatim ({unit, quantity} — the boundary's cost-line shape
 *   mirrored locally so this layer stays stdlib-pure; cost NORMALIZATION into
 *   semantic accounting is an application concern);
 * - `evidenceRef` is opaque and resolvable only by the caller's evidence
 *   authority;
 * - `authority` and `occupancy` echo the request's citations verbatim;
 * - `environment` records which execution environment produced the result
 *   (semantic provenance; the platform's own descriptor facts).
 */
import type { AuthorityCitation, ModelOccupancy } from "./authority.js";
import type { ExecutionEnvironmentClass } from "./vocabulary.js";
import type { ExecutionFailureKind } from "./vocabulary.js";
import type { ExecutionSettlementStatus } from "./lifecycle.js";
import type { ExecutionRequestId, ExecutionTenantId } from "./ids.js";
import { isExecutionFailureKind } from "./vocabulary.js";

/** One platform-measured usage line (opaque unit label + quantity). */
export interface ExecutionCostLine {
  readonly unit: string;
  readonly quantity: number;
}

/**
 * Normalized failure detail on failed settlements: how it failed (kind), the
 * platform error code verbatim (the W001 boundary code union at runtime —
 * kept opaque here), the message, and whether a retry may succeed.
 */
export interface ExecutionFailureDetail {
  readonly kind: ExecutionFailureKind;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/** Which execution environment produced the settlement. */
export interface ExecutionEnvironmentProvenance {
  readonly environmentId: string;
  readonly environmentClass: ExecutionEnvironmentClass;
  readonly variant: string;
  /** Boundary capability id (persist this, never the seam handle). */
  readonly capabilityId: string;
}

/** The normalized settlement envelope. */
export interface ExecutionSettlement {
  readonly tenantId: ExecutionTenantId;
  readonly requestId: ExecutionRequestId;
  readonly status: ExecutionSettlementStatus;
  /** Opaque result payload; present iff the platform produced output. */
  readonly result?: string;
  /** Present iff `status === "failed"`. */
  readonly failure?: ExecutionFailureDetail;
  readonly cost?: readonly ExecutionCostLine[];
  /** Opaque evidence reference, resolvable by the caller only. */
  readonly evidenceRef?: string;
  /** The request's domain authority citation, echoed verbatim. */
  readonly authority: AuthorityCitation;
  /** The request's model occupancy, echoed verbatim when present. */
  readonly occupancy?: ModelOccupancy;
  readonly environment: ExecutionEnvironmentProvenance;
  /** Epoch milliseconds at settlement (deterministic: caller-supplied). */
  readonly settledAt: number;
}

/** Input side of the settlement constructor (payload + provenance). */
export interface SettlementInput {
  readonly status: ExecutionSettlementStatus;
  readonly result?: string;
  readonly failure?: ExecutionFailureDetail;
  readonly cost?: readonly ExecutionCostLine[];
  readonly evidenceRef?: string;
  readonly settledAt: number;
}

/** Identifying echoes the constructor copies verbatim from the session. */
export interface SettlementContext {
  readonly tenantId: ExecutionTenantId;
  readonly requestId: ExecutionRequestId;
  readonly authority: AuthorityCitation;
  readonly occupancy?: ModelOccupancy;
  readonly environment: ExecutionEnvironmentProvenance;
}

/** Builds a settlement value (pure; callers then persist/return it). */
export function buildExecutionSettlement(
  context: SettlementContext,
  input: SettlementInput,
): ExecutionSettlement {
  return {
    tenantId: context.tenantId,
    requestId: context.requestId,
    status: input.status,
    authority: context.authority,
    environment: context.environment,
    settledAt: input.settledAt,
    ...(input.result === undefined ? {} : { result: input.result }),
    ...(input.failure === undefined ? {} : { failure: input.failure }),
    ...(input.cost === undefined ? {} : { cost: input.cost }),
    ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
    ...(context.occupancy === undefined ? {} : { occupancy: context.occupancy }),
  };
}

/** Settlement status ↔ failure-kind consistency + shape guard (wire-safe). */
export function isExecutionSettlement(value: unknown): value is ExecutionSettlement {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record["tenantId"] !== "string") return false;
  if (typeof record["requestId"] !== "string") return false;
  const status = record["status"];
  if (typeof status !== "string") return false;
  if (!["settled", "cancelled", "failed"].includes(status)) return false;
  if (record["result"] !== undefined && typeof record["result"] !== "string") return false;
  if (record["evidenceRef"] !== undefined && typeof record["evidenceRef"] !== "string")
    return false;
  if (typeof record["settledAt"] !== "number" || !Number.isFinite(record["settledAt"]))
    return false;
  if (record["authority"] === undefined || typeof record["authority"] !== "object")
    return false;
  const environment = record["environment"];
  if (environment === undefined || typeof environment !== "object") return false;
  const env = environment as Record<string, unknown>;
  if (
    typeof env["environmentId"] !== "string" ||
    typeof env["variant"] !== "string" ||
    typeof env["capabilityId"] !== "string"
  ) {
    return false;
  }
  const failure = record["failure"];
  if (status === "failed") {
    if (failure === undefined || typeof failure !== "object") return false;
    const f = failure as Record<string, unknown>;
    if (
      !isExecutionFailureKind(f["kind"]) ||
      typeof f["code"] !== "string" ||
      typeof f["message"] !== "string" ||
      typeof f["retryable"] !== "boolean"
    ) {
      return false;
    }
  } else if (failure !== undefined) {
    return false;
  }
  const cost = record["cost"];
  if (cost !== undefined) {
    if (!Array.isArray(cost)) return false;
    for (const line of cost) {
      if (
        typeof line !== "object" ||
        line === null ||
        typeof (line as Record<string, unknown>)["unit"] !== "string" ||
        typeof (line as Record<string, unknown>)["quantity"] !== "number"
      ) {
        return false;
      }
    }
  }
  return true;
}
