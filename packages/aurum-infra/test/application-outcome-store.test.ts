/**
 * P003 area 2 — the learning outcome store over PostgreSQL (migration 0002)
 * and the END-TO-END outcome-learning loop over PG-backed stores.
 *
 * Oracle pattern (the P002 equivalence ruling, adapted to the sync/async
 * seam): the REAL `createOutcomeLearning` service drives its in-memory
 * references (the semantic authority, composed exactly like the untouched
 * learning suite composes it), and every outcome join record it produces is
 * carried into the PG-backed store AND the async in-memory double; the
 * proofs assert the three agree on every read path — values deep-equal,
 * typed errors identical in code/message/issues — plus the explicit
 * seven-join-dimension verbatim checks the catalog demands, at the record
 * level AND the strong-column level.
 *
 * The end-to-end acceptance (catalog P003): seeded lab search → evaluation
 * record → outcome join → conditional evidence query, ALL through
 * PG-backed stores — the join assembles over PG-hydrated anchors (the REAL
 * `assembleOutcomeJoin` over the PG retrieval paths, never re-implemented),
 * the evidence aggregates over PG-listed outcomes (the REAL
 * `calibrateEvidence` / `applyConditionalCalibration`), and the composed
 * results deep-equal the reference service's own answers.
 *
 * Append-only is enforced at the DATABASE level (trigger + primary key);
 * the duplicate path resolves the byte-identical typed conflict on both
 * async modes; tenant isolation is uniform (foreign reads ≡ missing — the
 * W013 no-existence-leak law); the journal holds exactly the append keys.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyConditionalCalibration, calibrateEvidence, contextClassOf } from "@aurum/application";
import type { OutcomeJoinRecord } from "@aurum/application";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import { createPgCandidateRegistry } from "../src/domain-storage/adapters/candidate-store.js";
import {
  TENANT_A,
  TENANT_B,
  errOf,
  expectSameAppResult,
  loopFixture,
  makeApplicationTrio,
  mirrorReferenceEvaluations,
  now,
  okOf,
  personActor,
  provenance,
  raiseUnknowns,
  reviseGoalPriority,
  runSearch,
  scope,
  seedSubject,
} from "./application-test-utils.js";
import type { ApplicationStoreTrio, LoopFixture } from "./application-test-utils.js";
import {
  calibratedSearch,
  candidateInputOf,
  joinOutcomeFromPg,
  mirrorReferenceOutcomes,
  outcomeInput,
  recordOutcome,
  registerCandidate,
} from "./application-learning-utils.js";

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

/**
 * The standard outcome journeys: one achieved outcome under the medium
 * context, one failed outcome (failure detail + actual cost — failures are
 * first-class calibration evidence) under the revised critical context.
 * Different fingerprints ⇒ different candidate ids ⇒ no registry conflicts.
 */
function runOutcomeJourneys(): readonly OutcomeJoinRecord[] {
  seedSubject(fx, A);
  raiseUnknowns(fx.kernel, A, 2);
  const first = runSearch(fx, A, { atSeconds: 20 });
  const firstCandidate = first.result.ranked[0]?.candidate;
  if (!firstCandidate) throw new Error("test setup: no ranked candidate (first)");
  registerCandidate(fx, A, firstCandidate);
  const achieved = recordOutcome(fx, A, {
    outcomeId: "outcome-1",
    evaluationId: first.evaluation.evaluationId,
    candidateId: firstCandidate.candidateId,
    status: "achieved",
    observedAtSec: 30,
    atSec: 40,
  });
  reviseGoalPriority(fx.kernel, A, "critical");
  const second = runSearch(fx, A, { atSeconds: 25 });
  const secondCandidate = second.result.ranked[0]?.candidate;
  if (!secondCandidate) throw new Error("test setup: no ranked candidate (second)");
  registerCandidate(fx, A, secondCandidate);
  const failed = recordOutcome(fx, A, {
    outcomeId: "outcome-2",
    evaluationId: second.evaluation.evaluationId,
    candidateId: secondCandidate.candidateId,
    status: "failed",
    observedAtSec: 35,
    atSec: 45,
    failure: { kind: "execution", detail: "handoff stalled at the review step" },
    actualCost: 12_500,
  });
  return [achieved, failed];
}

