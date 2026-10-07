/**
 * aurum-agent public entrypoint.
 *
 * Cross-module consumers import ONLY from "@aurum/agent" (this file): the
 * composed contract surface plus the deterministic doubles needed to
 * compose a working fabric before PostgreSQL/real adapters land.
 */
export * from "./contract.js";

// Deterministic seam doubles (test/dev composition).
export { createInMemoryAgentFabricStore } from "./adapters/in-memory-store.js";
export { FixedClock, SteppingClock, SequentialIdGenerator } from "./adapters/deterministic.js";
export { ProviderFabricBindingLookup } from "./adapters/provider-fabric-lookup.js";
