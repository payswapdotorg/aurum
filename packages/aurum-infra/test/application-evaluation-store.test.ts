/**
 * P003 area 1 — the lab evaluation store over PostgreSQL (migration 0001):
 * the append-only evidence of the lab's two production paths.
 *
 * The equivalence ruling (the P002 precedent, adapted to the sync/async
 * seam — the lab service is synchronous and cannot take async stores, so
 * the REAL `createOrganizationalLab` service drives its in-memory
 * reference store, and every record it produces is carried into the
 * PG-backed store AND the async in-memory double; the proofs then assert
 * the three stores agree on every read path — values deep-equal, typed
 * errors identical — plus the explicit join-key verbatim checks the
 * catalog demands (fingerprintDigest, constraint set, weights, ranking
 * rule) at the record level AND the strong-column level.
 *
 * Append-only is enforced at the DATABASE level (trigger + primary key)
 * and the duplicate path resolves the same typed refusal on both async
 * modes; tenant isolation is uniform (foreign reads indistinguishable from
 * missing); the journal holds exactly the append keys.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import {
  TENANT_A,
  TENANT_B,
  errOf,
  expectSameAppResult,
  loopFixture,
  makeApplicationTrio,
  mirrorReferenceEvaluations,
  okOf,
  reviseGoalPriority,
  runSearch,
  scope,
  seedSubject,
  type LoopFixture,
  type ApplicationStoreTrio,
} from "./application-test-utils.js";
import type { LabEvaluationRecord } from "@aurum/application";

// Canonical JSON: key order is not semantic (postgres jsonb alphabetizes on
// round-trip); the join-key verbatim law compares CONTENT, deeply.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonical((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

let trio: ApplicationStoreTrio;
let fx: LoopFixture;

beforeAll(async () => {
  trio = await makeApplicationTrio();
  fx = loopFixture();
});

afterAll(async () => {
  await trio.harness.close();
});

const A = scope(TENANT_A);
const B = scope(TENANT_B);

/** The standard two-context journey: two searches under different contexts. */
function runStandardJourneys(): LabEvaluationRecord[] {
  seedSubject(fx, A);
  const first = runSearch(fx, A);
  reviseGoalPriority(fx.kernel, A, "critical");
  const second = runSearch(fx, A, { atSeconds: 25 });
  expect(second.evaluation.evaluationId).not.toBe(first.evaluation.evaluationId);
  expect(second.evaluation.fingerprintDigest).not.toBe(first.evaluation.fingerprintDigest);
  return [first.evaluation, second.evaluation];
}

