/**
 * Shared deterministic composition for provider fabric tests.
 * Every test uses fixture transports and the in-memory store — no network.
 */
import {
  FixtureAccountProbe,
  FixtureProviderDiscovery,
  FixedClock,
  SequentialIdGenerator,
  SteppingClock,
  asSecretRef,
  asTenantId,
  createInMemoryProviderFabricStore,
  createProviderFabric,
  type ProviderFabric,
  type ProviderFabricStore,
} from "../src/index.js";

export const TENANT_A = asTenantId("tenant-a");
export const TENANT_B = asTenantId("tenant-b");

export const API_KEY_REF = asSecretRef("secret:provacct-1:api-key");
export const OAUTH_REF = asSecretRef("secret:provacct-1:oauth");

export interface FabricHarness {
  readonly fabric: ProviderFabric;
  readonly store: ProviderFabricStore;
  readonly clock: SteppingClock;
  readonly ids: SequentialIdGenerator;
  readonly discovery: FixtureProviderDiscovery;
  readonly probe: FixtureAccountProbe;
}

export function makeFabric(startIso = "2026-01-01T00:00:00.000Z"): FabricHarness {
  const store = createInMemoryProviderFabricStore();
  const clock = new SteppingClock(startIso, 1000);
  const ids = new SequentialIdGenerator("id");
  const discovery = new FixtureProviderDiscovery([]);
  const probe = new FixtureAccountProbe([]);
  const fabric = createProviderFabric({ store, clock, ids, discovery, accountProbe: probe });
  return { fabric, store, clock, ids, discovery, probe };
}

export { FixedClock };

/** A provider definition + connected account, ready for catalog/binding work. */
export async function makeConnectedProvider(harness: FabricHarness): Promise<{
  readonly definitionId: string;
  readonly accountId: string;
}> {
  const definition = await harness.fabric.registry.registerRegistryProvider(TENANT_A, "anthropic");
  const account = await harness.fabric.accounts.createAccount(TENANT_A, {
    providerDefinitionId: definition.id,
    label: "primary",
    credentials: [{ kind: "api-key", secretRef: API_KEY_REF }],
  });
  harness.probe.succeed("probe ok");
  await harness.fabric.accounts.connectAccount(TENANT_A, account.id);
  return { definitionId: definition.id, accountId: account.id };
}
