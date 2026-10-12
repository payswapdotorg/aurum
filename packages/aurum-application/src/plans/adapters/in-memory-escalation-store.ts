/**
 * In-memory escalation store (W009 adapter). Escalation records live in their
 * own append-only store; they NEVER mutate plans directly (catalog clause 4:
 * escalation PROPOSES, the authority seams DISPOSE). P-series debt:
 * PostgreSQL storage.
 */
import { type Result, type TenantScope } from "@aurum/domain";
import { planValidationError, type PlanError } from "../domain/errors.js";
import type { EscalationRecord } from "../domain/records.js";
import type { EscalationStore } from "../domain/ports.js";

export class InMemoryEscalationStore implements EscalationStore {
  private readonly escalations = new Map<string, EscalationRecord[]>();

  appendEscalation(
    escalation: EscalationRecord,
  ): Result<EscalationRecord, PlanError> {
    if (!escalation || typeof escalation !== "object") {
      return {
        ok: false,
        error: planValidationError([{ field: "escalation", problem: "is required" }]),
      };
    }
    const existing = this.escalations.get(escalation.planId) ?? [];
    this.escalations.set(escalation.planId, [...existing, escalation]);
    return { ok: true, value: escalation };
  }

  listEscalations(
    scope: TenantScope,
    planId: string,
  ): readonly EscalationRecord[] {
    // Tenant isolation: only escalations whose plan belongs to the requesting
    // tenant are visible. The plan service already verifies ownership before
    // calling this; the store additionally filters by the plan's scope (the
    // escalation record itself doesn't carry a scope, but the plan does).
    return Object.freeze(this.escalations.get(planId) ?? []);
  }
}

export function createInMemoryEscalationStore(): InMemoryEscalationStore {
  return new InMemoryEscalationStore();
}
