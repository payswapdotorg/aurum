/**
 * P002 test helpers: a per-file fabric harness (shared-database composition
 * — domain migrations first, then the fabric area) plus the equivalence
 * oracle pattern: every proof drives the PG-backed store AND the W003
 * in-memory reference with identical inputs (same domain builders, same
 * deterministic ids/timestamps) and asserts the reads deep-equal — the
 * P001 `expectSameResult` discipline adapted to the fabric ports (records
 * or null instead of Results).
 *
 * Service-level pairs (the P002 equivalence ruling): the REAL application
 * services (`createProviderFabric` / `createAgentFabric`) are composed over
 * the PG-backed store AND over the in-memory store, each with its OWN
 * identically-scripted deterministic deps (same clock start/step, same id
 * prefix, same fixture scripts) — the exact journeys the @aurum/provider
 * and @aurum/agent suites drive, replayed against PostgreSQL. The ruling
 * and its rationale are recorded in fabric-storage/WORK-NOTES.md.
 */
import { expect } from "vitest";
import {
  FixtureAccountProbe,
  FixtureProviderDiscovery,
  SequentialIdGenerator,
  SteppingClock,
  asTenantId,
  createInMemoryProviderFabricStore,
  createProviderFabric,
} from "@aurum/provider";
import type { ProviderFabric, ProviderFabricStore } from "@aurum/provider";
import {
  SequentialIdGenerator as AgentSequentialIdGenerator,
  SteppingClock as AgentSteppingClock,
  createAgentFabric,
  createInMemoryAgentFabricStore,
} from "@aurum/agent";
import type {
  AgentFabric,
  AgentFabricStore,
  ModelBindingSnapshot,
  ProviderBindingLookupPort,
  TenantId as AgentTenantId,
} from "@aurum/agent";
import type { PgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";
import { createFabricPgLiteHarness } from "../src/fabric-storage/fabric-runner.js";
import {
  createPgAgentFabricStore,
  createPgProviderFabricStore,
} from "../src/fabric-storage/stores.js";

export const TENANT_A = asTenantId("tenant-a");
export const TENANT_B = asTenantId("tenant-b");

/** Deterministic timestamps (the SteppingClock cadence the suites use). */
export const T0 = "2026-01-01T00:00:00.000Z";
export const T1 = "2026-01-01T00:00:01.000Z";
export const T2 = "2026-01-01T00:00:02.000Z";
export const T3 = "2026-01-01T00:00:03.000Z";
export const T4 = "2026-01-01T00:00:04.000Z";
export const T5 = "2026-01-01T00:00:05.000Z";

/** The equivalence oracle: PG read must deep-equal the in-memory read. */
export function expectSameRead<T>(actual: T, expected: T): void {
  expect(actual).toEqual(expected);
}

/** Boots the shared-database fabric harness (domain + fabric areas). */
export async function bootFabricHarness(): Promise<PgLiteHarness> {
  return createFabricPgLiteHarness();
}

/** Both provider fabrics on one harness: PG store + in-memory reference. */
export interface ProviderStorePair {
  readonly harness: PgLiteHarness;
  readonly pg: ProviderFabricStore;
  readonly mem: ProviderFabricStore;
}

export async function makeProviderPair(): Promise<ProviderStorePair> {
  const harness = await bootFabricHarness();
  return {
    harness,
    pg: createPgProviderFabricStore(harness.sql),
    mem: createInMemoryProviderFabricStore(),
  };
}

/** Both agent fabrics on one harness: PG store + in-memory reference. */
export interface AgentStorePair {
  readonly harness: PgLiteHarness;
  readonly pg: AgentFabricStore;
  readonly mem: AgentFabricStore;
}

export async function makeAgentPair(): Promise<AgentStorePair> {
  const harness = await bootFabricHarness();
  return {
    harness,
    pg: createPgAgentFabricStore(harness.sql),
    mem: createInMemoryAgentFabricStore(),
  };
}

/**
 * The equivalence oracle for failures: both fabrics must reject the same
 * call with the same error `code` and message (the P001 issue-for-issue
 * discipline, adapted to the fabric's thrown ProviderFabricError /
 * AgentFabricError instead of Result values). Returns the PG error so a
 * proof can assert more of its shape.
 */
export async function expectSameFailure(
  pgCall: Promise<unknown>,
  memCall: Promise<unknown>,
): Promise<Error & { readonly code: unknown }> {
  const settle = (call: Promise<unknown>): Promise<unknown> =>
    call.then(
      () => {
        throw new Error("expected the call to fail, but it resolved");
      },
      (error: unknown) => error,
    );
  // Promise.all attaches BOTH handlers synchronously — a sequential await
  // would leave one rejection briefly unhandled.
  const [pgError, memError] = await Promise.all([settle(pgCall), settle(memCall)]);
  expect(pgError).toBeInstanceOf(Error);
  expect(memError).toBeInstanceOf(Error);
  const pg = pgError as Error & { readonly code: unknown };
  const mem = memError as Error & { readonly code: unknown };
  expect(pg.code).toEqual(mem.code);
  expect(pg.message).toBe(mem.message);
  return pg;
}

/** Both clocks' shared start (proofs step them in lockstep). */
const SERVICE_CLOCK_START = "2026-01-01T00:00:00.000Z";

/** Both id generators' shared prefix (ids mint in lockstep per journey). */
const SERVICE_ID_PREFIX = "id";

/**
 * The provider-fabric service pair: REAL services over both stores, with
 * symmetric scripting helpers that queue the SAME transport scripts on
 * both fabrics' fixture doubles (keeping every generated id/timestamp
 * identical across the two stores).
 */
export interface ProviderServicePair {
  readonly harness: PgLiteHarness;
  /** Real services (registry/accounts/catalog/bindings/observations) over PG. */
  readonly pg: ProviderFabric;
  /** The same services over the in-memory reference store. */
  readonly mem: ProviderFabric;
  /** Queue a successful probe on both fabrics' probe doubles. */
  probeSucceeds(detail?: string): void;
  /** Queue a failed probe on both fabrics' probe doubles. */
  probeFails(error: string): void;
  /** Queue a discovery result on both fabrics' discovery doubles. */
  discoveryReturns(modelKeys: readonly string[]): void;
}

export async function makeProviderServicePair(): Promise<ProviderServicePair> {
  const harness = await bootFabricHarness();
  const pgDiscovery = new FixtureProviderDiscovery();
  const memDiscovery = new FixtureProviderDiscovery();
  const pgProbe = new FixtureAccountProbe();
  const memProbe = new FixtureAccountProbe();
  const pg = createProviderFabric({
    store: createPgProviderFabricStore(harness.sql),
    clock: new SteppingClock(SERVICE_CLOCK_START, 1000),
    ids: new SequentialIdGenerator(SERVICE_ID_PREFIX),
    discovery: pgDiscovery,
    accountProbe: pgProbe,
  });
  const mem = createProviderFabric({
    store: createInMemoryProviderFabricStore(),
    clock: new SteppingClock(SERVICE_CLOCK_START, 1000),
    ids: new SequentialIdGenerator(SERVICE_ID_PREFIX),
    discovery: memDiscovery,
    accountProbe: memProbe,
  });
  return {
    harness,
    pg,
    mem,
    probeSucceeds: (detail?: string) => {
      pgProbe.succeed(detail);
      memProbe.succeed(detail);
    },
    probeFails: (error: string) => {
      pgProbe.fail(error);
      memProbe.fail(error);
    },
    discoveryReturns: (modelKeys: readonly string[]) => {
      pgDiscovery.returns(modelKeys.map((modelKey) => ({ modelKey })));
      memDiscovery.returns(modelKeys.map((modelKey) => ({ modelKey })));
    },
  };
}

/**
 * Scriptable provider-binding lookup double for the agent service pair
 * (the agent package's own test helper, re-implemented against the EXPORTED
 * port — cross-package test helpers are not importable, and the P001
 * ruling-10 discipline does not apply to test doubles).
 */
export class ScriptedBindingLookup implements ProviderBindingLookupPort {
  private readonly snapshots = new Map<string, ModelBindingSnapshot>();

  active(bindingId: string, purpose = "cognition"): void {
    this.snapshots.set(bindingId, {
      id: bindingId,
      purpose,
      status: "active",
      catalogEntryId: `cat-${bindingId}`,
    });
  }

  async getActiveModelBinding(
    _tenantId: AgentTenantId,
    bindingId: string,
  ): Promise<ModelBindingSnapshot | null> {
    return this.snapshots.get(bindingId) ?? null;
  }
}

/** The agent-fabric service pair: REAL services over both stores. */
export interface AgentServicePair {
  readonly harness: PgLiteHarness;
  /** Real services (bodies/modelBindings) over PG. */
  readonly pg: AgentFabric;
  /** The same services over the in-memory reference store. */
  readonly mem: AgentFabric;
  /** Make a binding reference resolve active on BOTH lookup doubles. */
  lookupActive(bindingId: string): void;
}

export async function makeAgentServicePair(): Promise<AgentServicePair> {
  const harness = await bootFabricHarness();
  const pgLookup = new ScriptedBindingLookup();
  const memLookup = new ScriptedBindingLookup();
  const pg = createAgentFabric({
    store: createPgAgentFabricStore(harness.sql),
    clock: new AgentSteppingClock(SERVICE_CLOCK_START, 1000),
    ids: new AgentSequentialIdGenerator("agent-id"),
    bindingLookup: pgLookup,
  });
  const mem = createAgentFabric({
    store: createInMemoryAgentFabricStore(),
    clock: new AgentSteppingClock(SERVICE_CLOCK_START, 1000),
    ids: new AgentSequentialIdGenerator("agent-id"),
    bindingLookup: memLookup,
  });
  return {
    harness,
    pg,
    mem,
    lookupActive: (bindingId: string) => {
      pgLookup.active(bindingId);
      memLookup.active(bindingId);
    },
  };
}
