/**
 * P001 epistemics area proof: the PG claims + beliefs ledger and the PG
 * inquiry ledger round-trip with semantics identical to the in-memory
 * reference — full claim lifecycles (active + retracted), append-only belief
 * revision histories, hypothesis status machines, retained contradictions
 * and explicit unknowns — with the same validation issues, the same
 * not-found-before-conflict discipline (observation/claim usability through
 * the injected async lookup, exactly the closure the kernel wires), the same
 * audit side-effects (registrations and openings carry none) — and every
 * table is append-only by database trigger with history rewrites rejected
 * by primary keys.
 *
 * Equivalence tests boot a fresh harness per test (the audit id sequence is
 * global, mirroring the kernel-global in-memory counter).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  OpenHypothesisInput,
  RaiseUnknownInput,
  RecordContradictionInput,
  RegisterClaimInput,
  ReviseBeliefInput,
  SubjectReference,
} from "@aurum/domain";
import { createPgEpistemicsLedger } from "../src/domain-storage/adapters/epistemics-store.js";
import { createPgInquiryLedger } from "../src/domain-storage/adapters/inquiry-store.js";
import { createPgEvidenceLedger } from "../src/domain-storage/adapters/evidence-store.js";
import { createPgAuditTrail } from "../src/domain-storage/adapters/audit-store.js";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import {
  auditInput,
  errOf,
  expectSameResult,
  memoryKernel,
  now,
  okOf,
  pgHarness,
  personActor,
  provenance,
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

const topic = (id: string): SubjectReference => ({ kind: "topic", id });

/** Boots the PG epistemics world: evidence ledger + lookup-wired ledgers. */
function pgEpistemicsWorld(sql: PgLiteHarness["sql"]) {
  const evidence = createPgEvidenceLedger(sql);
  const epistemics = createPgEpistemicsLedger(sql, {
    evidenceLookup: {
      observationExists: async (s, observationId) =>
        (await evidence.getObservation(s, observationId)).ok === true,
      claimIsUsable: async (s, claimId) => {
        const claim = await epistemics.getClaim(s, claimId);
        return claim.ok === true && claim.value.status === "active";
      },
    },
  });
  const inquiry = createPgInquiryLedger(sql);
  return { evidence, epistemics, inquiry };
}

/** Seeds two observations on both kernels (claims derive from them). */
async function seedObservations(
  world: ReturnType<typeof pgEpistemicsWorld>,
  memory: ReturnType<typeof memoryKernel>,
  s: ReturnType<typeof scope>,
): Promise<void> {
  const observations = [
    {
      observationId: "o-1",
      subject: topic("t-1"),
      content: "observation one",
      provenance: provenance(systemActor("seed")),
      observedAt: now(0),
    },
    {
      observationId: "o-2",
      subject: topic("t-2"),
      content: "observation two",
      provenance: provenance(personActor("p-1"), 1),
      observedAt: now(1),
      freshness: { asOf: now(1), validUntil: now(5000) },
    },
  ];
  for (const command of observations) {
    okOf(await world.evidence.recordObservation(s, command));
    okOf(memory.evidence.recordObservation(s, command));
  }
}

function claimInput(overrides: Record<string, unknown> = {}): RegisterClaimInput {
  return {
    claimId: "c-1",
    statement: "the build is deterministic",
    derivedFrom: ["o-1"],
    provenance: provenance(systemActor("seed")),
    ...overrides,
  } as RegisterClaimInput;
}

function beliefInput(overrides: Record<string, unknown> = {}): ReviseBeliefInput {
  return {
    beliefId: "b-1",
    subject: topic("t-1"),
    statement: "we understand t-1",
    supportingClaimIds: ["c-1"],
    provenance: provenance(systemActor("seed")),
    now: now(2),
    audit: auditInput(personActor("p-1"), "revise"),
    ...overrides,
  } as ReviseBeliefInput;
}

function hypothesisInput(overrides: Record<string, unknown> = {}): OpenHypothesisInput {
  return {
    hypothesisId: "h-1",
    statement: "caching explains the variance",
    explains: [topic("t-1")],
    provenance: provenance(systemActor("seed")),
    now: now(3),
    ...overrides,
  } as OpenHypothesisInput;
}

function contradictionInput(overrides: Record<string, unknown> = {}): RecordContradictionInput {
  return {
    contradictionId: "ctr-1",
    between: [topic("t-1"), topic("t-2")],
    description: "the two observations disagree",
    provenance: provenance(systemActor("seed")),
    now: now(4),
    ...overrides,
  } as RecordContradictionInput;
}

function unknownInput(overrides: Record<string, unknown> = {}): RaiseUnknownInput {
  return {
    unknownId: "u-1",
    question: "which cache tier is hot?",
    consequence: "capacity planning stays guesswork",
    relatedSubjects: [topic("t-1")],
    provenance: provenance(systemActor("seed")),
    now: now(5),
    ...overrides,
  } as RaiseUnknownInput;
}

