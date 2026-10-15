/**
 * CR-W014 journey proof (the TL wiring verification): the REAL W013 learning
 * service outcome store + the REAL cognition mission records flow through
 * the production adapter into the REAL W014 emergence service's gap
 * detection — no doubles on the evidence path.
 *
 * The CR's verification list:
 *   1. tsc -b packages/aurum-marketplace exit 0 (src) + tsc -p
 *      tsconfig.test.json exit 0 (the adapter + this journey) — structural
 *      assignability end-to-end, proven by the compiler.
 *   2. marketplace suite green (the 148 W014 proofs unchanged + this journey).
 *   3. THIS journey: real learning outcomes -> adapter -> detectGaps, with
 *      the W013 learning-sources journey as the template.
 *
 * The application-side fixtures (scope/actors/provenance/goal/pool/observation
 * seeds, the lab search run, the candidate mapping) are inlined here in the
 * composition-test style — the application package's own test helpers are
 * not exported across packages (and shall not be).
 */
import { describe, expect, it } from "vitest";
import {
  createDomainKernel,
  tenantScope,
  type ActorReference,
  type DomainTimestamp,
  type PersonId,
  type ProvenanceRecord,
  type SubjectReference,
  type TenantScope as KernelTenantScope,
} from "@aurum/domain";
import {
  createCognitionService,
  createInMemoryEvaluationStore,
  createInMemoryMissionStore,
  createInMemoryOutcomeStore,
  createKernelCognitionSeams,
  createOrganizationalLab,
  createOutcomeLearning,
  createScriptedReasoner,
  type ReasonedContent,
} from "@aurum/application";
import {
  createEmergenceService,
  createInMemoryEmergenceProposalStore,
  createInMemoryMarketplaceAuditLedger,
  createInMemoryMarketplaceCatalogStore,
  createInMemoryMarketplaceGovernanceStore,
  marketplaceTenantScope,
} from "../src/index.js";
import { createLearningEmergenceEvidence } from "./learning-emergence-evidence.js";

// --- inlined composition fixtures (the application test-suite shapes) ---

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const now = (seconds = 0): DomainTimestamp => (T0 + seconds * 1000) as DomainTimestamp;
const daysFromNow = (days: number, base = 0): DomainTimestamp =>
  (T0 + base * 1000 + days * DAY) as DomainTimestamp;

function scope(name: string): KernelTenantScope {
  const result = tenantScope(name);
  if (!result.ok) throw new Error(`test setup: invalid tenant name ${name}`);
  return result.value;
}

const personActor = (personId: string): ActorReference => ({
  kind: "person",
  personId: personId as PersonId,
});
const systemActor = (name: string): ActorReference => ({ kind: "system", name });

const provenance = (actor: ActorReference, atSeconds = 0): ProvenanceRecord => ({
  actor,
  source: "human-entered",
  recordedAt: now(atSeconds),
});

const topic = (id = "invoices"): SubjectReference => ({ kind: "topic", id });

type Kernel = ReturnType<typeof createDomainKernel>;

function must<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
  what: string,
): T {
  if (!result.ok) throw new Error(`${what} failed: ${result.error.message}`);
  return result.value;
}

function seedGoal(kernel: Kernel, s: KernelTenantScope): void {
  must(
    kernel.goals.createGoal(s, {
      goalId: "goal-1",
      objective: "Ship the invoice processing overhaul",
      desiredState: "Invoices processed within SLA",
      horizonStart: now(0),
      horizonEnd: daysFromNow(60),
      ownerId: "boss",
      ownerLabels: ["executive"],
      priority: "high",
      provenance: provenance(personActor("boss"), 0),
      now: now(0),
      audit: { actor: personActor("boss"), at: now(0), reason: "seed" },
    }),
    "seedGoal",
  );
}

function seedObservation(kernel: Kernel, s: KernelTenantScope, observationId: string): void {
  must(
    kernel.evidence.recordObservation(s, {
      observationId,
      subject: topic(),
      content: `Observation ${observationId} about the topic`,
      observedAt: now(0),
      provenance: provenance(personActor("p-1")),
      freshness: { asOf: now(0) },
    }),
    "seedObservation",
  );
}

/**
 * Seeds the mixed pool (the W008 fixture essence): two demanded capabilities
 * with employee/agent/software/supplier supplies + the goal's requirements —
 * the lab search always has a ranked head with a demand signature.
 */
