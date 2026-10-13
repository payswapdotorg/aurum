/**
 * PostgreSQL provider fabric core (P002, migration 0001): registered
 * protocols, provider definitions and provider accounts — the
 * `ProviderProtocolStore`, `ProviderDefinitionStore` and
 * `ProviderAccountStore` ports of @aurum/provider over the versioned-upsert
 * tables.
 *
 * Semantics mirror the in-memory doubles issue-for-issue: `put` is an
 * UPSERT-by-id whose list position is the record's FIRST insertion;
 * `findByNaturalKey` resolves the first current record matching the natural
 * name (the in-memory `list().find(...)` order); built-in protocols are
 * materialized tenant views from the domain templates (imported, never
 * re-implemented); every read is tenant-scoped with foreign-tenant lookups
 * indistinguishable from missing (null / empty, no existence leakage).
 *
 * Partition-key ruling: the in-memory `TenantTable.put(tenantId, record)`
 * partitions by the PARAMETER while `putRegistered(record)` partitions by
 * the record's own tenantId — each mirror keeps its exact reference shape.
 */
import {
  builtinProtocolTemplates,
  materializeProtocol,
  type ProviderAccount,
  type ProviderAccountStore,
  type ProviderDefinition,
  type ProviderDefinitionStore,
  type ProviderProtocol,
  type ProviderProtocolStore,
  type TenantId,
} from "@aurum/provider";
import { jsonbParam } from "../../domain-storage/pg/db.js";
import type { Db } from "../../domain-storage/pg/db.js";
import {
  appendVersionedRecord,
  readCurrentsVersioned,
  readCurrentVersioned,
} from "./versioned-record.js";

const PROTOCOLS = "fabric_protocols";
const DEFINITIONS = "fabric_provider_definitions";
const ACCOUNTS = "fabric_accounts";

class PgProtocolStore implements ProviderProtocolStore {
  constructor(private readonly sql: Db) {}

  async putRegistered(record: ProviderProtocol): Promise<void> {
    // Partition key is the record's own tenantId (the reference shape).
    const tenantId = record.tenantId as string;
    await appendVersionedRecord(this.sql, {
      table: PROTOCOLS,
      idColumn: "protocol_id",
      tenantId,
      recordId: record.id,
      area: "fabric-protocols",
      operation: "put-registered",
      insert: (tx, seq) => tx`
        insert into fabric_protocols (tenant_id, protocol_id, mutation_seq, record)
        values (${tenantId}, ${record.id}, ${seq}, ${jsonbParam(tx, record)})
      `,
    });
  }

  async getRegisteredById(tenantId: TenantId, id: string): Promise<ProviderProtocol | null> {
    return readCurrentVersioned<ProviderProtocol>(this.sql, PROTOCOLS, "protocol_id", tenantId, id);
  }

  async listForTenant(tenantId: TenantId): Promise<ProviderProtocol[]> {
    const registered = await readCurrentsVersioned<ProviderProtocol>(
      this.sql,
      PROTOCOLS,
      "protocol_id",
      tenantId,
    );
    const seen = new Set(registered.map((protocol) => protocol.id));
    return [
      ...registered,
      ...builtinProtocolTemplates()
        .filter((template) => !seen.has(template.id))
        .map((template) => materializeProtocol(template, tenantId)),
    ];
  }
}

class PgDefinitionStore implements ProviderDefinitionStore {
  constructor(private readonly sql: Db) {}

  async put(tenantId: TenantId, record: ProviderDefinition): Promise<void> {
    await appendVersionedRecord(this.sql, {
      table: DEFINITIONS,
      idColumn: "definition_id",
      tenantId: tenantId as string,
      recordId: record.id,
      area: "fabric-definitions",
      operation: "put",
      insert: (tx, seq) => tx`
        insert into fabric_provider_definitions
          (tenant_id, definition_id, mutation_seq, name, protocol_id, record)
        values
          (${tenantId}, ${record.id}, ${seq}, ${record.name}, ${record.protocolId},
           ${jsonbParam(tx, record)})
      `,
    });
  }

  async getById(tenantId: TenantId, id: string): Promise<ProviderDefinition | null> {
    return readCurrentVersioned<ProviderDefinition>(
      this.sql,
      DEFINITIONS,
      "definition_id",
      tenantId,
      id,
    );
  }

  async listByTenant(tenantId: TenantId): Promise<ProviderDefinition[]> {
    const currents = await readCurrentsVersioned<ProviderDefinition>(
      this.sql,
      DEFINITIONS,
      "definition_id",
      tenantId,
    );
    return [...currents];
  }

  async findByNaturalKey(tenantId: TenantId, name: string): Promise<ProviderDefinition | null> {
    const currents = await readCurrentsVersioned<ProviderDefinition>(
      this.sql,
      DEFINITIONS,
      "definition_id",
      tenantId,
    );
    return currents.find((definition) => definition.name === name) ?? null;
  }
}

class PgAccountStore implements ProviderAccountStore {
  constructor(private readonly sql: Db) {}

  async put(tenantId: TenantId, record: ProviderAccount): Promise<void> {
    await appendVersionedRecord(this.sql, {
      table: ACCOUNTS,
      idColumn: "account_id",
      tenantId: tenantId as string,
      recordId: record.id,
      area: "fabric-accounts",
      operation: "put",
      insert: (tx, seq) => tx`
        insert into fabric_accounts
          (tenant_id, account_id, mutation_seq, provider_definition_id, connection_state, record)
        values
          (${tenantId}, ${record.id}, ${seq}, ${record.providerDefinitionId},
           ${record.connection.state}, ${jsonbParam(tx, record)})
      `,
    });
  }

  async getById(tenantId: TenantId, id: string): Promise<ProviderAccount | null> {
    return readCurrentVersioned<ProviderAccount>(this.sql, ACCOUNTS, "account_id", tenantId, id);
  }

  async listByTenant(tenantId: TenantId): Promise<ProviderAccount[]> {
    const currents = await readCurrentsVersioned<ProviderAccount>(
      this.sql,
      ACCOUNTS,
      "account_id",
      tenantId,
    );
    return [...currents];
  }

  async listByDefinition(
    tenantId: TenantId,
    providerDefinitionId: string,
  ): Promise<ProviderAccount[]> {
    const currents = await readCurrentsVersioned<ProviderAccount>(
      this.sql,
      ACCOUNTS,
      "account_id",
      tenantId,
    );
    return currents.filter((account) => account.providerDefinitionId === providerDefinitionId);
  }
}

/** Creates the registered-protocol store bound to a database handle. */
export function createPgProtocolStore(sql: Db): ProviderProtocolStore {
  return new PgProtocolStore(sql);
}

/** Creates the provider-definition store bound to a database handle. */
export function createPgDefinitionStore(sql: Db): ProviderDefinitionStore {
  return new PgDefinitionStore(sql);
}

/** Creates the provider-account store bound to a database handle. */
export function createPgAccountStore(sql: Db): ProviderAccountStore {
  return new PgAccountStore(sql);
}
