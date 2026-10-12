/**
 * ACCEPTANCE (catalog W004): SITUATION AND GOAL ATTENTION — the honest goal
 * landscape (horizon states, per-goal open unknowns/contradictions, the
 * expected-evidence coverage ladder) plus the five deterministic, inspectable
 * attention criteria, through the real kernel and the public surface.
 */
import { describe, expect, it } from "vitest";
import {
  createDomainKernel,
  personActor,
  tenantScope,
  type ActorReference,
  type DomainTimestamp,
} from "@aurum/domain";
import {
  createCompanyIntelligenceService,
  createInMemoryQueryLog,
  DEFAULT_HORIZON_CLOSING_MS,
  type CompanyIntelligence,
} from "../src/index.js";
import type { AurumDomainKernel } from "@aurum/domain";

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const now = (seconds = 0): DomainTimestamp => (T0 + seconds * 1000) as DomainTimestamp;
const at = (days: number): DomainTimestamp => (T0 + days * DAY) as DomainTimestamp;
const prov = (actor: ActorReference, seconds = 0) => ({
  actor,
  source: "human-entered" as const,
  recordedAt: now(seconds),
});
const auditOf = (reason: string, seconds = 0) => ({
  actor: personActor("seed") as ActorReference,
  at: now(seconds),
  reason,
});