function seedMixedPool(kernel: Kernel, s: KernelTenantScope): void {
  for (const capabilityId of ["cap-design", "cap-review"]) {
    must(
      kernel.capabilities.registerCapability(s, {
        capabilityId,
        name: `capability ${capabilityId}`,
        provenance: provenance(systemActor("seed"), 0),
        now: now(0),
      }),
      "registerCapability",
    );
  }
  const supplies: readonly {
    supplyId: string;
    capabilityId: string;
    kind: "employee" | "agent" | "software" | "supplier";
    level: number;
    capacityPerPeriod: number;
    personId?: string;
    externalRef?: string;
  }[] = [
    {
      supplyId: "sup-emp-design",
      capabilityId: "cap-design",
      kind: "employee",
      level: 5,
      capacityPerPeriod: 90,
      personId: "p-designer",
    },
    {
      supplyId: "sup-emp-review",
      capabilityId: "cap-review",
      kind: "employee",
      level: 4,
      capacityPerPeriod: 60,
      personId: "p-reviewer",
    },
    {
      supplyId: "sup-agent-design",
      capabilityId: "cap-design",
      kind: "agent",
      level: 4,
      capacityPerPeriod: 200,
      externalRef: "agent-body-7",
    },
    {
      supplyId: "sup-agent-review",
      capabilityId: "cap-review",
      kind: "agent",
      level: 4,
      capacityPerPeriod: 150,
      externalRef: "agent-body-8",
    },
    {
      supplyId: "sup-software-review",
      capabilityId: "cap-review",
      kind: "software",
      level: 3,
      capacityPerPeriod: 500,
      externalRef: "ocr-svc",
    },
    {
      supplyId: "sup-supplier-design",
      capabilityId: "cap-design",
      kind: "supplier",
      level: 4,
      capacityPerPeriod: 120,
      externalRef: "bpo-2",
    },
  ];
  for (const seed of supplies) {
    must(
      kernel.capabilities.registerSupply(s, {
        supplyId: seed.supplyId,
        capabilityId: seed.capabilityId,
        supplier: {
          kind: seed.kind,
          ...(seed.personId ? { personId: seed.personId as PersonId } : {}),
          ...(seed.externalRef ? { externalRef: seed.externalRef } : {}),
        },
        level: seed.level,
        capacityPerPeriod: seed.capacityPerPeriod,
        freshness: { asOf: now(10) },
        provenance: provenance(systemActor("seed"), 1),
        now: now(1),
      }),
      "registerSupply",
    );
  }
  for (const [capabilityId, level, capacity] of [
    ["cap-design", 4, 45],
    ["cap-review", 3, 30],
  ] as const) {
    must(
      kernel.capabilities.registerRequirement(s, {
        requirementId: `req-${capabilityId}`,
        capabilityId,
        source: { kind: "goal", ref: "goal-1" },
        requiredLevel: level,
        requiredCapacityPerPeriod: capacity,
        provenance: provenance(systemActor("seed"), 2),
        now: now(2),
      }),
      "registerRequirement",
    );
  }
}

