/**
 * In-memory handoff relay store (W009 adapter). Records handoff deliveries
 * idempotently (catalog clause 3). The store is keyed by (planId, taskId,
 * handoffId) — duplicate deliveries of the SAME handoff are observed exactly
 * once. Divergent duplicates (same id, different payload) are refused as a
 * `plan-handoff-divergent` invariant violation (never rewrite a delivered
 * handoff). P-series debt: PostgreSQL storage.
 */
import { type Result } from "@aurum/domain";
import { planHandoffDivergent, planValidationError, type PlanError } from "../domain/errors.js";
import { handoffPayloadsIdentical } from "../domain/relay.js";
import type { HandoffDeliveryResult, HandoffPayload } from "../domain/records.js";
import type { HandoffRelayStore } from "../domain/ports.js";

interface HandoffKey {
  readonly planId: string;
  readonly taskId: string;
  readonly handoffId: string;
}

function keyOf(payload: HandoffPayload): HandoffKey {
  return {
    planId: payload.planId,
    taskId: payload.taskId,
    handoffId: payload.handoffId,
  };
}

function keyToString(key: HandoffKey): string {
  return `${key.planId}\0${key.taskId}\0${key.handoffId}`;
}

export class InMemoryHandoffRelayStore implements HandoffRelayStore {
  private readonly deliveries = new Map<string, HandoffPayload>();

  recordDelivery(payload: HandoffPayload): Result<HandoffDeliveryResult, PlanError> {
    if (!payload || typeof payload !== "object") {
      return {
        ok: false,
        error: planValidationError([{ field: "payload", problem: "is required" }]),
      };
    }
    const key = keyOf(payload);
    const keyString = keyToString(key);
    const existing = this.deliveries.get(keyString);
    if (existing === undefined) {
      this.deliveries.set(keyString, payload);
      return { ok: true, value: { outcome: "delivered-first", payload } };
    }
    // Idempotent delivery: byte-identical duplicate observed exactly once.
    if (handoffPayloadsIdentical(existing, payload)) {
      return { ok: true, value: { outcome: "delivered-duplicate", payload: existing } };
    }
    // Divergent duplicate: invariant violation.
    return { ok: false, error: planHandoffDivergent(payload.handoffId) };
  }

  deliveredFor(planId: string, taskId: string): readonly HandoffPayload[] {
    return Object.freeze(
      [...this.deliveries.values()].filter(
        (p) => p.planId === planId && p.taskId === taskId,
      ),
    );
  }

  deliveredForPlan(planId: string): readonly HandoffPayload[] {
    return Object.freeze(
      [...this.deliveries.values()].filter((p) => p.planId === planId),
    );
  }
}

export function createInMemoryHandoffRelayStore(): InMemoryHandoffRelayStore {
  return new InMemoryHandoffRelayStore();
}
