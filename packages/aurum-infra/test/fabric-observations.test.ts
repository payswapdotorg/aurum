/**
 * P002 area 3 — provider observation logs (migration 0003): health,
 * availability and evidence stores over PostgreSQL, proven by driving the
 * REAL ProviderObservationService through the SAME journeys the
 * @aurum/provider suite drives, over BOTH the PG-backed store and the W003
 * in-memory reference (identical deterministic deps — the P002 equivalence
 * ruling). Database-level enforcement is asserted against the raw tables:
 * append-only trigger on all three logs, one-immutable-row-per-id primary
 * keys (a duplicate id is an infrastructure error, never a silent history
 * rewrite), and the availability position PK.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import { createPgProviderFabricStore } from "../src/fabric-storage/stores.js";
import {
  TENANT_A,
  TENANT_B,
  expectSameFailure,
  expectSameRead,
  makeProviderServicePair,
} from "./fabric-test-utils.js";
import type { ProviderServicePair } from "./fabric-test-utils.js";

let pair: ProviderServicePair;

beforeAll(async () => {
  pair = await makeProviderServicePair();
});

afterAll(async () => {
  await pair.harness.close();
});

/** The account subject both health and availability observations target. */
const ACCOUNT_SUBJECT = { kind: "provider-account", accountId: "acct-1" } as const;
const DEFINITION_SUBJECT = { kind: "provider-definition", definitionId: "def-1" } as const;
const MODEL_SUBJECT = { kind: "model", catalogEntryId: "cat-1" } as const;