describe("lab evaluation store: round-trip equivalence (real lab service)", () => {
  it("search-produced evaluations round-trip with the join keys verbatim", async () => {
    const records = runStandardJourneys();
    await mirrorReferenceEvaluations(
      fx.referenceEvaluations,
      [trio.pg.evaluations, trio.mem.evaluations],
      A,
    );

    for (const record of records) {
      const expected = fx.referenceEvaluations.getEvaluation(A, record.evaluationId);
      expectSameAppResult(
        await trio.pg.evaluations.getEvaluation(A, record.evaluationId),
        expected,
      );
      expectSameAppResult(
        await trio.mem.evaluations.getEvaluation(A, record.evaluationId),
        expected,
      );
      const pgRecord = okOf(await trio.pg.evaluations.getEvaluation(A, record.evaluationId));
      // P003 join keys survive the round-trip BYTE-FOR-BYTE:
      expect(canonical(pgRecord.constraintSet)).toEqual(canonical(record.constraintSet));
      expect(canonical(pgRecord.weights)).toEqual(canonical(record.weights));
      expect(canonical(pgRecord.modifiers)).toEqual(canonical(record.modifiers));
      expect(canonical(pgRecord.fingerprintAxes)).toEqual(canonical(record.fingerprintAxes));
      expect(pgRecord.fingerprintDigest).toBe(record.fingerprintDigest);
      expect(pgRecord.rankingRule).toBe(record.rankingRule);
      expect(pgRecord.ranked).toEqual(record.ranked);
    }

    // Full-list equivalence (insertion order):
    expect(await trio.pg.evaluations.listEvaluations(A)).toEqual(
      fx.referenceEvaluations.listEvaluations(A),
    );
    expect(await trio.mem.evaluations.listEvaluations(A)).toEqual(
      fx.referenceEvaluations.listEvaluations(A),
    );

    // Strong columns mirror the record's join keys (column-level proof):
    const rows = await trio.harness.sql`
      select evaluation_id, goal_id, fingerprint_digest, ranking_rule
      from lab_evaluations where tenant_id = ${A.tenantId} order by seq
    `;
    expect(rows.length).toBe(records.length);
    for (const row of rows) {
      const record = records.find((item) => item.evaluationId === row.evaluation_id);
      expect(record).toBeTruthy();
      expect(row.goal_id).toBe(record?.goalId ?? null);
      expect(row.fingerprint_digest).toBe(record?.fingerprintDigest);
      expect(row.ranking_rule).toBe(record?.rankingRule);
    }
  });

  it("standalone candidate evaluations round-trip (the evaluateOrganizations path)", async () => {
    const { fingerprint, result } = runSearch(fx, A, { atSeconds: 30 });
    const candidates = result.ranked.slice(0, 2).map((entry) => entry.candidate);
    const evaluated = okOf(
      fx.lab.evaluateOrganizations(A, {
        goalId: "goal-1",
        fingerprint: fingerprint as never,
        candidates: candidates as never,
        now: fx.lab.listEvaluations(A).at(-1)?.createdAt ?? (30_000 as never),
      }),
    );
    expect(evaluated.ranked.length).toBe(2);
    expect(evaluated.ranked[0]?.strategy).toBeUndefined();
    await mirrorReferenceEvaluations(
      fx.referenceEvaluations,
      [trio.pg.evaluations, trio.mem.evaluations],
      A,
    );
    expectSameAppResult(
      await trio.pg.evaluations.getEvaluation(A, evaluated.evaluationId),
      fx.referenceEvaluations.getEvaluation(A, evaluated.evaluationId),
    );
    const pgRecord = okOf(await trio.pg.evaluations.getEvaluation(A, evaluated.evaluationId));
    expect(canonical(pgRecord.constraintSet)).toEqual(canonical(evaluated.constraintSet));
    expect(canonical(pgRecord.weights)).toEqual(canonical(evaluated.weights));
    expect(pgRecord.rankingRule).toBe(evaluated.rankingRule);
    expect(await trio.pg.evaluations.listEvaluations(A)).toEqual(
      fx.referenceEvaluations.listEvaluations(A),
    );
  });

  it("list filters mirror the in-memory reference (goal + digest anchors)", async () => {
    const reference = fx.referenceEvaluations.listEvaluations(A);
    expect(reference.length).toBeGreaterThanOrEqual(3);
    const byGoal = reference[0]?.goalId ?? "goal-1";
    for (const filter of [
      { goalId: byGoal },
      { fingerprintDigest: reference[0]?.fingerprintDigest },
      { goalId: byGoal, fingerprintDigest: reference[0]?.fingerprintDigest },
      { goalId: "missing-goal" },
    ]) {
      expect(await trio.pg.evaluations.listEvaluations(A, filter)).toEqual(
        fx.referenceEvaluations.listEvaluations(A, filter),
      );
      expect(await trio.mem.evaluations.listEvaluations(A, filter)).toEqual(
        fx.referenceEvaluations.listEvaluations(A, filter),
      );
    }
  });
});

