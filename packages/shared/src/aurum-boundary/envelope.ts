/**
 * Aurum-facing platform boundary — normalized result envelope (W001).
 *
 * This is the ONE shape in which execution results cross from the ZCode
 * substrate to Aurum. It is deliberately thin and deliberately opaque:
 *
 *   status      — platform lifecycle state (terminal when settled)
 *   result      — opaque payload (adapter-defined encoding)
 *   error       — typed boundary error detail (present when failed)
 *   cost        — platform-measured usage lines (opaque units)
 *   evidenceRef — opaque reference to execution evidence
 *
 * Every field is either an opaque string or a boundary-local platform type.
 * No Aurum domain type, no substrate semantic type, no provider SDK type
 * ever appears here — that is the whole point of W001, and the leakage
 * tripwires in this directory lock it.
 *
 * Idempotency / stale-result rules (explicit, per the constitution):
 * - `submit` with the same `submissionKey` returns the SAME ticket and the
 *   adapter marks the ack `replay: true` — never a second execution.
 * - terminal states never transition again. If the adapter later produces a
 *   superseding envelope for the same ticket (e.g. a replay landed a newer
 *   settlement), the earlier envelope is reported again with `stale: true`;
 *   history is append-only, nothing is rewritten in place.
 */

import { AURUM_TRANSPORT_LIFECYCLE_STATES } from "./lifecycle.js";
import type { AurumBoundaryErrorDetail } from "./errors.js";
import type { AurumSubmissionTicket } from "./identifiers.js";
import type { AurumTransportLifecycleState } from "./lifecycle.js";

const AURUM_STATE_SET: ReadonlySet<string> = new Set<string>(
  AURUM_TRANSPORT_LIFECYCLE_STATES as readonly string[],
);

/**
 * One platform-measured usage line. `unit` is an opaque label chosen by the
 * adapter (tokens, cpu-seconds, bytes, ...); the boundary and Aurum never
 * parse it — cost normalization is an application-side concern.
 */
export interface AurumTransportCostLine {
  /** Opaque usage-unit label (e.g. "input-tokens"). Never parsed. */
  readonly unit: string;
  /** Measured quantity for that unit. */
  readonly quantity: number;
}

/**
 * The normalized result envelope: how completed work crosses the boundary.
 *
 * - `status` is a terminal state on envelopes obtained from
 *   `awaitCompletion`; snapshots may surface the current state.
 * - `result` is present iff the platform produced an output payload;
 *   its encoding is adapter-defined and opaque to the boundary.
 * - `error` is present iff `status === "failed"`.
 * - `evidenceRef`, when present, is an opaque reference the Aurum evidence
 *   authority MAY resolve later; the boundary never resolves it itself.
 */
export interface AurumTransportResultEnvelope {
  /** The submission this envelope describes. */
  readonly ticket: AurumSubmissionTicket;
  /** Platform lifecycle state of the submission at envelope time. */
  readonly status: AurumTransportLifecycleState;
  /** Opaque result payload (adapter-defined encoding). */
  readonly result?: string;
  /** Typed error detail; present iff `status` is `"failed"`. */
  readonly error?: AurumBoundaryErrorDetail;
  /** Platform-measured usage lines. */
  readonly cost?: readonly AurumTransportCostLine[];
  /** Opaque reference to execution evidence, resolvable by Aurum only. */
  readonly evidenceRef?: string;
  /**
   * True when this envelope has been superseded by a later settlement for
   * the same ticket (append-only history; the original is never mutated).
   */
  readonly stale?: boolean;
}

/**
 * Structural type guard for a well-formed envelope (e.g. off a wire or a
 * test double). Checks shape and state vocabulary only; opaque payload
 * contents are, by design, unverifiable here.
 */
export function isAurumTransportResultEnvelope(
  value: unknown,
): value is AurumTransportResultEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record["ticket"] !== "string") return false;
  const status = record["status"];
  if (typeof status !== "string") return false;
  if (!AURUM_STATE_SET.has(status)) return false;
  if (record["result"] !== undefined && typeof record["result"] !== "string") return false;
  if (record["error"] !== undefined && !isPlainErrorDetail(record["error"])) return false;
  if (record["evidenceRef"] !== undefined && typeof record["evidenceRef"] !== "string")
    return false;
  if (record["stale"] !== undefined && typeof record["stale"] !== "boolean") return false;
  const cost = record["cost"];
  if (cost === undefined) return true;
  if (!Array.isArray(cost)) return false;
  return cost.every(
    (line) =>
      typeof line === "object" &&
      line !== null &&
      typeof (line as Record<string, unknown>)["unit"] === "string" &&
      typeof (line as Record<string, unknown>)["quantity"] === "number",
  );
}

function isPlainErrorDetail(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["code"] === "string" &&
    typeof record["message"] === "string" &&
    typeof record["retryable"] === "boolean"
  );
}