describe("fabric observations: round-trip equivalence (real services)", () => {
  it("health observations round-trip per subject and project the latest-wins current health", async () => {
    // Interleaved subjects: the log is per-subject, append order preserved.
    const healthJourneys: readonly {
      readonly subject: typeof ACCOUNT_SUBJECT | typeof DEFINITION_SUBJECT;
      readonly status: "healthy" | "degraded" | "down";
      readonly detail: string;
    }[] = [
      { subject: ACCOUNT_SUBJECT, status: "healthy", detail: "probe ok" },
      { subject: DEFINITION_SUBJECT, status: "degraded", detail: "latency" },
      { subject: ACCOUNT_SUBJECT, status: "degraded", detail: "slow" },
      { subject: ACCOUNT_SUBJECT, status: "healthy", detail: "recovered" },
    ];
    for (const journey of healthJourneys) {
      for (const fabric of [pair.pg, pair.mem]) {
        await fabric.observations.recordHealth(TENANT_A, journey);
      }
    }

    expectSameRead(
      await pair.pg.observations.currentHealth(TENANT_A, ACCOUNT_SUBJECT),
      await pair.mem.observations.currentHealth(TENANT_A, ACCOUNT_SUBJECT),
    );
    expect(await pair.pg.observations.currentHealth(TENANT_A, ACCOUNT_SUBJECT)).toEqual({
      status: "healthy",
      observedAt: expect.any(String),
    });
    expectSameRead(
      await pair.pg.observations.currentHealth(TENANT_A, DEFINITION_SUBJECT),
      await pair.mem.observations.currentHealth(TENANT_A, DEFINITION_SUBJECT),
    );
    // A subject with NO observations projects the EXPLICIT unknown — never
    // absent, never a default "healthy".
    expectSameRead(
      await pair.pg.observations.currentHealth(TENANT_A, {
        kind: "model-endpoint",
        definitionId: "def-1",
        modelKey: "nope",
      }),
      await pair.mem.observations.currentHealth(TENANT_A, {
        kind: "model-endpoint",
        definitionId: "def-1",
        modelKey: "nope",
      }),
    );
    expect(
      await pair.pg.observations.currentHealth(TENANT_A, {
        kind: "model-endpoint",
        definitionId: "def-1",
        modelKey: "nope",
      }),
    ).toEqual({ status: "unknown", observedAt: null });

    // Store-level read: the adapter boundary hands out deep-frozen records
    // (the in-memory double's defense-in-depth, mirrored) and the raw table
    // holds exactly the four appended observations.
    const store = createPgProviderFabricStore(pair.harness.sql);
    const accountHealth = await store.health.listBySubject(TENANT_A, ACCOUNT_SUBJECT);
    expect(accountHealth).toHaveLength(3);
    expect(Object.isFrozen(accountHealth[0])).toBe(true);
    expect(Object.isFrozen(accountHealth[0]?.subject)).toBe(true);
    const rawRows = await pair.harness.sql`
      select 1 from fabric_health_observations where tenant_id = ${TENANT_A}
    `;
    expect(rawRows.length).toBe(4);
  });

  it("availability observations round-trip with the explicit unknown and staleness degradation", async () => {
    // No observations yet: the EXPLICIT unknown (a listing is never
    // "available" by implication — the availability law). Every service
    // call is made SYMMETRICALLY on both fabrics and the pg result is then
    // asserted on the captured value — a one-sided call would advance one
    // fabric's clock and de-sync the deterministic timestamps.
    const unknownPg = await pair.pg.observations.availabilityOf(TENANT_A, MODEL_SUBJECT);
    const unknownMem = await pair.mem.observations.availabilityOf(TENANT_A, MODEL_SUBJECT);
    expectSameRead(unknownPg, unknownMem);
    expect(unknownPg).toEqual({
      subject: MODEL_SUBJECT,
      state: "unknown",
      reason: null,
      lastObservedAt: null,
      stale: false,
    });

    // Mark available, then evaluate inside the freshness window.
    for (const fabric of [pair.pg, pair.mem]) {
      await fabric.observations.markAvailable(TENANT_A, MODEL_SUBJECT, "probe green");
    }
    const availablePg = await pair.pg.observations.availabilityOf(TENANT_A, MODEL_SUBJECT);
    const availableMem = await pair.mem.observations.availabilityOf(TENANT_A, MODEL_SUBJECT);
    expectSameRead(availablePg, availableMem);
    expect(availablePg).toMatchObject({
      state: "available",
      reason: "probe green",
      stale: false,
    });

    // The same observation ages out: with freshnessMs 0 the 1s clock step
    // already exceeds the window — state degrades to unknown with the
    // reason PRESERVED and stale: true (uncertainty is carried, not lost).
    const stalePg = await pair.pg.observations.availabilityOf(TENANT_A, MODEL_SUBJECT, {
      freshnessMs: 0,
    });
    const staleMem = await pair.mem.observations.availabilityOf(TENANT_A, MODEL_SUBJECT, {
      freshnessMs: 0,
    });
    expectSameRead(stalePg, staleMem);
    expect(stalePg).toMatchObject({ state: "unknown", reason: "probe green", stale: true });

    // Unavailable wins as the newest observation.
    for (const fabric of [pair.pg, pair.mem]) {
      await fabric.observations.markUnavailable(TENANT_A, MODEL_SUBJECT, "circuit open");
    }
    const unavailablePg = await pair.pg.observations.availabilityOf(TENANT_A, MODEL_SUBJECT);
    const unavailableMem = await pair.mem.observations.availabilityOf(TENANT_A, MODEL_SUBJECT);
    expectSameRead(unavailablePg, unavailableMem);
    expect(unavailablePg).toMatchObject({
      state: "unavailable",
      reason: "circuit open",
    });
  });

  it("evidence round-trips with first-appearance subject grouping and newest-first subject views", async () => {
    // Interleaved subjects: X (protocol), Y (account), X again, Z (catalog).
    // listByTenant groups by FIRST appearance: [X1, X2, Y, Z] — X2 precedes
    // Y despite being appended after it (the SubjectLog.listAll order).
    const evidenceJourneys: readonly {
      readonly kind: "manual-note" | "health-check" | "lifecycle";
      readonly subject:
        | { readonly kind: "protocol"; readonly protocolId: string }
        | { readonly kind: "provider-account"; readonly accountId: string }
        | { readonly kind: "model-catalog-entry"; readonly catalogEntryId: string };
      readonly outcome: "success" | "failure" | "inconclusive";
      readonly detail: string;
    }[] = [
      {
        kind: "manual-note",
        subject: { kind: "protocol", protocolId: "proto-x" },
        outcome: "inconclusive",
        detail: "first x",
      },
      {
        kind: "health-check",
        subject: { kind: "provider-account", accountId: "acct-1" },
        outcome: "success",
        detail: "account evidence",
      },
      {
        kind: "manual-note",
        subject: { kind: "protocol", protocolId: "proto-x" },
        outcome: "success",
        detail: "second x",
      },
      {
        kind: "lifecycle",
        subject: { kind: "model-catalog-entry", catalogEntryId: "cat-1" },
        outcome: "success",
        detail: "catalog evidence",
      },
    ];
    const ids: string[] = [];
    for (const journey of evidenceJourneys) {
      for (const fabric of [pair.pg, pair.mem]) {
        const evidence = await fabric.observations.appendEvidence(TENANT_A, journey);
        ids.push(evidence.id);
      }
    }

    // Whole-tenant listing: identical order through both stores. The
    // availability test's evidence (subject catalog:cat-1) appeared FIRST,
    // so the grouping is [catalog rows, protocol rows, account rows] — the
    // later-appended "catalog evidence" keeps its subject group's slot.
    const allPg = await pair.pg.observations.listEvidence(TENANT_A);
    const allMem = await pair.mem.observations.listEvidence(TENANT_A);
    expectSameRead(allPg, allMem);
    expect(allPg.map((row) => row.detail)).toEqual([
      "probe green",
      "circuit open",
      "catalog evidence",
      "first x",
      "second x",
      "account evidence",
    ]);

    // Subject view: newest first (evidenceForSubject).
    expectSameRead(
      await pair.pg.observations.listEvidence(TENANT_A, {
        kind: "protocol",
        protocolId: "proto-x",
      }),
      await pair.mem.observations.listEvidence(TENANT_A, {
        kind: "protocol",
        protocolId: "proto-x",
      }),
    );
    expect(
      (
        await pair.pg.observations.listEvidence(TENANT_A, {
          kind: "protocol",
          protocolId: "proto-x",
        })
      ).map((row) => row.detail),
    ).toEqual(["second x", "first x"]);

    // Point reads round-trip.
    expectSameRead(
      await pair.pg.observations.getEvidence(TENANT_A, ids[0] as string),
      await pair.mem.observations.getEvidence(TENANT_A, ids[0] as string),
    );
    // Missing evidence: uniform EVIDENCE_NOT_FOUND on both stores.
    await expectSameFailure(
      pair.pg.observations.getEvidence(TENANT_A, "ev-missing"),
      pair.mem.observations.getEvidence(TENANT_A, "ev-missing"),
    );
  });
});