describe("lab evaluation store: append-only discipline", () => {
  it("duplicate evaluation id resolves the typed append refusal on BOTH async modes; the DB rejects the re-insert", async () => {
    const existing = fx.referenceEvaluations.listEvaluations(A)[0];
    expect(existing).toBeTruthy();
    const duplicate = await trio.pg.evaluations.putEvaluation(A, existing);
    expect(duplicate.ok).toBe(false);
    const refusal = errOf(duplicate);
    expect(refusal.code).toBe("lab-validation");
    expect(refusal.message).toContain(existing.evaluationId);
    expect(refusal.message).toContain("append-only");
    // The async in-memory twin resolves the IDENTICAL typed refusal:
    const memDuplicate = await trio.mem.evaluations.putEvaluation(A, existing);
    expectSameAppResult(memDuplicate, duplicate);
    // The database rejects the re-insert at the raw level (primary key):
    await expect(trio.harness.sql`
      insert into lab_evaluations (tenant_id, evaluation_id, fingerprint_digest, ranking_rule, record)
      values (${A.tenantId}, ${existing.evaluationId}, 'fp', 'rule', '{}'::jsonb)
    `).rejects.toThrow(/duplicate key/i);
    // And nothing changed: the store still lists exactly the reference set.
    expect(await trio.pg.evaluations.listEvaluations(A)).toEqual(
      fx.referenceEvaluations.listEvaluations(A),
    );
  });

  it("the port surface exposes put/get/list ONLY (no update, no delete, no global surface)", () => {
    expect(Object.keys(trio.pg.evaluations).sort()).toEqual([
      "getEvaluation",
      "listEvaluations",
      "putEvaluation",
    ]);
    expect(Object.keys(trio.mem.evaluations).sort()).toEqual([
      "getEvaluation",
      "listEvaluations",
      "putEvaluation",
    ]);
  });

  it("raw UPDATE and DELETE are rejected by the database trigger (the table holds real rows)", async () => {
    const rows = await trio.harness
      .sql`select count(*)::int as n from lab_evaluations where tenant_id = ${A.tenantId}`;
    expect(rows[0].n).toBeGreaterThan(0);
    await expect(
      trio.harness
        .sql`update lab_evaluations set record = '{}'::jsonb where tenant_id = ${A.tenantId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      trio.harness.sql`delete from lab_evaluations where tenant_id = ${A.tenantId}`,
    ).rejects.toThrow(/append-only/);
  });

  it("the journal records exactly the successful append keys", async () => {
    const journal = await listJournal(trio.harness.sql, A.tenantId);
    const evaluationKeys = journal.filter((row) => row.area === "lab-evaluations");
    const expectedIds = fx.referenceEvaluations.listEvaluations(A).map((r) => r.evaluationId);
    expect(evaluationKeys.map((row) => row.journalKey).sort()).toEqual(
      expectedIds.map((id) => `lab-evaluations:append:${id}:1`).sort(),
    );
    for (const row of evaluationKeys) {
      expect(row.operation).toBe("append");
      expect(row.version).toBe(1);
    }
  });
});

describe("lab evaluation store: tenant isolation", () => {
  it("foreign-tenant reads are indistinguishable from missing; the same id is independently registrable per tenant", async () => {
    const tenantARecord = fx.referenceEvaluations.listEvaluations(A)[0];
    expect(tenantARecord).toBeTruthy();

    // Foreign read ≡ missing (identical typed error bytes):
    const foreign = await trio.pg.evaluations.getEvaluation(B, tenantARecord.evaluationId);
    const missing = await trio.pg.evaluations.getEvaluation(B, "lab-eval-404");
    expect(foreign.ok).toBe(false);
    expectSameAppResult(foreign, missing);
    expect(errOf(foreign).message).toBe("lab evaluation not found");
    // The async in-memory twin agrees:
    expectSameAppResult(
      await trio.mem.evaluations.getEvaluation(B, tenantARecord.evaluationId),
      foreign,
    );

    // The same evaluation id is independently registrable per tenant:
    const tenantBRecord: LabEvaluationRecord = {
      ...structuredClone(tenantARecord),
      scope: B,
    };
    expectSameAppResult(
      await trio.pg.evaluations.putEvaluation(B, tenantBRecord),
      fx.referenceEvaluations.putEvaluation(B, tenantBRecord),
    );
    expectSameAppResult(
      await trio.pg.evaluations.getEvaluation(B, tenantBRecord.evaluationId),
      fx.referenceEvaluations.getEvaluation(B, tenantBRecord.evaluationId),
    );
    // Each tenant's list holds only its own records:
    expect((await trio.pg.evaluations.listEvaluations(B)).map((r) => r.scope.tenantId)).toEqual([
      B.tenantId,
    ]);
    expect(await trio.pg.evaluations.listEvaluations(A)).toEqual(
      fx.referenceEvaluations.listEvaluations(A),
    );
    // Journal isolation: tenant B's journal holds its own append only.
    const journalB = await listJournal(trio.harness.sql, B.tenantId);
    expect(
      journalB.filter((row) => row.area === "lab-evaluations").map((row) => row.journalKey),
    ).toEqual([`lab-evaluations:append:${tenantBRecord.evaluationId}:1`]);
  });
});
