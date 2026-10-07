/**
 * Provider Fabric composition: the single object application code holds.
 *
 * Composes the five application services over shared ports. This factory
 * lives in the app layer and wires NOTHING concrete: the store, the clock,
 * the id generator and both transport seams arrive as dependencies. The
 * deterministic doubles in adapters/ can produce a fully working in-memory
 * fabric for tests and local development; production wiring (PostgreSQL
 * store, real network adapters) arrives with infra/adapter work items.
 */
import type { Clock, IdGenerator } from "../domain/ports.js";
import type { ProviderFabricStore } from "../domain/stores.js";
import type { ProviderAccountProbePort, ProviderDiscoveryPort } from "../domain/transport-seams.js";
import { ProviderRegistryService } from "./provider-registry-service.js";
import { ProviderAccountService } from "./provider-account-service.js";
import { ModelCatalogService } from "./model-catalog-service.js";
import { ModelBindingService } from "./model-binding-service.js";
import { ProviderObservationService } from "./provider-observation-service.js";

export interface ProviderFabricDeps {
  readonly store: ProviderFabricStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly discovery: ProviderDiscoveryPort;
  readonly accountProbe: ProviderAccountProbePort;
}

export interface ProviderFabric {
  readonly registry: ProviderRegistryService;
  readonly accounts: ProviderAccountService;
  readonly catalog: ModelCatalogService;
  readonly bindings: ModelBindingService;
  readonly observations: ProviderObservationService;
}

export function createProviderFabric(deps: ProviderFabricDeps): ProviderFabric {
  return {
    registry: new ProviderRegistryService(deps),
    accounts: new ProviderAccountService(deps),
    catalog: new ModelCatalogService(deps),
    bindings: new ModelBindingService(deps),
    observations: new ProviderObservationService(deps),
  };
}
