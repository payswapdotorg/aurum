/**
 * P002 area 1 — provider core (migration 0001): registered protocols,
 * provider definitions and provider accounts in PostgreSQL, mirroring the
 * W003 in-memory doubles issue-for-issue. Every journey drives BOTH stores
 * with identical domain-built records and asserts the reads deep-equal;
 * database-level enforcement (append-only trigger, version-rewrite primary
 * key, verbatim history retention) is asserted against the raw table.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildAccount,
  buildCustomDefinition,
  buildProtocol,
  buildRegistryDefinition,
  transitionConnection,
} from "@aurum/provider";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import { readVersionRows } from "../src/fabric-storage/adapters/versioned-record.js";
import {
  T0,
  T1,
  T2,
  T3,
  TENANT_A,
  TENANT_B,
  expectSameRead,
  makeProviderPair,
} from "./fabric-test-utils.js";
import type { ProviderStorePair } from "./fabric-test-utils.js";

let pair: ProviderStorePair;

beforeAll(async () => {
  pair = await makeProviderPair();
});

afterAll(async () => {
  await pair.harness.close();
});

describe("fabric provider core: round-trip equivalence", () => {
  it("protocols: registered rows round-trip; listForTenant materializes the builtins and dedups by id", async () => {
    const registered = buildProtocol(
      TENANT_A,
      { kind: "anthropic-messages", name: "Tenant A Wire", capabilities: ["chat"] },
      { id: "proto:tenant-a", now: T0 },
    );
    // A registered protocol carrying a BUILTIN's id shadows that builtin in
    // listForTenant (the in-memory dedup edge).
    const shadow = buildProtocol(
      TENANT_A,
      { kind: "openai-chat-completions", name: "Shadow", capabilities: ["chat"] },
      { id: "proto:openai-chat-completions", now: T1 },
    );
    await pair.mem.protocols.putRegistered(registered);
    await pair.pg.protocols.putRegistered(registered);
    await pair.mem.protocols.putRegistered(shadow);
    await pair.pg.protocols.putRegistered(shadow);

    expectSameRead(
      await pair.pg.protocols.getRegisteredById(TENANT_A, "proto:tenant-a"),
      await pair.mem.protocols.getRegisteredById(TENANT_A, "proto:tenant-a"),
    );
    expectSameRead(
      await pair.pg.protocols.getRegisteredById(TENANT_A, "proto:openai-chat-completions"),
      await pair.mem.protocols.getRegisteredById(TENANT_A, "proto:openai-chat-completions"),
    );
    // Never-registered builtin id: uniform null (builtins are not rows).
    expectSameRead(
      await pair.pg.protocols.getRegisteredById(TENANT_A, "proto:ollama-native"),
      await pair.mem.protocols.getRegisteredById(TENANT_A, "proto:ollama-native"),
    );
    expect(await pair.pg.protocols.getRegisteredById(TENANT_A, "proto:ollama-native")).toBeNull();

    const pgList = await pair.pg.protocols.listForTenant(TENANT_A);
    const memList = await pair.mem.protocols.listForTenant(TENANT_A);
    expectSameRead(pgList, memList);
    expect(pgList.map((protocol) => protocol.id)).toEqual([
      "proto:tenant-a",
      "proto:openai-chat-completions",
      "proto:openai-responses",
      "proto:anthropic-messages",
      "proto:ollama-native",
      "proto:google-generative",
    ]);
    // The shadowed builtin is the REGISTERED record, not the template.
    const shadowed = pgList.find((protocol) => protocol.id === "proto:openai-chat-completions");
    expect(shadowed?.name).toBe("Shadow");
    // Pure builtins carry the EPOCH tenant-stamp materialization.
    const builtin = pgList.find((protocol) => protocol.id === "proto:ollama-native");
    expect(builtin?.createdAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("definitions: registry and custom definitions round-trip; the natural key resolves the CURRENT version", async () => {
    const registry = buildRegistryDefinition(TENANT_A, "anthropic", { id: "def-1", now: T0 });
    const custom = buildCustomDefinition(
      TENANT_A,
      {
        name: "Edge Gateway",
        protocolId: "proto:openai-chat-completions",
        endpointUrl: "https://edge.example.com/v1",
        description: "tenant gateway",
        capabilities: ["chat", "tool-call"],
      },
      { id: "def-2", now: T1 },
    );
    const openai = buildRegistryDefinition(TENANT_A, "openai", { id: "def-3", now: T2 });
    for (const store of [pair.mem.definitions, pair.pg.definitions]) {
      await store.put(TENANT_A, registry);
      await store.put(TENANT_A, custom);
      await store.put(TENANT_A, openai);
    }
    // Upsert by id (the in-memory Map.set): a re-put of def-1 appends a new
    // version; the list position stays the FIRST insertion.
    const registryAgain = buildRegistryDefinition(TENANT_A, "anthropic", { id: "def-1", now: T3 });
    for (const store of [pair.mem.definitions, pair.pg.definitions]) {
      await store.put(TENANT_A, registryAgain);
    }

    expectSameRead(
      await pair.pg.definitions.getById(TENANT_A, "def-1"),
      await pair.mem.definitions.getById(TENANT_A, "def-1"),
    );
    expect((await pair.pg.definitions.getById(TENANT_A, "def-1"))?.updatedAt).toBe(T3);
    expectSameRead(
      await pair.pg.definitions.listByTenant(TENANT_A),
      await pair.mem.definitions.listByTenant(TENANT_A),
    );
    expect((await pair.pg.definitions.listByTenant(TENANT_A)).map((row) => row.id)).toEqual([
      "def-1",
      "def-2",
      "def-3",
    ]);
    expectSameRead(
      await pair.pg.definitions.findByNaturalKey(TENANT_A, "Edge Gateway"),
      await pair.mem.definitions.findByNaturalKey(TENANT_A, "Edge Gateway"),
    );
    expectSameRead(
      await pair.pg.definitions.findByNaturalKey(TENANT_A, "nope"),
      await pair.mem.definitions.findByNaturalKey(TENANT_A, "nope"),
    );
    expect(await pair.pg.definitions.findByNaturalKey(TENANT_A, "nope")).toBeNull();

    // The database retains the superseded version verbatim (history law).
    const versions = await readVersionRows(
      pair.harness.sql,
      "fabric_provider_definitions",
      "definition_id",
      TENANT_A,
      "def-1",
    );
    expect(versions).toHaveLength(2);
    expect(versions[0]?.mutationSeq).toBe(0);
    expect(versions[0]?.record).toEqual(registry);
    expect(versions[1]?.record).toEqual(registryAgain);
  });

  it("accounts: connection-lifecycle upserts round-trip with stable list order and per-definition filter", async () => {
    const account = buildAccount(
      TENANT_A,
      {
        providerDefinitionId: "def-1",
        label: "primary",
        credentials: [
          { kind: "api-key", secretRef: "secret:acct:api-key" },
          { kind: "oauth", secretRef: "secret:acct:oauth", label: "workspace" },
        ],
      },
      { id: "acct-1", now: T0 },
    );
    const other = buildAccount(
      TENANT_A,
      {
        providerDefinitionId: "def-2",
        label: "secondary",
        credentials: [{ kind: "api-key", secretRef: "secret:acct:2" }],
      },
      { id: "acct-2", now: T1 },
    );
    // The three-step connection journey (the service's put pattern).
    const connecting = transitionConnection(account, { type: "probe-started", at: T1 });
    const connected = transitionConnection(connecting, {
      type: "probe-succeeded",
      at: T2,
      evidenceId: "ev-1",
    });
    for (const store of [pair.mem.accounts, pair.pg.accounts]) {
      await store.put(TENANT_A, account);
      await store.put(TENANT_A, other);
      await store.put(TENANT_A, connecting);
      await store.put(TENANT_A, connected);
    }

    expectSameRead(
      await pair.pg.accounts.getById(TENANT_A, "acct-1"),
      await pair.mem.accounts.getById(TENANT_A, "acct-1"),
    );
    expect((await pair.pg.accounts.getById(TENANT_A, "acct-1"))?.connection.state).toBe(
      "connected",
    );
    expectSameRead(
      await pair.pg.accounts.listByTenant(TENANT_A),
      await pair.mem.accounts.listByTenant(TENANT_A),
    );
    expect((await pair.pg.accounts.listByTenant(TENANT_A)).map((row) => row.id)).toEqual([
      "acct-1",
      "acct-2",
    ]);
    expectSameRead(
      await pair.pg.accounts.listByDefinition(TENANT_A, "def-2"),
      await pair.mem.accounts.listByDefinition(TENANT_A, "def-2"),
    );
    // Credential material never enters storage: the record carries opaque
    // secret references only (round-tripped verbatim by both kernels).
    const stored = await pair.pg.accounts.getById(TENANT_A, "acct-1");
    expect(stored?.credentials).toEqual(account.credentials);
    // Three versions retained: disconnected, connecting, connected.
    const versions = await readVersionRows(
      pair.harness.sql,
      "fabric_accounts",
      "account_id",
      TENANT_A,
      "acct-1",
    );
    expect(versions.map((version) => version.record.connection.state)).toEqual([
      "disconnected",
      "connecting",
      "connected",
    ]);
  });
});

describe("fabric provider core: tenant isolation", () => {
  it("foreign-tenant reads are indistinguishable from missing and ids are independently registrable", async () => {
    const tenantBProtocol = buildProtocol(
      TENANT_B,
      { kind: "ollama-native", name: "B Wire", capabilities: ["chat"] },
      { id: "proto:tenant-a", now: T0 },
    );
    const tenantBDefinition = buildRegistryDefinition(TENANT_B, "openai", { id: "def-1", now: T0 });
    const tenantBAccount = buildAccount(
      TENANT_B,
      {
        providerDefinitionId: "def-1",
        label: "b only",
        credentials: [{ kind: "api-key", secretRef: "secret:b:1" }],
      },
      { id: "acct-1", now: T0 },
    );
    for (const store of [pair.mem.protocols, pair.pg.protocols]) {
      await store.putRegistered(tenantBProtocol);
    }
    for (const store of [pair.mem.definitions, pair.pg.definitions]) {
      await store.put(TENANT_B, tenantBDefinition);
    }
    for (const store of [pair.mem.accounts, pair.pg.accounts]) {
      await store.put(TENANT_B, tenantBAccount);
    }

    // Tenant A cannot see tenant B's records — uniformly null/empty, and
    // A's own same-id records are untouched by B's registration.
    expectSameRead(
      await pair.pg.protocols.getRegisteredById(TENANT_A, "proto:tenant-a"),
      await pair.mem.protocols.getRegisteredById(TENANT_A, "proto:tenant-a"),
    );
    expectSameRead(
      await pair.pg.definitions.getById(TENANT_A, "def-1"),
      await pair.mem.definitions.getById(TENANT_A, "def-1"),
    );
    expectSameRead(
      await pair.pg.accounts.getById(TENANT_A, "acct-1"),
      await pair.mem.accounts.getById(TENANT_A, "acct-1"),
    );
    // Tenant B sees its OWN records under the same ids.
    expect((await pair.pg.protocols.getRegisteredById(TENANT_B, "proto:tenant-a"))?.name).toBe(
      "B Wire",
    );
    expect((await pair.pg.definitions.getById(TENANT_B, "def-1"))?.name).toBe("OpenAI");
    expect((await pair.pg.accounts.listByTenant(TENANT_B)).map((row) => row.id)).toEqual([
      "acct-1",
    ]);
    expect((await pair.pg.accounts.getById(TENANT_B, "acct-1"))?.label).toBe("b only");
  });
});

describe("fabric provider core: database enforcement", () => {
  it("rejects raw UPDATE and DELETE on all three tables (append-only)", async () => {
    const sql = pair.harness.sql;
    await expect(sql`update fabric_protocols set record = '{}'::jsonb`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from fabric_protocols`).rejects.toThrow(/append-only/);
    await expect(sql`update fabric_provider_definitions set name = 'x'`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from fabric_provider_definitions`).rejects.toThrow(/append-only/);
    await expect(sql`update fabric_accounts set connection_state = 'error'`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from fabric_accounts`).rejects.toThrow(/append-only/);
  });

  it("rejects version rewrites by primary key", async () => {
    const sql = pair.harness.sql;
    // def-1 mutation 0 already exists (the round-trip proof wrote it).
    await expect(sql`
      insert into fabric_provider_definitions
        (tenant_id, definition_id, mutation_seq, name, protocol_id, record)
      values (${TENANT_A}, 'def-1', 0, 'Anthropic', 'proto:anthropic-messages', '{}'::jsonb)
    `).rejects.toThrow(/duplicate key/i);
    // A brand-new record starting above 0 is structurally allowed by the PK
    // (the adapter always allocates max+1); the append-only discipline of
    // the READ model still derives current = highest.
  });

  it("enforces the CHECK constraints on account connection state and definition shape", async () => {
    const sql = pair.harness.sql;
    await expect(sql`
      insert into fabric_accounts
        (tenant_id, account_id, mutation_seq, provider_definition_id, connection_state, record)
      values (${TENANT_A}, 'acct-bad', 0, 'def-1', 'zombie', '{}'::jsonb)
    `).rejects.toThrow(/violates check constraint/i);
    await expect(sql`
      insert into fabric_provider_definitions
        (tenant_id, definition_id, mutation_seq, name, protocol_id, record)
      values (${TENANT_A}, 'def-bad', 0, '', 'proto:x', '{}'::jsonb)
    `).rejects.toThrow(/violates check constraint/i);
  });
});

describe("fabric provider core: journal", () => {
  it("records stable mutation-identity keys for every versioned put", async () => {
    const journal = await listJournal(pair.harness.sql, TENANT_A);
    const keys = journal.map((row) => row.journalKey);
    expect(keys).toContain("fabric-protocols:put-registered:proto:tenant-a:1");
    expect(keys).toContain("fabric-protocols:put-registered:proto:openai-chat-completions:1");
    expect(keys).toContain("fabric-definitions:put:def-1:1");
    expect(keys).toContain("fabric-definitions:put:def-1:2");
    expect(keys).toContain("fabric-definitions:put:def-2:1");
    expect(keys).toContain("fabric-definitions:put:def-3:1");
    expect(keys).toContain("fabric-accounts:put:acct-1:1");
    expect(keys).toContain("fabric-accounts:put:acct-1:2");
    expect(keys).toContain("fabric-accounts:put:acct-1:3");
    expect(keys).toContain("fabric-accounts:put:acct-2:1");
    // Areas and record ids line up with the keys.
    for (const row of journal) {
      expect(row.area).toMatch(/^fabric-(protocols|definitions|accounts)$/);
      expect(row.recordId).toBeTruthy();
    }
  });
});