function okOf<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  expect(result.ok, `expected ok: ${result.ok ? "" : result.error.message}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

function scopeOf(name: string) {
  const result = tenantScope(name);
  if (!result.ok) throw new Error("bad tenant");
  return result.value;
}

function serviceOf(kernel: AurumDomainKernel): CompanyIntelligence {
  return createCompanyIntelligenceService({
    views: {
      evidence: kernel.evidence,
      epistemics: kernel.epistemics,
      inquiry: kernel.inquiry,
      goals: kernel.goals,
      memory: kernel.memory,
      identity: kernel.identity,
      audit: kernel.audit,
    },
    queryLog: createInMemoryQueryLog(),
  });
}

/** Situation fixture: five goals spanning the horizon states and criteria. */
function seed(): {
  kernel: AurumDomainKernel;
  tenant: ReturnType<typeof scopeOf>;
  service: CompanyIntelligence;
} {
  const kernel = createDomainKernel();
  const s = scopeOf("co-situation");
  const goalInput = (
    goalId: string,
    horizonStart: DomainTimestamp,
    horizonEnd: DomainTimestamp,
    expected: { description: string; subject: { kind: "process" | "topic"; id: string } }[] = [],
  ) => ({
    goalId,
    objective: `Objective ${goalId}`,
    desiredState: `Desired ${goalId}`,
    horizonStart,
    horizonEnd,
    ownerId: "p-ceo",
    ownerLabels: ["executive"],
    priority: "high",
    expectedEvidence: expected,
    provenance: prov(personActor("p-ceo"), 1),
    now: now(1),
    audit: auditOf("seed"),
  });
  okOf(
    kernel.goals.createGoal(
      s,
      goalInput("goal-active", now(0), at(60), [
        { description: "processing logs", subject: { kind: "process", id: "p-1" } },
        { description: "inflation readings", subject: { kind: "topic", id: "t-cov" } },
      ]),
    ),
  );
  okOf(kernel.goals.createGoal(s, goalInput("goal-elapsed", at(-10), at(-1))));
  okOf(kernel.goals.createGoal(s, goalInput("goal-closing", now(0), at(10))));
  okOf(kernel.goals.createGoal(s, goalInput("goal-upcoming", at(10), at(80))));
  okOf(
    kernel.goals.createGoal(
      s,
      goalInput("goal-clean", now(0), at(90), [
        { description: "clean readings", subject: { kind: "topic", id: "t-cov" } },
      ]),
    ),
  );
  okOf(
    kernel.evidence.recordObservation(s, {
      observationId: "obs-cov",
      subject: { kind: "topic", id: "t-cov" },
      content: "clean signal observed",
      observedAt: now(5),
      provenance: prov(personActor("p-ops"), 5),
    }),
  );
  okOf(
    kernel.inquiry.raiseUnknown(s, {
      unknownId: "u-1",
      question: "Which supplier will be single-sourced?",
      consequence: "negotiation leverage degrades",
      relatedSubjects: [{ kind: "goal", id: "goal-active" }],
      provenance: prov(personActor("p-ceo"), 6),
      now: now(6),
    }),
  );
  okOf(
    kernel.inquiry.raiseUnknown(s, {
      unknownId: "u-resolved",
      question: "Old question",
      consequence: "moot",
      relatedSubjects: [{ kind: "goal", id: "goal-elapsed" }],
      provenance: prov(personActor("p-ceo"), 7),
      now: now(7),
    }),
  );
  okOf(
    kernel.inquiry.resolveUnknown(s, {
      unknownId: "u-resolved",
      outcome: "answered elsewhere",
      now: now(8),
      audit: auditOf("answered", 8),
    }),
  );
  okOf(
    kernel.inquiry.recordContradiction(s, {
      contradictionId: "con-1",
      between: [
        { kind: "goal", id: "goal-active" },
        { kind: "topic", id: "t-cov" },
      ],
      description: "Objective conflicts with the observed signal",
      provenance: prov(personActor("p-ceo"), 9),
      now: now(9),
    }),
  );
  return { kernel, tenant: s, service: serviceOf(kernel) };
}

const QUERY = { askedBy: personActor("p-ceo"), reason: "weekly review" };

describe("situation (goal landscape)", () => {
  it("every goal appears with its current revision, owner and horizon state", () => {
    const { tenant, service } = seed();
    const report = okOf(service.situation(tenant, { now: now(3600), ...QUERY }));
    expect(report.goals).toHaveLength(5);
    const byId = new Map(report.goals.map((goal) => [goal.goalId as string, goal]));
    expect(byId.get("goal-active")?.horizonState).toBe("active");
    expect(byId.get("goal-elapsed")?.horizonState).toBe("elapsed");
    expect(byId.get("goal-closing")?.horizonState).toBe("active");
    expect(byId.get("goal-upcoming")?.horizonState).toBe("upcoming");
    expect(byId.get("goal-active")?.ownerPersonId).toBe("p-ceo");
    expect(byId.get("goal-active")?.objective).toBe("Objective goal-active");
    expect(byId.get("goal-active")?.provenance.source).toBe("human-entered");
  });

  it("per-goal open unknowns/contradictions and tenant totals; resolved unknowns do not count", () => {
    const { tenant, service } = seed();
    const report = okOf(service.situation(tenant, { now: now(3600), ...QUERY }));
    const byId = new Map(report.goals.map((goal) => [goal.goalId as string, goal]));
    expect(byId.get("goal-active")?.openUnknowns).toBe(1);
    expect(byId.get("goal-active")?.openContradictions).toBe(1);
    expect(byId.get("goal-elapsed")?.openUnknowns).toBe(0);
    expect(report.totals).toEqual({ goals: 5, openUnknowns: 1, openContradictions: 1 });
  });

  it("the expected-evidence coverage ladder: covered / partial / none-declared", () => {
    const { tenant, service } = seed();
    const report = okOf(service.situation(tenant, { now: now(3600), ...QUERY }));
    const byId = new Map(report.goals.map((goal) => [goal.goalId as string, goal]));
    expect(byId.get("goal-active")?.expectedEvidenceCoverage).toBe("partial");
    expect(byId.get("goal-active")?.expectedEvidenceCount).toBe(2);
    expect(byId.get("goal-clean")?.expectedEvidenceCoverage).toBe("covered");
    expect(byId.get("goal-elapsed")?.expectedEvidenceCoverage).toBe("none-declared");
  });

  it("blind spots aggregate open unknowns and missing expectations across goals", () => {
    const { tenant, service } = seed();
    const report = okOf(service.situation(tenant, { now: now(3600), ...QUERY }));
    const openUnknown = report.blindSpots.find((spot) => spot.kind === "open-unknown");
    expect(openUnknown?.consequence).toBe("negotiation leverage degrades");
    expect(openUnknown?.subject).toEqual({ kind: "goal", id: "goal-active" });
    const missing = report.blindSpots.filter((spot) => spot.kind === "missing-expected-evidence");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.description).toContain("processing logs");
  });

  it("goal knowledge freshness is the revision's age (stale when the revision is old)", () => {
    const { kernel, tenant, service } = seed();
    okOf(
      kernel.goals.reviseGoal(tenant, {
        goalId: "goal-clean",
        objective: "Objective goal-clean",
        desiredState: "Desired goal-clean",
        horizonStart: now(0),
        horizonEnd: at(90),
        ownerId: "p-ceo",
        ownerLabels: ["executive"],
        priority: "high",
        expectedEvidence: [
          { description: "clean readings", subject: { kind: "topic", id: "t-cov" } },
        ],
        provenance: { actor: personActor("p-ceo"), source: "imported", recordedAt: at(-45) },
        now: at(-45),
        audit: auditOf("imported", -45),
      }),
    );
    const report = okOf(service.situation(tenant, { now: now(3600), ...QUERY }));
    const byId = new Map(report.goals.map((goal) => [goal.goalId as string, goal]));
    expect(byId.get("goal-clean")?.freshness).toBe("stale");
  });
});

describe("goalAttention (five deterministic criteria)", () => {
  it("horizon-elapsed fires with its ms arithmetic in the detail", () => {
    const { tenant, service } = seed();
    const report = okOf(service.goalAttention(tenant, { now: now(3600), ...QUERY }));
    const elapsed = report.attention.find((goal) => goal.goalId === "goal-elapsed");
    expect(elapsed).toBeDefined();
    expect(elapsed?.criteria.map((finding) => finding.criterion)).toEqual(["horizon-elapsed"]);
    expect(elapsed?.criteria[0]?.detail).toBe(`horizon ended ${86400000 + 3600000} ms before asOf`);
  });

  it("horizon-closing fires within the default window and respects a custom window", () => {
    const { tenant, service } = seed();
    const report = okOf(service.goalAttention(tenant, { now: now(3600), ...QUERY }));
    const closing = report.attention.find((goal) => goal.goalId === "goal-closing");
    expect(closing).toBeDefined();
    expect(closing?.criteria.map((finding) => finding.criterion)).toEqual(["horizon-closing"]);
    expect(closing?.criteria[0]?.detail).toBe(
      `horizon ends in ${10 * 86400000 - 3600000} ms (within ${DEFAULT_HORIZON_CLOSING_MS} ms)`,
    );
    const tighter = okOf(
      service.goalAttention(tenant, {
        now: now(3600),
        horizonClosingWithinMs: 5 * 86400000,
        ...QUERY,
      }),
    );
    expect(tighter.attention.some((goal) => goal.goalId === "goal-closing")).toBe(false);
  });

  it("open-contradiction and open-unknown fire with their counts", () => {
    const { tenant, service } = seed();
    const report = okOf(service.goalAttention(tenant, { now: now(3600), ...QUERY }));
    const active = report.attention.find((goal) => goal.goalId === "goal-active");
    expect(active).toBeDefined();
    const criteria = active?.criteria.map((finding) => finding.criterion) ?? [];
    expect(criteria).toContain("open-contradiction");
    expect(criteria).toContain("open-unknown");
    const contradiction = active?.criteria.find((f) => f.criterion === "open-contradiction");
    expect(contradiction?.detail).toBe("1 open contradiction(s) reference this goal");
    const unknown = active?.criteria.find((f) => f.criterion === "open-unknown");
    expect(unknown?.detail).toBe("1 open unknown(s) reference this goal; consequences recorded");
  });

  it("missing-expected-evidence fires when expectations have no usable observations", () => {
    const { tenant, service } = seed();
    const report = okOf(service.goalAttention(tenant, { now: now(3600), ...QUERY }));
    const active = report.attention.find((goal) => goal.goalId === "goal-active");
    expect(active).toBeDefined();
    const missing = active?.criteria.find((f) => f.criterion === "missing-expected-evidence");
    expect(missing?.detail).toBe(
      "1 of 2 expected-evidence expectations have no usable observations",
    );
  });

  it("goals with no criteria are excluded; ordering is score descending then goalId", () => {
    const { tenant, service } = seed();
    const report = okOf(service.goalAttention(tenant, { now: now(3600), ...QUERY }));
    expect(report.attention.some((goal) => goal.goalId === "goal-clean")).toBe(false);
    expect(report.attention.some((goal) => goal.goalId === "goal-upcoming")).toBe(false);
    const ids = report.attention.map((goal) => goal.goalId as string);
    const scores = report.attention.map((goal) => goal.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(ids.indexOf("goal-active")).toBeLessThan(ids.indexOf("goal-closing"));
    expect(ids.indexOf("goal-closing")).toBeLessThan(ids.indexOf("goal-elapsed"));
    expect(report.asOf).toBe(now(3600));
    expect(report.horizonClosingWithinMs).toBe(DEFAULT_HORIZON_CLOSING_MS);
  });
});
