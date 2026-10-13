/**
 * P001 candidate area proof: the PG organization candidate registry
 * round-trips with semantics identical to the in-memory reference — the
 * W005 frozen shared vocabulary (mixed human/team/agent/software actors,
 * assignments, capability allocations, execution/information topology,
 * model occupancy, environment, budget, expected outcome, risks,
 * constraints, mandatory evidence) with the same input validation issues,
 * the same deep structural validation (the domain-exported
 * organizationCandidateIssues — zero drift by construction), the same
 * conflict/not-found discipline, the same audit side-effect — and the
 * registry table is append-only by database trigger with one row per
 * (tenant, candidate).
 *
 * Equivalence tests boot a fresh harness per test (the audit id sequence is
 * global, mirroring the kernel-global in-memory counter).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RegisterCandidateInput } from "@aurum/domain";
import { createPgCandidateRegistry } from "../src/domain-storage/adapters/candidate-store.js";
import { createPgAuditTrail } from "../src/domain-storage/adapters/audit-store.js";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import {
  errOf,
  expectSameResult,
  memoryKernel,
  now,
  okOf,
  pgHarness,
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

/** The full mixed-actor candidate exercising every vocabulary section. */
function richInput(overrides: Record<string, unknown> = {}): RegisterCandidateInput {
  return {
    candidateId: "cand-1",
    goalId: "g-1",
    contextFingerprint: "fp-abc",
    constraints: {
      season: "Q4",
      window: { start: now(0), end: now(10000) },
      duration: 5000,
      staffing: { minHeadcount: 1, maxHeadcount: 4 },
      minExperience: 2,
      workload: 3,
      geography: "EU",
      budget: { maxCost: 100, currency: "credits" },
      sla: { maxDurationMs: 8000, successRate: 0.9 },
      quality: { minLevel: 3 },
      inspectionIntensity: "medium",
      riskTolerance: "low",
      environmentCapabilities: ["browser"],
      evidenceFreshness: { maxAgeMs: 60000 },
    },
    actors: [
      { actorId: "act-human", kind: "human", personId: "p-1", displayName: "Ada" },
      { actorId: "act-team", kind: "team", unitId: "u-1" },
      { actorId: "act-agent", kind: "agent", agentBodyRef: "body-1" },
      { actorId: "act-software", kind: "software", externalRef: "svc-1" },
    ],
    assignments: [
      {
        assignmentId: "as-1",
        actorId: "act-human",
        position: "lead",
        stepRefs: ["step-1"],
        effortShare: 0.6,
        period: { start: now(0), end: now(1000) },
      },
      { assignmentId: "as-2", actorId: "act-agent", position: "builder", effortShare: 1 },
    ],
    capabilityAllocations: [
      {
        allocationId: "alloc-1",
        capabilityId: "cap-1",
        requirementRef: "req-1",
        actorIds: ["act-human", "act-agent"],
        level: 4,
        capacityPerPeriod: 10,
        workloadShare: 0.5,
      },
      {
        allocationId: "alloc-2",
        capabilityId: "cap-2",
        actorIds: ["act-software"],
        level: 2,
        capacityPerPeriod: 3,
      },
    ],
    topology: {
      execution: {
        steps: [
          { stepId: "step-1", name: "intake", actorId: "act-human", automated: false },
          { stepId: "step-2", name: "build", actorId: "act-agent", automated: true },
        ],
        edges: [
          {
            kind: "delegation",
            fromActorId: "act-human",
            toActorId: "act-agent",
            onStepRef: "step-1",
            note: "hands off the build",
          },
          { kind: "review", fromActorId: "act-human", toActorId: "act-team" },
          { kind: "escalation", fromActorId: "act-agent", toActorId: "act-human" },
          { kind: "handoff", fromActorId: "act-team", toActorId: "act-software" },
        ],
      },
      information: {
        flows: [
          {
            flowId: "flow-1",
            knowledge: "requirements",
            sourceActorId: "act-human",
            ownerActorId: "act-team",
            recipientActorIds: ["act-agent"],
            freshnessMaxAgeMs: 30000,
            minimalContext: true,
            reviewRequired: true,
            escalationActorId: "act-human",
            handoffOnStepRefs: ["step-1"],
          },
        ],
      },
    },
    modelOccupancy: [
      {
        actorId: "act-agent",
        modelBindingRef: "binding-1",
        window: { start: now(0), end: now(5000) },
        exclusive: true,
      },
    ],
    environment: [{ environmentRef: "env-1", requiredCapabilities: ["browser"] }],
    budget: {
      maxTotalCost: 500,
      currency: "credits",
      humanCost: 100,
      agentCost: 200,
      softwareCost: 50,
      externalCost: 10,
    },
    expectedOutcome: { goalId: "g-1", metric: "throughput", target: 42, confidence: 0.8 },
    risks: [
      {
        kind: "operational",
        description: "bus factor",
        severity: "medium",
        mitigation: "document",
      },
      { kind: "employment", description: "role change", severity: "high" },
    ],
    evidenceRefs: [{ kind: "observation", id: "obs-1" }],
    proposedBy: systemActor("lab"),
    provenance: provenance(systemActor("seed")),
    now: now(1),
    ...overrides,
  } as RegisterCandidateInput;
}

