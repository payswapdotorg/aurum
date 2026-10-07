/**
 * Deterministic in-memory implementation of ProviderFabricStore.
 *
 * This is the reference double for tests and local composition until the
 * PostgreSQL adapter lands (infra work). Tenant isolation is enforced at
 * the table level: every read is scoped by tenant id, and a foreign-tenant
 * lookup returns the same `null` as a missing id — uniformly, with no
 * existence leakage. Records are deep-frozen on write so stored rows can
 * never be mutated in place (append-only concerns stay append-only).
 */
import type {
  ProviderAccountStore,
  ProviderAvailabilityStore,
  ProviderDefinitionStore,
  ProviderEvidenceStore,
  ProviderFabricStore,
  ProviderHealthStore,
  ModelBindingStore,
  ModelCatalogStore,
  ProviderProtocolStore,
} from "../domain/stores.js";
import type { TenantId } from "../domain/ids.js";
import {
  builtinProtocolTemplates,
  materializeProtocol,
  type ProviderProtocol,
} from "../domain/provider-protocol.js";
import {
  subjectKey as keyOfHealthSubject,
  type HealthSubject,
  type ProviderHealthObservation,
} from "../domain/provider-health.js";
import {
  availabilitySubjectKey as keyOfAvailabilitySubject,
  type AvailabilityObservation,
  type AvailabilitySubject,
} from "../domain/provider-availability.js";
import {
  evidenceSubjectKey as keyOfEvidenceSubject,
  type EvidenceSubject,
  type ProviderEvidence,
} from "../domain/provider-evidence.js";
import type { ProviderDefinition } from "../domain/provider-definition.js";
import type { ProviderAccount } from "../domain/provider-account.js";
import type { ModelCatalogEntry } from "../domain/model-catalog.js";
import type { ModelBinding, ModelBindingPurpose } from "../domain/model-binding.js";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** Tenant-partitioned table of id-keyed records. */
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

/** Tenant-partitioned append-only log keyed by subject. */
class SubjectLog<T> {
  private readonly partitions = new Map<string, Map<string, T[]>>();

  private bucket(tenantId: TenantId): Map<string, T[]> {
    const key = tenantId as string;
    let bucket = this.partitions.get(key);
    if (bucket === undefined) {
      bucket = new Map<string, T[]>();
      this.partitions.set(key, bucket);
    }
    return bucket;
  }

  append(tenantId: TenantId, key: string, item: T): void {
    const bucket = this.bucket(tenantId);
    const log = bucket.get(key) ?? [];
    log.push(deepFreeze(item));
    bucket.set(key, log);
  }

  listBySubject(tenantId: TenantId, key: string): T[] {
    return [...(this.bucket(tenantId).get(key) ?? [])];
  }

  listAll(tenantId: TenantId): T[] {
    const all: T[] = [];
    for (const log of this.bucket(tenantId).values()) all.push(...log);
    return all;
  }
}

class InMemoryProtocolStore implements ProviderProtocolStore {
  private readonly registered = new TenantTable<ProviderProtocol>();

  async putRegistered(record: ProviderProtocol): Promise<void> {
    this.registered.put(record.tenantId, record);
  }

  async getRegisteredById(tenantId: TenantId, id: string): Promise<ProviderProtocol | null> {
    return this.registered.getById(tenantId, id);
  }

  async listForTenant(tenantId: TenantId): Promise<ProviderProtocol[]> {
    const registered = this.registered.list(tenantId);
    const seen = new Set(registered.map((protocol) => protocol.id));
    return [
      ...registered,
      ...builtinProtocolTemplates()
        .filter((template) => !seen.has(template.id))
        .map((template) => materializeProtocol(template, tenantId)),
    ];
  }
}

class InMemoryDefinitionStore implements ProviderDefinitionStore {
  private readonly table = new TenantTable<ProviderDefinition>();

  async put(tenantId: TenantId, record: ProviderDefinition): Promise<void> {
    this.table.put(tenantId, record);
  }

  async getById(tenantId: TenantId, id: string): Promise<ProviderDefinition | null> {
    return this.table.getById(tenantId, id);
  }

  async listByTenant(tenantId: TenantId): Promise<ProviderDefinition[]> {
    return this.table.list(tenantId);
  }

  async findByNaturalKey(tenantId: TenantId, name: string): Promise<ProviderDefinition | null> {
    return this.table.list(tenantId).find((definition) => definition.name === name) ?? null;
  }
}

class InMemoryAccountStore implements ProviderAccountStore {
  private readonly table = new TenantTable<ProviderAccount>();

  async put(tenantId: TenantId, record: ProviderAccount): Promise<void> {
    this.table.put(tenantId, record);
  }

  async getById(tenantId: TenantId, id: string): Promise<ProviderAccount | null> {
    return this.table.getById(tenantId, id);
  }