describe("fabric observations: database enforcement", () => {
  it("rejects raw UPDATE and DELETE on all three logs (append-only trigger)", async () => {
    const sql = pair.harness.sql;
    await expect(sql`update fabric_health_observations set record = '{}'::jsonb`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from fabric_health_observations`).rejects.toThrow(/append-only/);
    await expect(sql`update fabric_availability_observations set position = 99`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from fabric_availability_observations`).rejects.toThrow(/append-only/);
    await expect(sql`update fabric_evidence set subject_key = 'x'`).rejects.toThrow(/append-only/);
    await expect(sql`delete from fabric_evidence`).rejects.toThrow(/append-only/);
  });

  it("makes every observation id ONE immutable row: duplicate ids are infrastructure errors, never silent rewrites", async () => {
    const sql = pair.harness.sql;
    const journal = await listJournal(sql, TENANT_A);
    const healthId = journal.find((row) => row.area === "fabric-health")?.recordId as string;
    const evidenceId = journal.find((row) => row.area === "fabric-evidence")?.recordId as string;
    // The in-memory evidence double's unreachable overwrite-by-id path is
    // structurally closed here: the same (tenant, id) cannot land twice.
    await expect(sql`
      insert into fabric_health_observations (tenant_id, observation_id, subject_key, record)
      values (${TENANT_A}, ${healthId}, 'account:acct-1', '{}'::jsonb)
    `).rejects.toThrow(/duplicate key/i);
    await expect(sql`
      insert into fabric_evidence (tenant_id, evidence_id, subject_key, record)
      values (${TENANT_A}, ${evidenceId}, 'account:acct-1', '{}'::jsonb)
    `).rejects.toThrow(/duplicate key/i);
    // Availability identity is the append position: re-inserting position 0
    // for an existing (tenant, subject) is rejected by the primary key.
    await expect(sql`
      insert into fabric_availability_observations (tenant_id, subject_key, position, record)
      values (${TENANT_A}, 'model:cat-1', 0, '{}'::jsonb)
    `).rejects.toThrow(/duplicate key/i);
  });

  it("enforces CHECK constraints on subject keys and positions", async () => {
    const sql = pair.harness.sql;
    await expect(sql`
      insert into fabric_health_observations (tenant_id, observation_id, subject_key, record)
      values (${TENANT_A}, 'obs-bad', '', '{}'::jsonb)
    `).rejects.toThrow(/violates check constraint/i);
    await expect(sql`
      insert into fabric_availability_observations (tenant_id, subject_key, position, record)
      values (${TENANT_A}, 'model:cat-9', -1, '{}'::jsonb)
    `).rejects.toThrow(/violates check constraint/i);
  });
});