describe("PG epistemics equivalence with the in-memory reference", () => {
  it("round-trips claims, beliefs, hypotheses, contradictions and unknowns", async () => {
    const local = await pgHarness();
    try {
      const world = pgEpistemicsWorld(local.sql);
      const memory = memoryKernel();
      const s = scope("epistemics-equivalence");
      await seedObservations(world, memory, s);

      // Claims: active, retracted, explicit-freshness variants.
      const claims: readonly RegisterClaimInput[] = [
        claimInput(),
        claimInput({ claimId: "c-2", derivedFrom: ["o-2"] }),
        claimInput({
          claimId: "c-3",
          freshness: { asOf: now(1), validUntil: now(9000) },
        }),
      ];
      for (const command of claims) {
        expectSameResult(
          await world.epistemics.registerClaim(s, command),
          memory.epistemics.registerClaim(s, command),
        );
      }
      const retract = {
        reason: "superseded by c-3",
        now: now(6),
        audit: auditInput(personActor("p-1"), "retract", 6),
      };
      expectSameResult(
        await world.epistemics.retractClaim(s, "c-2", retract),
        memory.epistemics.retractClaim(s, "c-2", retract),
      );

      // Beliefs: multi-revision history on one subject, single-revision on
      // another, and a revision carrying explicit freshness.
      const beliefs: readonly ReviseBeliefInput[] = [
        beliefInput(),
        beliefInput({ statement: "we understand t-1 better", now: now(7) }),
        beliefInput({
          statement: "we understand t-1 well",
          now: now(8),
          freshness: { validUntil: now(9000) },
        }),
        beliefInput({
          beliefId: "b-2",
          subject: topic("t-2"),
          statement: "we understand t-2",
          supportingClaimIds: ["c-1"],
        }),
      ];
      for (const command of beliefs) {
        expectSameResult(
          await world.epistemics.reviseBelief(s, command),
          memory.epistemics.reviseBelief(s, command),
        );
      }

      // Hypotheses: three lifecycles through every legal terminal.
      const hypotheses: readonly OpenHypothesisInput[] = [
        hypothesisInput(),
        hypothesisInput({ hypothesisId: "h-2", explains: [topic("t-2")] }),
        hypothesisInput({ hypothesisId: "h-3", freshness: { validUntil: now(9000) } }),
      ];
      for (const command of hypotheses) {
        expectSameResult(
          await world.inquiry.openHypothesis(s, command),
          memory.inquiry.openHypothesis(s, command),
        );
      }
      const statusCommands: readonly [string, string, number][] = [
        ["h-1", "supported", 10],
        ["h-1", "retired", 11],
        ["h-2", "refuted", 12],
        ["h-3", "retired", 13],
      ];
      for (const [hypothesisId, status, at] of statusCommands) {
        const command = {
          hypothesisId,
          status,
          provenance: provenance(personActor("p-1"), at),
          now: now(at),
          audit: auditInput(personActor("p-1"), `status ${status}`, at),
        };
        expectSameResult(
          await world.inquiry.recordHypothesisStatus(s, command),
          memory.inquiry.recordHypothesisStatus(s, command),
        );
      }

      // Contradictions and unknowns: one retained, one resolved each.
      const retainedContradiction = contradictionInput();
      const resolvedContradiction = contradictionInput({ contradictionId: "ctr-2" });
      for (const command of [retainedContradiction, resolvedContradiction]) {
        expectSameResult(
          await world.inquiry.recordContradiction(s, command),
          memory.inquiry.recordContradiction(s, command),
        );
      }
      const contradictionResolution = {
        contradictionId: "ctr-2",
        outcome: "o-2 was stale",
        now: now(14),
        audit: auditInput(personActor("p-1"), "resolve", 14),
      };
      expectSameResult(
        await world.inquiry.resolveContradiction(s, contradictionResolution),
        memory.inquiry.resolveContradiction(s, contradictionResolution),
      );

      const openUnknown = unknownInput();
      const resolvedUnknown = unknownInput({ unknownId: "u-2", relatedSubjects: [] });
      for (const command of [openUnknown, resolvedUnknown]) {
        expectSameResult(
          await world.inquiry.raiseUnknown(s, command),
          memory.inquiry.raiseUnknown(s, command),
        );
      }
      const unknownResolution = {
        unknownId: "u-2",
        outcome: "measured: tier two",
        now: now(15),
        audit: auditInput(personActor("p-1"), "resolve", 15),
      };
      expectSameResult(
        await world.inquiry.resolveUnknown(s, unknownResolution),
        memory.inquiry.resolveUnknown(s, unknownResolution),
      );

      // Read-back equivalence across every record kind and list surface.
      for (const claimId of ["c-1", "c-2", "c-3", "missing"]) {
        expectSameResult(
          await world.epistemics.getClaim(s, claimId),
          memory.epistemics.getClaim(s, claimId),
        );
      }
      for (const beliefId of ["b-1", "b-2", "missing"]) {
        expectSameResult(
          await world.epistemics.getBelief(s, beliefId),
          memory.epistemics.getBelief(s, beliefId),
        );
      }
      for (const subject of [topic("t-1"), topic("t-2"), topic("nope")]) {
        expect(await world.epistemics.listBeliefs(s, subject)).toEqual(
          memory.epistemics.listBeliefs(s, subject),
        );
      }
      for (const hypothesisId of ["h-1", "h-2", "h-3", "missing"]) {
        expectSameResult(
          await world.inquiry.getHypothesis(s, hypothesisId),
          memory.inquiry.getHypothesis(s, hypothesisId),
        );
      }
      for (const contradictionId of ["ctr-1", "ctr-2", "missing"]) {
        expectSameResult(
          await world.inquiry.getContradiction(s, contradictionId),
          memory.inquiry.getContradiction(s, contradictionId),
        );
      }
      expect(await world.inquiry.listOpenContradictions(s)).toEqual(
        memory.inquiry.listOpenContradictions(s),
      );
      for (const unknownId of ["u-1", "u-2", "missing"]) {
        expectSameResult(
          await world.inquiry.getUnknown(s, unknownId),
          memory.inquiry.getUnknown(s, unknownId),
        );
      }
      expect(await world.inquiry.listOpenUnknowns(s)).toEqual(memory.inquiry.listOpenUnknowns(s));
    } finally {
      await local.close();
    }
  });

  it("mirrors validation failures issue-for-issue", async () => {
    const local = await pgHarness();
    try {
      const world = pgEpistemicsWorld(local.sql);
      const memory = memoryKernel();
      const s = scope("epistemics-validation");
      await seedObservations(world, memory, s);

      const badClaims: readonly Record<string, unknown>[] = [
        { claimId: "" },
        { claimId: "c-\u0001" },
        { statement: "   " },
        { derivedFrom: [] },
        { derivedFrom: ["o-1", "o-1"] },
        { provenance: undefined },
        { provenance: { actor: systemActor("x"), source: "guess", recordedAt: now(0) } },
        { provenance: { actor: { kind: "person" }, source: "human-entered", recordedAt: now(0) } },
        { provenance: { actor: systemActor("x"), source: "human-entered", recordedAt: -1 } },
        {
          provenance: {
            actor: systemActor("x"),
            source: "human-entered",
            recordedAt: now(0),
            note: "  ",
          },
        },
        { freshness: { asOf: -1 } },
        { freshness: { validUntil: Number.NaN } },
      ];
      for (const overrides of badClaims) {
        const input = claimInput(overrides);
        expectSameResult(
          await world.epistemics.registerClaim(s, input),
          memory.epistemics.registerClaim(s, input),
        );
      }
      const badRetracts: readonly [string, Record<string, unknown>][] = [
        ["", {}],
        ["c-\u0001", {}],
        ["missing", { now: -1 }],
        ["missing", { reason: "   " }],
        ["missing", { audit: { ...auditInput(personActor("p-1"), "why"), reason: "" } }],
      ];
      for (const [claimId, overrides] of badRetracts) {
        const input = {
          reason: "why",
          now: now(1),
          audit: auditInput(personActor("p-1"), "why"),
          ...overrides,
        } as never;
        expectSameResult(
          await world.epistemics.retractClaim(s, claimId, input),
          memory.epistemics.retractClaim(s, claimId, input),
        );
      }

      const badBeliefs: readonly Record<string, unknown>[] = [
        { beliefId: "" },
        { subject: { kind: "warp", id: "x" } },
        { subject: { kind: "topic", id: "  " } },
        { statement: "   " },
        { supportingClaimIds: [] },
        { supportingClaimIds: ["c-1", "c-1"] },
        { provenance: undefined },
        { now: -1 },
        { audit: { ...auditInput(personActor("p-1"), "why"), reason: "  " } },
        { freshness: { asOf: -5 } },
      ];
      for (const overrides of badBeliefs) {
        const input = beliefInput(overrides);
        expectSameResult(
          await world.epistemics.reviseBelief(s, input),
          memory.epistemics.reviseBelief(s, input),
        );
      }

      const badHypotheses: readonly Record<string, unknown>[] = [
        { hypothesisId: "" },
        { statement: "   " },
        { explains: [] },
        { explains: [{ kind: "warp", id: "x" }] },
        { explains: "not-an-array" },
        { provenance: undefined },
        { now: -1 },
        { freshness: { asOf: -1 } },
      ];
      for (const overrides of badHypotheses) {
        const input = hypothesisInput(overrides);
        expectSameResult(
          await world.inquiry.openHypothesis(s, input),
          memory.inquiry.openHypothesis(s, input),
        );
      }
      const badStatuses: readonly Record<string, unknown>[] = [
        { hypothesisId: "" },
        { status: "sideways" },
        { provenance: undefined },
        { now: -1 },
        { audit: { ...auditInput(personActor("p-1"), "why"), reason: "  " } },
      ];
      for (const overrides of badStatuses) {
        const input = {
          hypothesisId: "h-1",
          status: "supported",
          provenance: provenance(systemActor("seed")),
          now: now(2),
          audit: auditInput(personActor("p-1"), "status"),
          ...overrides,
        };
        expectSameResult(
          await world.inquiry.recordHypothesisStatus(s, input),
          memory.inquiry.recordHypothesisStatus(s, input),
        );
      }

      const badContradictions: readonly Record<string, unknown>[] = [
        { contradictionId: "" },
        { description: "   " },
        { between: [topic("t-1")] },
        { between: [] },
        { between: [topic("t-1"), { kind: "warp", id: "x" }] },
        { between: [topic("t-1"), topic("t-1")] },
        { provenance: undefined },
        { now: -1 },
        { freshness: { asOf: -1 } },
      ];
      for (const overrides of badContradictions) {
        const input = contradictionInput(overrides);
        expectSameResult(
          await world.inquiry.recordContradiction(s, input),
          memory.inquiry.recordContradiction(s, input),
        );
      }
      const badContradictionResolutions: readonly Record<string, unknown>[] = [
        { contradictionId: "" },
        { outcome: "   " },
        { now: -1 },
        { audit: { ...auditInput(personActor("p-1"), "why"), reason: "  " } },
      ];
      for (const overrides of badContradictionResolutions) {
        const input = {
          contradictionId: "ctr-1",
          outcome: "settled",
          now: now(3),
          audit: auditInput(personActor("p-1"), "resolve"),
          ...overrides,
        };
        expectSameResult(
          await world.inquiry.resolveContradiction(s, input),
          memory.inquiry.resolveContradiction(s, input),
        );
      }

      const badUnknowns: readonly Record<string, unknown>[] = [
        { unknownId: "" },
        { question: "   " },
        { consequence: "   " },
        { relatedSubjects: [{ kind: "warp", id: "x" }] },
        { provenance: undefined },
        { now: -1 },
      ];
      for (const overrides of badUnknowns) {
        const input = unknownInput(overrides);
        expectSameResult(
          await world.inquiry.raiseUnknown(s, input),
          memory.inquiry.raiseUnknown(s, input),
        );
      }
      const badUnknownResolutions: readonly Record<string, unknown>[] = [
        { unknownId: "" },
        { outcome: "   " },
        { now: -1 },
        { audit: { ...auditInput(personActor("p-1"), "why"), reason: "  " } },
      ];
      for (const overrides of badUnknownResolutions) {
        const input = {
          unknownId: "u-1",
          outcome: "answered",
          now: now(4),
          audit: auditInput(personActor("p-1"), "resolve"),
          ...overrides,
        };
        expectSameResult(
          await world.inquiry.resolveUnknown(s, input),
          memory.inquiry.resolveUnknown(s, input),
        );
      }

      // Nothing may have been written by a failed command.
      expect(await world.inquiry.listOpenContradictions(s)).toEqual([]);
      expect(await world.inquiry.listOpenUnknowns(s)).toEqual([]);
      expect(await world.epistemics.listBeliefs(s, topic("t-1"))).toEqual([]);
      expectSameResult(
        await world.epistemics.getClaim(s, "missing"),
        memory.epistemics.getClaim(s, "missing"),
      );
    } finally {
      await local.close();
    }
  });

  it("mirrors not-found/conflict/invariant discipline and tenant isolation", async () => {
    const local = await pgHarness();
    try {
      const world = pgEpistemicsWorld(local.sql);
      const memory = memoryKernel();
      const s = scope("epistemics-discipline");
      const foreign = scope("epistemics-foreign");
      await seedObservations(world, memory, s);

      // Observation existence is verified BEFORE the duplicate conflict.
      const missingObservation = claimInput({ derivedFrom: ["nope"] });
      expectSameResult(
        await world.epistemics.registerClaim(s, missingObservation),
        memory.epistemics.registerClaim(s, missingObservation),
      );
      okOf(await world.epistemics.registerClaim(s, claimInput()));
      okOf(memory.epistemics.registerClaim(s, claimInput()));
      expectSameResult(
        await world.epistemics.registerClaim(s, claimInput()),
        memory.epistemics.registerClaim(s, claimInput()),
      );
      expectSameResult(
        await world.epistemics.retractClaim(s, "missing", {
          reason: "why",
          now: now(1),
          audit: auditInput(personActor("p-1"), "why"),
        }),
        memory.epistemics.retractClaim(s, "missing", {
          reason: "why",
          now: now(1),
          audit: auditInput(personActor("p-1"), "why"),
        }),
      );
      const retract = {
        reason: "why",
        now: now(2),
        audit: auditInput(personActor("p-1"), "retract", 2),
      };
      expectSameResult(
        await world.epistemics.retractClaim(s, "c-1", retract),
        memory.epistemics.retractClaim(s, "c-1", retract),
      );
      expectSameResult(
        await world.epistemics.retractClaim(s, "c-1", retract),
        memory.epistemics.retractClaim(s, "c-1", retract),
      );

      // Beliefs: claim usability is verified before subject stability, and
      // retention keeps the history referencing a later-retracted claim.
      okOf(await world.epistemics.registerClaim(s, claimInput({ claimId: "c-2" })));
      okOf(memory.epistemics.registerClaim(s, claimInput({ claimId: "c-2" })));
      const unknownClaim = beliefInput({ supportingClaimIds: ["nope"] });
      expectSameResult(
        await world.epistemics.reviseBelief(s, unknownClaim),
        memory.epistemics.reviseBelief(s, unknownClaim),
      );
      okOf(await world.epistemics.reviseBelief(s, beliefInput({ supportingClaimIds: ["c-2"] })));
      okOf(memory.epistemics.reviseBelief(s, beliefInput({ supportingClaimIds: ["c-2"] })));
      const subjectFlip = beliefInput({ subject: topic("t-2") });
      expectSameResult(
        await world.epistemics.reviseBelief(s, subjectFlip),
        memory.epistemics.reviseBelief(s, subjectFlip),
      );
      const retractedSupport = beliefInput({ supportingClaimIds: ["c-1"] });
      expectSameResult(
        await world.epistemics.reviseBelief(s, retractedSupport),
        memory.epistemics.reviseBelief(s, retractedSupport),
      );

      // Hypotheses: duplicate, missing, and every illegal move.
      okOf(await world.inquiry.openHypothesis(s, hypothesisInput()));
      okOf(memory.inquiry.openHypothesis(s, hypothesisInput()));
      expectSameResult(
        await world.inquiry.openHypothesis(s, hypothesisInput()),
        memory.inquiry.openHypothesis(s, hypothesisInput()),
      );
      const statusInput = (overrides: Record<string, unknown> = {}) => ({
        hypothesisId: "h-1",
        status: "supported",
        provenance: provenance(systemActor("seed")),
        now: now(3),
        audit: auditInput(personActor("p-1"), "status"),
        ...overrides,
      });
      expectSameResult(
        await world.inquiry.recordHypothesisStatus(s, statusInput({ hypothesisId: "nope" })),
        memory.inquiry.recordHypothesisStatus(s, statusInput({ hypothesisId: "nope" })),
      );
      expectSameResult(
        await world.inquiry.recordHypothesisStatus(s, statusInput({ status: "open" })),
        memory.inquiry.recordHypothesisStatus(s, statusInput({ status: "open" })),
      );
      okOf(await world.inquiry.recordHypothesisStatus(s, statusInput()));
      okOf(memory.inquiry.recordHypothesisStatus(s, statusInput()));
      expectSameResult(
        await world.inquiry.recordHypothesisStatus(s, statusInput({ status: "refuted" })),
        memory.inquiry.recordHypothesisStatus(s, statusInput({ status: "refuted" })),
      );
      okOf(await world.inquiry.recordHypothesisStatus(s, statusInput({ status: "retired" })));
      okOf(memory.inquiry.recordHypothesisStatus(s, statusInput({ status: "retired" })));
      expectSameResult(
        await world.inquiry.recordHypothesisStatus(s, statusInput({ status: "supported" })),
        memory.inquiry.recordHypothesisStatus(s, statusInput({ status: "supported" })),
      );

      // Contradictions and unknowns: duplicate, missing, already-resolved.
      okOf(await world.inquiry.recordContradiction(s, contradictionInput()));
      okOf(memory.inquiry.recordContradiction(s, contradictionInput()));
      expectSameResult(
        await world.inquiry.recordContradiction(s, contradictionInput()),
        memory.inquiry.recordContradiction(s, contradictionInput()),
      );
      const contradictionResolution = (overrides: Record<string, unknown> = {}) => ({
        contradictionId: "ctr-1",
        outcome: "settled",
        now: now(4),
        audit: auditInput(personActor("p-1"), "resolve"),
        ...overrides,
      });
      expectSameResult(
        await world.inquiry.resolveContradiction(
          s,
          contradictionResolution({ contradictionId: "nope" }),
        ),
        memory.inquiry.resolveContradiction(
          s,
          contradictionResolution({ contradictionId: "nope" }),
        ),
      );
      expectSameResult(
        await world.inquiry.resolveContradiction(s, contradictionResolution()),
        memory.inquiry.resolveContradiction(s, contradictionResolution()),
      );
      expectSameResult(
        await world.inquiry.resolveContradiction(s, contradictionResolution()),
        memory.inquiry.resolveContradiction(s, contradictionResolution()),
      );
      okOf(await world.inquiry.raiseUnknown(s, unknownInput()));
      okOf(memory.inquiry.raiseUnknown(s, unknownInput()));
      expectSameResult(
        await world.inquiry.raiseUnknown(s, unknownInput()),
        memory.inquiry.raiseUnknown(s, unknownInput()),
      );
      const unknownResolution = (overrides: Record<string, unknown> = {}) => ({
        unknownId: "u-1",
        outcome: "answered",
        now: now(5),
        audit: auditInput(personActor("p-1"), "resolve"),
        ...overrides,
      });
      expectSameResult(
        await world.inquiry.resolveUnknown(s, unknownResolution({ unknownId: "nope" })),
        memory.inquiry.resolveUnknown(s, unknownResolution({ unknownId: "nope" })),
      );
      expectSameResult(
        await world.inquiry.resolveUnknown(s, unknownResolution()),
        memory.inquiry.resolveUnknown(s, unknownResolution()),
      );
      expectSameResult(
        await world.inquiry.resolveUnknown(s, unknownResolution()),
        memory.inquiry.resolveUnknown(s, unknownResolution()),
      );

      // Foreign-tenant reads are indistinguishable from missing.
      for (const [pgRead, memoryRead] of [
        [
          () => world.epistemics.getClaim(foreign, "c-1"),
          () => memory.epistemics.getClaim(foreign, "c-1"),
        ],
        [
          () => world.epistemics.getBelief(foreign, "b-1"),
          () => memory.epistemics.getBelief(foreign, "b-1"),
        ],
        [
          () => world.inquiry.getHypothesis(foreign, "h-1"),
          () => memory.inquiry.getHypothesis(foreign, "h-1"),
        ],
        [
          () => world.inquiry.getContradiction(foreign, "ctr-1"),
          () => memory.inquiry.getContradiction(foreign, "ctr-1"),
        ],
        [
          () => world.inquiry.getUnknown(foreign, "u-1"),
          () => memory.inquiry.getUnknown(foreign, "u-1"),
        ],
      ] as const) {
        expectSameResult(await pgRead(), memoryRead());
      }
      const foreignClaimRead = errOf(await world.epistemics.getClaim(foreign, "c-1"));
      const missingClaimRead = errOf(await world.epistemics.getClaim(s, "missing"));
      expect(foreignClaimRead.message).toBe(missingClaimRead.message);
      expect(foreignClaimRead.message).toBe("claim not found");
      expect(await world.epistemics.listBeliefs(foreign, topic("t-1"))).toEqual([]);
      expect(await world.inquiry.listOpenContradictions(foreign)).toEqual([]);
      expect(await world.inquiry.listOpenUnknowns(foreign)).toEqual([]);

      // The same ids may exist independently in another tenant (the
      // foreign tenant seeds its own observation first — isolation is
      // per-tenant evidence, not shared rows).
      const foreignWorld = pgEpistemicsWorld(local.sql);
      okOf(
        await foreignWorld.evidence.recordObservation(foreign, {
          observationId: "o-1",
          subject: topic("t-1"),
          content: "foreign observation",
          provenance: provenance(systemActor("seed")),
          observedAt: now(0),
        }),
      );
      const seeded = okOf(
        await foreignWorld.epistemics.registerClaim(foreign, claimInput({ derivedFrom: ["o-1"] })),
      );
      expect(seeded.status).toBe("active");
      expectSameResult(
        await world.epistemics.getClaim(s, "c-1"),
        memory.epistemics.getClaim(s, "c-1"),
      );
    } finally {
      await local.close();
    }
  });

  it("appends matching audit entries (registrations and openings carry none)", async () => {
    const local = await pgHarness();
    try {
      const world = pgEpistemicsWorld(local.sql);
      const pgAudit = createPgAuditTrail(local.sql);
      const memory = memoryKernel();
      const s = scope("epistemics-audit");
      await seedObservations(world, memory, s);

      // Claim registration and hypothesis opening are NOT audited: after
      // both, the trails are still empty (even observation recording carries
      // no audit entry — only retractions do).
      okOf(await world.epistemics.registerClaim(s, claimInput()));
      okOf(memory.epistemics.registerClaim(s, claimInput()));
      okOf(await world.inquiry.openHypothesis(s, hypothesisInput()));
      okOf(memory.inquiry.openHypothesis(s, hypothesisInput()));
      expect(await pgAudit.queryAudit(s, {})).toEqual([]);
      expect(memory.audit.queryAudit(s, {})).toEqual([]);
      expect((await pgAudit.queryAudit(s, { subject: { kind: "claim", id: "c-1" } })).length).toBe(
        0,
      );
      expect(
        (await pgAudit.queryAudit(s, { subject: { kind: "hypothesis", id: "h-1" } })).length,
      ).toBe(0);

      // Every consequential transition appends an identical entry.
      const retract = {
        reason: "superseded",
        now: now(1),
        audit: auditInput(personActor("p-1"), "retract", 1),
      };
      okOf(await world.epistemics.retractClaim(s, "c-1", retract));
      okOf(memory.epistemics.retractClaim(s, "c-1", retract));
      okOf(
        await world.inquiry.recordHypothesisStatus(s, {
          hypothesisId: "h-1",
          status: "supported",
          provenance: provenance(systemActor("seed")),
          now: now(2),
          audit: auditInput(personActor("p-1"), "status", 2),
        }),
      );
      okOf(
        memory.inquiry.recordHypothesisStatus(s, {
          hypothesisId: "h-1",
          status: "supported",
          provenance: provenance(systemActor("seed")),
          now: now(2),
          audit: auditInput(personActor("p-1"), "status", 2),
        }),
      );
      okOf(await world.inquiry.recordContradiction(s, contradictionInput()));
      okOf(memory.inquiry.recordContradiction(s, contradictionInput()));
      okOf(await world.inquiry.raiseUnknown(s, unknownInput()));
      okOf(memory.inquiry.raiseUnknown(s, unknownInput()));
      okOf(
        await world.inquiry.resolveContradiction(s, {
          contradictionId: "ctr-1",
          outcome: "settled",
          now: now(3),
          audit: auditInput(personActor("p-1"), "resolve", 3),
        }),
      );
      okOf(
        memory.inquiry.resolveContradiction(s, {
          contradictionId: "ctr-1",
          outcome: "settled",
          now: now(3),
          audit: auditInput(personActor("p-1"), "resolve", 3),
        }),
      );
      okOf(
        await world.inquiry.resolveUnknown(s, {
          unknownId: "u-1",
          outcome: "answered",
          now: now(4),
          audit: auditInput(personActor("p-1"), "resolve", 4),
        }),
      );
      okOf(
        memory.inquiry.resolveUnknown(s, {
          unknownId: "u-1",
          outcome: "answered",
          now: now(4),
          audit: auditInput(personActor("p-1"), "resolve", 4),
        }),
      );
      expect(await pgAudit.queryAudit(s, {})).toEqual(memory.audit.queryAudit(s, {}));
      for (const subject of [
        { kind: "claim", id: "c-1" },
        { kind: "hypothesis", id: "h-1" },
        { kind: "contradiction", id: "ctr-1" },
        { kind: "unknown", id: "u-1" },
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

describe("PG epistemics database enforcement", () => {
  it("rejects UPDATE and DELETE on every epistemics table (append-only)", async () => {
    const world = pgEpistemicsWorld(harness.sql);
    const s = scope("epistemics-immutable");
    const evidence = createPgEvidenceLedger(harness.sql);
    okOf(
      await evidence.recordObservation(s, {
        observationId: "o-1",
        subject: topic("t-1"),
        content: "observation",
        provenance: provenance(systemActor("seed")),
        observedAt: now(0),
      }),
    );
    okOf(await world.epistemics.registerClaim(s, claimInput()));
    okOf(await world.epistemics.reviseBelief(s, beliefInput()));
    okOf(
      await world.epistemics.retractClaim(s, "c-1", {
        reason: "why",
        now: now(1),
        audit: auditInput(personActor("p-1"), "retract", 1),
      }),
    );
    okOf(await world.inquiry.openHypothesis(s, hypothesisInput()));
    okOf(
      await world.inquiry.recordHypothesisStatus(s, {
        hypothesisId: "h-1",
        status: "supported",
        provenance: provenance(systemActor("seed")),
        now: now(2),
        audit: auditInput(personActor("p-1"), "status", 2),
      }),
    );
    okOf(await world.inquiry.recordContradiction(s, contradictionInput()));
    okOf(
      await world.inquiry.resolveContradiction(s, {
        contradictionId: "ctr-1",
        outcome: "settled",
        now: now(3),
        audit: auditInput(personActor("p-1"), "resolve", 3),
      }),
    );
    okOf(await world.inquiry.raiseUnknown(s, unknownInput()));
    okOf(
      await world.inquiry.resolveUnknown(s, {
        unknownId: "u-1",
        outcome: "answered",
        now: now(4),
        audit: auditInput(personActor("p-1"), "resolve", 4),
      }),
    );

    const tables = [
      "domain_claims",
      "domain_claim_retractions",
      "domain_belief_revisions",
      "domain_hypotheses",
      "domain_contradictions",
      "domain_contradiction_resolutions",
      "domain_unknowns",
      "domain_unknown_resolutions",
    ] as const;
    for (const table of tables) {
      await expect(
        harness.sql.unsafe(`update ${table} set tenant_id = tenant_id where tenant_id = $1`, [
          s.tenantId,
        ]),
      ).rejects.toThrow(/append-only/);
      await expect(
        harness.sql.unsafe(`delete from ${table} where tenant_id = $1`, [s.tenantId]),
      ).rejects.toThrow(/append-only/);
    }
    // The records survived every rejected mutation attempt.
    const claim = okOf(await world.epistemics.getClaim(s, "c-1"));
    expect(claim.status).toBe("retracted");
    const belief = okOf(await world.epistemics.getBelief(s, "b-1"));
    expect(belief.currentRevision).toBe(1);
    const hypothesis = okOf(await world.inquiry.getHypothesis(s, "h-1"));
    expect(hypothesis.statusHistory).toHaveLength(2);
    const contradiction = okOf(await world.inquiry.getContradiction(s, "ctr-1"));
    expect(contradiction.status).toBe("resolved");
    const unknown = okOf(await world.inquiry.getUnknown(s, "u-1"));
    expect(unknown.status).toBe("resolved");
  });

  it("journeys every mutation through the write journal with stable keys", async () => {
    const world = pgEpistemicsWorld(harness.sql);
    const s = scope("epistemics-journal");
    const evidence = createPgEvidenceLedger(harness.sql);
    okOf(
      await evidence.recordObservation(s, {
        observationId: "o-1",
        subject: topic("t-1"),
        content: "observation",
        provenance: provenance(systemActor("seed")),
        observedAt: now(0),
      }),
    );
    okOf(await world.epistemics.registerClaim(s, claimInput()));
    okOf(await world.epistemics.reviseBelief(s, beliefInput()));
    okOf(await world.epistemics.reviseBelief(s, beliefInput({ statement: "v2" })));
    okOf(
      await world.epistemics.retractClaim(s, "c-1", {
        reason: "why",
        now: now(1),
        audit: auditInput(personActor("p-1"), "retract", 1),
      }),
    );
    okOf(await world.inquiry.openHypothesis(s, hypothesisInput()));
    okOf(
      await world.inquiry.recordHypothesisStatus(s, {
        hypothesisId: "h-1",
        status: "supported",
        provenance: provenance(systemActor("seed")),
        now: now(2),
        audit: auditInput(personActor("p-1"), "status", 2),
      }),
    );
    okOf(await world.inquiry.recordContradiction(s, contradictionInput()));
    okOf(
      await world.inquiry.resolveContradiction(s, {
        contradictionId: "ctr-1",
        outcome: "settled",
        now: now(3),
        audit: auditInput(personActor("p-1"), "resolve", 3),
      }),
    );
    okOf(await world.inquiry.raiseUnknown(s, unknownInput()));
    okOf(
      await world.inquiry.resolveUnknown(s, {
        unknownId: "u-1",
        outcome: "answered",
        now: now(4),
        audit: auditInput(personActor("p-1"), "resolve", 4),
      }),
    );

    const rows = await listJournal(harness.sql, s.tenantId);
    expect(rows.filter((row) => row.area === "epistemics").map((row) => row.journalKey)).toEqual([
      "epistemics:register-claim:c-1",
      "epistemics:revise-belief:b-1:1",
      "epistemics:revise-belief:b-1:2",
      "epistemics:retract-claim:c-1",
      "epistemics:open-hypothesis:h-1",
      "epistemics:hypothesis-status:h-1:1",
      "epistemics:record-contradiction:ctr-1",
      "epistemics:resolve-contradiction:ctr-1",
      "epistemics:raise-unknown:u-1",
      "epistemics:resolve-unknown:u-1",
    ]);
  });

  it("rejects history rewrites (database constraints)", async () => {
    const world = pgEpistemicsWorld(harness.sql);
    const s = scope("epistemics-constraints");
    const evidence = createPgEvidenceLedger(harness.sql);
    okOf(
      await evidence.recordObservation(s, {
        observationId: "o-1",
        subject: topic("t-1"),
        content: "observation",
        provenance: provenance(systemActor("seed")),
        observedAt: now(0),
      }),
    );
    okOf(await world.epistemics.registerClaim(s, claimInput()));
    okOf(await world.epistemics.reviseBelief(s, beliefInput()));
    okOf(
      await world.epistemics.retractClaim(s, "c-1", {
        reason: "why",
        now: now(1),
        audit: auditInput(personActor("p-1"), "retract", 1),
      }),
    );
    okOf(await world.inquiry.openHypothesis(s, hypothesisInput()));
    okOf(
      await world.inquiry.recordHypothesisStatus(s, {
        hypothesisId: "h-1",
        status: "supported",
        provenance: provenance(systemActor("seed")),
        now: now(2),
        audit: auditInput(personActor("p-1"), "status", 2),
      }),
    );
    okOf(await world.inquiry.recordContradiction(s, contradictionInput()));
    okOf(await world.inquiry.raiseUnknown(s, unknownInput()));

    // A second retraction for the same claim is rejected by the primary key.
    await expect(
      harness.sql`
        insert into domain_claim_retractions (tenant_id, claim_id, retracted_at, retracted_by, reason)
        values (${s.tenantId}, 'c-1', ${now(9)}, ${harness.sql.json({ kind: "system", name: "x" })}, 'again')
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    // Rewriting revision history is rejected by the primary key.
    await expect(
      harness.sql`
        insert into domain_belief_revisions
          (tenant_id, belief_id, revision_number, subject_kind, subject_id, record)
        values (${s.tenantId}, 'b-1', 1, 'topic', 't-1', '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    // Rewriting the hypothesis lifecycle is rejected by the primary key...
    await expect(
      harness.sql`
        insert into domain_hypotheses (tenant_id, hypothesis_id, mutation_seq, from_status, to_status, record)
        values (${s.tenantId}, 'h-1', 0, null, 'open', '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      harness.sql`
        insert into domain_hypotheses (tenant_id, hypothesis_id, mutation_seq, from_status, to_status, record)
        values (${s.tenantId}, 'h-1', 1, 'open', 'retired', '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    // ...and a transition row targeting 'open' violates the lifecycle check.
    await expect(
      harness.sql`
        insert into domain_hypotheses (tenant_id, hypothesis_id, mutation_seq, from_status, to_status, record)
        values (${s.tenantId}, 'h-9', 1, 'open', 'open', '{}'::jsonb)
      `,
    ).rejects.toThrow(/check/i);

    const claim = okOf(await world.epistemics.getClaim(s, "c-1"));
    expect(claim.status).toBe("retracted");
    const belief = okOf(await world.epistemics.getBelief(s, "b-1"));
    expect(belief.revisions).toHaveLength(1);
    const hypothesis = okOf(await world.inquiry.getHypothesis(s, "h-1"));
    expect(hypothesis.statusHistory).toHaveLength(2);
  });
});
