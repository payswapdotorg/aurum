/**
 * Persistence seams for the Provider Fabric.
 *
 * The app layer talks to these ports; the in-memory adapter (adapters/)
 * is the deterministic reference implementation until the PostgreSQL
 * adapter lands in infra work. All reads and writes are tenant-scoped:
 * a lookup with a foreign tenant id returns the same NOT-FOUND as a
 * missing id — cross-tenant access fails closed without existence
 * leakage (spec/ARCHITECTURE.md, Tenant isolation).
 */
import type { TenantId } from "./ids.js";
import type { ProviderProtocol } from "./provider-protocol.js";
import type { ProviderDefinition } from "./provider-definition.js";
import type { ProviderAccount } from "./provider-account.js";
import type { ModelCatalogEntry } from "./model-catalog.js";
import type { ModelBinding, ModelBindingPurpose } from "./model-binding.js";
import type { ProviderHealthObservation, HealthSubject } from "./provider-health.js";
import type { AvailabilityObservation, AvailabilitySubject } from "./provider-availability.js";
import type { ProviderEvidence, EvidenceSubject } from "./provider-evidence.js";

/** Generic tenant-scoped record store. */
export interface RecordStore<T> {
  put(tenantId: TenantId, record: T): Promise<void>;
  getById(tenantId: TenantId, id: string): Promise<T | null>;
  listByTenant(tenantId: TenantId): Promise<T[]>;
}

/** Protocol storage: builtin templates + tenant-registered protocols. */
export interface ProviderProtocolStore {
  putRegistered(record: ProviderProtocol): Promise<void>;
  getRegisteredById(tenantId: TenantId, id: string): Promise<ProviderProtocol | null>;
  listForTenant(tenantId: TenantId): Promise<ProviderProtocol[]>;
}

export interface ProviderDefinitionStore extends RecordStore<ProviderDefinition> {
  /** Enforce one custom definition per (name, protocol) natural key. */
  findByNaturalKey(tenantId: TenantId, name: string): Promise<ProviderDefinition | null>;
}

export interface ProviderAccountStore extends RecordStore<ProviderAccount> {
  listByDefinition(tenantId: TenantId, providerDefinitionId: string): Promise<ProviderAccount[]>;
}

export interface ModelCatalogStore extends RecordStore<ModelCatalogEntry> {
  findByModelKey(
    tenantId: TenantId,
    providerDefinitionId: string,
    modelKey: string,
  ): Promise<ModelCatalogEntry | null>;
}

export interface ModelBindingStore extends RecordStore<ModelBinding> {
  findActiveByPurpose(
    tenantId: TenantId,
    purpose: ModelBindingPurpose,
  ): Promise<ModelBinding | null>;
  listByPurpose(tenantId: TenantId, purpose: ModelBindingPurpose): Promise<ModelBinding[]>;
}

export interface ProviderHealthStore {
  append(tenantId: TenantId, observation: ProviderHealthObservation): Promise<void>;
  listBySubject(tenantId: TenantId, subject: HealthSubject): Promise<ProviderHealthObservation[]>;
}

export interface ProviderAvailabilityStore {
  append(tenantId: TenantId, observation: AvailabilityObservation): Promise<void>;
  listBySubject(
    tenantId: TenantId,
    subject: AvailabilitySubject,
  ): Promise<AvailabilityObservation[]>;
}

export interface ProviderEvidenceStore {
  append(tenantId: TenantId, evidence: ProviderEvidence): Promise<void>;
  getById(tenantId: TenantId, id: string): Promise<ProviderEvidence | null>;
  listBySubject(tenantId: TenantId, subject: EvidenceSubject): Promise<ProviderEvidence[]>;
  listByTenant(tenantId: TenantId): Promise<ProviderEvidence[]>;
}

/** Composite persistence seam handed to the fabric services. */
export interface ProviderFabricStore {
  readonly protocols: ProviderProtocolStore;
  readonly definitions: ProviderDefinitionStore;
  readonly accounts: ProviderAccountStore;
  readonly catalog: ModelCatalogStore;
  readonly bindings: ModelBindingStore;
  readonly health: ProviderHealthStore;
  readonly availability: ProviderAvailabilityStore;
  readonly evidence: ProviderEvidenceStore;
}
