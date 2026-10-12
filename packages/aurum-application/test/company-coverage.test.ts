/**
 * ACCEPTANCE (catalog W004): COVERAGE OF WHAT IS KNOWN, made explicit —
 * covered / stale / unevidenced buckets, per-record freshness readings for
 * every evidence-bearing record and every declared expectation, through the
 * real kernel and the public surface (../src/index.js).
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

/** Coverage fixture: one goal with three expectations (fresh/stale/missing). */
function seed(): {
  kernel: AurumDomainKernel;
  tenant: ReturnType<typeof scopeOf>;
  service: CompanyIntelligence;
} {
  const kernel = createDomainKernel();
  const s = scopeOf("co-coverage");
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
        { description: "inflation readings", subject: { kind: "topic", id: "t-1" } },
        { description: "supplier exposure", subject: { kind: "topic", id: "t-stale" } },
      ],
      provenance: prov(personActor("p-ceo"), 1),
      now: now(1),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.evidence.recordObservation(s, {
      observationId: "obs-fresh",
      subject: { kind: "topic", id: "t-1" },
      content: "inflation 3.1%",
      observedAt: now(5),
      provenance: prov(personActor("p-ops"), 5),
    }),
  );
  okOf(
    kernel.evidence.recordObservation(s, {
      observationId: "obs-old",
      subject: { kind: "topic", id: "t-1" },
      content: "inflation 4.8% (aging)",
      observedAt: at(-10),
      provenance: prov(personActor("p-ops"), 6),
    }),
  );
  okOf(
    kernel.evidence.recordObservation(s, {
      observationId: "obs-stale",
      subject: { kind: "topic", id: "t-stale" },
      content: "supplier exposure 41% single-source",
      observedAt: at(-45),
      provenance: prov(personActor("p-ops"), 7),
    }),
  );
  okOf(
    kernel.evidence.recordObservation(s, {
      observationId: "obs-retract",
      subject: { kind: "topic", id: "t-1" },
      content: "withdrawn reading",
      observedAt: now(8),
      provenance: prov(personActor("p-ops"), 8),
    }),
  );
  okOf(
    kernel.evidence.retractObservation(s, "obs-retract", {
      reason: "bad source",
      now: now(9),
      audit: auditOf("cleanup", 9),
    }),
  );
  okOf(
    kernel.epistemics.registerClaim(s, {
      claimId: "c-1",
      statement: "inflation declining",
      derivedFrom: ["obs-fresh"],
      provenance: prov(personActor("p-ceo"), 10),
    }),
  );
  okOf(
    kernel.epistemics.reviseBelief(s, {
      beliefId: "b-1",
      subject: { kind: "topic", id: "t-1" },
      statement: "inflation easing",
      supportingClaimIds: ["c-1"],
      provenance: prov(personActor("p-ceo"), 11),
      now: now(11),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.memory.recordMemory(s, {
      memoryId: "mem-fresh",
      subject: { kind: "topic", id: "t-1" },
      content: "monthly pricing review cadence",
      provenance: prov(personActor("p-ceo"), 12),
      now: now(12),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.memory.recordMemory(s, {
      memoryId: "mem-stale",
      subject: { kind: "topic", id: "t-stale" },
      content: "supplier onboarding notes",
      provenance: { actor: personActor("p-ceo"), source: "imported", recordedAt: at(-45) },
      freshness: { asOf: at(-45) },
      now: at(-45),
      audit: auditOf("imported", -45),
    }),
  );
  return { kernel, tenant: s, service: serviceOf(kernel) };
}

const QUERY = { askedBy: personActor("p-ceo"), reason: "coverage review" };

describe("reportCoverage (coverage of what is known)", () => {
  it("covered: current AND aging evidence (treatable-as-current); stale only when expired", () => {
    const { tenant, service } = seed();
    const report = okOf(
      service.reportCoverage(tenant, {
        subject: { kind: "topic", id: "t-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    // obs-fresh is current; obs-old is 10 days old (aging) — decaying but
    // still valid, so both are treatable as current and land in covered.
    expect(report.covered.map((entry) => entry.description)).toEqual([
      "inflation 3.1%",
      "inflation 4.8% (aging)",
      "monthly pricing review cadence",
    ]);
    expect(report.covered.map((entry) => entry.freshness)).toEqual(["current", "aging", "current"]);
    // Nothing about t-1 is expired: the stale bucket is empty.
    expect(report.stale).toHaveLength(0);
  });

  it("stale bucket for unknown-freshness expectations: evidence exists but is not current", () => {
    const { tenant, service } = seed();
    const report = okOf(
      service.reportCoverage(tenant, {
        subject: { kind: "topic", id: "t-stale" },
        now: now(60),
        ...QUERY,
      }),
    );
    expect(report.stale.map((entry) => entry.description)).toEqual([
      "supplier exposure 41% single-source",
      "supplier onboarding notes",
    ]);
    expect(report.stale.every((entry) => entry.status === "stale")).toBe(true);
  });

  it("retracted observations never enter the buckets; they stay visible as readings", () => {
    const { tenant, service } = seed();
    const report = okOf(
      service.reportCoverage(tenant, {
        subject: { kind: "topic", id: "t-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    expect(report.covered.some((entry) => entry.description === "withdrawn reading")).toBe(false);
    expect(report.stale.some((entry) => entry.description === "withdrawn reading")).toBe(false);
    expect(report.freshness.some((reading) => reading.description === "withdrawn reading")).toBe(
      true,
    );
  });

  it("unevidenced: declared expectations with no usable observations, plus blind spots", () => {
    const { tenant, service } = seed();
    const report = okOf(
      service.reportCoverage(tenant, {
        subject: { kind: "goal", id: "goal-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    expect(report.unevidenced.map((entry) => entry.description)).toEqual(["processing logs"]);
    expect(report.unevidenced[0]?.subject).toEqual({ kind: "process", id: "p-1" });
    const missing = report.blindSpots.find((spot) => spot.kind === "missing-expected-evidence");
    expect(missing?.description).toContain("processing logs");
    const staleSpot = report.blindSpots.find((spot) => spot.kind === "stale-evidence");
    expect(staleSpot?.description).toContain("supplier exposure");
  });

  it("per-record freshness readings cover every evidence-bearing record and expectation", () => {
    const { tenant, service } = seed();
    const report = okOf(
      service.reportCoverage(tenant, {
        subject: { kind: "topic", id: "t-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    const kinds = report.freshness.map((reading) => reading.kind);
    expect(kinds).toContain("observation");
    expect(kinds).toContain("claim");
    expect(kinds).toContain("belief");
    expect(kinds).toContain("memory");
    const claimReading = report.freshness.find((reading) => reading.kind === "claim");
    expect(claimReading?.description).toBe("inflation declining");
    // Expected-evidence readings only exist for goal subjects (t-1 is not one).
    expect(report.freshness.some((reading) => reading.kind === "expected-evidence")).toBe(false);
  });

  it("expected-evidence readings reflect the best observation freshness per expectation", () => {
    const { tenant, service } = seed();
    const report = okOf(
      service.reportCoverage(tenant, {
        subject: { kind: "goal", id: "goal-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    const readings = report.freshness.filter((reading) => reading.kind === "expected-evidence");
    expect(readings).toHaveLength(3);
    const byDescription = new Map(
      readings.map((reading) => [reading.description, reading.freshness]),
    );
    expect(byDescription.get("processing logs")).toBe("unknown");
    expect(byDescription.get("inflation readings")).toBe("current");
    expect(byDescription.get("supplier exposure")).toBe("stale");
  });

  it("coverage reports are tenant-isolated", () => {
    const { service } = seed();
    const other = scopeOf("co-coverage-other");
    const report = okOf(
      service.reportCoverage(other, {
        subject: { kind: "topic", id: "t-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    expect(report.covered).toHaveLength(0);
    expect(report.stale).toHaveLength(0);
    expect(report.unevidenced).toHaveLength(0);
  });

  it("the query is logged under report-coverage", () => {
    const { tenant, service } = seed();
    const before = service.listQueryLogs(tenant).length;
    okOf(
      service.reportCoverage(tenant, {
        subject: { kind: "topic", id: "t-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    const logs = service.listQueryLogs(tenant);
    expect(logs.length).toBe(before + 1);
    expect(logs[logs.length - 1]?.kind).toBe("report-coverage");
  });
});
