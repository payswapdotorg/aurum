/**
 * In-memory plan store (W009 adapter). Tenant-scoped (uses the kernel's
 * TenantIndex pattern); cross-tenant reads fail closed as a uniform
 * not-found (no existence leaks). P-series debt: PostgreSQL storage will
 * implement the same `PlanStore` port against the same shapes.
 */
import { TenantIndex, type Result, type TenantScope } from "@aurum/domain";
import { planNotFound, planValidationError, type PlanError } from "../domain/errors.js";
import type { ExecutionPlanLike, PlanStore } from "../domain/ports.js";

export class InMemoryPlanStore implements PlanStore {
  private readonly index = new TenantIndex<ExecutionPlanLike>();

  putPlan(plan: ExecutionPlanLike): Result<ExecutionPlanLike, PlanError> {
    if (!plan || typeof plan !== "object") {
      return {
        ok: false,
        error: planValidationError([{ field: "plan", problem: "is required" }]),
      };
    }
    const stored = this.index.put(plan.scope, plan.planId, plan);
    return { ok: true, value: stored };
  }

  getPlan(scope: TenantScope, planId: string): Result<ExecutionPlanLike, PlanError> {
    const record = this.index.get(scope, planId);
    if (!record) return { ok: false, error: planNotFound("plan") };
    return { ok: true, value: record };
  }

  listPlans(scope: TenantScope): readonly ExecutionPlanLike[] {
    return this.index.list(scope);
  }
}

export function createInMemoryPlanStore(): InMemoryPlanStore {
  return new InMemoryPlanStore();
}
