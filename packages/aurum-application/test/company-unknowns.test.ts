/**
 * ACCEPTANCE (catalog W004): BLIND SPOTS MADE EXPLICIT — the tenant-wide
 * unknowns report: one list per blind-spot kind (open unknowns, open
 * contradictions, stale evidence over the declared-consequential subject
 * set, missing expected evidence), through the public surface.
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

/** Unknowns fixture: consequential subjects across all four kinds. */
function seed(): {
  kernel: AurumDomainKernel;
  tenant: ReturnType<typeof scopeOf>;
  service: CompanyIntelligence;
} {
  const kernel = createDomainKernel();
  const s = scopeOf("co-unknowns");
  okOf(
    kernel.goals.createGoal(s, {
      goalId: "goal-1",
      objective: "Overhaul invoicing",
      desiredState: "SLA met",
      horizonStart: now(0),
      horizonEnd: at(60),
      ownerId: "p-ceo",
      ownerLabels: ["executive"],
      priority: "high",
      expectedEvidence: [
        { description: "processing logs", subject: { kind: "process", id: "p-1" } },
        { description: "covered readings", subject: { kind: "topic", id: "t-cov" } },
        { description: "supplier exposure", subject: { kind: "topic", id: "t-stale" } },
      ],
      provenance: prov(personActor("p-ceo"), 1),
      now: now(1),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.evidence.recordObservation(s, {
      observationId: "obs-cov",
      subject: { kind: "topic", id: "t-cov" },
      content: "covered signal",
      observedAt: now(5),
      provenance: prov(personActor("p-ops"), 5),
    }),
  );
  okOf(
    kernel.evidence.recordObservation(s, {
      observationId: "obs-stale",
      subject: { kind: "topic", id: "t-stale" },
      content: "supplier exposure 41%",
      observedAt: at(-45),
      provenance: prov(personActor("p-ops"), 6),
    }),
  );
  okOf(
    kernel.evidence.recordObservation(s, {
      observationId: "obs-unk",
      subject: { kind: "topic", id: "t-unk" },
      content: "churn preliminary reading",
      observedAt: at(-45),
      provenance: prov(personActor("p-ops"), 7),
    }),
  );
  okOf(
    kernel.memory.recordMemory(s, {
      memoryId: "mem-unk",
      subject: { kind: "topic", id: "t-unk" },
      content: "churn methodology notes",
      provenance: { actor: personActor("p-ceo"), source: "imported", recordedAt: at(-45) },
      freshness: { asOf: at(-45) },
      now: at(-45),
      audit: auditOf("imported", -45),
    }),
  );
  okOf(
    kernel.memory.recordMemory(s, {
      memoryId: "mem-con",
      subject: { kind: "topic", id: "t-con" },
      content: "contradiction background notes",
      provenance: { actor: personActor("p-ceo"), source: "imported", recordedAt: at(-45) },
      freshness: { asOf: at(-45) },
      now: at(-45),
      audit: auditOf("imported", -45),
    }),
  );
  okOf(
    kernel.inquiry.raiseUnknown(s, {
      unknownId: "u-1",
      question: "What is the churn rate?",
      consequence: "pricing decisions degrade",
      relatedSubjects: [{ kind: "topic", id: "t-unk" }],
      provenance: prov(personActor("p-ceo"), 8),
      now: now(8),
    }),
  );
  okOf(
    kernel.inquiry.raiseUnknown(s, {
      unknownId: "u-resolved",
      question: "Old question",
      consequence: "moot",
      relatedSubjects: [{ kind: "topic", id: "t-old" }],
      provenance: prov(personActor("p-ceo"), 9),
      now: now(9),
    }),
  );
  okOf(
    kernel.inquiry.resolveUnknown(s, {
      unknownId: "u-resolved",
      outcome: "answered elsewhere",
      now: now(10),
      audit: auditOf("answered", 10),
    }),
  );
  okOf(
    kernel.inquiry.recordContradiction(s, {
      contradictionId: "con-1",
      between: [
        { kind: "goal", id: "goal-1" },
        { kind: "topic", id: "t-con" },
      ],
      description: "Objective conflicts with the background notes",
      provenance: prov(personActor("p-ceo"), 11),
      now: now(11),
    }),
  );
  return { kernel, tenant: s, service: serviceOf(kernel) };
}

const QUERY = { askedBy: personActor("p-ceo"), reason: "risk review" };

describe("reportUnknowns (blind spots made explicit)", () => {
  it("open unknowns are listed with question, consequence, raisedAt and freshness", () => {
    const { tenant, service } = seed();
    const report = okOf(service.reportUnknowns(tenant, { now: now(3600), ...QUERY }));
    expect(report.openUnknowns).toHaveLength(1);
    const unknown = report.openUnknowns[0];
    expect(unknown?.question).toBe("What is the churn rate?");
    expect(unknown?.consequence).toBe("pricing decisions degrade");
    expect(unknown?.raisedAt).toBe(now(8));
    expect(unknown?.freshness).toBe("current");
    expect(unknown?.subject).toEqual({ kind: "topic", id: "t-unk" });
  });

  it("resolved unknowns never appear; contradictions carry their freshness", () => {
    const { tenant, service } = seed();
    const report = okOf(service.reportUnknowns(tenant, { now: now(3600), ...QUERY }));
    expect(report.openUnknowns.some((entry) => entry.question === "Old question")).toBe(false);
    expect(report.openContradictions).toHaveLength(1);
    expect(report.openContradictions[0]?.description).toBe(
      "Objective conflicts with the background notes",
    );
    expect(report.openContradictions[0]?.recordedAt).toBe(now(11));
  });

  it("stale evidence covers the consequential set (expectations, unknown relations, contradictions)", () => {
    const { tenant, service } = seed();
    const report = okOf(service.reportUnknowns(tenant, { now: now(3600), ...QUERY }));
    const descriptions = report.staleEvidence.map((entry) => entry.description);
    // t-stale expectation subject; t-unk (unknown relation) observation + memory;
    // t-con (contradiction relation) memory. t-cov is fresh; p-1 has nothing.
    expect(descriptions).toEqual([
      "memory version 1 is stale",
      "memory version 1 is stale",
      'observation "supplier exposure 41%" is stale',
      'observation "churn preliminary reading" is stale',
    ]);
    expect(report.staleEvidence.every((entry) => entry.freshness === "stale")).toBe(true);
    expect(report.staleEvidence.map((entry) => entry.subject.id)).toEqual([
      "t-con",
      "t-unk",
      "t-stale",
      "t-unk",
    ]);
  });

  it("missing expected evidence is listed per goal, ordered by record id", () => {
    const { tenant, service } = seed();
    const report = okOf(service.reportUnknowns(tenant, { now: now(3600), ...QUERY }));
    expect(report.missingExpectedEvidence).toHaveLength(1);
    expect(report.missingExpectedEvidence[0]?.description).toContain("processing logs");
    expect(report.missingExpectedEvidence[0]?.subject).toEqual({ kind: "goal", id: "goal-1" });
  });

  it("an empty tenant reports four empty lists, honestly", () => {
    const kernel = createDomainKernel();
    const service = serviceOf(kernel);
    const empty = scopeOf("co-unknowns-empty");
    const report = okOf(service.reportUnknowns(empty, { now: now(3600), ...QUERY }));
    expect(report.openUnknowns).toHaveLength(0);
    expect(report.openContradictions).toHaveLength(0);
    expect(report.staleEvidence).toHaveLength(0);
    expect(report.missingExpectedEvidence).toHaveLength(0);
  });

  it("the report is tenant-isolated", () => {
    const { service } = seed();
    const other = scopeOf("co-unknowns-other");
    const report = okOf(service.reportUnknowns(other, { now: now(3600), ...QUERY }));
    expect(report.openUnknowns).toHaveLength(0);
    expect(report.openContradictions).toHaveLength(0);
  });

  it("the query is logged under report-unknowns", () => {
    const { tenant, service } = seed();
    const before = service.listQueryLogs(tenant).length;
    okOf(service.reportUnknowns(tenant, { now: now(3600), ...QUERY }));
    const logs = service.listQueryLogs(tenant);
    expect(logs.length).toBe(before + 1);
    expect(logs[logs.length - 1]?.kind).toBe("report-unknowns");
  });
});
