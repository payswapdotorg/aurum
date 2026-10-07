/**
 * Agent fabric composition: the object application code holds. Wires the
 * two application services over shared ports; nothing concrete is chosen
 * here — store, clock, ids and the provider lookup port arrive as
 * dependencies, keeping composition at the edges.
 */
import type { Clock, IdGenerator } from "../domain/ports.js";
import type { AgentFabricStore } from "../domain/stores.js";
import type { ProviderBindingLookupPort } from "../domain/provider-lookup.js";
import { AgentBodyService } from "./agent-body-service.js";
import { BodyModelBindingService } from "./body-model-binding-service.js";

export interface AgentFabricDeps {
  readonly store: AgentFabricStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly bindingLookup: ProviderBindingLookupPort;
}

export interface AgentFabric {
  readonly bodies: AgentBodyService;
  readonly modelBindings: BodyModelBindingService;
}

export function createAgentFabric(deps: AgentFabricDeps): AgentFabric {
  return {
    bodies: new AgentBodyService(deps),
    modelBindings: new BodyModelBindingService(deps),
  };
}
