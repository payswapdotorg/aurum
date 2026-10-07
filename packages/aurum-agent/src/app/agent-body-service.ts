/**
 * Agent Body application service: create/read/update/retire + role
 * assignment with append-only history.
 *
 * NOTE ON MODEL SWAPS: nothing in this service is called when a model is
 * attached or swapped — that is entirely BodyModelBindingService's business
 * over its own store. That separation is what makes the byte-for-byte body
 * identity guarantee structural rather than conventional.
 */
import type { Clock, IdGenerator } from "../domain/ports.js";
import type { AgentFabricStore } from "../domain/stores.js";
import { invalidTransition, notFound } from "../domain/errors.js";
import {
  buildAgentBody,
  retireAgentBody,
  updateAgentBody,
  type AgentBody,
  type CreateAgentBodyInput,
  type UpdateAgentBodyInput,
} from "../domain/agent-body.js";
import {
  buildRoleAssignment,
  roleHistoryOf,
  supersedeRoleAssignment,
  type AgentRoleAssignment,
} from "../domain/role-history.js";
import type { TenantId } from "../domain/ids.js";

export interface AgentBodyDeps {
  readonly store: AgentFabricStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class AgentBodyService {
  constructor(private readonly deps: AgentBodyDeps) {}

  async createBody(tenantId: TenantId, input: CreateAgentBodyInput): Promise<AgentBody> {
    const body = buildAgentBody(tenantId, input, {
      id: this.deps.ids.next(),
      now: this.deps.clock.now(),
    });
    await this.deps.store.bodies.put(tenantId, body);
    // The initial role assignment opens the role history ledger.
    const assignment = buildRoleAssignment(tenantId, body.id, body.role, {
      id: this.deps.ids.next(),
      now: this.deps.clock.now(),
    });
    await this.deps.store.roleHistory.put(tenantId, assignment);
    return body;
  }

  async getBody(tenantId: TenantId, bodyId: string): Promise<AgentBody> {
    const body = await this.deps.store.bodies.getById(tenantId, bodyId);
    if (body === null) {
      throw notFound("BODY_NOT_FOUND", `agent body ${bodyId}`);
    }
    return body;
  }

  async listBodies(tenantId: TenantId): Promise<AgentBody[]> {
    return this.deps.store.bodies.listByTenant(tenantId);
  }

  async updateBody(
    tenantId: TenantId,
    bodyId: string,
    input: UpdateAgentBodyInput,
  ): Promise<AgentBody> {
    const body = await this.getBody(tenantId, bodyId);
    const updated = updateAgentBody(body, input, this.deps.clock.now());
    await this.deps.store.bodies.put(tenantId, updated);
    return updated;
  }

  /** Assign a new role: supersede the current assignment, append the next. */
  async assignRole(
    tenantId: TenantId,
    bodyId: string,
    role: { readonly title: string; readonly description?: string },
  ): Promise<{ readonly body: AgentBody; readonly assignment: AgentRoleAssignment }> {
    const body = await this.getBody(tenantId, bodyId);
    if (body.lifecycle.state !== "active") {
      throw invalidTransition("retired bodies cannot change roles");
    }
    const now = this.deps.clock.now();
    const history = await this.deps.store.roleHistory.listByBody(tenantId, bodyId);
    const current = [...history].sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))[0];
    const assignment = buildRoleAssignment(
      tenantId,
      body.id,
      {
        title: role.title,
        description: role.description ?? null,
      },
      { id: this.deps.ids.next(), now },
    );
    if (current !== undefined && current.supersededAt === null) {
      await this.deps.store.roleHistory.put(
        tenantId,
        supersedeRoleAssignment(current, assignment.id, now),
      );
    }
    await this.deps.store.roleHistory.put(tenantId, assignment);
    const updated: AgentBody = {
      ...body,
      role: assignment.role,
      updatedAt: now,
    };
    await this.deps.store.bodies.put(tenantId, updated);
    return { body: updated, assignment };
  }

  async roleHistory(tenantId: TenantId, bodyId: string): Promise<readonly AgentRoleAssignment[]> {
    await this.getBody(tenantId, bodyId);
    return roleHistoryOf(await this.deps.store.roleHistory.listByBody(tenantId, bodyId));
  }

  /** One-way retirement; there is no un-retire operation on any surface. */
  async retireBody(tenantId: TenantId, bodyId: string, reason?: string): Promise<AgentBody> {
    const body = await this.getBody(tenantId, bodyId);
    const retired = retireAgentBody(body, reason, this.deps.clock.now());
    await this.deps.store.bodies.put(tenantId, retired);
    return retired;
  }
}
