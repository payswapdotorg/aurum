/**
 * Concern 4 of 8 — ModelCatalogEntry: the model catalog.
 *
 * A catalog entry says a model EXISTS for a provider definition. Entries
 * arrive from two first-class sources: MANUAL registration (tenant asserts
 * the model by hand) and DISCOVERY (a discovery run observed it). Both are
 * the same record shape, both are equally bindable, and the source is
 * carried as provenance — never as a second-class flag.
 *
 * CRITICAL LAW: being listed in the catalog says NOTHING about being
 * available NOW. Availability is a separate concern (provider-availability)
 * with explicit unknown/unavailable states.
 */
import {
  asModelCatalogEntryId,
  type ModelCatalogEntryId,
  type ProviderDefinitionId,
  type TenantId,
} from "./ids.js";
import { sanitizeAndAssertClean } from "./sanitize.js";
import { validationFailed } from "./errors.js";
import {
  isProviderCapability,
  type ModelCatalogSource,
  type ProviderCapability,
} from "./vocabulary.js";
import type { RecordBookkeeping, TenantScoped } from "./ports.js";

export interface ModelCatalogEntry extends TenantScoped, RecordBookkeeping {
  readonly id: ModelCatalogEntryId;
  readonly providerDefinitionId: ProviderDefinitionId;
  /** Provider-native model key (e.g. "claude-sonnet-4-5"). */
  readonly modelKey: string;
  readonly displayName: string;
  readonly source: ModelCatalogSource;
  readonly capabilities: readonly ProviderCapability[];
  readonly contextWindowTokens: number | null;
  readonly notes: string | null;
}

export interface ManualCatalogInput {
  readonly providerDefinitionId: string;
  readonly modelKey: string;
  readonly displayName?: string;
  readonly capabilities?: readonly ProviderCapability[];
  readonly contextWindowTokens?: number;
  readonly notes?: string;
}

export function buildManualCatalogEntry(
  tenantId: TenantId,
  input: ManualCatalogInput,
  deps: { id: string; now: string },
): ModelCatalogEntry {
  return buildEntry(tenantId, input, { kind: "manual" }, deps);
}

/** Shape a discovery adapter reports for one observed model. */
export interface DiscoveredModel {
  readonly modelKey: string;
  readonly displayName?: string;
  readonly capabilities?: readonly ProviderCapability[];
  readonly contextWindowTokens?: number;
}

export function buildDiscoveredCatalogEntry(
  tenantId: TenantId,
  providerDefinitionId: string,
  discovered: DiscoveredModel,
  deps: { id: string; now: string; discoveryRunId: string },
): ModelCatalogEntry {
  return buildEntry(
    tenantId,
    {
      providerDefinitionId,
      modelKey: discovered.modelKey,
      displayName: discovered.displayName,
      capabilities: discovered.capabilities,
      contextWindowTokens: discovered.contextWindowTokens,
    },
    { kind: "discovered", discoveredAt: deps.now, discoveryRunId: deps.discoveryRunId },
    deps,
  );
}

function buildEntry(
  tenantId: TenantId,
  input: {
    readonly providerDefinitionId: string;
    readonly modelKey: string;
    readonly displayName?: string;
    readonly capabilities?: readonly ProviderCapability[];
    readonly contextWindowTokens?: number;
    readonly notes?: string;
  },
  source: ModelCatalogSource,
  deps: { id: string; now: string },
): ModelCatalogEntry {
  const modelKey = input.modelKey.trim();
  if (modelKey.length === 0 || modelKey.length > 200) {
    throw validationFailed("modelKey must be 1..200 characters");
  }
  if (/[^\w.:-]/.test(modelKey)) {
    throw validationFailed("modelKey may only contain word characters, '.', ':' and '-'");
  }
  const capabilities = input.capabilities ?? ["chat"];
  for (const capability of capabilities) {
    if (!isProviderCapability(capability)) {
      throw validationFailed(`unknown capability: ${capability}`);
    }
  }
  if (
    input.contextWindowTokens !== undefined &&
    (!Number.isSafeInteger(input.contextWindowTokens) || input.contextWindowTokens! <= 0)
  ) {
    throw validationFailed("contextWindowTokens must be a positive integer");
  }
  const displayName = sanitizeAndAssertClean((input.displayName ?? modelKey).trim());
  const notes = input.notes === undefined ? null : sanitizeAndAssertClean(input.notes.trim());
  return {
    id: asModelCatalogEntryId(deps.id),
    tenantId,
    providerDefinitionId: input.providerDefinitionId as ProviderDefinitionId,
    modelKey,
    displayName: displayName.length > 0 ? displayName : modelKey,
    source,
    capabilities: [...new Set(capabilities)],
    contextWindowTokens: input.contextWindowTokens ?? null,
    notes,
    createdAt: deps.now,
    updatedAt: deps.now,
  };
}

/** Natural identity of a catalog row: (provider, modelKey) within a tenant. */
export function catalogEntryKey(providerDefinitionId: string, modelKey: string): string {
  return `${providerDefinitionId}::${modelKey}`;
}

export function entryKeyOf(entry: ModelCatalogEntry): string {
  return catalogEntryKey(entry.providerDefinitionId, entry.modelKey);
}