describe("PG candidate equivalence with the in-memory reference", () => {
  it("round-trips the full vocabulary (rich, minimal, fallback and trim cases)", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgCandidateRegistry(local.sql);
      const memory = memoryKernel();
      const s = scope("candidate-equivalence");

      // The rich candidate: every vocabulary section populated. Each register
      // is asserted ok (and the returned records compared) so a
      // silently-failing command cannot hide behind notFound-equality on
      // the read-back.
      const pgRich = okOf(await pg.registerCandidate(s, richInput()));
      const memoryRich = okOf(memory.candidates.registerCandidate(s, richInput()));
      expect(pgRich).toEqual(memoryRich);

      // The minimal candidate: one external actor, no optional sections —
      // plus an explicitly-undefined constraint field (the JSON bridge
      // drops it at storage; Result equality treats it as absent).
      const minimal = richInput({
        candidateId: "cand-2",
        goalId: undefined,
        contextFingerprint: undefined,
        constraints: { season: "Q4", geography: undefined },
        actors: [{ actorId: "solo", kind: "external-service", externalRef: "x-1" }],
        assignments: [],
        capabilityAllocations: [],
        topology: {
          execution: { steps: [{ stepId: "only-step", name: "do", automated: false }], edges: [] },
          information: {
            flows: [
              {
                flowId: "only-flow",
                knowledge: "facts",
                recipientActorIds: ["solo"],
                minimalContext: false,
                reviewRequired: false,
              },
            ],
          },
        },
        modelOccupancy: [],
        environment: [],
        budget: undefined,
        expectedOutcome: { target: 1, confidence: 0.5 },
        risks: [],
        evidenceRefs: [{ kind: "observation", id: "obs-2" }],
        now: now(2),
      });
      expect(okOf(await pg.registerCandidate(s, minimal))).toEqual(
        okOf(memory.candidates.registerCandidate(s, minimal)),
      );

      // The fallback case: an unknown actor kind becomes an external
      // service (the domain-internal buildActor fallback, mirrored).
      const fallback = richInput({
        candidateId: "cand-3",
        goalId: undefined,
        contextFingerprint: undefined,
        constraints: undefined,
        actors: [{ actorId: "fallback", kind: "wish", externalRef: "ext-1" }],
        assignments: [],
        capabilityAllocations: [],
        topology: {
          execution: { steps: [{ stepId: "s", name: "n", automated: false }], edges: [] },
          information: {
            flows: [
              {
                flowId: "f",
                knowledge: "k",
                recipientActorIds: ["fallback"],
                minimalContext: false,
                reviewRequired: false,
              },
            ],
          },
        },
        modelOccupancy: [],
        environment: [],
        budget: undefined,
        expectedOutcome: { target: 3, confidence: 0.3 },
        risks: [],
        evidenceRefs: [{ kind: "goal", id: "g-9" }],
        now: now(3),
      });
      expect(okOf(await pg.registerCandidate(s, fallback))).toEqual(
        okOf(memory.candidates.registerCandidate(s, fallback)),
      );

      // The trim case: base ids and references are trimmed in the draft
      // (cross-references must use the trimmed ids).
      const trimmed = richInput({
        candidateId: "cand-4",
        goalId: " g-4 ",
        contextFingerprint: " fp-4 ",
        constraints: undefined,
        actors: [
          { actorId: " padded ", kind: "human", personId: " p-9 ", displayName: " Trimmer " },
        ],
        assignments: [
          { assignmentId: " as ", actorId: " padded ", position: " doer ", effortShare: 1 },
        ],
        capabilityAllocations: [
          {
            allocationId: " al ",
            capabilityId: " cap ",
            requirementRef: " req ",
            actorIds: ["padded"],
            level: 3,
            capacityPerPeriod: 1,
          },
        ],
        topology: {
          execution: { steps: [{ stepId: "step-t", name: "trim", automated: false }], edges: [] },
          information: {
            flows: [
              {
                flowId: "flow-t",
                knowledge: "k",
                recipientActorIds: ["padded"],
                minimalContext: false,
                reviewRequired: false,
              },
            ],
          },
        },
        modelOccupancy: [],
        environment: [{ environmentRef: "env-t" }],
        budget: undefined,
        expectedOutcome: { target: 2, confidence: 0.25 },
        risks: [],
        evidenceRefs: [{ kind: "observation", id: "obs-4" }],
        now: now(4),
      });
      expect(okOf(await pg.registerCandidate(s, trimmed))).toEqual(
        okOf(memory.candidates.registerCandidate(s, trimmed)),
      );

      // Read-back equivalence on every surface.
      for (const candidateId of ["cand-1", "cand-2", "cand-3", "cand-4", "missing"]) {
        expectSameResult(
          await pg.getCandidate(s, candidateId),
          memory.candidates.getCandidate(s, candidateId),
        );
      }
      expect(await pg.listCandidates(s)).toEqual(memory.candidates.listCandidates(s));
    } finally {
      await local.close();
    }
  });

  it("mirrors validation failures issue-for-issue (input fields + deep structure)", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgCandidateRegistry(local.sql);
      const memory = memoryKernel();
      const s = scope("candidate-validation");

      const badInputs: readonly Record<string, unknown>[] = [
        // Input field validation.
        { candidateId: "" },
        { candidateId: "bad\tid" },
        { goalId: "g\t1" },
        { contextFingerprint: "x".repeat(301) },
        { provenance: undefined },
        { now: -1 },
        // Deep structural validation: actors.
        { actors: [] },
        {
          actors: [
            { actorId: "a1", kind: "human" },
            { actorId: "a1", kind: "team", unitId: "u" },
          ],
        },
        { actors: [{ actorId: "a1", kind: "agent" }] },
        { actors: [{ actorId: "a1", kind: "software" }] },
        { actors: [{ actorId: "a1", kind: "human", personId: "p", displayName: "   " }] },
        // Assignments.
        {
          assignments: [
            {
              assignmentId: "",
              actorId: "ghost",
              position: "   ",
              stepRefs: ["nope"],
              effortShare: 0,
              period: { start: 10, end: 5 },
            },
          ],
        },
        {
          assignments: [
            { assignmentId: "as-x", actorId: "act-human", position: "x", effortShare: 1.5 },
          ],
        },
        // Capability allocations.
        {
          capabilityAllocations: [
            {
              allocationId: "",
              capabilityId: "   ",
              actorIds: [],
              level: 0,
              capacityPerPeriod: -1,
            },
          ],
        },
        {
          capabilityAllocations: [
            {
              allocationId: "al-x",
              capabilityId: "cap-x",
              requirementRef: "   ",
              actorIds: ["ghost"],
              level: 2.5,
              capacityPerPeriod: 1,
              workloadShare: 0,
            },
          ],
        },
        // Topology.
        { topology: undefined },
        { topology: { execution: { steps: [], edges: [] }, information: { flows: [] } } },
        {
          topology: {
            execution: {
              steps: [
                { stepId: "s", name: "n", automated: false },
                { stepId: "s", name: "n", actorId: "ghost", automated: false },
              ],
              edges: [
                {
                  kind: "wish",
                  fromActorId: "act-human",
                  toActorId: "act-human",
                  onStepRef: "nope",
                },
              ],
            },
            information: {
              flows: [
                {
                  flowId: "f",
                  knowledge: "k",
                  recipientActorIds: ["act-agent"],
                  minimalContext: false,
                  reviewRequired: false,
                },
              ],
            },
          },
        },
        {
          topology: {
            execution: {
              steps: [{ stepId: "step-1", name: "intake", automated: false }],
              edges: [],
            },
            information: {
              flows: [
                {
                  flowId: "   ",
                  knowledge: "   ",
                  sourceActorId: "ghost",
                  ownerActorId: "ghost-2",
                  recipientActorIds: [],
                  freshnessMaxAgeMs: 0,
                  minimalContext: "no",
                  reviewRequired: "no",
                  escalationActorId: "ghost-3",
                  handoffOnStepRefs: ["nope"],
                },
              ],
            },
          },
        },
        // Model occupancy.
        {
          modelOccupancy: [
            {
              actorId: "act-human",
              modelBindingRef: "b",
              window: { start: 10, end: 5 },
              exclusive: true,
            },
          ],
        },
        {
          modelOccupancy: [
            {
              actorId: "ghost",
              modelBindingRef: "   ",
              window: { start: 0, end: 1 },
              exclusive: "yes",
            },
          ],
        },
        // Environment.
        { environment: [{ environmentRef: "   " }] },
        // Constraints.
        { constraints: { season: "   " } },
        { constraints: { window: { start: 10, end: 5 } } },
        { constraints: { duration: -1 } },
        { constraints: { staffing: { minHeadcount: 5, maxHeadcount: 2 } } },
        { constraints: { geography: "   " } },
        { constraints: { budget: { maxCost: -1 } } },
        { constraints: { sla: { successRate: 2 } } },
        { constraints: { quality: { minLevel: 9 } } },
        { constraints: { inspectionIntensity: "wild" } },
        { constraints: { riskTolerance: "wild" } },
        { constraints: { environmentCapabilities: [] } },
        { constraints: { evidenceFreshness: { maxAgeMs: 0 } } },
        // Budget.
        { budget: { maxTotalCost: -1 } },
        { budget: { currency: "   " } },
        // Expected outcome.
        { expectedOutcome: undefined },
        { expectedOutcome: { target: Number.NaN, confidence: 2 } },
        { expectedOutcome: { metric: "   ", target: 1, confidence: 0.5 } },
        // Risks.
        { risks: [{ kind: "wish", description: "   ", severity: "wild", mitigation: "   " }] },
        // Evidence.
        { evidenceRefs: [] },
        { evidenceRefs: [{ kind: "wish", id: "x" }] },
        // Proposer.
        { proposedBy: undefined },
      ];
      for (const overrides of badInputs) {
        const input = richInput(overrides);
        expectSameResult(
          await pg.registerCandidate(s, input),
          memory.candidates.registerCandidate(s, input),
        );
      }

      // Nothing may have been written by a failed command; the one
      // successful register below is the only journaled candidate write.
      expect(await pg.listCandidates(s)).toEqual(memory.candidates.listCandidates(s));
      const good = richInput({ candidateId: "cand-v" });
      expectSameResult(
        await pg.registerCandidate(s, good),
        memory.candidates.registerCandidate(s, good),
      );
      expect(
        (await listJournal(local.sql, s.tenantId))
          .filter((row) => row.area === "candidate")
          .map((row) => row.journalKey),
      ).toEqual(["candidate:register:cand-v"]);
    } finally {
      await local.close();
    }
  });

  it("mirrors conflict/not-found discipline and tenant isolation", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgCandidateRegistry(local.sql);
      const memory = memoryKernel();
      const s = scope("candidate-conflict");
      const other = scope("candidate-other");

      // Duplicate registration resolves as the same conflict.
      okOf(await pg.registerCandidate(s, richInput()));
      okOf(memory.candidates.registerCandidate(s, richInput()));
      expectSameResult(
        await pg.registerCandidate(s, richInput()),
        memory.candidates.registerCandidate(s, richInput()),
      );

      // Not-found: a missing candidate id.
      expectSameResult(
        await pg.getCandidate(s, "missing"),
        memory.candidates.getCandidate(s, "missing"),
      );

      // Tenant isolation: foreign reads are indistinguishable from missing.
      const foreignRead = errOf(await pg.getCandidate(other, "cand-1"));
      const missingRead = errOf(await pg.getCandidate(s, "missing"));
      expect(foreignRead.message).toBe(missingRead.message);
      expect(foreignRead.message).toBe("organization candidate not found");
      expect(await pg.listCandidates(other)).toEqual([]);

      // The same id is independently registrable per tenant, and the
      // original tenant's records are unaffected.
      okOf(await pg.registerCandidate(other, richInput()));
      expectSameResult(
        await pg.getCandidate(s, "cand-1"),
        memory.candidates.getCandidate(s, "cand-1"),
      );
      expect((await pg.listCandidates(s)).length).toBe(1);
      expect((await pg.listCandidates(other)).length).toBe(1);
    } finally {
      await local.close();
    }
  });

  it("appends matching audit entries (candidate.registered)", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgCandidateRegistry(local.sql);
      const pgAudit = createPgAuditTrail(local.sql);
      const memory = memoryKernel();
      const s = scope("candidate-audit");

      okOf(await pg.registerCandidate(s, richInput()));
      okOf(memory.candidates.registerCandidate(s, richInput()));
      expect(await pgAudit.queryAudit(s, {})).toEqual(memory.audit.queryAudit(s, {}));
      expect(await pgAudit.queryAudit(s, { subject: { kind: "candidate", id: "cand-1" } })).toEqual(
        memory.audit.queryAudit(s, { subject: { kind: "candidate", id: "cand-1" } }),
      );
    } finally {
      await local.close();
    }
  });
});

