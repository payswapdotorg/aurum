/**
 * PostgreSQL agent fabric (P002, migration 0004): the `AgentBodyStore`,
 * `RoleHistoryStore` and `BodyModelBindingStore` ports of @aurum/agent over
 * the versioned-upsert tables.
 *
 * THE IDENTITY LAW (agent-body.ts / body-model-binding.ts): attaching,
 * swapping or detaching a model NEVER writes the AgentBody record — not its
 * facets, not its updatedAt. The storage mirror makes that structural:
 * model attachment writes ONLY fabric_body_model_bindings. A body row
 * exists per put of the body itself (create/update/assignRole/retire) and
 * nothing else; across swaps the body's row count and its current record
 * are byte-for-byte unchanged.
 *
 * Role history and body-model bindings follow the migration-0001
 * versioned-upsert shape (the in-memory stores upsert by assignment/binding
 * id): superseding writes the superseded version as a NEW appended row
 * while the original is retained verbatim at its own mutation_seq; the
 * port's read model derives the current record per id exactly like the
 * in-memory upsert (including list positions: a superseded assignment
 * keeps its original position in listByBody).
 */
import type {
  AgentBody,
  AgentBodyStore,
  AgentRoleAssignment,
  BodyModelBinding,
  BodyModelBindingStore,
  RoleHistoryStore,
  TenantId,
} from "@aurum/agent";
import { jsonbParam } from "../../domain-storage/pg/db.js";
import type { Db } from "../../domain-storage/pg/db.js";
import {
  appendVersionedRecord,
  readCurrentsVersioned,
  readCurrentVersioned,
} from "./versioned-record.js";

const BODIES = "fabric_agent_bodies";
const ROLE_ASSIGNMENTS = "fabric_role_assignments";
const BODY_MODEL_BINDINGS = "fabric_body_model_bindings";

class PgAgentBodyStore implements AgentBodyStore {
  constructor(private readonly sql: Db) {}

  async put(tenantId: TenantId, body: AgentBody): Promise<void> {
    await appendVersionedRecord(this.sql, {
      table: BODIES,
      idColumn: "body_id",
      tenantId: tenantId as string,
      recordId: body.id,
      area: "fabric-bodies",
      operation: "put",
      insert: (tx, seq) => tx`
        insert into fabric_agent_bodies (tenant_id, body_id, mutation_seq, lifecycle_state, record)
        values (${tenantId}, ${body.id}, ${seq}, ${body.lifecycle.state}, ${jsonbParam(tx, body)})
      `,
    });
  }

  async getById(tenantId: TenantId, bodyId: string): Promise<AgentBody | null> {
    return readCurrentVersioned<AgentBody>(this.sql, BODIES, "body_id", tenantId, bodyId);
  }

  async listByTenant(tenantId: TenantId): Promise<AgentBody[]> {
    const currents = await readCurrentsVersioned<AgentBody>(this.sql, BODIES, "body_id", tenantId);
    return [...currents];
  }
}

class PgRoleHistoryStore implements RoleHistoryStore {
  constructor(private readonly sql: Db) {}

  async put(tenantId: TenantId, assignment: AgentRoleAssignment): Promise<void> {
    await appendVersionedRecord(this.sql, {
      table: ROLE_ASSIGNMENTS,
      idColumn: "assignment_id",
      tenantId: tenantId as string,
      recordId: assignment.id,
      area: "fabric-role-history",
      operation: "put",
      insert: (tx, seq) => tx`
        insert into fabric_role_assignments (tenant_id, assignment_id, mutation_seq, body_id, record)
        values
          (${tenantId}, ${assignment.id}, ${seq}, ${assignment.bodyId},
           ${jsonbParam(tx, assignment)})
      `,
    });
  }

  async getById(tenantId: TenantId, assignmentId: string): Promise<AgentRoleAssignment | null> {
    return readCurrentVersioned<AgentRoleAssignment>(
      this.sql,
      ROLE_ASSIGNMENTS,
      "assignment_id",
      tenantId,
      assignmentId,
    );
  }

  async listByBody(tenantId: TenantId, bodyId: string): Promise<AgentRoleAssignment[]> {
    const currents = await readCurrentsVersioned<AgentRoleAssignment>(
      this.sql,
      ROLE_ASSIGNMENTS,
      "assignment_id",
      tenantId,
    );
    return currents.filter((assignment) => assignment.bodyId === bodyId);
  }
}

class PgBodyModelBindingStore implements BodyModelBindingStore {
  constructor(private readonly sql: Db) {}

  async put(tenantId: TenantId, binding: BodyModelBinding): Promise<void> {
    await appendVersionedRecord(this.sql, {
      table: BODY_MODEL_BINDINGS,
      idColumn: "binding_id",
      tenantId: tenantId as string,
      recordId: binding.id,
      area: "fabric-body-model-bindings",
      operation: "put",
      insert: (tx, seq) => tx`
        insert into fabric_body_model_bindings
          (tenant_id, binding_id, mutation_seq, body_id, purpose, status, record)
        values
          (${tenantId}, ${binding.id}, ${seq}, ${binding.bodyId}, ${binding.purpose},
           ${binding.status}, ${jsonbParam(tx, binding)})
      `,
    });
  }

  async getById(tenantId: TenantId, bindingId: string): Promise<BodyModelBinding | null> {
    return readCurrentVersioned<BodyModelBinding>(
      this.sql,
      BODY_MODEL_BINDINGS,
      "binding_id",
      tenantId,
      bindingId,
    );
  }

  async listByBody(tenantId: TenantId, bodyId: string): Promise<BodyModelBinding[]> {
    const currents = await readCurrentsVersioned<BodyModelBinding>(
      this.sql,
      BODY_MODEL_BINDINGS,
      "binding_id",
      tenantId,
    );
    return currents.filter((binding) => binding.bodyId === bodyId);
  }

  async findAttachedByPurpose(
    tenantId: TenantId,
    bodyId: string,
    purpose: BodyModelBinding["purpose"],
  ): Promise<BodyModelBinding | null> {
    const currents = await readCurrentsVersioned<BodyModelBinding>(
      this.sql,
      BODY_MODEL_BINDINGS,
      "binding_id",
      tenantId,
    );
    return (
      currents.find(
        (binding) =>
          binding.bodyId === bodyId && binding.purpose === purpose && binding.status === "attached",
      ) ?? null
    );
  }
}

/** Creates the agent body store bound to a database handle. */
export function createPgAgentBodyStore(sql: Db): AgentBodyStore {
  return new PgAgentBodyStore(sql);
}

/** Creates the append-only role-history ledger bound to a database handle. */
export function createPgRoleHistoryStore(sql: Db): RoleHistoryStore {
  return new PgRoleHistoryStore(sql);
}

/** Creates the append-only body->model attachment ledger bound to a handle. */
export function createPgBodyModelBindingStore(sql: Db): BodyModelBindingStore {
  return new PgBodyModelBindingStore(sql);
}
