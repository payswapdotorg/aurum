/**
 * Model catalog application service.
 *
 * Manual and discovered entries are both first-class rows of ONE catalog.
 * Discovery runs go through the discovery seam; a failed run leaves the
 * catalog untouched and records failure evidence (fixture-honest: the seam
 * double replays scripted results, no real network).
 */
import type { Clock, IdGenerator } from "../domain/ports.js";
import type { ProviderFabricStore } from "../domain/stores.js";
import type { ProviderDiscoveryPort } from "../domain/transport-seams.js";
import { duplicate, notFound } from "../domain/errors.js";
import {
  buildDiscoveredCatalogEntry,
  buildManualCatalogEntry,
  catalogEntryKey,
  entryKeyOf,
  type ManualCatalogInput,
  type ModelCatalogEntry,
} from "../domain/model-catalog.js";
import { buildEvidence } from "../domain/provider-evidence.js";
import { credentialRefsOf } from "../domain/provider-account.js";
import type { TenantId } from "../domain/ids.js";

export interface ModelCatalogDeps {
  readonly store: ProviderFabricStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly discovery: ProviderDiscoveryPort;
}

export interface DiscoveryRunOutcome {
  readonly runId: string;
  readonly ok: boolean;
  /** Catalog entries imported by this run (new rows). */
  readonly imported: readonly ModelCatalogEntry[];
  /** Existing entries the run corroborated (manual rows confirmed live). */
  readonly corroborated: readonly ModelCatalogEntry[];
  readonly error: string | null;
}

export class ModelCatalogService {
  constructor(private readonly deps: ModelCatalogDeps) {}

  async addManualEntry(tenantId: TenantId, input: ManualCatalogInput): Promise<ModelCatalogEntry> {
    const definition = await this.deps.store.definitions.getById(
      tenantId,
      input.providerDefinitionId,
    );
    if (definition === null) {
      throw notFound("PROVIDER_NOT_FOUND", `provider definition ${input.providerDefinitionId}`);
    }
    const existing = await this.deps.store.catalog.findByModelKey(
      tenantId,
      input.providerDefinitionId,
      input.modelKey.trim(),
    );
    if (existing !== null) {
      throw duplicate(`catalog entry ${input.modelKey}`);
    }
    const entry = buildManualCatalogEntry(tenantId, input, {
      id: this.deps.ids.next(),
      now: this.deps.clock.now(),
    });
    await this.deps.store.catalog.put(tenantId, entry);
    return entry;
  }

  async getEntry(tenantId: TenantId, entryId: string): Promise<ModelCatalogEntry> {
    const entry = await this.deps.store.catalog.getById(tenantId, entryId);
    if (entry === null) {
      throw notFound("CATALOG_ENTRY_NOT_FOUND", `catalog entry ${entryId}`);
    }
    return entry;
  }

  async listCatalog(tenantId: TenantId): Promise<ModelCatalogEntry[]> {
    return this.deps.store.catalog.listByTenant(tenantId);
  }

  async listByDefinition(
    tenantId: TenantId,
    providerDefinitionId: string,
  ): Promise<ModelCatalogEntry[]> {
    const all = await this.deps.store.catalog.listByTenant(tenantId);
    return all.filter((entry) => entry.providerDefinitionId === providerDefinitionId);
  }

  /**
   * Run a discovery pass for a provider account through the seam. Manual
   * entries are never overwritten: an observed model that already exists is
   * recorded as corroboration evidence, keeping manual rows authoritative
   * for what the tenant asserted by hand.
   */
  async runDiscovery(
    tenantId: TenantId,
    input: { readonly accountId: string },
  ): Promise<DiscoveryRunOutcome> {
    const account = await this.deps.store.accounts.getById(tenantId, input.accountId);
    if (account === null) {
      throw notFound("ACCOUNT_NOT_FOUND", `provider account ${input.accountId}`);
    }
    const definition = await this.deps.store.definitions.getById(
      tenantId,
      account.providerDefinitionId,
    );
    if (definition === null) {
      throw notFound("PROVIDER_NOT_FOUND", `provider definition ${account.providerDefinitionId}`);
    }
    const runId = this.deps.ids.next();
    const result = await this.deps.discovery.discoverModels({
      providerDefinitionId: definition.id,
      protocolId: definition.protocolId,
      endpointUrl: definition.endpointUrl,
      credentialRefs: credentialRefsOf(account),
    });
    if (!result.ok) {
      await this.deps.store.evidence.append(
        tenantId,
        buildEvidence(
          tenantId,
          {
            kind: "discovery-run",
            subject: { kind: "provider-definition", definitionId: definition.id },
            outcome: "failure",
            detail: result.error,
          },
          { id: runId, now: this.deps.clock.now() },
        ),
      );
      return { runId, ok: false, imported: [], corroborated: [], error: result.error };
    }

    const imported: ModelCatalogEntry[] = [];
    const corroborated: ModelCatalogEntry[] = [];
    const existing = await this.listByDefinition(tenantId, definition.id);
    const byKey = new Map(existing.map((entry) => [entryKeyOf(entry), entry]));
    for (const discovered of result.models) {
      const key = catalogEntryKey(definition.id, discovered.modelKey);
      const prior = byKey.get(key);
      if (prior === undefined) {
        const entry = buildDiscoveredCatalogEntry(tenantId, definition.id, discovered, {
          id: this.deps.ids.next(),
          now: this.deps.clock.now(),
          discoveryRunId: runId,
        });
        await this.deps.store.catalog.put(tenantId, entry);
        byKey.set(key, entry);
        imported.push(entry);
      } else {
        corroborated.push(prior);
      }
    }
    await this.deps.store.evidence.append(
      tenantId,
      buildEvidence(
        tenantId,
        {
          kind: "discovery-run",
          subject: { kind: "provider-definition", definitionId: definition.id },
          outcome: "success",
          detail: `discovered ${result.models.length} model(s); imported ${imported.length}, corroborated ${corroborated.length}`,
        },
        { id: runId, now: this.deps.clock.now() },
      ),
    );
    return { runId, ok: true, imported, corroborated, error: null };
  }
}