describe("fabric observations: tenant isolation", () => {
  it("foreign-tenant subject logs are invisible; the same subject keys are independently registrable", async () => {
    // Tenant B records health + availability + evidence for the SAME subject
    // keys tenant A uses.
    for (const fabric of [pair.pg, pair.mem]) {
      await fabric.observations.recordHealth(TENANT_B, {
        subject: ACCOUNT_SUBJECT,
        status: "down",
        detail: "b sees an outage",
      });
      await fabric.observations.markUnavailable(TENANT_B, MODEL_SUBJECT, "b-side outage");
      await fabric.observations.appendEvidence(TENANT_B, {
        kind: "manual-note",
        subject: { kind: "protocol", protocolId: "proto-x" },
        outcome: "failure",
        detail: "b evidence",
      });
    }

    // A's views are unchanged by B's records — identical through both
    // stores, and the interleaved append order above means B's rows were
    // appended AFTER A's (a scoped read must not see them). Captured
    // symmetric reads (a one-sided availabilityOf would de-sync the
    // deterministic clocks).
    const aHealthPg = await pair.pg.observations.currentHealth(TENANT_A, ACCOUNT_SUBJECT);
    const aHealthMem = await pair.mem.observations.currentHealth(TENANT_A, ACCOUNT_SUBJECT);
    expectSameRead(aHealthPg, aHealthMem);
    expect(aHealthPg).toMatchObject({ status: "healthy" });
    const aAvailabilityPg = await pair.pg.observations.availabilityOf(TENANT_A, MODEL_SUBJECT);
    const aAvailabilityMem = await pair.mem.observations.availabilityOf(TENANT_A, MODEL_SUBJECT);
    expectSameRead(aAvailabilityPg, aAvailabilityMem);
    expect(aAvailabilityPg).toMatchObject({ state: "unavailable" });
    const aEvidencePg = await pair.pg.observations.listEvidence(TENANT_A);
    const aEvidenceMem = await pair.mem.observations.listEvidence(TENANT_A);
    expectSameRead(aEvidencePg, aEvidenceMem);
    expect(aEvidencePg.map((row) => row.detail)).not.toContain("b evidence");
    // B sees its OWN observations under the same subject keys (the
    // markUnavailable call also appended its availability-check evidence).
    expect(await pair.pg.observations.currentHealth(TENANT_B, ACCOUNT_SUBJECT)).toMatchObject({
      status: "down",
    });
    expect((await pair.pg.observations.listEvidence(TENANT_B)).map((row) => row.detail)).toEqual([
      "b-side outage",
      "b evidence",
    ]);
    // Availability positions are per (tenant, subject): B's first
    // observation is position 0 even though A already used it.
    const bPositions = await pair.harness.sql`
      select position from fabric_availability_observations
      where tenant_id = ${TENANT_B} and subject_key = 'model:cat-1'
    `;
    expect(bPositions.map((row) => row.position)).toEqual([0]);
  });
});

describe("fabric observations: journal", () => {
  it("records stable mutation-identity keys for all three logs", async () => {
    const journal = await listJournal(pair.harness.sql, TENANT_A);
    const keys = journal.map((row) => row.journalKey);
    // Health: one key per appended observation id.
    for (const row of journal.filter((entry) => entry.area === "fabric-health")) {
      expect(row.journalKey).toBe(`fabric-health:append:${row.recordId}`);
      expect(keys).toContain(row.journalKey);
    }
    // Availability: subject key + 0-based append position, 1-based version.
    const availabilityRows = journal.filter((entry) => entry.area === "fabric-availability");
    expect(availabilityRows.length).toBe(2);
    expect(availabilityRows[0]?.journalKey).toBe("fabric-availability:append:model:cat-1:0");
    expect(availabilityRows[1]?.journalKey).toBe("fabric-availability:append:model:cat-1:1");
    expect(availabilityRows[0]?.version).toBe(1);
    expect(availabilityRows[1]?.version).toBe(2);
    // Evidence: one key per appended evidence id.
    for (const row of journal.filter((entry) => entry.area === "fabric-evidence")) {
      expect(row.journalKey).toBe(`fabric-evidence:append:${row.recordId}`);
    }
  });
});