describe("learning outcome store: round-trip equivalence (real learning service)", () => {
  it("outcome join records round-trip with the seven join dimensions verbatim", async () => {
    const outcomes = runOutcomeJourneys();
    await mirrorReferenceEvaluations(
      fx.referenceEvaluations,
      [trio.pg.evaluations, trio.mem.evaluations],
      A,
    );
    await mirrorReferenceOutcomes(fx.referenceOutcomes, [trio.pg.outcomes, trio.mem.outcomes], A);

    for (const record of outcomes) {
      const expected = fx.referenceOutcomes.getOutcome(A, record.outcomeId);
      expectSameAppResult(await trio.pg.outcomes.getOutcome(A, record.outcomeId), expected);
      expectSameAppResult(await trio.mem.outcomes.getOutcome(A, record.outcomeId), expected);
      const pgRecord = okOf(await trio.pg.outcomes.getOutcome(A, record.outcomeId));
      const memRecord = okOf(await trio.mem.outcomes.getOutcome(A, record.outcomeId));
      // The seven join dimensions survive the round-trip VERBATIM (deep
      // equality — the P002 ruling: jsonb normalizes object key order, so
      // a cross-store STRING comparison would be shape noise, not
      // semantics) — context: fingerprint + axes, constraint set,
      // weights, modifiers, ranking rule, rank + weighted score:
      expect(pgRecord.fingerprintDigest).toBe(record.fingerprintDigest);
      expect(pgRecord.fingerprintAxes).toEqual(record.fingerprintAxes);
      expect(pgRecord.constraintSet).toEqual(record.constraintSet);
      expect(pgRecord.weights).toEqual(record.weights);
      expect(pgRecord.modifiers).toEqual(record.modifiers);
      expect(pgRecord.rankingRule).toBe(record.rankingRule);
      expect(pgRecord.rankAtEvaluation).toBe(record.rankAtEvaluation);
      expect(pgRecord.weightedScoreAtEvaluation).toBe(record.weightedScoreAtEvaluation);
      // organization: candidate anchor, strategy, shape:
      expect(pgRecord.candidateId).toBe(record.candidateId);
      expect(pgRecord.strategy).toBe(record.strategy);
      expect(pgRecord.shape).toEqual(record.shape);
      // the remaining dimensions: actor allocation, model occupancy,
      // information strategy, environments, cost:
      expect(pgRecord.allocation).toEqual(record.allocation);
      expect(pgRecord.occupancy).toEqual(record.occupancy);
      expect(pgRecord.informationStrategy).toEqual(record.informationStrategy);
      expect(pgRecord.environments).toEqual(record.environments);
      expect(pgRecord.cost).toEqual(record.cost);
      // observation + provenance + anchors:
      expect(pgRecord.observation).toEqual(record.observation);
      expect(pgRecord.provenance).toEqual(record.provenance);
      expect(pgRecord.evaluationId).toBe(record.evaluationId);
      expect(pgRecord.goalId).toBe(record.goalId);
      expect(pgRecord.outcomeId).toBe(record.outcomeId);
      expect(pgRecord.recordedAt).toBe(record.recordedAt);
      // Byte-for-byte is PER SIDE (the P002 ruling): each store's record
      // serializes byte-identically to itself across reads — the strongest
      // byte-level statement the jsonb boundary permits.
      expect(JSON.stringify(okOf(await trio.pg.outcomes.getOutcome(A, record.outcomeId)))).toBe(
        JSON.stringify(pgRecord),
      );
      expect(JSON.stringify(okOf(await trio.mem.outcomes.getOutcome(A, record.outcomeId)))).toBe(
        JSON.stringify(memRecord),
      );
    }

    // Full-list equivalence (insertion order):
    expect(await trio.pg.outcomes.listOutcomes(A)).toEqual(fx.referenceOutcomes.listOutcomes(A));
    expect(await trio.mem.outcomes.listOutcomes(A)).toEqual(fx.referenceOutcomes.listOutcomes(A));

    // Strong columns mirror the join/retrieval keys (column-level proof):
    const rows = await trio.harness.sql`
      select outcome_id, evaluation_id, candidate_id, goal_id, fingerprint_digest,
             context_class_key, shape_key
      from learning_outcomes where tenant_id = ${A.tenantId} order by seq
    `;
    expect(rows.length).toBe(outcomes.length);
    for (const row of rows) {
      const record = outcomes.find((item) => item.outcomeId === row.outcome_id);
      expect(record).toBeTruthy();
      expect(row.evaluation_id).toBe(record?.evaluationId);
      expect(row.candidate_id).toBe(record?.candidateId);
      expect(row.goal_id).toBe(record?.goalId ?? null);
      expect(row.fingerprint_digest).toBe(record?.fingerprintDigest);
      expect(row.context_class_key).toBe(record?.contextClass.classKey);
      expect(row.shape_key).toBe(record?.shape.shapeKey);
    }
  });

  it("list filters mirror the reference (anchor + class retrieval paths)", async () => {
    const reference = fx.referenceOutcomes.listOutcomes(A);
    expect(reference.length).toBeGreaterThanOrEqual(2);
    const first = reference[0];
    expect(first).toBeTruthy();
    if (!first) return;
    for (const filter of [
      { goalId: first.goalId ?? "goal-1" },
      { candidateId: first.candidateId },
      { contextClassKey: first.contextClass.classKey },
      { shapeKey: first.shape.shapeKey },
      { contextClassKey: first.contextClass.classKey, shapeKey: first.shape.shapeKey },
      { candidateId: "cand-404" },
    ]) {
      expect(await trio.pg.outcomes.listOutcomes(A, filter)).toEqual(
        fx.referenceOutcomes.listOutcomes(A, filter),
      );
      expect(await trio.mem.outcomes.listOutcomes(A, filter)).toEqual(
        fx.referenceOutcomes.listOutcomes(A, filter),
      );
    }
  });
});

