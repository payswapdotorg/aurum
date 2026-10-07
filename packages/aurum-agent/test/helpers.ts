/**
 * Shared deterministic composition for agent fabric tests, plus a scripted
 * provider-binding lookup double for pure agent-side tests (the real
 * @aurum/provider bridge is exercised in provider-integration.test.ts).
 */
import {
  FixedClock,
  SequentialIdGenerator,
  SteppingClock,
  asTenantId,
  createAgentFabric,
  createInMemoryAgentFabricStore,
  type AgentFabric,
  type AgentFabricStore,
  type ModelBindingSnapshot,
  type ProviderBindingLookupPort,
} from "../src/index.js";
import type { TenantId } from "../src/domain/ids.js";

export const TENANT_A: TenantId = asTenantId("tenant-a");
export const TENANT_B: TenantId = asTenantId("tenant-b");

/** Scriptable lookup double: maps binding ids to snapshots per call. */
export class ScriptedBindingLookup implements ProviderBindingLookupPort {
  readonly calls: Array<{ tenantId: TenantId; bindingId: string }> = [];
  private readonly snapshots = new Map<string, ModelBindingSnapshot>();

  active(bindingId: string, purpose = "cognition"): void {
    this.snapshots.set(bindingId, {
      id: bindingId,
      purpose,
      status: "active",
      catalogEntryId: `cat-${bindingId}`,
    });
  }

  async getActiveModelBinding(
    tenantId: TenantId,
    bindingId: string,
  ): Promise<ModelBindingSnapshot | null> {
    this.calls.push({ tenantId, bindingId });
    return this.snapshots.get(bindingId) ?? null;
  }
}

export interface AgentHarness {
  readonly fabric: AgentFabric;
  readonly store: AgentFabricStore;
  readonly clock: SteppingClock;
  readonly ids: SequentialIdGenerator;
  readonly lookup: ScriptedBindingLookup;
}

export function makeAgentFabric(startIso = "2026-01-01T00:00:00.000Z"): AgentHarness {
  const store = createInMemoryAgentFabricStore();
  const clock = new SteppingClock(startIso, 1000);
  const ids = new SequentialIdGenerator("agent-id");
  const lookup = new ScriptedBindingLookup();
  const fabric = createAgentFabric({ store, clock, ids, bindingLookup: lookup });
  return { fabric, store, clock, ids, lookup };
}

export async function makeBody(harness: AgentHarness): Promise<string> {
  const body = await harness.fabric.bodies.createBody(TENANT_A, {
    displayName: "Ride Support Agent",
    role: { title: "Support Specialist", description: "Handles ride support conversations" },
    permittedCapabilities: ["conversation", "information-retrieval"],
    memoryPolicy: { retention: "persistent", sharing: "team" },
    escalation: { onUncertainty: "ask-human", escalatesTo: ["Human Support Lead"] },
    relationships: [
      { kind: "reports-to", targetBodyId: null, targetRole: "Support Lead", note: null },
    ],
  });
  return body.id;
}

export { FixedClock };
