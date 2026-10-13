/**
 * P002 area 2 — model catalog + binding ledger (migration 0002): the
 * ModelCatalogStore and ModelBindingStore ports over PostgreSQL, proven by
 * driving the REAL application services (`createProviderFabric`) through the
 * SAME journeys the @aurum/provider suite drives, over BOTH the PG-backed
 * store and the W003 in-memory reference (identical deterministic deps —
 * the P002 equivalence ruling), plus database-level enforcement assertions
 * against the raw tables: the binding ledger is append-only at the DATABASE
 * level (trigger-rejected UPDATE/DELETE, PK-rejected version rewrites, the
 * superseded active version retained verbatim at its own mutation_seq).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import { readVersionRows } from "../src/fabric-storage/adapters/versioned-record.js";
import {
  TENANT_A,
  TENANT_B,
  expectSameFailure,
  expectSameRead,
  makeProviderServicePair,
} from "./fabric-test-utils.js";
import type { ProviderServicePair } from "./fabric-test-utils.js";
import type { ModelBinding } from "@aurum/provider";

let pair: ProviderServicePair;

beforeAll(async () => {
  pair = await makeProviderServicePair();
});

afterAll(async () => {
  await pair.harness.close();
});

/** A connected provider + two manual catalog entries, on BOTH fabrics. */
async function connectedProviderWithTwoModels(): Promise<{
  readonly definitionId: string;
  readonly firstEntryId: string;
  readonly secondEntryId: string;
}> {
  const definitionIds: string[] = [];
  const entryIds: string[] = [];
  for (const fabric of [pair.pg, pair.mem]) {
    const definition = await fabric.registry.registerRegistryProvider(TENANT_A, "anthropic");
    const account = await fabric.accounts.createAccount(TENANT_A, {
      providerDefinitionId: definition.id,
      label: "primary",
      credentials: [{ kind: "api-key", secretRef: "secret:acct:api-key" }],
    });
    pair.probeSucceeds("probe ok");
    await fabric.accounts.connectAccount(TENANT_A, account.id);
    const first = await fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definition.id,
      modelKey: "model-one",
      displayName: "Model One",
      capabilities: ["chat", "tool-call"],
      contextWindowTokens: 128_000,
      notes: "tenant-asserted",
    });
    const second = await fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definition.id,
      modelKey: "model-two",
    });
    definitionIds.push(definition.id);
    entryIds.push(first.id, second.id);
  }
  return {
    definitionId: definitionIds[0] as string,
    firstEntryId: entryIds[0] as string,
    // Both fabrics mint IDENTICAL id strings for their identical journeys,
    // so entryIds[1] (pg's second) === entryIds[3] (mem's second).
    secondEntryId: entryIds[1] as string,
  };
}

