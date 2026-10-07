/**
 * aurum-provider public entrypoint.
 *
 * Cross-module consumers import ONLY from "@aurum/provider" (this file).
 * The composed contract surface lives in contract.ts; the deterministic
 * doubles for the persistence/transport seams (needed to compose a working
 * fabric before the PostgreSQL + real-network adapters land) are re-exported
 * here with explicit fixture-honest naming. Real provider SDK types never
 * appear on this surface.
 */
export * from "./contract.js";

// Deterministic seam doubles (test/dev composition; no network, no SDKs).
export { createInMemoryProviderFabricStore } from "./adapters/in-memory-store.js";
export { FixedClock, SteppingClock, SequentialIdGenerator } from "./adapters/deterministic.js";
export {
  FixtureProviderDiscovery,
  FixtureAccountProbe,
  FixtureExecutionTransport,
} from "./adapters/fixture-transports.js";