  async listByTenant(tenantId: TenantId): Promise<ProviderAccount[]> {
    return this.table.list(tenantId);
  }

  async listByDefinition(
    tenantId: TenantId,
    providerDefinitionId: string,
  ): Promise<ProviderAccount[]> {
    return this.table
      .list(tenantId)
      .filter((account) => account.providerDefinitionId === providerDefinitionId);
  }
}

class InMemoryCatalogStore implements ModelCatalogStore {
  private readonly table = new TenantTable<ModelCatalogEntry>();

  async put(tenantId: TenantId, record: ModelCatalogEntry): Promise<void> {
    this.table.put(tenantId, record);
  }

  async getById(tenantId: TenantId, id: string): Promise<ModelCatalogEntry | null> {
    return this.table.getById(tenantId, id);
  }

  async listByTenant(tenantId: TenantId): Promise<ModelCatalogEntry[]> {
    return this.table.list(tenantId);
  }

  async findByModelKey(
    tenantId: TenantId,
    providerDefinitionId: string,
    modelKey: string,
  ): Promise<ModelCatalogEntry | null> {
    return (
      this.table
        .list(tenantId)
        .find(
          (entry) =>
            entry.providerDefinitionId === providerDefinitionId && entry.modelKey === modelKey,
        ) ?? null
    );
  }
}

class InMemoryBindingStore implements ModelBindingStore {
  private readonly table = new TenantTable<ModelBinding>();

  async put(tenantId: TenantId, record: ModelBinding): Promise<void> {
    this.table.put(tenantId, record);
  }

  async getById(tenantId: TenantId, id: string): Promise<ModelBinding | null> {
    return this.table.getById(tenantId, id);
  }

  async listByTenant(tenantId: TenantId): Promise<ModelBinding[]> {
    return this.table.list(tenantId);
  }

  async findActiveByPurpose(
    tenantId: TenantId,
    purpose: ModelBindingPurpose,
  ): Promise<ModelBinding | null> {
    return (
      this.table
        .list(tenantId)
        .find((binding) => binding.purpose === purpose && binding.status === "active") ?? null
    );
  }

  async listByPurpose(tenantId: TenantId, purpose: ModelBindingPurpose): Promise<ModelBinding[]> {
    return this.table.list(tenantId).filter((binding) => binding.purpose === purpose);
  }
}

class InMemoryHealthStore implements ProviderHealthStore {
  private readonly log = new SubjectLog<ProviderHealthObservation>();

  async append(tenantId: TenantId, observation: ProviderHealthObservation): Promise<void> {
    this.log.append(tenantId, keyOfHealthSubject(observation.subject), observation);
  }

  async listBySubject(
    tenantId: TenantId,
    subject: HealthSubject,
  ): Promise<ProviderHealthObservation[]> {
    return this.log.listBySubject(tenantId, keyOfHealthSubject(subject));
  }
}

class InMemoryAvailabilityStore implements ProviderAvailabilityStore {
  private readonly log = new SubjectLog<AvailabilityObservation>();

  async append(tenantId: TenantId, observation: AvailabilityObservation): Promise<void> {
    this.log.append(tenantId, keyOfAvailabilitySubject(observation.subject), observation);
  }

  async listBySubject(
    tenantId: TenantId,
    subject: AvailabilitySubject,
  ): Promise<AvailabilityObservation[]> {
    return this.log.listBySubject(tenantId, keyOfAvailabilitySubject(subject));
  }
}

class InMemoryEvidenceStore implements ProviderEvidenceStore {
  private readonly table = new TenantTable<ProviderEvidence>();
  private readonly log = new SubjectLog<ProviderEvidence>();

  async append(tenantId: TenantId, evidence: ProviderEvidence): Promise<void> {
    this.table.put(tenantId, evidence);
    this.log.append(tenantId, keyOfEvidenceSubject(evidence.subject), evidence);
  }

  async getById(tenantId: TenantId, id: string): Promise<ProviderEvidence | null> {
    return this.table.getById(tenantId, id);
  }

  async listBySubject(tenantId: TenantId, subject: EvidenceSubject): Promise<ProviderEvidence[]> {
    return this.log.listBySubject(tenantId, keyOfEvidenceSubject(subject));
  }

  async listByTenant(tenantId: TenantId): Promise<ProviderEvidence[]> {
    return this.log.listAll(tenantId);
  }
}

export function createInMemoryProviderFabricStore(): ProviderFabricStore {
  return {
    protocols: new InMemoryProtocolStore(),
    definitions: new InMemoryDefinitionStore(),
    accounts: new InMemoryAccountStore(),
    catalog: new InMemoryCatalogStore(),
    bindings: new InMemoryBindingStore(),
    health: new InMemoryHealthStore(),
    availability: new InMemoryAvailabilityStore(),
    evidence: new InMemoryEvidenceStore(),
  };
}