describe("fabric catalog + bindings: round-trip equivalence (real services)", () => {
  it("manual and discovered catalog entries round-trip; discovery corroborates manual rows", async () => {
    const { definitionId, firstEntryId } = await connectedProviderWithTwoModels();

    // The full catalog view is identical through both stores.
    expectSameRead(
      await pair.pg.catalog.listCatalog(TENANT_A),
      await pair.mem.catalog.listCatalog(TENANT_A),
    );
    expect((await pair.pg.catalog.listCatalog(TENANT_A)).map((entry) => entry.modelKey)).toEqual([
      "model-one",
      "model-two",
    ]);
    expectSameRead(
      await pair.pg.catalog.getEntry(TENANT_A, firstEntryId),
      await pair.mem.catalog.getEntry(TENANT_A, firstEntryId),
    );

    // A discovery run imports the new model and corroborates the manual one
    // (manual rows are never overwritten — first-class equal, not replaced).
    pair.discoveryReturns(["model-two", "model-three"]);
    const runResults = [];
    for (const fabric of [pair.pg, pair.mem]) {
      runResults.push(
        await fabric.catalog.runDiscovery(TENANT_A, {
          accountId: (await fabric.accounts.listAccounts(TENANT_A))[0]?.id as string,
        }),
      );
    }
    expectSameRead(runResults[0], runResults[1]);
    expect(runResults[0]?.imported.map((entry) => entry.modelKey)).toEqual(["model-three"]);
    expect(runResults[0]?.corroborated.map((entry) => entry.modelKey)).toEqual(["model-two"]);
    expectSameRead(
      await pair.pg.catalog.listCatalog(TENANT_A),
      await pair.mem.catalog.listCatalog(TENANT_A),
    );
    expect((await pair.pg.catalog.listCatalog(TENANT_A)).map((entry) => entry.modelKey)).toEqual([
      "model-one",
      "model-two",
      "model-three",
    ]);
    // Discovered provenance is first-class data on the entry.
    const discovered = (await pair.pg.catalog.listCatalog(TENANT_A)).find(
      (entry) => entry.modelKey === "model-three",
    );
    expect(discovered?.source).toMatchObject({ kind: "discovered" });

    // listByDefinition filter equivalence.
    expectSameRead(
      await pair.pg.catalog.listByDefinition(TENANT_A, definitionId),
      await pair.mem.catalog.listByDefinition(TENANT_A, definitionId),
    );
  });

  it("selection journeys round-trip: select, supersede, idempotent re-select, clear", async () => {
    const { firstEntryId, secondEntryId } = await connectedProviderWithTwoModels();

    const firstSelections = [];
    for (const fabric of [pair.pg, pair.mem]) {
      firstSelections.push(await fabric.bindings.selectModel(TENANT_A, "cognition", firstEntryId));
    }
    expectSameRead(firstSelections[0], firstSelections[1]);
    expect(firstSelections[0]?.active.status).toBe("active");
    expect(firstSelections[0]?.active.catalogEntryId).toBe(firstEntryId);

    // Supersede with a reason: the old binding is retained and linked.
    const secondSelections = [];
    for (const fabric of [pair.pg, pair.mem]) {
      secondSelections.push(
        await fabric.bindings.selectModel(TENANT_A, "cognition", secondEntryId, {
          reason: "cost optimization",
        }),
      );
    }
    expectSameRead(secondSelections[0], secondSelections[1]);
    expect(secondSelections[0]?.superseded?.status).toBe("superseded");
    expect(secondSelections[0]?.superseded?.supersededBy).toBe(secondSelections[0]?.active.id);
    expect(secondSelections[0]?.superseded?.supersedeReason).toBe("cost optimization");

    // The superseded row is still retrievable through both stores.
    expectSameRead(
      await pair.pg.bindings.getBinding(TENANT_A, firstSelections[0]?.active.id as string),
      await pair.mem.bindings.getBinding(TENANT_A, firstSelections[0]?.active.id as string),
    );

    // Exactly one active binding per purpose; purposes stay independent.
    expectSameRead(
      await pair.pg.bindings.getActiveBinding(TENANT_A, "cognition"),
      await pair.mem.bindings.getActiveBinding(TENANT_A, "cognition"),
    );
    const thirdSelections = [];
    for (const fabric of [pair.pg, pair.mem]) {
      thirdSelections.push(await fabric.bindings.selectModel(TENANT_A, "analysis", firstEntryId));
    }
    expectSameRead(thirdSelections[0], thirdSelections[1]);
    expectSameRead(
      await pair.pg.bindings.getActiveBinding(TENANT_A, "analysis"),
      await pair.mem.bindings.getActiveBinding(TENANT_A, "analysis"),
    );
    expectSameRead(
      await pair.pg.bindings.listBindingHistory(TENANT_A, "cognition"),
      await pair.mem.bindings.listBindingHistory(TENANT_A, "cognition"),
    );
    expect(
      (await pair.pg.bindings.listBindingHistory(TENANT_A, "cognition")).map((row) => row.status),
    ).toEqual(["superseded", "active"]);

    // Idempotent re-selection: no audit spam, same active row.
    const again = [];
    for (const fabric of [pair.pg, pair.mem]) {
      again.push(await fabric.bindings.selectModel(TENANT_A, "cognition", secondEntryId));
    }
    expectSameRead(again[0], again[1]);
    expect(again[0]?.superseded).toBeNull();
    expect((await pair.pg.bindings.listBindingHistory(TENANT_A, "cognition")).length).toBe(2);

    // Clearing supersedes without a successor; the record is retained.
    const cleared = [];
    for (const fabric of [pair.pg, pair.mem]) {
      cleared.push(await fabric.bindings.clearBinding(TENANT_A, "analysis", "tenant decision"));
    }
    expectSameRead(cleared[0], cleared[1]);
    expect(cleared[0]?.status).toBe("superseded");
    expect(cleared[0]?.supersededBy).toBeNull();
    expectSameRead(
      await pair.pg.bindings.getActiveBinding(TENANT_A, "analysis"),
      await pair.mem.bindings.getActiveBinding(TENANT_A, "analysis"),
    );
    expect(await pair.pg.bindings.getActiveBinding(TENANT_A, "analysis")).toBeNull();
  });

  it("validation and not-found failures are identical issue-for-issue", async () => {
    const { firstEntryId } = await connectedProviderWithTwoModels();
    const definitionId = (await pair.pg.catalog.getEntry(TENANT_A, firstEntryId))
      .providerDefinitionId;
    // Unknown catalog entry: uniform CATALOG_ENTRY_NOT_FOUND.
    await expectSameFailure(
      pair.pg.bindings.selectModel(TENANT_A, "cognition", "cat-missing"),
      pair.mem.bindings.selectModel(TENANT_A, "cognition", "cat-missing"),
    );
    // Duplicate manual entry for the same (definition, modelKey).
    await expectSameFailure(
      pair.pg.catalog.addManualEntry(TENANT_A, {
        providerDefinitionId: definitionId,
        modelKey: "model-one",
      }),
      pair.mem.catalog.addManualEntry(TENANT_A, {
        providerDefinitionId: definitionId,
        modelKey: "model-one",
      }),
    );
    // Missing binding id: uniform BINDING_NOT_FOUND.
    await expectSameFailure(
      pair.pg.bindings.getBinding(TENANT_A, "bind-missing"),
      pair.mem.bindings.getBinding(TENANT_A, "bind-missing"),
    );
    // Missing catalog entry read: uniform CATALOG_ENTRY_NOT_FOUND.
    await expectSameFailure(
      pair.pg.catalog.getEntry(TENANT_A, "cat-missing"),
      pair.mem.catalog.getEntry(TENANT_A, "cat-missing"),
    );
  });
});

