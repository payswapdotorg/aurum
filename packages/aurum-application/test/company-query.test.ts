/**
 * ACCEPTANCE (catalog W004): ANSWERS IDENTIFY SOURCE/EVIDENCE/FRESHNESS,
 * blind spots are explicit, and insufficient evidence produces honest
 * Unknown / LearningMission answers — proved end-to-end through the real
 * domain kernel and the public service surface (../src/index.js).
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

function errOf<T>(
  result: { ok: true; value: T } | { ok: false; error: { code?: string; message: string } },
): { code?: string; message: string } {
  expect(result.ok, `expected error: ${result.ok ? JSON.stringify(result.value) : ""}`).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

function scopeOf(name: string) {
  const result = tenantScope(name);
  if (!result.ok) throw new Error("bad tenant");
  return result.value;
}

interface Fixture {
  kernel: AurumDomainKernel;
  tenant: ReturnType<typeof scopeOf>;
  service: CompanyIntelligence;
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

/** The standard company fixture tenant (deterministic, insertion-ordered). */
function seed(): Fixture {
  const kernel = createDomainKernel();
  const s = scopeOf("co-query");
  okOf(
    kernel.organization.registerOrganization(s, {
      organizationId: "o-1",
      name: "Aurum Co",
      provenance: personActor("seed"),
      now: now(0),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.organization.registerUnit(s, {
      unitId: "u-1",
      organizationId: "o-1",
      name: "Operations",
      provenance: personActor("seed"),
      now: now(0),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.identity.registerPerson(s, {
      personId: "p-ceo",
      displayName: "CEO",
      labels: ["executive"],
      provenance: personActor("seed"),
      now: now(0),
    }),
  );
  okOf(
    kernel.identity.registerPerson(s, {
      personId: "p-ops",
      displayName: "Ops lead",
      labels: ["manager"],
      provenance: personActor("seed"),
      now: now(0),
    }),
  );
  okOf(
    kernel.identity.grantMembership(s, {
      membershipId: "m-ceo",
      personId: "p-ceo",
      organizationId: "o-1",
      roles: ["owner"],
      grantedBy: personActor("seed"),
      now: now(1),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.identity.grantMembership(s, {
      membershipId: "m-ops",
      personId: "p-ops",
      organizationId: "o-1",
      unitId: "u-1",
      roles: ["owner"],
      grantedBy: personActor("seed"),
      now: now(1),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.goals.createGoal(s, {
      goalId: "goal-1",
      objective: "Overhaul invoicing",
      desiredState: "Invoices processed within SLA",
      horizonStart: now(0),
      horizonEnd: at(60),
      ownerId: "p-ceo",
      ownerLabels: ["executive"],
      priority: "high",
      expectedEvidence: [
        { description: "processing logs", subject: { kind: "process", id: "p-1" } },
        { description: "inflation readings", subject: { kind: "topic", id: "t-1" } },
      ],
      provenance: prov(personActor("p-ceo"), 2),
      now: now(2),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.evidence.recordObservation(s, {
      observationId: "obs-fresh",
      subject: { kind: "topic", id: "t-1" },
      content: "inflation at 3.1%",
      observedAt: now(5),
      provenance: { ...prov(personActor("p-ops"), 5), note: "monthly report" },
    }),
  );
  okOf(
    kernel.evidence.recordObservation(s, {
      observationId: "obs-stale",
      subject: { kind: "topic", id: "t-1" },
      content: "inflation at 4.8%",
      observedAt: at(-40),
      provenance: prov(personActor("p-ops"), 6),
    }),
  );
  okOf(
    kernel.evidence.recordObservation(s, {
      observationId: "obs-retract",
      subject: { kind: "topic", id: "t-2" },
      content: "supplier depends on single source",
      observedAt: now(7),
      provenance: prov(personActor("p-ops"), 7),
    }),
  );
  okOf(
    kernel.epistemics.registerClaim(s, {
      claimId: "c-fresh",
      statement: "inflation is declining",
      derivedFrom: ["obs-fresh"],
      provenance: prov(personActor("p-ceo"), 8),
    }),
  );
  okOf(
    kernel.epistemics.registerClaim(s, {
      claimId: "c-risk",
      statement: "supplier risk is contained",
      derivedFrom: ["obs-retract"],
      provenance: prov(personActor("p-ceo"), 12),
    }),
  );
  okOf(
    kernel.epistemics.registerClaim(s, {
      claimId: "c-stalef",
      statement: "supplier concentration is rising",
      derivedFrom: ["obs-retract"],
      provenance: { actor: personActor("p-ceo"), source: "imported", recordedAt: at(-40) },
      freshness: { asOf: at(-40) },
    }),
  );
  okOf(
    kernel.epistemics.reviseBelief(s, {
      beliefId: "b-t1",
      subject: { kind: "topic", id: "t-1" },
      statement: "inflation environment is easing",
      supportingClaimIds: ["c-fresh"],
      provenance: prov(personActor("p-ceo"), 9),
      now: now(9),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.epistemics.reviseBelief(s, {
      beliefId: "b-risk",
      subject: { kind: "topic", id: "t-2" },
      statement: "supplier exposure is manageable",
      supportingClaimIds: ["c-risk"],
      provenance: prov(personActor("p-ceo"), 13),
      now: now(13),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.epistemics.reviseBelief(s, {
      beliefId: "b-t3",
      subject: { kind: "topic", id: "t-3" },
      statement: "supplier risk is elevated",
      supportingClaimIds: ["c-stalef"],
      provenance: prov(personActor("p-ceo"), 10),
      now: now(10),
      audit: auditOf("seed"),
    }),
  );
  okOf(
    kernel.memory.recordMemory(s, {
      memoryId: "mem-t1",
      subject: { kind: "topic", id: "t-1" },
      content: "pricing reviews happen monthly",
      provenance: prov(personActor("p-ceo"), 11),
      now: now(11),
      audit: auditOf("seed"),
    }),
  );
  return { kernel, tenant: s, service: serviceOf(kernel) };
}

const QUERY = { askedBy: personActor("p-ceo"), reason: "board review" };

describe("askAboutSubject (what do we know about X)", () => {
  it("evidenced: a belief on a fresh chain, with every entry naming source and freshness", () => {
    const { tenant, service } = seed();
    const answer = okOf(
      service.askAboutSubject(tenant, {
        subject: { kind: "topic", id: "t-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    expect(answer.classification).toBe("evidenced");
    expect(answer.classificationBasis).toContain("b-t1 revision 1");
    expect(answer.classificationBasis).toContain("current");
    expect(answer.beliefs).toHaveLength(1);
    expect(answer.beliefs[0]?.asserted).toBe(true);
    expect(answer.beliefs[0]?.supportingClaims[0]?.provenance.source).toBe("human-entered");
    expect(answer.observations.map((entry) => entry.observationId)).toEqual([
      "obs-fresh",
      "obs-stale",
    ]);
    expect(answer.observations[1]?.freshness).toBe("stale");
    expect(answer.memories[0]?.content).toBe("pricing reviews happen monthly");
  });

  it("the zombie-assertion proof: retracting the observation under the claim drops the answer to unknown", () => {
    const { kernel, tenant, service } = seed();
    const before = okOf(
      service.askAboutSubject(tenant, {
        subject: { kind: "topic", id: "t-2" },
        now: now(20),
        ...QUERY,
      }),
    );
    expect(before.classification).toBe("evidenced");
    expect(before.beliefs[0]?.asserted).toBe(true);
    okOf(
      kernel.evidence.retractObservation(tenant, "obs-retract", {
        reason: "source disavowed",
        now: now(30),
        audit: auditOf("disavowed", 30),
      }),
    );
    const after = okOf(
      service.askAboutSubject(tenant, {
        subject: { kind: "topic", id: "t-2" },
        now: now(60),
        ...QUERY,
      }),
    );
    expect(after.classification).toBe("unknown");
    expect(after.beliefs[0]?.asserted).toBe(false);
    expect(after.beliefs[0]?.supportingClaims[0]?.support).toBe("superseded");
    expect(after.observations[0]?.status).toBe("retracted");
  });

  it("partial: a belief resting on a stale-freshness claim is degraded, with a stale-evidence blind spot", () => {
    const { tenant, service } = seed();
    const answer = okOf(
      service.askAboutSubject(tenant, {
        subject: { kind: "topic", id: "t-3" },
        now: now(60),
        ...QUERY,
      }),
    );
    expect(answer.classification).toBe("partial");
    expect(answer.classificationBasis).toContain("stale or unknown-freshness support");
    const spot = answer.blindSpots.find((item) => item.kind === "stale-evidence");
    expect(spot).toBeDefined();
    expect(spot?.description).toContain("b-t3 revision 1");
  });

  it("unknown; then learning-mission-required once an open unknown records the consequence", () => {
    const { kernel, tenant, service } = seed();
    const empty = { kind: "topic", id: "t-empty" } as const;
    const before = okOf(
      service.askAboutSubject(tenant, { subject: empty, now: now(60), ...QUERY }),
    );
    expect(before.classification).toBe("unknown");
    expect(before.observations).toHaveLength(0);
    okOf(
      kernel.inquiry.raiseUnknown(tenant, {
        unknownId: "u-1",
        question: "What is the churn rate?",
        consequence: "pricing decisions degrade without it",
        relatedSubjects: [empty],
        provenance: prov(personActor("p-ceo"), 40),
        now: now(40),
      }),
    );
    const after = okOf(service.askAboutSubject(tenant, { subject: empty, now: now(60), ...QUERY }));
    expect(after.classification).toBe("learning-mission-required");
    expect(after.classificationBasis).toContain("1 open unknown(s)");
    const spot = after.blindSpots.find((item) => item.kind === "open-unknown");
    expect(spot?.consequence).toBe("pricing decisions degrade without it");
  });

  it("goal answers make missing expected evidence explicit as blind spots", () => {
    const { tenant, service } = seed();
    const answer = okOf(
      service.askAboutSubject(tenant, {
        subject: { kind: "goal", id: "goal-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    const missing = answer.blindSpots.filter((item) => item.kind === "missing-expected-evidence");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.description).toContain("processing logs");
    // The covered expectation produces no blind spot.
    expect(answer.blindSpots.some((item) => item.description.includes("inflation readings"))).toBe(
      false,
    );
  });

  it("answers are tenant-isolated: a foreign tenant sees honest unknown, not other tenants' evidence", () => {
    const { kernel, service } = seed();
    const other = scopeOf("co-other");
    const answer = okOf(
      service.askAboutSubject(other, {
        subject: { kind: "topic", id: "t-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    expect(answer.classification).toBe("unknown");
    expect(answer.observations).toHaveLength(0);
    expect(kernel.evidence.listObservations(other, { kind: "topic", id: "t-1" })).toHaveLength(0);
  });

  it("every successful ask is logged with its honesty outcome; failures are not", () => {
    const { tenant, service } = seed();
    const before = service.listQueryLogs(tenant).length;
    const bad = service.askAboutSubject(tenant, {
      subject: { kind: "topic", id: "t-1" },
      now: -5,
      askedBy: { kind: "person" },
      reason: " ",
    });
    expect(bad.ok).toBe(false);
    expect(service.listQueryLogs(tenant).length).toBe(before);
    okOf(
      service.askAboutSubject(tenant, {
        subject: { kind: "topic", id: "t-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    const logs = service.listQueryLogs(tenant);
    expect(logs.length).toBe(before + 1);
    const last = logs[logs.length - 1];
    expect(last?.kind).toBe("ask-about-subject");
    expect(last?.classification).toBe("evidenced");
    expect(okOf(service.getQueryLog(tenant, last?.queryId ?? "")).queryId).toBe(last?.queryId);
  });
});

describe("whoOwns (who owns what)", () => {
  it("goal ownership comes from the current goal revision", () => {
    const { tenant, service } = seed();
    const answer = okOf(
      service.whoOwns(tenant, { subject: { kind: "goal", id: "goal-1" }, now: now(60), ...QUERY }),
    );
    expect(answer.classification).toBe("evidenced");
    expect(answer.owners).toHaveLength(1);
    expect(answer.owners[0]?.personId).toBe("p-ceo");
    expect(answer.owners[0]?.basis).toBe("goal-revision");
    expect(answer.owners[0]?.basisRecordId).toBe("goal-1@1");
    expect(answer.owners[0]?.freshness).toBe("current");
  });

  it("organization ownership comes from active owner-memberships; units from unit-scoped ones", () => {
    const { tenant, service } = seed();
    // An owner-role membership under the organization counts for the
    // organization whether it is org-wide (m-ceo) or unit-scoped (m-ops).
    const org = okOf(
      service.whoOwns(tenant, {
        subject: { kind: "organization", id: "o-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    expect(org.owners.map((owner) => owner.personId)).toEqual(["p-ceo", "p-ops"]);
    const unit = okOf(
      service.whoOwns(tenant, { subject: { kind: "unit", id: "u-1" }, now: now(60), ...QUERY }),
    );
    expect(unit.owners.map((owner) => owner.personId)).toEqual(["p-ops"]);
    expect(unit.owners[0]?.basis).toBe("active-membership");
    expect(unit.owners[0]?.basisRecordId).toBe("m-ops");
  });

  it("ended memberships never back ownership; the honest answer is unknown", () => {
    const { kernel, tenant, service } = seed();
    okOf(
      kernel.identity.endMembership(tenant, {
        membershipId: "m-ceo",
        endedBy: personActor("seed"),
        now: now(50),
        audit: auditOf("resigned", 50),
      }),
    );
    // The unit-scoped owner remains for the organization.
    const org = okOf(
      service.whoOwns(tenant, {
        subject: { kind: "organization", id: "o-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    expect(org.owners.map((owner) => owner.personId)).toEqual(["p-ops"]);
    okOf(
      kernel.identity.endMembership(tenant, {
        membershipId: "m-ops",
        endedBy: personActor("seed"),
        now: now(55),
        audit: auditOf("reassigned", 55),
      }),
    );
    const afterOrg = okOf(
      service.whoOwns(tenant, {
        subject: { kind: "organization", id: "o-1" },
        now: now(60),
        ...QUERY,
      }),
    );
    expect(afterOrg.classification).toBe("unknown");
    expect(afterOrg.owners).toHaveLength(0);
    const afterUnit = okOf(
      service.whoOwns(tenant, { subject: { kind: "unit", id: "u-1" }, now: now(60), ...QUERY }),
    );
    expect(afterUnit.classification).toBe("unknown");
  });

  it("a missing goal is an honest unknown, never an error and never a leak", () => {
    const { tenant, service } = seed();
    const answer = okOf(
      service.whoOwns(tenant, { subject: { kind: "goal", id: "goal-x" }, now: now(60), ...QUERY }),
    );
    expect(answer.classification).toBe("unknown");
    expect(answer.owners).toHaveLength(0);
  });

  it("subjects without an ownership basis are a validation error, not a guess", () => {
    const { tenant, service } = seed();
    const error = errOf(
      service.whoOwns(tenant, { subject: { kind: "person", id: "p-ceo" }, now: now(60), ...QUERY }),
    );
    expect(error.code).toBe("company-validation");
  });
});

describe("whatChangedSince (what changed)", () => {
  it("subject-scoped: new evidence appears with its provenance reason; retractions are marked", () => {
    const { kernel, tenant, service } = seed();
    okOf(
      kernel.evidence.retractObservation(tenant, "obs-retract", {
        reason: "source disavowed",
        now: now(30),
        audit: auditOf("disavowed", 30),
      }),
    );
    const report = okOf(
      service.whatChangedSince(tenant, {
        since: now(0),
        until: now(3600),
        subject: { kind: "topic", id: "t-2" },
        now: now(3600),
        ...QUERY,
      }),
    );
    const recorded = report.changes.filter((change) => change.action === "observation.recorded");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.reason).toBe("evidence recorded");
    expect(recorded[0]?.subject.id).toBe("t-2");
    const retraction = report.changes.find((change) => change.retraction);
    expect(retraction?.action).toBe("observation.retracted");
    expect(retraction?.reason).toBe("disavowed");
    expect(retraction?.summary).toContain("source disavowed");
  });

  it("tenant-wide: every consequential transition, enriched with revision content", () => {
    const { tenant, service } = seed();
    const report = okOf(
      service.whatChangedSince(tenant, {
        since: now(0),
        until: now(3600),
        now: now(3600),
        ...QUERY,
      }),
    );
    const actions = new Set(report.changes.map((change) => change.action));
    expect(actions.has("goal.created")).toBe(true);
    expect(actions.has("membership.granted")).toBe(true);
    expect(actions.has("belief.revised")).toBe(true);
    expect(actions.has("memory.revised")).toBe(true);
    const goalCreated = report.changes.find((change) => change.action === "goal.created");
    expect(goalCreated?.enrichment?.kind).toBe("goal");
    expect(goalCreated?.enrichment?.statement).toBe("Overhaul invoicing");
    const beliefRevised = report.changes.find((change) => change.action === "belief.revised");
    expect(beliefRevised?.enrichment?.statement).toContain("easing");
    const memoryRevised = report.changes.find((change) => change.action === "memory.revised");
    expect(memoryRevised?.enrichment?.statement).toBe("pricing reviews happen monthly");
  });

  it("changes are ordered by time and deduped by record id", () => {
    const { tenant, service } = seed();
    const report = okOf(
      service.whatChangedSince(tenant, {
        since: now(0),
        until: now(3600),
        now: now(3600),
        ...QUERY,
      }),
    );
    const times = report.changes.map((change) => change.at);
    const sorted = [...times].sort((left, right) => left - right);
    expect(times).toEqual(sorted);
    expect(new Set(report.changes.map((change) => change.recordId)).size).toBe(
      report.changes.length,
    );
  });

  it("an empty window reports no changes (honest, not an error)", () => {
    const { tenant, service } = seed();
    const report = okOf(
      service.whatChangedSince(tenant, {
        since: now(2000),
        until: now(3000),
        now: now(3000),
        ...QUERY,
      }),
    );
    expect(report.changes).toHaveLength(0);
    expect(report.since).toBe(now(2000));
    expect(report.until).toBe(now(3000));
  });

  it("an invalid window is a validation error", () => {
    const { tenant, service } = seed();
    const error = errOf(
      service.whatChangedSince(tenant, {
        since: now(100),
        until: now(50),
        now: now(60),
        ...QUERY,
      }),
    );
    expect(error.code).toBe("company-validation");
  });
});
