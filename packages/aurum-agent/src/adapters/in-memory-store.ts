/**
 * Deterministic in-memory implementation of AgentFabricStore.
 *
 * Tenant isolation at the table level: foreign-tenant reads return the same
 * null as missing ids (uniform, no existence leakage). Records are
 * deep-frozen on write — a stored AgentBody can never be mutated in place,
 * which makes the byte-for-byte identity guarantee defense-in-depth rather
 * than convention.
 */
import type {
  AgentBodyStore,
  AgentFabricStore,
  BodyModelBindingStore,
  RoleHistoryStore,
} from "../domain/stores.js";
import type { TenantId } from "../domain/ids.js";
import type { AgentBody } from "../domain/agent-body.js";
import type { AgentRoleAssignment } from "../domain/role-history.js";
import type { BodyModelBinding } from "../domain/body-model-binding.js";
import type { BodyModelPurpose } from "../domain/vocabulary.js";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

class TenantTable<T extends { readonly id: string }> {
  private readonly partitions = new Map<string, Map<string, T>>();

  private bucket(tenantId: TenantId): Map<string, T> {
    const key = tenantId as string;
    let bucket = this.partitions.get(key);
    if (bucket === undefined) {
      bucket = new Map<string, T>();
      this.partitions.set(key, bucket);
    }
    return bucket;
  }

  put(tenantId: TenantId, record: T): void {
    this.bucket(tenantId).set(record.id, deepFreeze(record));
  }

  getById(tenantId: TenantId, id: string): T | null {
    return this.bucket(tenantId).get(id) ?? null;
  }

  list(tenantId: TenantId): T[] {
    return [...this.bucket(tenantId).values()];
  }
}

class InMemoryBodyStore implements AgentBodyStore {
  private readonly table = new TenantTable<AgentBody>();

  async put(tenantId: TenantId, body: AgentBody): Promise<void> {
    this.table.put(tenantId, body);
  }

  async getById(tenantId: TenantId, bodyId: string): Promise<AgentBody | null> {
    return this.table.getById(tenantId, bodyId);
  }

  async listByTenant(tenantId: TenantId): Promise<AgentBody[]> {
    return this.table.list(tenantId);
  }
}

class InMemoryRoleHistoryStore implements RoleHistoryStore {
  private readonly byId = new TenantTable<AgentRoleAssignment>();
  private readonly byBody = new Map<string, AgentRoleAssignment[]>();

  private bucket(tenantId: TenantId, bodyId: string): AgentRoleAssignment[] {
    const key = `${tenantId as string}::${bodyId}`;
    let bucket = this.byBody.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.byBody.set(key, bucket);
    }
    return bucket;
  }

  async put(tenantId: TenantId, assignment: AgentRoleAssignment): Promise<void> {
    this.byId.put(tenantId, assignment);
    const log = this.bucket(tenantId, assignment.bodyId as string);
    const index = log.findIndex((row) => row.id === assignment.id);
    if (index >= 0) {
      log[index] = deepFreeze(assignment);
    } else {
      log.push(deepFreeze(assignment));
    }
  }

  async getById(tenantId: TenantId, assignmentId: string): Promise<AgentRoleAssignment | null> {
    return this.byId.getById(tenantId, assignmentId);
  }

  async listByBody(tenantId: TenantId, bodyId: string): Promise<AgentRoleAssignment[]> {
    return [...this.bucket(tenantId, bodyId)];
  }
}

class InMemoryBodyModelBindingStore implements BodyModelBindingStore {
  private readonly table = new TenantTable<BodyModelBinding>();

  async put(tenantId: TenantId, binding: BodyModelBinding): Promise<void> {
    this.table.put(tenantId, binding);
  }

  async getById(tenantId: TenantId, bindingId: string): Promise<BodyModelBinding | null> {
    return this.table.getById(tenantId, bindingId);
  }

  async listByBody(tenantId: TenantId, bodyId: string): Promise<BodyModelBinding[]> {
    return this.table.list(tenantId).filter((binding) => binding.bodyId === bodyId);
  }

  async findAttachedByPurpose(
    tenantId: TenantId,
    bodyId: string,
    purpose: BodyModelPurpose,
  ): Promise<BodyModelBinding | null> {
    return (
      this.table
        .list(tenantId)
        .find(
          (binding) =>
            binding.bodyId === bodyId &&
            binding.purpose === purpose &&
            binding.status === "attached",
        ) ?? null
    );
  }
}

export function createInMemoryAgentFabricStore(): AgentFabricStore {
  return {
    bodies: new InMemoryBodyStore(),
    roleHistory: new InMemoryRoleHistoryStore(),
    modelBindings: new InMemoryBodyModelBindingStore(),
  };
}