describe("fabric catalog + bindings: the binding ledger is append-only at the database level", () => {
  it("retains the superseded ACTIVE version verbatim and appends the supersede as a new row", async () => {
    // The selection proof selected model-one then model-two for cognition:
    // the first binding carries two versions — the ORIGINAL active record
    // verbatim at mutation_seq 0, the superseded rewrite appended at seq 1.
    // The database never rewrote the original row.
    const journal = await listJournal(pair.harness.sql, TENANT_A);
    const firstBindingId = journal.find((row) => row.area === "fabric-model-bindings")
      ?.recordId as string;
    const versions = await readVersionRows<ModelBinding>(
      pair.harness.sql,
      "fabric_model_bindings",
      "binding_id",
      TENANT_A,
      firstBindingId,
    );
    expect(versions).toHaveLength(2);
    expect(versions[0]?.mutationSeq).toBe(0);
    expect(versions[1]?.mutationSeq).toBe(1);
    // The original row is exactly the first selection's active record.
    expect(versions[0]?.record.status).toBe("active");
    expect(versions[0]?.record.supersededBy).toBeNull();
    expect(versions[0]?.record.supersededAt).toBeNull();
    expect(versions[0]?.record.supersedeReason).toBeNull();
    // The rewrite is the same record with only the supersede fields moved.
    expect(versions[1]?.record.id).toBe(versions[0]?.record.id);
    expect(versions[1]?.record.status).toBe("superseded");
    expect(typeof versions[1]?.record.supersededBy).toBe("string");
    expect(versions[1]?.record.supersededBy).not.toBe(versions[1]?.record.id);
    expect(versions[1]?.record.catalogEntryId).toBe(versions[0]?.record.catalogEntryId);
    expect(versions[1]?.record.selectedAt).toBe(versions[0]?.record.selectedAt);
    expect(versions[1]?.record.createdAt).toBe(versions[0]?.record.createdAt);
  });

  it("rejects raw UPDATE and DELETE on both tables (append-only trigger)", async () => {
    const sql = pair.harness.sql;
    await expect(sql`update fabric_catalog_entries set model_key = 'x'`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from fabric_catalog_entries`).rejects.toThrow(/append-only/);
    await expect(sql`update fabric_model_bindings set status = 'active'`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from fabric_model_bindings`).rejects.toThrow(/append-only/);
  });

  it("rejects version rewrites by primary key and vocabulary violations by CHECK", async () => {
    const sql = pair.harness.sql;
    const journal = await listJournal(sql, TENANT_A);
    const firstBindingId = journal.find((row) => row.area === "fabric-model-bindings")
      ?.recordId as string;
    // Same (tenant, binding, mutation_seq): a version rewrite.
    await expect(sql`
      insert into fabric_model_bindings (tenant_id, binding_id, mutation_seq, purpose, status, record)
      values (${TENANT_A}, ${firstBindingId}, 0, 'cognition', 'active', '{}'::jsonb)
    `).rejects.toThrow(/duplicate key/i);
    // Status outside the closed vocabulary.
    await expect(sql`
      insert into fabric_model_bindings (tenant_id, binding_id, mutation_seq, purpose, status, record)
      values (${TENANT_A}, 'bind-bad', 0, 'cognition', 'zombie', '{}'::jsonb)
    `).rejects.toThrow(/violates check constraint/i);
    // Empty model key on the catalog.
    await expect(sql`
      insert into fabric_catalog_entries
        (tenant_id, entry_id, mutation_seq, provider_definition_id, model_key, record)
      values (${TENANT_A}, 'entry-bad', 0, 'def-1', '', '{}'::jsonb)
    `).rejects.toThrow(/violates check constraint/i);
  });

  it("keeps credential material out of storage: account rows carry opaque secret references only", async () => {
    const sql = pair.harness.sql;
    // Every account row this journey created (disconnected -> connecting ->
    // connected) must contain ONLY the opaque secret references — no key
    // material, no tokens — in any version's jsonb record.
    const rows = await sql`
      select record::text as record_text from fabric_accounts where tenant_id = ${TENANT_A}
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.record_text as string).toContain("secret:acct:api-key");
      expect(row.record_text as string).not.toMatch(/sk-[a-zA-Z0-9]/);
      expect(row.record_text as string).not.toMatch(/"apiKey"/);
      expect(row.record_text as string).not.toMatch(/"token"/);
      expect(row.record_text as string).not.toMatch(/"password"/);
    }
  });
});

describe("fabric catalog + bindings: tenant isolation", () => {
  it("foreign-tenant reads are indistinguishable from missing; ids are independently registrable", async () => {
    // Tenant B runs its OWN connected-provider + selection journey.
    for (const fabric of [pair.pg, pair.mem]) {
      const definition = await fabric.registry.registerRegistryProvider(TENANT_B, "openai");
      const account = await fabric.accounts.createAccount(TENANT_B, {
        providerDefinitionId: definition.id,
        label: "b only",
        credentials: [{ kind: "api-key", secretRef: "secret:b:1" }],
      });
      pair.probeSucceeds("ok");
      await fabric.accounts.connectAccount(TENANT_B, account.id);
      const entry = await fabric.catalog.addManualEntry(TENANT_B, {
        providerDefinitionId: definition.id,
        modelKey: "gpt-test",
      });
      await fabric.bindings.selectModel(TENANT_B, "cognition", entry.id);
    }

    // Tenant A's catalog and bindings are untouched by B's journey, and
    // every A-read of B's records is indistinguishable from missing (the
    // identical error a missing id produces, on both stores).
    expectSameRead(
      await pair.pg.catalog.listCatalog(TENANT_A),
      await pair.mem.catalog.listCatalog(TENANT_A),
    );
    expect(
      (await pair.pg.catalog.listCatalog(TENANT_A)).map((entry) => entry.modelKey),
    ).not.toContain("gpt-test");
    const bEntry = (await pair.pg.catalog.listCatalog(TENANT_B))[0];
    expect(bEntry?.modelKey).toBe("gpt-test");
    await expectSameFailure(
      pair.pg.catalog.getEntry(TENANT_A, bEntry?.id as string),
      pair.mem.catalog.getEntry(TENANT_A, bEntry?.id as string),
    );
    // B's binding for the same purpose is invisible to A; A's own active
    // binding for cognition is unchanged (still model-two).
    expectSameRead(
      await pair.pg.bindings.getActiveBinding(TENANT_A, "cognition"),
      await pair.mem.bindings.getActiveBinding(TENANT_A, "cognition"),
    );
    expect(
      (await pair.pg.bindings.getActiveBinding(TENANT_A, "cognition"))?.catalogEntryId,
    ).not.toBe(bEntry?.id);
    expect((await pair.pg.bindings.getActiveBinding(TENANT_B, "cognition"))?.catalogEntryId).toBe(
      bEntry?.id,
    );
  });
});

describe("fabric catalog + bindings: journal", () => {
  it("records stable mutation-identity keys for catalog puts and binding versions", async () => {
    const journal = await listJournal(pair.harness.sql, TENANT_A);
    const keys = journal.map((row) => row.journalKey);
    // Catalog: one journal key per put (each entry put exactly once here).
    const catalogPuts = keys.filter((key) => key.startsWith("fabric-catalog:put:"));
    expect(catalogPuts.length).toBeGreaterThanOrEqual(3);
    for (const key of catalogPuts) {
      expect(key).toMatch(/^fabric-catalog:put:[^:]+:1$/);
    }
    // Bindings: version-stamped keys — first binding has :1 and :2 (active
    // put + supersede rewrite), its successor :1.
    const bindingPuts = keys.filter((key) => key.startsWith("fabric-model-bindings:put:"));
    expect(bindingPuts.some((key) => key.endsWith(":1"))).toBe(true);
    expect(bindingPuts.some((key) => key.endsWith(":2"))).toBe(true);
    for (const row of journal.filter((entry) => entry.area === "fabric-model-bindings")) {
      expect(row.operation).toBe("put");
      expect(row.recordId).toBeTruthy();
    }
  });
});