describe("learning outcome store: append-only discipline", () => {
  it("duplicate outcome id resolves the typed learningConflict on BOTH async modes; the DB rejects the re-insert", async () => {
    const existing = fx.referenceOutcomes.listOutcomes(A)[0];
    expect(existing).toBeTruthy();
    if (!existing) return;
    const duplicate = await trio.pg.outcomes.putOutcome(A, existing);
    expect(duplicate.ok).toBe(false);
    const conflict = errOf(duplicate);
    expect(conflict.code).toBe("learning-conflict");
    expect(conflict.message).toBe(`outcome already recorded: ${existing.outcomeId}`);
    // The async in-memory twin resolves the IDENTICAL typed conflict:
    const memDuplicate = await trio.mem.outcomes.putOutcome(A, existing);
    expectSameAppResult(memDuplicate, duplicate);
    // The database rejects the re-insert at the raw level (primary key):
    await expect(trio.harness.sql`
      insert into learning_outcomes
        (tenant_id, outcome_id, evaluation_id, candidate_id, fingerprint_digest,
         context_class_key, shape_key, record)
      values (${A.tenantId}, ${existing.outcomeId}, 'ev-raw', 'cand-raw', 'fp', 'ck', 'sk', '{}'::jsonb)
    `).rejects.toThrow(/duplicate key/i);
    // And nothing changed: the store still lists exactly the reference set.
    expect(await trio.pg.outcomes.listOutcomes(A)).toEqual(fx.referenceOutcomes.listOutcomes(A));
  });

  it("the port surface exposes put/get/list ONLY (no update, no delete, no global surface)", () => {
    expect(Object.keys(trio.pg.outcomes).sort()).toEqual([
      "getOutcome",
      "listOutcomes",
      "putOutcome",
    ]);
    expect(Object.keys(trio.mem.outcomes).sort()).toEqual([
      "getOutcome",
      "listOutcomes",
      "putOutcome",
    ]);
  });

  it("raw UPDATE and DELETE are rejected by the database trigger (the table holds real rows)", async () => {
    const rows = await trio.harness
      .sql`select count(*)::int as n from learning_outcomes where tenant_id = ${A.tenantId}`;
    expect(rows[0].n).toBeGreaterThan(0);
    await expect(
      trio.harness
        .sql`update learning_outcomes set record = '{}'::jsonb where tenant_id = ${A.tenantId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      trio.harness.sql`delete from learning_outcomes where tenant_id = ${A.tenantId}`,
    ).rejects.toThrow(/append-only/);
  });

  it("the journal records exactly the successful append keys", async () => {
    const journal = await listJournal(trio.harness.sql, A.tenantId);
    const outcomeKeys = journal.filter((row) => row.area === "learning-outcomes");
    const expectedIds = fx.referenceOutcomes.listOutcomes(A).map((r) => r.outcomeId);
    expect(outcomeKeys.map((row) => row.journalKey).sort()).toEqual(
      expectedIds.map((id) => `learning-outcomes:append:${id}:1`).sort(),
    );
    for (const row of outcomeKeys) {
      expect(row.operation).toBe("append");
      expect(row.version).toBe(1);
    }
  });
});

describe("learning outcome store: tenant isolation", () => {
  it("foreign-tenant reads are indistinguishable from missing; the same id is independently registrable per tenant", async () => {
    const tenantARecord = fx.referenceOutcomes.listOutcomes(A)[0];
    expect(tenantARecord).toBeTruthy();
    if (!tenantARecord) return;

    // Foreign read ≡ missing (identical typed error bytes — no existence leak):
    const foreign = await trio.pg.outcomes.getOutcome(B, tenantARecord.outcomeId);
    const missing = await trio.pg.outcomes.getOutcome(B, "outcome-404");
    expect(foreign.ok).toBe(false);
    expectSameAppResult(foreign, missing);
    expect(errOf(foreign).message).toBe("learning outcome not found");
    // The async in-memory twin agrees:
    expectSameAppResult(await trio.mem.outcomes.getOutcome(B, tenantARecord.outcomeId), foreign);

    // The same outcome id is independently registrable per tenant:
    const tenantBRecord: OutcomeJoinRecord = {
      ...structuredClone(tenantARecord),
      scope: B,
    };
    expectSameAppResult(
      await trio.pg.outcomes.putOutcome(B, tenantBRecord),
      fx.referenceOutcomes.putOutcome(B, tenantBRecord),
    );
    expectSameAppResult(
      await trio.pg.outcomes.getOutcome(B, tenantBRecord.outcomeId),
      fx.referenceOutcomes.getOutcome(B, tenantBRecord.outcomeId),
    );
    // Each tenant's list holds only its own records (no global surface):
    expect((await trio.pg.outcomes.listOutcomes(B)).map((r) => r.scope.tenantId)).toEqual([
      B.tenantId,
    ]);
    expect(await trio.pg.outcomes.listOutcomes(A)).toEqual(fx.referenceOutcomes.listOutcomes(A));
    // Journal isolation: tenant B's journal holds its own append only.
    const journalB = await listJournal(trio.harness.sql, B.tenantId);
    expect(
      journalB.filter((row) => row.area === "learning-outcomes").map((row) => row.journalKey),
    ).toEqual([`learning-outcomes:append:${tenantBRecord.outcomeId}:1`]);
  });
});

describe("the outcome-learning loop over PG-backed stores (end-to-end)", () => {
  it("seeded lab search → evaluation record → outcome join → conditional evidence, all PG-backed", async () => {
    // A fresh context for the loop: one more open unknown ⇒ a fresh
    // fingerprint ⇒ fresh candidate ids (no registry conflicts).
    okOf(
      fx.kernel.inquiry.raiseUnknown(A, {
        unknownId: "unknown-loop",
        question: "Will the expanded agent pool hold the review SLA?",
        consequence: "review throughput degrades",
        relatedSubjects: [{ kind: "goal", id: "goal-1" }],
        provenance: provenance(personActor("boss"), 45),
        now: now(45),
      }),
    );
    const search = runSearch(fx, A, { atSeconds: 50 });
    const candidate = search.result.ranked[0]?.candidate;
    if (!candidate) throw new Error("test setup: no ranked candidate (loop)");
    // The organization-join anchor goes into the kernel registry (the
    // reference side) AND the P001 PG candidate registry (the loop's
    // retrieval side — composed, never duplicated):
    registerCandidate(fx, A, candidate);
    const pgCandidates = createPgCandidateRegistry(trio.harness.sql);
    okOf(await pgCandidates.registerCandidate(A, candidateInputOf(candidate)));

    // Evaluation record: the search evidence is mirrored into the async stores.
    await mirrorReferenceEvaluations(
      fx.referenceEvaluations,
      [trio.pg.evaluations, trio.mem.evaluations],
      A,
    );

    // Outcome join: the REAL assembleOutcomeJoin over PG-hydrated anchors
    // (the retrieval paths feed the loop; the join logic is never
    // re-implemented) — byte-identical to the reference service's record:
    const options = {
      outcomeId: "outcome-loop",
      evaluationId: search.evaluation.evaluationId,
      candidateId: candidate.candidateId,
      status: "achieved" as const,
      observedAtSec: 55,
      atSec: 60,
    };
    const joined = okOf(await joinOutcomeFromPg(trio.retrieval, A, outcomeInput(options)));
    const referenceOutcome = recordOutcome(fx, A, options);
    expect(joined).toEqual(referenceOutcome);

    // The joined record lands in the PG store (and the async twin):
    okOf(await trio.pg.outcomes.putOutcome(A, joined));
    okOf(await trio.mem.outcomes.putOutcome(A, joined));
    expectSameAppResult(
      await trio.pg.outcomes.getOutcome(A, joined.outcomeId),
      fx.referenceOutcomes.getOutcome(A, joined.outcomeId),
    );

    // Conditional evidence query — anchored, never global: the REAL
    // calibrateEvidence over PG-listed outcomes, filtered to the search's
    // own context class, deep-equals the reference service's answer, and
    // the loop's own outcome is IN the evidence chain:
    const classKey = okOf(contextClassOf(search.fingerprint.axes)).classKey;
    const serviceEvidence = okOf(
      fx.learning.conditionalEvidence(A, { fingerprint: search.fingerprint, now: now(70) }),
    );
    const pgEvidence = calibrateEvidence(await trio.pg.outcomes.listOutcomes(A), now(70));
    expect(pgEvidence.filter((entry) => entry.contextClass.classKey === classKey)).toEqual(
      serviceEvidence,
    );
    expect(serviceEvidence.length).toBeGreaterThanOrEqual(1);
    expect(serviceEvidence.some((entry) => entry.outcomeIds.includes("outcome-loop"))).toBe(true);

    // And the calibrated search composition: the REAL
    // applyConditionalCalibration over the PG-backed evidence deep-equals
    // the reference service's own calibrated search (the evidence lists
    // are identical, so the pure composition must be too — both helpers
    // build the identical search input over the unchanged kernel state):
    const calibrated = calibratedSearch(fx, A, { atSeconds: 50 });
    const base = runSearch(fx, A, { atSeconds: 50 });
    expect(
      okOf(
        applyConditionalCalibration(
          base.result,
          calibrateEvidence(await trio.pg.outcomes.listOutcomes(A), base.result.evaluatedAt),
        ),
      ),
    ).toEqual(calibrated);
  });
});
