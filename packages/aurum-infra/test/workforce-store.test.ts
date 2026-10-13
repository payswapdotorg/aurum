/**
 * P001 workforce area proof: the PG workforce directory, insights store and
 * recommendation store round-trip with semantics identical to the in-memory
 * reference — roles, capacity declarations, bounded assignments (covering
 * declaration required, effort and concurrency bounds enforced over active
 * overlapping assignments) with ends as appended facts, workload
 * observations/outcomes/alternative explanations, and recommendations with
 * human-only immutable decisions — with the same validation issues, the same
 * conflict/not-found/forbidden discipline, the same list-filter edge
 * behavior, the same audit side-effects — and every table is append-only by
 * database trigger with one-end/one-decision-per-record primary keys.
 *
 * Equivalence tests boot a fresh harness per test (the audit id sequence is
 * global, mirroring the kernel-global in-memory counter).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  DecideRecommendationInput,
  DeclareCapacityInput,
  ProposeRecommendationInput,
  RecordAlternativeExplanationInput,
  RecordAssignmentInput,
  RecordOutcomeInput,
  RecordWorkloadObservationInput,
  RegisterRoleInput,
} from "@aurum/domain";
import { createPgWorkforceDirectory } from "../src/domain-storage/adapters/workforce-store.js";
import { createPgWorkforceInsights } from "../src/domain-storage/adapters/insights-store.js";
import { createPgWorkforceRecommendations } from "../src/domain-storage/adapters/recommendation-store.js";
import { createPgAuditTrail } from "../src/domain-storage/adapters/audit-store.js";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import {
  auditInput,
  errOf,
  expectSameResult,
  memoryKernel,
  now,
  okOf,
  personActor,
  pgHarness,
  provenance,
  rejectionMessage,
  scope,
  systemActor,
} from "./helpers.js";
import type { PgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";

let harness: PgLiteHarness;

beforeAll(async () => {
  harness = await pgHarness();
});

afterAll(async () => {
  await harness.close();
});

function roleInput(overrides: Record<string, unknown> = {}): RegisterRoleInput {
  return {
    roleId: "r-1",
    title: "typescript engineer",
    description: "writes typed code",
    requiredCapabilities: ["cap-1", "cap-2"],
    provenance: provenance(systemActor("seed")),
    now: now(0),
    ...overrides,
  } as RegisterRoleInput;
}

function capacityInput(overrides: Record<string, unknown> = {}): DeclareCapacityInput {
  return {
    capacityId: "cap-p-1",
    personId: "p-1",
    bounds: {
      period: { start: now(0), end: now(10000) },
      maxEffortMs: 100000,
      maxConcurrentAssignments: 2,
    },
    provenance: provenance(systemActor("seed")),
    now: now(1),
    ...overrides,
  } as DeclareCapacityInput;
}

function assignmentInput(overrides: Record<string, unknown> = {}): RecordAssignmentInput {
  return {
    assignmentId: "a-1",
    personId: "p-1",
    roleId: "r-1",
    processRef: { processId: "pr-1", stepId: "s-1" },
    effortMs: 30000,
    period: { start: now(10), end: now(5000) },
    provenance: provenance(systemActor("seed")),
    now: now(2),
    ...overrides,
  } as RecordAssignmentInput;
}

function observationInput(overrides: Record<string, unknown> = {}): RecordWorkloadObservationInput {
  return {
    observationId: "obs-1",
    personId: "p-1",
    period: { start: now(0), end: now(1000) },
    observedEffortMs: 42000,
    observedUtilization: 0.42,
    note: "steady",
    freshness: { asOf: now(3), validUntil: now(5000) },
    provenance: provenance(systemActor("seed")),
    now: now(3),
    ...overrides,
  } as RecordWorkloadObservationInput;
}

function outcomeInput(overrides: Record<string, unknown> = {}): RecordOutcomeInput {
  return {
    outcomeId: "out-1",
    personId: "p-1",
    period: { start: now(0), end: now(1000) },
    subject: { kind: "goal", id: "g-1" },
    result: "met",
    summary: "delivered",
    provenance: provenance(systemActor("seed")),
    now: now(4),
    ...overrides,
  } as RecordOutcomeInput;
}

function explanationInput(
  overrides: Record<string, unknown> = {},
): RecordAlternativeExplanationInput {
  return {
    explanationId: "exp-1",
    subject: { kind: "person", id: "p-1" },
    pattern: "sustained overload",
    explanation: "demand surge",
    evidenceRefs: [{ kind: "observation", id: "obs-1" }],
    provenance: provenance(systemActor("seed")),
    now: now(5),
    ...overrides,
  } as RecordAlternativeExplanationInput;
}

function recommendationInput(overrides: Record<string, unknown> = {}): ProposeRecommendationInput {
  return {
    recommendationId: "rec-1",
    adjustment: "training",
    subject: { kind: "person", id: "p-1" },
    rationale: "level up typescript",
    evidenceRefs: [],
    employmentImpacting: false,
    proposedBy: systemActor("lab"),
    provenance: provenance(systemActor("seed")),
    now: now(6),
    ...overrides,
  } as ProposeRecommendationInput;
}

function decideInput(overrides: Record<string, unknown> = {}): DecideRecommendationInput {
  return {
    recommendationId: "rec-1",
    decision: "human-approved",
    decidedBy: personActor("p-9"),
    reason: "approved with budget",
    now: now(7),
    ...overrides,
  } as DecideRecommendationInput;
}

describe("PG workforce equivalence with the in-memory reference", () => {
  it("round-trips roles, capacities, assignments with ends, insights and recommendations", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgWorkforceDirectory(local.sql);
      const insights = createPgWorkforceInsights(local.sql);
      const recommendations = createPgWorkforceRecommendations(local.sql);
      const memory = memoryKernel();
      const s = scope("workforce-equivalence");

      // Roles: with and without description; capability list trimmed.
      for (const command of [
        roleInput(),
        roleInput({
          roleId: "r-2",
          title: "site reliability",
          description: undefined,
          requiredCapabilities: [],
        }),
      ] as const) {
        expectSameResult(
          await pg.registerRole(s, command),
          memory.workforce.registerRole(s, command),
        );
      }
      // Capacities: two declarations for p-1 (the later one wins coverage)
      // and one for p-2.
      for (const command of [
        capacityInput(),
        capacityInput({ capacityId: "cap-p-1b", now: now(2) }),
        capacityInput({
          capacityId: "cap-p-2",
          personId: "p-2",
          bounds: {
            period: { start: now(0), end: now(99999) },
            maxEffortMs: 50000,
            maxConcurrentAssignments: 1,
          },
        }),
      ] as const) {
        expectSameResult(
          await pg.declareCapacity(s, command),
          memory.workforce.declareCapacity(s, command),
        );
      }
      // Assignments: with role+processRef, bare, and for p-2; then end one.
      for (const command of [
        assignmentInput(),
        assignmentInput({
          assignmentId: "a-2",
          roleId: undefined,
          processRef: undefined,
          effortMs: 20000,
          period: { start: now(0), end: now(10000) },
          now: now(3),
        }),
        assignmentInput({
          assignmentId: "a-p2",
          personId: "p-2",
          roleId: undefined,
          processRef: undefined,
          effortMs: 10000,
          period: { start: now(100), end: now(200) },
          now: now(3),
        }),
      ] as const) {
        expectSameResult(
          await pg.recordAssignment(s, command),
          memory.workforce.recordAssignment(s, command),
        );
      }
      const end = {
        assignmentId: "a-2",
        endedBy: personActor("p-9"),
        now: now(4),
        audit: auditInput(personActor("p-9"), "workload shifted", 4),
      };
      expectSameResult(await pg.endAssignment(s, end), memory.workforce.endAssignment(s, end));

      // Insights: observations (optional utilization/note/freshness),
      // outcomes (all three results, optional subject), explanations.
      for (const command of [
        observationInput(),
        observationInput({
          observationId: "obs-2",
          observedUtilization: undefined,
          note: undefined,
          freshness: undefined,
          now: now(4),
        }),
        observationInput({ observationId: "obs-p2", personId: "p-2", now: now(4) }),
      ] as const) {
        expectSameResult(
          await insights.recordWorkloadObservation(s, command),
          memory.workforceInsights.recordWorkloadObservation(s, command),
        );
      }
      for (const command of [
        outcomeInput(),
        outcomeInput({ outcomeId: "out-2", result: "partial", subject: undefined }),
        outcomeInput({ outcomeId: "out-3", result: "missed" }),
      ] as const) {
        expectSameResult(
          await insights.recordOutcome(s, command),
          memory.workforceInsights.recordOutcome(s, command),
        );
      }
      for (const command of [
        explanationInput(),
        explanationInput({
          explanationId: "exp-2",
          subject: { kind: "goal", id: "g-2" },
          pattern: "missed targets",
          explanation: "skill mismatch",
          evidenceRefs: [
            { kind: "observation", id: "obs-1" },
            { kind: "goal", id: "g-1" },
          ],
          now: now(6),
        }),
      ] as const) {
        expectSameResult(
          await insights.recordAlternativeExplanation(s, command),
          memory.workforceInsights.recordAlternativeExplanation(s, command),
        );
      }

      // Recommendations: open proposal, inherently-impacting proposal with
      // evidence, then one approve and one reject journey.
      for (const command of [
        recommendationInput(),
        recommendationInput({
          recommendationId: "rec-2",
          adjustment: "reassignment",
          rationale: "move to the platform team",
          evidenceRefs: [{ kind: "observation", id: "obs-1" }],
          employmentImpacting: true,
          now: now(7),
        }),
        recommendationInput({
          recommendationId: "rec-3",
          adjustment: "hiring",
          rationale: "demand exceeds capacity",
          evidenceRefs: [{ kind: "goal", id: "g-1" }],
          employmentImpacting: true,
          now: now(8),
        }),
      ] as const) {
        expectSameResult(
          await recommendations.proposeRecommendation(s, command),
          memory.workforceRecommendations.proposeRecommendation(s, command),
        );
      }
      for (const command of [
        decideInput({ recommendationId: "rec-2" }),
        decideInput({ recommendationId: "rec-3", decision: "human-rejected", now: now(9) }),
      ] as const) {
        expectSameResult(
          await recommendations.decideRecommendation(s, command),
          memory.workforceRecommendations.decideRecommendation(s, command),
        );
      }

      // Read-back equivalence across every surface, including the filter
      // edge behavior (empty personId/adjustment returns ALL).
      expect(await pg.listRoles(s)).toEqual(memory.workforce.listRoles(s));
      for (const [personId, at] of [
        ["p-1", now(500)],
        ["p-1", now(20000)],
        ["p-2", now(150)],
        ["p-none", now(500)],
        ["  p-1  ", now(500)],
      ] as const) {
        expectSameResult(
          await pg.getCapacity(s, personId, at),
          memory.workforce.getCapacity(s, personId, at),
        );
      }
      for (const filter of [
        undefined,
        { personId: "p-1" },
        { personId: "" },
        { status: "ended" as const },
        { personId: "p-1", status: "active" as const },
        { personId: "p-2", status: "ended" as const },
      ] as const) {
        expect(await pg.listAssignments(s, filter)).toEqual(
          memory.workforce.listAssignments(s, filter),
        );
      }
      for (const period of [
        { start: now(0), end: now(10000) },
        { start: now(0), end: now(200) },
        { start: now(20000), end: now(30000) },
      ] as const) {
        for (const personId of ["p-1", "p-2", "p-none"]) {
          expectSameResult(
            await pg.workloadOf(s, personId, period),
            memory.workforce.workloadOf(s, personId, period),
          );
        }
      }
      for (const filter of [undefined, { personId: "p-1" }, { personId: "" }] as const) {
        expect(await insights.listWorkloadObservations(s, filter)).toEqual(
          memory.workforceInsights.listWorkloadObservations(s, filter),
        );
      }
      for (const filter of [
        undefined,
        { personId: "p-1" },
        { result: "met" as const },
        { personId: "p-1", result: "partial" as const },
        { personId: "" },
      ] as const) {
        expect(await insights.listOutcomes(s, filter)).toEqual(
          memory.workforceInsights.listOutcomes(s, filter),
        );
      }
      for (const filter of [
        undefined,
        { subject: { kind: "person", id: "p-1" } },
        { subject: { kind: "goal", id: "g-2" } },
        { subject: { kind: "goal", id: "g-none" } },
      ] as const) {
        expect(await insights.listAlternativeExplanations(s, filter)).toEqual(
          memory.workforceInsights.listAlternativeExplanations(s, filter),
        );
      }
      for (const recommendationId of ["rec-1", "rec-2", "rec-3", "missing"]) {
        expectSameResult(
          await recommendations.getRecommendation(s, recommendationId),
          memory.workforceRecommendations.getRecommendation(s, recommendationId),
        );
      }
      for (const filter of [
        undefined,
        { adjustment: "training" },
        { state: "pending" as const },
        { employmentImpacting: true },
        { adjustment: "hiring", state: "human-rejected" as const },
        { adjustment: "" },
      ] as const) {
        expect(await recommendations.listRecommendations(s, filter)).toEqual(
          memory.workforceRecommendations.listRecommendations(s, filter),
        );
      }
    } finally {
      await local.close();
    }
  });

  it("mirrors validation failures issue-for-issue (incl. the bounded-allocation rules)", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgWorkforceDirectory(local.sql);
      const insights = createPgWorkforceInsights(local.sql);
      const recommendations = createPgWorkforceRecommendations(local.sql);
      const memory = memoryKernel();
      const s = scope("workforce-validation");

      const badRoles: readonly Record<string, unknown>[] = [
        { roleId: "" },
        { title: "   " },
        { title: "x".repeat(301) },
        { description: "   " },
        { requiredCapabilities: ["cap", ""] },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of badRoles) {
        const input = roleInput(overrides);
        expectSameResult(await pg.registerRole(s, input), memory.workforce.registerRole(s, input));
      }
      const badCapacities: readonly Record<string, unknown>[] = [
        { capacityId: "" },
        { personId: "" },
        { bounds: { period: { start: -1, end: 10 }, maxEffortMs: 1, maxConcurrentAssignments: 1 } },
        { bounds: { period: { start: 10, end: 5 }, maxEffortMs: 1, maxConcurrentAssignments: 1 } },
        { bounds: { period: { start: 0, end: 10 }, maxEffortMs: 0, maxConcurrentAssignments: 1 } },
        {
          bounds: { period: { start: 0, end: 10 }, maxEffortMs: -5, maxConcurrentAssignments: 1 },
        },
        { bounds: { period: { start: 0, end: 10 }, maxEffortMs: 1, maxConcurrentAssignments: 0 } },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of badCapacities) {
        const input = capacityInput(overrides);
        expectSameResult(
          await pg.declareCapacity(s, input),
          memory.workforce.declareCapacity(s, input),
        );
      }
      // One valid capacity so the assignment rules can be exercised; two
      // active assignments saturate the concurrency bound (max 2).
      okOf(await pg.declareCapacity(s, capacityInput()));
      okOf(memory.workforce.declareCapacity(s, capacityInput()));
      okOf(await pg.recordAssignment(s, assignmentInput()));
      okOf(memory.workforce.recordAssignment(s, assignmentInput()));
      okOf(
        await pg.recordAssignment(
          s,
          assignmentInput({
            assignmentId: "a-2",
            roleId: undefined,
            processRef: undefined,
            effortMs: 20000,
            period: { start: now(0), end: now(10000) },
            now: now(3),
          }),
        ),
      );
      okOf(
        memory.workforce.recordAssignment(
          s,
          assignmentInput({
            assignmentId: "a-2",
            roleId: undefined,
            processRef: undefined,
            effortMs: 20000,
            period: { start: now(0), end: now(10000) },
            now: now(3),
          }),
        ),
      );

      const badAssignments: readonly Record<string, unknown>[] = [
        { assignmentId: "" },
        { personId: "" },
        { roleId: "bad\tid" },
        { processRef: { processId: "", stepId: "s" } },
        { processRef: { processId: "pr", stepId: "" } },
        { effortMs: 0 },
        { effortMs: -1 },
        { period: { start: -1, end: 5 } },
        { period: { start: 50, end: 5 } },
        { provenance: undefined },
        { now: -1 },
        // No covering declaration for this person.
        { assignmentId: "a-x", personId: "p-none" },
        // Id conflict wins over the missing covering declaration (order).
        { personId: "p-none" },
        // Concurrency: a third simultaneous active assignment (bound 2).
        {
          assignmentId: "a-y",
          effortMs: 1,
          period: { start: now(100), end: now(200) },
          now: now(3),
        },
        // Effort: overlapping only a-2, within concurrency but over the total.
        {
          assignmentId: "a-z",
          effortMs: 150000,
          period: { start: now(6000), end: now(7000) },
          now: now(3),
        },
      ];
      for (const overrides of badAssignments) {
        const input = assignmentInput(overrides);
        expectSameResult(
          await pg.recordAssignment(s, input),
          memory.workforce.recordAssignment(s, input),
        );
      }
      const badEnds: readonly Record<string, unknown>[] = [
        { assignmentId: "bad id" },
        { now: -1 },
        { audit: undefined },
        { audit: { actor: personActor("p-9"), at: now(4), reason: "   " } },
      ];
      for (const overrides of badEnds) {
        const input = {
          assignmentId: "a-1",
          endedBy: personActor("p-9"),
          now: now(4),
          audit: auditInput(personActor("p-9"), "done", 4),
          ...overrides,
        };
        expectSameResult(
          await pg.endAssignment(s, input),
          memory.workforce.endAssignment(s, input),
        );
      }

      const badObservations: readonly Record<string, unknown>[] = [
        { observationId: "" },
        { personId: "" },
        { period: { start: -1, end: 5 } },
        { period: { start: 5, end: 1 } },
        { observedEffortMs: -1 },
        { observedUtilization: -0.5 },
        { observedUtilization: Number.NaN },
        { note: "x".repeat(2001) },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of badObservations) {
        const input = observationInput(overrides);
        expectSameResult(
          await insights.recordWorkloadObservation(s, input),
          memory.workforceInsights.recordWorkloadObservation(s, input),
        );
      }
      const badOutcomes: readonly Record<string, unknown>[] = [
        { outcomeId: "" },
        { personId: "" },
        { period: { start: -1, end: 5 } },
        { subject: { kind: "wish", id: "x" } },
        { subject: { kind: "goal", id: "" } },
        { result: "smashed" },
        { summary: "   " },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of badOutcomes) {
        const input = outcomeInput(overrides);
        expectSameResult(
          await insights.recordOutcome(s, input),
          memory.workforceInsights.recordOutcome(s, input),
        );
      }
      const badExplanations: readonly Record<string, unknown>[] = [
        { explanationId: "" },
        { subject: { kind: "wish", id: "x" } },
        { subject: undefined },
        { pattern: "   " },
        { explanation: "   " },
        { evidenceRefs: [{ kind: "goal", id: "" }] },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of badExplanations) {
        const input = explanationInput(overrides);
        expectSameResult(
          await insights.recordAlternativeExplanation(s, input),
          memory.workforceInsights.recordAlternativeExplanation(s, input),
        );
      }
      // The shared non-array evidenceRefs TypeError: both kernels throw
      // identically on `[...undefined]` after the issue-free validation.
      const badExplanation = explanationInput({ evidenceRefs: undefined });
      const pgThrow = await rejectionMessage(() =>
        insights.recordAlternativeExplanation(s, badExplanation),
      );
      let memoryThrow = "";
      try {
        memory.workforceInsights.recordAlternativeExplanation(s, badExplanation);
      } catch (error) {
        memoryThrow = error instanceof Error ? error.message : String(error);
      }
      expect(pgThrow).toBe(memoryThrow);

      const badProposals: readonly Record<string, unknown>[] = [
        { recommendationId: "" },
        { adjustment: "wish" },
        { subject: { kind: "wish", id: "x" } },
        { rationale: "   " },
        { evidenceRefs: [{ kind: "goal", id: "" }] },
        { employmentImpacting: "yes" },
        { proposedBy: undefined },
        { provenance: undefined },
        { now: -1 },
        // Inherently-impacting adjustment cannot be proposed non-impacting.
        { adjustment: "reassignment", employmentImpacting: false },
        { adjustment: "hiring", employmentImpacting: false },
        { adjustment: "agent-replacement", employmentImpacting: false },
        { adjustment: "outsourcing", employmentImpacting: false },
        // Impacting proposal without evidence.
        { adjustment: "training", employmentImpacting: true },
      ];
      for (const overrides of badProposals) {
        const input = recommendationInput(overrides);
        expectSameResult(
          await recommendations.proposeRecommendation(s, input),
          memory.workforceRecommendations.proposeRecommendation(s, input),
        );
      }
      okOf(await recommendations.proposeRecommendation(s, recommendationInput()));
      okOf(memory.workforceRecommendations.proposeRecommendation(s, recommendationInput()));
      const badDecides: readonly Record<string, unknown>[] = [
        { recommendationId: "bad id" },
        { decision: "machine-approved" },
        { reason: "   " },
        { decidedBy: undefined },
        { now: -1 },
      ];
      for (const overrides of badDecides) {
        const input = decideInput(overrides);
        expectSameResult(
          await recommendations.decideRecommendation(s, input),
          memory.workforceRecommendations.decideRecommendation(s, input),
        );
      }

      // Nothing may have been written by a failed command.
      expect(await pg.listRoles(s)).toEqual(memory.workforce.listRoles(s));
      expect(await pg.listAssignments(s)).toEqual(memory.workforce.listAssignments(s));
      expect(await insights.listWorkloadObservations(s)).toEqual(
        memory.workforceInsights.listWorkloadObservations(s),
      );
      expect(await insights.listOutcomes(s)).toEqual(memory.workforceInsights.listOutcomes(s));
      expect(await insights.listAlternativeExplanations(s)).toEqual(
        memory.workforceInsights.listAlternativeExplanations(s),
      );
      expect(await recommendations.listRecommendations(s)).toEqual(
        memory.workforceRecommendations.listRecommendations(s),
      );
      // The only journaled workforce mutations are the successful capacity
      // register, the two assignment registers and the one proposal above.
      expect(
        (await listJournal(local.sql, s.tenantId))
          .filter((row) => row.area === "workforce")
          .map((row) => row.journalKey),
      ).toEqual([
        "workforce:declare-capacity:cap-p-1",
        "workforce:record-assignment:a-1",
        "workforce:record-assignment:a-2",
        "workforce:propose-recommendation:rec-1",
      ]);
    } finally {
      await local.close();
    }
  });

  it("mirrors conflict/not-found/forbidden discipline and tenant isolation", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgWorkforceDirectory(local.sql);
      const insights = createPgWorkforceInsights(local.sql);
      const recommendations = createPgWorkforceRecommendations(local.sql);
      const memory = memoryKernel();
      const s = scope("workforce-conflict");
      const other = scope("workforce-other");

      // Duplicate registrations resolve as the same conflicts.
      okOf(await pg.registerRole(s, roleInput()));
      okOf(memory.workforce.registerRole(s, roleInput()));
      expectSameResult(
        await pg.registerRole(s, roleInput()),
        memory.workforce.registerRole(s, roleInput()),
      );
      okOf(await pg.declareCapacity(s, capacityInput()));
      okOf(memory.workforce.declareCapacity(s, capacityInput()));
      expectSameResult(
        await pg.declareCapacity(s, capacityInput()),
        memory.workforce.declareCapacity(s, capacityInput()),
      );
      okOf(await pg.recordAssignment(s, assignmentInput()));
      okOf(memory.workforce.recordAssignment(s, assignmentInput()));
      expectSameResult(
        await pg.recordAssignment(s, assignmentInput()),
        memory.workforce.recordAssignment(s, assignmentInput()),
      );
      okOf(await insights.recordWorkloadObservation(s, observationInput()));
      okOf(memory.workforceInsights.recordWorkloadObservation(s, observationInput()));
      expectSameResult(
        await insights.recordWorkloadObservation(s, observationInput()),
        memory.workforceInsights.recordWorkloadObservation(s, observationInput()),
      );
      okOf(await insights.recordOutcome(s, outcomeInput()));
      okOf(memory.workforceInsights.recordOutcome(s, outcomeInput()));
      expectSameResult(
        await insights.recordOutcome(s, outcomeInput()),
        memory.workforceInsights.recordOutcome(s, outcomeInput()),
      );
      okOf(await insights.recordAlternativeExplanation(s, explanationInput()));
      okOf(memory.workforceInsights.recordAlternativeExplanation(s, explanationInput()));
      expectSameResult(
        await insights.recordAlternativeExplanation(s, explanationInput()),
        memory.workforceInsights.recordAlternativeExplanation(s, explanationInput()),
      );
      okOf(await recommendations.proposeRecommendation(s, recommendationInput()));
      okOf(memory.workforceRecommendations.proposeRecommendation(s, recommendationInput()));
      expectSameResult(
        await recommendations.proposeRecommendation(s, recommendationInput()),
        memory.workforceRecommendations.proposeRecommendation(s, recommendationInput()),
      );

      // Not-found: end/decide on missing records.
      const end = {
        assignmentId: "missing",
        endedBy: personActor("p-9"),
        now: now(4),
        audit: auditInput(personActor("p-9"), "done", 4),
      };
      expectSameResult(await pg.endAssignment(s, end), memory.workforce.endAssignment(s, end));
      expectSameResult(
        await recommendations.decideRecommendation(s, decideInput()),
        memory.workforceRecommendations.decideRecommendation(s, decideInput()),
      );
      // The human-only gate fires BEFORE the not-found check (mirrored
      // order): an agent decider is forbidden even for a missing id.
      const agentDecide = decideInput({
        recommendationId: "missing",
        decidedBy: { kind: "agent", externalRef: "agent-1" },
      });
      expectSameResult(
        await recommendations.decideRecommendation(s, agentDecide),
        memory.workforceRecommendations.decideRecommendation(s, agentDecide),
      );
      // Ended once: the second end is a conflict.
      const endOnce = {
        assignmentId: "a-1",
        endedBy: personActor("p-9"),
        now: now(4),
        audit: auditInput(personActor("p-9"), "done", 4),
      };
      expectSameResult(
        await pg.endAssignment(s, endOnce),
        memory.workforce.endAssignment(s, endOnce),
      );
      expectSameResult(
        await pg.endAssignment(s, endOnce),
        memory.workforce.endAssignment(s, endOnce),
      );
      // Decided once: the second decision is a conflict naming the state.
      expectSameResult(
        await recommendations.decideRecommendation(s, decideInput()),
        memory.workforceRecommendations.decideRecommendation(s, decideInput()),
      );
      expectSameResult(
        await recommendations.decideRecommendation(s, decideInput()),
        memory.workforceRecommendations.decideRecommendation(s, decideInput()),
      );

      // Tenant isolation: foreign reads are indistinguishable from missing
      // and the same ids are independently registrable per tenant.
      const foreignRead = errOf(await pg.getCapacity(other, "p-1", now(500)));
      const missingRead = errOf(await pg.getCapacity(s, "p-none", now(500)));
      expect(foreignRead.message).toBe(missingRead.message);
      expect(foreignRead.message).toBe("capacity declaration not found");
      expect(await pg.listRoles(other)).toEqual([]);
      expect(await pg.listAssignments(other)).toEqual([]);
      expect(await insights.listWorkloadObservations(other)).toEqual([]);
      expect(await insights.listOutcomes(other)).toEqual([]);
      expect(await insights.listAlternativeExplanations(other)).toEqual([]);
      expect(await recommendations.listRecommendations(other)).toEqual([]);
      expectSameResult(
        await recommendations.getRecommendation(other, "rec-1"),
        memory.workforceRecommendations.getRecommendation(other, "rec-1"),
      );
      okOf(await pg.registerRole(other, roleInput()));
      okOf(await pg.declareCapacity(other, capacityInput()));
      okOf(await pg.recordAssignment(other, assignmentInput()));
      okOf(await insights.recordWorkloadObservation(other, observationInput()));
      okOf(await insights.recordOutcome(other, outcomeInput()));
      okOf(await insights.recordAlternativeExplanation(other, explanationInput()));
      okOf(await recommendations.proposeRecommendation(other, recommendationInput()));
      // The original tenant's reads are unaffected by the other tenant's
      // same-id registrations.
      expectSameResult(
        await pg.getCapacity(s, "p-1", now(500)),
        memory.workforce.getCapacity(s, "p-1", now(500)),
      );
      expect(await pg.listAssignments(s)).toEqual(memory.workforce.listAssignments(s));
      expect(await insights.listOutcomes(s)).toEqual(memory.workforceInsights.listOutcomes(s));
      expect(await recommendations.listRecommendations(s)).toEqual(
        memory.workforceRecommendations.listRecommendations(s),
      );
    } finally {
      await local.close();
    }
  });

  it("appends matching audit entries (registered, declared, recorded, ended, observed, decided)", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgWorkforceDirectory(local.sql);
      const insights = createPgWorkforceInsights(local.sql);
      const recommendations = createPgWorkforceRecommendations(local.sql);
      const pgAudit = createPgAuditTrail(local.sql);
      const memory = memoryKernel();
      const s = scope("workforce-audit");

      okOf(await pg.registerRole(s, roleInput()));
      okOf(memory.workforce.registerRole(s, roleInput()));
      okOf(await pg.declareCapacity(s, capacityInput()));
      okOf(memory.workforce.declareCapacity(s, capacityInput()));
      okOf(await pg.recordAssignment(s, assignmentInput()));
      okOf(memory.workforce.recordAssignment(s, assignmentInput()));
      okOf(
        await pg.endAssignment(s, {
          assignmentId: "a-1",
          endedBy: personActor("p-9"),
          now: now(4),
          audit: auditInput(personActor("p-9"), "workload shifted", 4),
        }),
      );
      okOf(
        memory.workforce.endAssignment(s, {
          assignmentId: "a-1",
          endedBy: personActor("p-9"),
          now: now(4),
          audit: auditInput(personActor("p-9"), "workload shifted", 4),
        }),
      );
      okOf(await insights.recordWorkloadObservation(s, observationInput()));
      okOf(memory.workforceInsights.recordWorkloadObservation(s, observationInput()));
      okOf(await insights.recordOutcome(s, outcomeInput()));
      okOf(memory.workforceInsights.recordOutcome(s, outcomeInput()));
      okOf(await insights.recordAlternativeExplanation(s, explanationInput()));
      okOf(memory.workforceInsights.recordAlternativeExplanation(s, explanationInput()));
      okOf(await recommendations.proposeRecommendation(s, recommendationInput()));
      okOf(memory.workforceRecommendations.proposeRecommendation(s, recommendationInput()));
      okOf(await recommendations.decideRecommendation(s, decideInput()));
      okOf(memory.workforceRecommendations.decideRecommendation(s, decideInput()));
      expect(await pgAudit.queryAudit(s, {})).toEqual(memory.audit.queryAudit(s, {}));
      for (const subject of [
        { kind: "workforce", id: "r-1" },
        { kind: "workforce", id: "cap-p-1" },
        { kind: "workforce", id: "a-1" },
        { kind: "workforce", id: "obs-1" },
        { kind: "workforce", id: "out-1" },
        { kind: "workforce", id: "exp-1" },
        { kind: "workforce", id: "rec-1" },
      ] as const) {
        expect(await pgAudit.queryAudit(s, { subject })).toEqual(
          memory.audit.queryAudit(s, { subject }),
        );
      }
    } finally {
      await local.close();
    }
  });
});

describe("PG workforce database enforcement", () => {
  it("rejects UPDATE and DELETE on every workforce table (append-only)", async () => {
    const pg = createPgWorkforceDirectory(harness.sql);
    const insights = createPgWorkforceInsights(harness.sql);
    const recommendations = createPgWorkforceRecommendations(harness.sql);
    const s = scope("workforce-immutable");
    okOf(await pg.registerRole(s, roleInput()));
    okOf(await pg.declareCapacity(s, capacityInput()));
    okOf(await pg.recordAssignment(s, assignmentInput()));
    okOf(
      await pg.endAssignment(s, {
        assignmentId: "a-1",
        endedBy: personActor("p-9"),
        now: now(4),
        audit: auditInput(personActor("p-9"), "done", 4),
      }),
    );
    okOf(await insights.recordWorkloadObservation(s, observationInput()));
    okOf(await insights.recordOutcome(s, outcomeInput()));
    okOf(await insights.recordAlternativeExplanation(s, explanationInput()));
    okOf(await recommendations.proposeRecommendation(s, recommendationInput()));
    okOf(await recommendations.decideRecommendation(s, decideInput()));
    for (const table of [
      "domain_workforce_roles",
      "domain_workforce_capacities",
      "domain_workforce_assignments",
      "domain_workforce_assignment_ends",
      "domain_workload_observations",
      "domain_work_outcomes",
      "domain_alternative_explanations",
      "domain_workforce_recommendations",
      "domain_workforce_recommendation_decisions",
    ] as const) {
      await expect(
        harness.sql.unsafe(`update ${table} set tenant_id = tenant_id where tenant_id = $1`, [
          s.tenantId,
        ]),
      ).rejects.toThrow(/append-only/);
      await expect(
        harness.sql.unsafe(`delete from ${table} where tenant_id = $1`, [s.tenantId]),
      ).rejects.toThrow(/append-only/);
    }
    expect((await pg.listRoles(s)).length).toBe(1);
    expect((await pg.listAssignments(s)).length).toBe(1);
    expect((await insights.listWorkloadObservations(s)).length).toBe(1);
    expect((await insights.listOutcomes(s)).length).toBe(1);
    expect((await insights.listAlternativeExplanations(s)).length).toBe(1);
    expect((await recommendations.listRecommendations(s)).length).toBe(1);
  });

  it("journeys every mutation through the write journal with stable keys", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgWorkforceDirectory(local.sql);
      const insights = createPgWorkforceInsights(local.sql);
      const recommendations = createPgWorkforceRecommendations(local.sql);
      const s = scope("workforce-journal");
      await pg.registerRole(s, roleInput());
      await pg.declareCapacity(s, capacityInput());
      await pg.recordAssignment(s, assignmentInput());
      await pg.endAssignment(s, {
        assignmentId: "a-1",
        endedBy: personActor("p-9"),
        now: now(4),
        audit: auditInput(personActor("p-9"), "done", 4),
      });
      await insights.recordWorkloadObservation(s, observationInput());
      await insights.recordOutcome(s, outcomeInput());
      await insights.recordAlternativeExplanation(s, explanationInput());
      await recommendations.proposeRecommendation(s, recommendationInput());
      await recommendations.decideRecommendation(s, decideInput());
      const rows = await listJournal(local.sql, s.tenantId);
      expect(rows.filter((row) => row.area === "workforce").map((row) => row.journalKey)).toEqual([
        "workforce:register-role:r-1",
        "workforce:declare-capacity:cap-p-1",
        "workforce:record-assignment:a-1",
        "workforce:end-assignment:a-1",
        "workforce:observe-workload:obs-1",
        "workforce:record-outcome:out-1",
        "workforce:record-explanation:exp-1",
        "workforce:propose-recommendation:rec-1",
        "workforce:decide-recommendation:rec-1",
      ]);
    } finally {
      await local.close();
    }
  });

  it("rejects history rewrites and illegal decision states (database constraints)", async () => {
    const pg = createPgWorkforceDirectory(harness.sql);
    const insights = createPgWorkforceInsights(harness.sql);
    const recommendations = createPgWorkforceRecommendations(harness.sql);
    const s = scope("workforce-constraint");
    okOf(await pg.declareCapacity(s, capacityInput()));
    okOf(await pg.recordAssignment(s, assignmentInput()));
    okOf(
      await pg.endAssignment(s, {
        assignmentId: "a-1",
        endedBy: personActor("p-9"),
        now: now(4),
        audit: auditInput(personActor("p-9"), "done", 4),
      }),
    );
    okOf(await insights.recordWorkloadObservation(s, observationInput()));
    okOf(await recommendations.proposeRecommendation(s, recommendationInput()));
    okOf(await recommendations.decideRecommendation(s, decideInput()));
    // Duplicate base rows are rejected by the primary key.
    await expect(
      harness.sql`
        insert into domain_workforce_assignments (tenant_id, assignment_id, person_id, record)
        values (${s.tenantId}, 'a-1', 'p-1', '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      harness.sql`
        insert into domain_workload_observations (tenant_id, observation_id, person_id, record)
        values (${s.tenantId}, 'obs-1', 'p-1', '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      harness.sql`
        insert into domain_workforce_recommendations
          (tenant_id, recommendation_id, adjustment, record)
        values (${s.tenantId}, 'rec-1', 'training', '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    // A raw second end for the same assignment is rejected by the
    // one-end-per-assignment primary key (decisions are immutable too).
    await expect(
      harness.sql`
        insert into domain_workforce_assignment_ends
          (tenant_id, assignment_id, ended_at, ended_by)
        values (${s.tenantId}, 'a-1', 1, '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    // A raw second decision for the same recommendation is rejected by the
    // one-decision-per-record primary key...
    await expect(
      harness.sql`
        insert into domain_workforce_recommendation_decisions
          (tenant_id, recommendation_id, state, decided_at, decided_by, reason)
        values (${s.tenantId}, 'rec-1', 'human-rejected', 1, '{}'::jsonb, 'nope')
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    // ...and an illegal decision state is rejected by the check constraint.
    await expect(
      harness.sql`
        insert into domain_workforce_recommendation_decisions
          (tenant_id, recommendation_id, state, decided_at, decided_by, reason)
        values (${s.tenantId}, 'rec-9', 'machine-approved', 1, '{}'::jsonb, 'nope')
      `,
    ).rejects.toThrow(/check/i);
    // The adapter-level reads keep the derived values this tenant produced.
    expect(await pg.listAssignments(s)).toHaveLength(1);
    expect((await recommendations.listRecommendations(s))[0]?.decision.state).toBe(
      "human-approved",
    );
  });
});
