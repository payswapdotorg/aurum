/**
 * P002 test helpers: a per-file fabric harness (shared-database composition
 * — domain migrations first, then the fabric area) plus the equivalence
 * oracle pattern: every proof drives the PG-backed store AND the W003
 * in-memory reference with identical inputs (same domain builders, same
 * deterministic ids/timestamps) and asserts the reads deep-equal — the
 * P001 `expectSameResult` discipline adapted to the fabric ports (records
 * or null instead of Results).
 */
import { expect } from "vitest";
import { asTenantId, createInMemoryProviderFabricStore } from "@aurum/provider";
import type { ProviderFabricStore } from "@aurum/provider";
import { createInMemoryAgentFabricStore } from "@aurum/agent";
import type { AgentFabricStore } from "@aurum/agent";
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
