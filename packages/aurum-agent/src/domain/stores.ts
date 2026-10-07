/**
 * Persistence seams for the agent fabric. Tenant-scoped, fail-closed on
 * foreign ids (uniform NOT_FOUND), records deep-frozen by the in-memory
 * double. The body store has NO delete: retirement is a state, not a
 * removal; attachments and role assignments are append-only ledgers.
 */
import type { TenantId } from "./ids.js";
import type { AgentBody } from "./agent-body.js";
import type { AgentRoleAssignment } from "./role-history.js";
import type { BodyModelBinding } from "./body-model-binding.js";
import type { BodyModelPurpose } from "./vocabulary.js";

export interface AgentBodyStore {
  put(tenantId: TenantId, body: AgentBody): Promise<void>;
  getById(tenantId: TenantId, bodyId: string): Promise<AgentBody | null>;
  listByTenant(tenantId: TenantId): Promise<AgentBody[]>;
}

export interface RoleHistoryStore {
  /** Upsert by assignment id. The ledger only ever grows: superseding
   * writes the superseded version (with successor pointer), never deletes. */
  put(tenantId: TenantId, assignment: AgentRoleAssignment): Promise<void>;
  getById(tenantId: TenantId, assignmentId: string): Promise<AgentRoleAssignment | null>;
  listByBody(tenantId: TenantId, bodyId: string): Promise<AgentRoleAssignment[]>;
}

export interface BodyModelBindingStore {
  put(tenantId: TenantId, binding: BodyModelBinding): Promise<void>;
  getById(tenantId: TenantId, bindingId: string): Promise<BodyModelBinding | null>;
  listByBody(tenantId: TenantId, bodyId: string): Promise<BodyModelBinding[]>;
  findAttachedByPurpose(
    tenantId: TenantId,
    bodyId: string,
    purpose: BodyModelPurpose,
  ): Promise<BodyModelBinding | null>;
}

export interface AgentFabricStore {
  readonly bodies: AgentBodyStore;
  readonly roleHistory: RoleHistoryStore;
  readonly modelBindings: BodyModelBindingStore;
}
