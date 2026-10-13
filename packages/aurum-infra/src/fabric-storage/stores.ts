/**
 * Composed PG-backed fabric stores (P002): the two whole-fabric
 * composition factories. Composition is consumer-owned by default (one
 * factory per store, the P001 discipline); these two convenience factories
 * wire every store of one fabric onto ONE database handle — the shape the
 * proofs and the application services drive.
 */
import type { AgentFabricStore } from "@aurum/agent";
import type { ProviderFabricStore } from "@aurum/provider";
import type { Db } from "../domain-storage/pg/db.js";
import {
  createPgCatalogStore,
  createPgModelBindingStore,
} from "./adapters/catalog-binding-store.js";
import {
  createPgAccountStore,
  createPgDefinitionStore,
  createPgProtocolStore,
} from "./adapters/provider-core-store.js";
import {
  createPgAgentBodyStore,
  createPgBodyModelBindingStore,
  createPgRoleHistoryStore,
} from "./adapters/agent-store.js";
import {
  createPgAvailabilityStore,
  createPgEvidenceStore,
  createPgHealthStore,
} from "./adapters/observation-store.js";

/** Every provider-fabric store on one database handle. */
export function createPgProviderFabricStore(sql: Db): ProviderFabricStore {
  return {
    protocols: createPgProtocolStore(sql),
    definitions: createPgDefinitionStore(sql),
    accounts: createPgAccountStore(sql),
    catalog: createPgCatalogStore(sql),
    bindings: createPgModelBindingStore(sql),
    health: createPgHealthStore(sql),
    availability: createPgAvailabilityStore(sql),
    evidence: createPgEvidenceStore(sql),
  };
}

/** Every agent-fabric store on one database handle. */
export function createPgAgentFabricStore(sql: Db): AgentFabricStore {
  return {
    bodies: createPgAgentBodyStore(sql),
    roleHistory: createPgRoleHistoryStore(sql),
    modelBindings: createPgBodyModelBindingStore(sql),
  };
}