describe("PG candidate database enforcement", () => {
  it("rejects UPDATE and DELETE on the candidate table (append-only)", async () => {
    const pg = createPgCandidateRegistry(harness.sql);
    const s = scope("candidate-immutable");
    okOf(await pg.registerCandidate(s, richInput()));
    await expect(
      harness.sql.unsafe(
        `update domain_candidates set tenant_id = tenant_id where tenant_id = $1`,
        [s.tenantId],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.sql.unsafe(`delete from domain_candidates where tenant_id = $1`, [s.tenantId]),
    ).rejects.toThrow(/append-only/);
    expect((await pg.listCandidates(s)).length).toBe(1);
  });

  it("journeys every mutation through the write journal with stable keys", async () => {
    const local = await pgHarness();
    try {
      const pg = createPgCandidateRegistry(local.sql);
      const s = scope("candidate-journal");
      await pg.registerCandidate(s, richInput());
      await pg.registerCandidate(s, richInput({ candidateId: "cand-2", now: now(2) }));
      const rows = await listJournal(local.sql, s.tenantId);
      expect(rows.filter((row) => row.area === "candidate").map((row) => row.journalKey)).toEqual([
        "candidate:register:cand-1",
        "candidate:register:cand-2",
      ]);
    } finally {
      await local.close();
    }
  });

  it("rejects history rewrites (database constraints)", async () => {
    const pg = createPgCandidateRegistry(harness.sql);
    const s = scope("candidate-constraint");
    okOf(await pg.registerCandidate(s, richInput()));
    // A duplicate base row is rejected by the primary key.
    await expect(
      harness.sql`
        insert into domain_candidates (tenant_id, candidate_id, record)
        values (${s.tenantId}, 'cand-1', '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    // The adapter-level reads keep the record this tenant produced.
    expect((await pg.listCandidates(s)).length).toBe(1);
    expect((await pg.getCandidate(s, "cand-1")).ok).toBe(true);
  });
});