describe("CR-W014 wiring: REAL learning + cognition evidence through the adapter into emergence", () => {
  it("real outcome-join records feed detectGaps; the mission unknown projects verbatim", async () => {
    const s = scope("acme");

    // --- the REAL W013 composition (kernel + lab + learning, shared stores) ---
    const kernel = createDomainKernel();
    const evaluations = createInMemoryEvaluationStore();
    const lab = createOrganizationalLab({
      views: {
        goals: kernel.goals,
        capabilities: kernel.capabilities,
        workforce: kernel.workforce,
        inquiry: kernel.inquiry,
      },
      evaluations,
    });
    const outcomes = createInMemoryOutcomeStore();
    const learning = createOutcomeLearning({
      outcomes,
      evaluations,
      candidates: kernel.candidates,
      lab,
    });

    // seed the subject + run the contextual search (the join anchor)
    seedGoal(kernel, s);
    seedMixedPool(kernel, s);
    const fingerprinted = lab.fingerprintSituation(s, { goalId: "goal-1", now: now(20) });
    if (!fingerprinted.ok)
      throw new Error(`fingerprintSituation failed: ${fingerprinted.error.message}`);
    const searched = lab.searchOrganizations(s, {
      goalId: "goal-1",
      fingerprint: fingerprinted.value.fingerprint,
      proposedBy: personActor("boss"),
      provenance: provenance(personActor("boss"), 10),
      now: now(20),
    });
    if (!searched.ok) throw new Error(`searchOrganizations failed: ${searched.error.message}`);
    const evaluation = lab
      .listEvaluations(s, { goalId: "goal-1" })
      .filter((record) => record.fingerprintDigest === fingerprinted.value.fingerprint.digest)
      .at(-1);
    if (!evaluation) throw new Error("test setup: no evaluation recorded for the search");
    const best = searched.value.ranked[0]?.candidate;
    if (!best) throw new Error("test setup: no ranked candidate");
    // the house value->registry mapping (verbatim from the W013 suite's
    // candidateInputOf — the application test helpers are not exported
    // across packages, so the composition test carries its own copy)
    const registered = kernel.candidates.registerCandidate(s, {
      candidateId: best.candidateId,
      ...(best.goalId !== undefined ? { goalId: best.goalId } : {}),
      ...(best.contextFingerprint !== undefined
        ? { contextFingerprint: best.contextFingerprint }
        : {}),
      ...(best.constraints !== undefined ? { constraints: best.constraints } : {}),
      actors: best.actors.map((actor) => ({
        actorId: actor.actorId,
        kind: actor.kind,
        ...(actor.personId ? { personId: actor.personId } : {}),
        ...(actor.unitId ? { unitId: actor.unitId } : {}),
        ...(actor.agentBodyRef ? { agentBodyRef: actor.agentBodyRef } : {}),
        ...(actor.externalRef ? { externalRef: actor.externalRef } : {}),
        ...(actor.displayName ? { displayName: actor.displayName } : {}),
      })),
      assignments: best.assignments.map((assignment) => ({
        assignmentId: assignment.assignmentId,
        actorId: assignment.actorId,
        position: assignment.position,
        ...(assignment.stepRefs ? { stepRefs: [...assignment.stepRefs] } : {}),
        effortShare: assignment.effortShare,
        ...(assignment.period ? { period: assignment.period } : {}),
      })),
      capabilityAllocations: best.capabilityAllocations.map((allocation) => ({
        allocationId: allocation.allocationId,
        capabilityId: allocation.capabilityId,
        ...(allocation.requirementRef ? { requirementRef: allocation.requirementRef } : {}),
        actorIds: [...allocation.actorIds],
        level: allocation.level,
        capacityPerPeriod: allocation.capacityPerPeriod,
        ...(allocation.workloadShare !== undefined
          ? { workloadShare: allocation.workloadShare }
          : {}),
      })),
      topology: best.topology,
      modelOccupancy: [...best.modelOccupancy],
      environment: [...best.environment],
      ...(best.budget ? { budget: best.budget } : {}),
      expectedOutcome: best.expectedOutcome,
      risks: [...best.risks],
      evidenceRefs: [...best.evidenceRefs],
      proposedBy: best.proposedBy,
      provenance: best.provenance,
      now: best.proposedAt,
    });
    if (!registered.ok) throw new Error(`registerCandidate failed: ${registered.error.message}`);

    // THREE recurring MISSED outcomes through the REAL recordOutcome join —
    // same evaluation context (same class), same failure kind, distinct ids.
    const outcomeIds = ["out-journey-1", "out-journey-2", "out-journey-3"];
    let classKey = "";
    for (const outcomeId of outcomeIds) {
      const joined = learning.recordOutcome(s, {
        outcomeId,
        evaluationId: evaluation.evaluationId,
        candidateId: best.candidateId,
        observation: {
          status: "missed",
          source: { kind: "mission", ref: "mission-journey" },
          observedAt: now(30),
          observedBy: personActor("boss"),
          failure: { kind: "capability-missing", detail: "no supply for the demanded capability" },
          metric: { metric: "time-to-resolution", observed: 40, target: 24 },
        },
        provenance: provenance(personActor("boss"), 30),
        now: now(40),
      });
      if (!joined.ok) throw new Error(`recordOutcome failed: ${joined.error.message}`);
      // the REAL record carries the conditioning keys the emergence intake
      // mirrors, and the class derivation is DETERMINISTIC over the shared
      // evaluation context
      if (classKey === "") classKey = joined.value.contextClass.classKey;
      expect(joined.value.contextClass.classKey).toBe(classKey);
      expect(joined.value.shape.shapeKey).toBeTruthy();
    }

    // --- the REAL cognition composition (a mission that raises an unknown) ---
    seedObservation(kernel, s, "obs-1");
    seedObservation(kernel, s, "obs-2");
    const missions = createInMemoryMissionStore();
    const seams = createKernelCognitionSeams(kernel);
    const content: ReasonedContent = Object.freeze({
      summary: "Invoice processing latency correlates with supplier ACME's batch size.",
      findings: Object.freeze([
        Object.freeze({
          statement: "Supplier ACME delivers unbatched invoices causing manual steps.",
          basedOn: Object.freeze(["obs-1"]),
        }),
      ]),
      gaps: Object.freeze([
        Object.freeze({
          question: "Which supplier drives the processing delays?",
          consequence: "SLA breaches continue unnoticed",
        }),
      ]),
      hypotheses: Object.freeze([]),
      proposals: Object.freeze([
        Object.freeze({
          kind: "recommendation" as const,
          title: "Automate ACME invoice intake",
          rationale: "Removes the manual step identified by the mission findings.",
        }),
      ]),
    });
    const cognition = createCognitionService({
      reads: seams.reads,
      knowledge: seams.knowledge,
      gate: seams.gate,
      model: createScriptedReasoner([content]),
      missions,
      proposalPolicy: { approvalRoles: ["approver"], authorizationRoles: ["authorizer"] },
    });
    const chartered = cognition.createMission(s, {
      missionId: "mission-journey",
      subject: topic(),
      question: "Why is invoice processing slow?",
      consequence: "SLA breaches accumulate without a known cause",
      goalId: "goal-1",
      createdBy: personActor("p-1"),
      now: now(0),
    });
    if (!chartered.ok) throw new Error(`createMission failed: ${chartered.error.message}`);
    const completed = await cognition.runToCompletion(s, "mission-journey", { now: now(1) });
    if (!completed.ok) throw new Error(`runToCompletion failed: ${completed.error.message}`);
    const mission = missions.listMissions(s).find((m) => m.missionId === "mission-journey");
    if (!mission) throw new Error("test setup: mission not in the store");
    const propose = mission.stages.find((stage) => stage.stage === "propose");
    if (!propose || propose.stage !== "propose" || propose.manifest.unknowns.length === 0) {
      throw new Error("test setup: propose stage carries no unknowns");
    }

    // --- the adapter (CR-W014): REAL stores -> the emergence intake ---
    const evidence = createLearningEmergenceEvidence({ outcomes, missions });

    // --- the REAL emergence service over the adapter (public contract only) ---
    const emergence = createEmergenceService({
      evidence,
      proposals: createInMemoryEmergenceProposalStore(),
      catalog: createInMemoryMarketplaceCatalogStore(),
      recruitments: createInMemoryMarketplaceGovernanceStore(),
      audit: createInMemoryMarketplaceAuditLedger(),
    });
    const mscope = marketplaceTenantScope("acme");
    if (!mscope.ok) throw new Error("test setup: invalid tenant name");

    const gaps = emergence.detectGaps(mscope.value, { now: now(1000) });
    if (!gaps.ok) throw new Error(`detectGaps failed: ${JSON.stringify(gaps.error)}`);

    // (a) the REAL outcome records derived a capability-shortfall gap
    const shortfall = gaps.value.find((gap) => gap.signalKind === "capability-shortfall");
    expect(shortfall).toBeDefined();
    if (shortfall) {
      expect(new Set(shortfall.outcomeIds)).toEqual(new Set(outcomeIds));
      expect(shortfall.recurrenceCount).toBe(3);
      expect(shortfall.contextClassKey).toBe(classKey);
      expect(shortfall.failureKind).toBe("capability-missing");
      expect(shortfall.affectedGoalIds).toContain("goal-1");
    }

    // (b) the REAL mission unknown is projected VERBATIM by the adapter
    // (the CR's three-field projection + the mission run reference)
    const signals = evidence.listUnknownSignals(mscope.value);
    expect(signals.length).toBe(1);
    const signal = signals[0];
    if (!signal) throw new Error("test setup: no unknown signal projected");
    expect(signal.unknownId).toBe(propose.manifest.unknowns[0]?.unknownId);
    expect(signal.question).toBe("Which supplier drives the processing delays?");
    expect(signal.consequence).toBe("SLA breaches continue unnoticed");
    expect(signal.missionRef).toBe("mission-journey");
    expect(signal.goalId).toBe("goal-1");
    expect(signal.observedAt).toBe(propose.at);

    // (b2) at the DEFAULT threshold the single real signal derives no gap
    // (the recurrence law — the cognition area never re-raises an open
    // unknown, so a sequential journey yields one signal per distinct
    // question); a LOWER caller threshold admits the knowledge-gap citing
    // the REAL mission ref — the derivation path proven end-to-end with
    // the REAL projected signal (the W014 gap suite's sub-threshold
    // precedent)
    expect(gaps.value.find((gap) => gap.signalKind === "knowledge-gap")).toBeUndefined();
    const lowered = emergence.detectGaps(mscope.value, {
      now: now(1000),
      thresholds: { minRecurrence: 1 },
    });
    if (!lowered.ok) throw new Error(`detectGaps failed: ${JSON.stringify(lowered.error)}`);
    const knowledge = lowered.value.find((gap) => gap.signalKind === "knowledge-gap");
    expect(knowledge).toBeDefined();
    if (knowledge) {
      expect(knowledge.affectedMissionRefs).toContain("mission-journey");
      expect(knowledge.unknownIds).toEqual([signal.unknownId]);
    }

    // (c) purity: the same evidence + query derive byte-identical gaps again
    const again = emergence.detectGaps(mscope.value, { now: now(1000) });
    expect(again.ok && JSON.stringify(again.value)).toBe(JSON.stringify(gaps.value));

    // (d) tenant isolation through the adapter: a foreign tenant sees nothing
    const foreign = marketplaceTenantScope("other-tenant");
    if (foreign.ok) {
      expect(emergence.detectGaps(foreign.value, { now: now(1000) })).toEqual({
        ok: true,
        value: [],
      });
    }
  });
});
