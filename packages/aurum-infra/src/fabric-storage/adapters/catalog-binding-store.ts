/**
 * PostgreSQL model catalog + model-binding ledger (P002, migration 0002):
 * the `ModelCatalogStore` and `ModelBindingStore` ports of @aurum/provider.
 *
 * THE BINDING LEDGER LAW (model-binding.ts): bindings are append-only audit
 * records — supersede, never delete. The database mirror keeps EVERY
 * version: superseding a binding appends a new row for the SAME binding id
 * at mutation_seq + 1 (carrying the successor pointer) while the original
 * active row is retained verbatim at its own mutation_seq; the port's read
 * model derives the current record per id exactly like the in-memory
 * upsert. UPDATE/DELETE are rejected by the shared trigger, version
 * rewrites by the primary key — the ledger is append-only at the DATABASE
 * level, not just by runtime discipline.
 */
import type {
  ModelBinding,
  ModelBindingPurpose,
  ModelBindingStore,
  ModelCatalogEntry,
  ModelCatalogStore,
  TenantId,
} from "@aurum/provider";
import { jsonbParam } from "../../domain-storage/pg/db.js";
import type { Db } from "../../domain-storage/pg/db.js";
import {
  appendVersionedRecord,
  readCurrentsVersioned,
  readCurrentVersioned,
} from "./versioned-record.js";

const CATALOG = "fabric_catalog_entries";
const BINDINGS = "fabric_model_bindings";

class PgCatalogStore implements ModelCatalogStore {
  constructor(private readonly sql: Db) {}

  async put(tenantId: TenantId, record: ModelCatalogEntry): Promise<void> {
    await appendVersionedRecord(this.sql, {
      table: CATALOG,
      idColumn: "entry_id",
      tenantId: tenantId as string,
      recordId: record.id,
      area: "fabric-catalog",
      operation: "put",
      insert: (tx, seq) => tx`
        insert into fabric_catalog_entries
          (tenant_id, entry_id, mutation_seq, provider_definition_id, model_key, record)
        values
          (${tenantId}, ${record.id}, ${seq}, ${record.providerDefinitionId}, ${record.modelKey},
           ${jsonbParam(tx, record)})
      `,
    });
  }

  async getById(tenantId: TenantId, id: string): Promise<ModelCatalogEntry | null> {
    return readCurrentVersioned<ModelCatalogEntry>(this.sql, CATALOG, "entry_id", tenantId, id);
  }

  async listByTenant(tenantId: TenantId): Promise<ModelCatalogEntry[]> {
    const currents = await readCurrentsVersioned<ModelCatalogEntry>(
      this.sql,
      CATALOG,
      "entry_id",
      tenantId,
    );
    return [...currents];
  }

  async findByModelKey(
    tenantId: TenantId,
    providerDefinitionId: string,
    modelKey: string,
  ): Promise<ModelCatalogEntry | null> {
    const currents = await readCurrentsVersioned<ModelCatalogEntry>(
      this.sql,
      CATALOG,
      "entry_id",
      tenantId,
    );
    return (
      currents.find(
        (entry) =>
          entry.providerDefinitionId === providerDefinitionId && entry.modelKey === modelKey,
      ) ?? null
    );
  }
}

class PgModelBindingStore implements ModelBindingStore {
  constructor(private readonly sql: Db) {}

  async put(tenantId: TenantId, record: ModelBinding): Promise<void> {
    await appendVersionedRecord(this.sql, {
      table: BINDINGS,
      idColumn: "binding_id",
      tenantId: tenantId as string,
      recordId: record.id,
      area: "fabric-model-bindings",
      operation: "put",
      insert: (tx, seq) => tx`
        insert into fabric_model_bindings
          (tenant_id, binding_id, mutation_seq, purpose, status, record)
        values
          (${tenantId}, ${record.id}, ${seq}, ${record.purpose}, ${record.status},
           ${jsonbParam(tx, record)})
      `,
    });
  }

  async getById(tenantId: TenantId, id: string): Promise<ModelBinding | null> {
    return readCurrentVersioned<ModelBinding>(this.sql, BINDINGS, "binding_id", tenantId, id);
  }

  async listByTenant(tenantId: TenantId): Promise<ModelBinding[]> {
    const currents = await readCurrentsVersioned<ModelBinding>(
      this.sql,
      BINDINGS,
      "binding_id",
      tenantId,
    );
    return [...currents];
  }

  async findActiveByPurpose(
    tenantId: TenantId,
    purpose: ModelBindingPurpose,
  ): Promise<ModelBinding | null> {
    const currents = await readCurrentsVersioned<ModelBinding>(
      this.sql,
      BINDINGS,
      "binding_id",
      tenantId,
    );
    return (
      currents.find((binding) => binding.purpose === purpose && binding.status === "active") ?? null
    );
  }

  async listByPurpose(tenantId: TenantId, purpose: ModelBindingPurpose): Promise<ModelBinding[]> {
    const currents = await readCurrentsVersioned<ModelBinding>(
      this.sql,
      BINDINGS,
      "binding_id",
      tenantId,
    );
    return currents.filter((binding) => binding.purpose === purpose);
  }
}

/** Creates the model-catalog store bound to a database handle. */
export function createPgCatalogStore(sql: Db): ModelCatalogStore {
  return new PgCatalogStore(sql);
}

/** Creates the append-only model-binding ledger bound to a database handle. */
export function createPgModelBindingStore(sql: Db): ModelBindingStore {
  return new PgModelBindingStore(sql);
}
