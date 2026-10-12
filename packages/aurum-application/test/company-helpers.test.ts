/**
 * ACCEPTANCE (structural): THE PUBLIC HELPER SURFACE — chain builders, the
 * in-memory query log, the typed error namespace and the honesty
 * vocabularies, all consumed through the PUBLIC application contract
 * (../src/index.js), exactly as other modules consume it.
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
  auditEntry,
  beliefRevisionEntry,
  claimEntry,
  goalRevisionEntry,
  membershipEntry,
  memoryEntry,
  observationEntry,
  createInMemoryQueryLog,
  CompanyError,
  isCompanyError,
  isKnownAnswerClassification,
  isKnownAttentionCriterion,
  isKnownBlindSpotKind,
} from "../src/index.js";

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const now = (seconds = 0): DomainTimestamp => (T0 + seconds * 1000) as DomainTimestamp;
const daysFromNow = (days: number): DomainTimestamp => (T0 + days * DAY) as DomainTimestamp;
const prov = (actor: ActorReference, atSeconds = 0) => ({
  actor,
  source: "human-entered" as const,
  recordedAt: now(atSeconds),
});

function scopeOf(name: string) {
  const result = tenantScope(name);
  if (!result.ok) throw new Error("bad tenant");
  return result.value;
}

function okOf<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  expect(result.ok, `expected ok: ${result.ok ? "" : result.error.message}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

describe("observationEntry builder", () => {
  it("carries content, status, provenance stamp and the kernel freshness class", () => {
    const kernel = createDomainKernel();
    const s = scopeOf("t-helpers");
    const record = okOf(
      kernel.evidence.recordObservation(s, {
        observationId: "obs-1",
        subject: { kind: "topic", id: "t-1" },
        content: "inflation at 3.1%",
        observedAt: now(0),
        provenance: prov(personActor("boss")),
      }),
    );
    const entry = observationEntry(record, now(60));
    expect(entry.recordId).toBe("obs-1");
    expect(entry.status).toBe("active");
    expect(entry.freshness).toBe("current");
    expect(entry.provenance).toEqual({
      actor: personActor("boss"),
      source: "human-entered",
      recordedAt: now(0),
    });
  });

  it("classifies the same observation stale at a later now (pure re-read)", () => {
    const kernel = createDomainKernel();
    const s = scopeOf("t-helpers");
    const record = okOf(
      kernel.evidence.recordObservation(s, {
        observationId: "obs-old",
        subject: { kind: "topic", id: "t-1" },
        content: "older reading",
        observedAt: now(0),
        provenance: prov(personActor("boss")),
      }),
    );
    expect(observationEntry(record, now(0)).freshness).toBe("current");
    expect(observationEntry(record, daysFromNow(45) as DomainTimestamp).freshness).toBe("stale");
  });

  it("a retracted observation keeps its retracted status on the entry", () => {
    const kernel = createDomainKernel();
    const s = scopeOf("t-helpers");
    okOf(
      kernel.evidence.recordObservation(s, {
        observationId: "obs-1",
        subject: { kind: "topic", id: "t-1" },
        content: "reading",
        observedAt: now(0),
        provenance: prov(personActor("boss")),
      }),
    );
    const record = okOf(
      kernel.evidence.retractObservation(s, "obs-1", {
        reason: "wrong source",
        now: now(10),
        audit: { actor: personActor("boss"), at: now(10), reason: "cleanup" },
      }),
    );
    const entry = observationEntry(record, now(60));
    expect(entry.status).toBe("retracted");
    expect(entry.observationId).toBe("obs-1");
  });
});

describe("claimEntry builder (chain honesty at build time)", () => {
  it("an active claim over a fresh source has support active", () => {
    const kernel = createDomainKernel();
    const s = scopeOf("t-helpers");
    const obs = okOf(
      kernel.evidence.recordObservation(s, {
        observationId: "obs-1",
        subject: { kind: "topic", id: "t-1" },
        content: "reading",
        observedAt: now(0),
        provenance: prov(personActor("boss")),
      }),
    );
    const claimRecord = okOf(
      kernel.epistemics.registerClaim(s, {
        claimId: "claim-1",
        statement: "inflation is declining",
        derivedFrom: ["obs-1"],
        provenance: prov(personActor("boss"), 1),
      }),
    );
    const entry = claimEntry(claimRecord, [obs], now(60));
    expect(entry.support).toBe("active");
    expect(entry.derivedFrom).toHaveLength(1);
    expect(entry.derivedFrom[0]?.recordId).toBe("obs-1");
  });

  it("an active claim whose sources were all retracted builds as superseded", () => {
    const kernel = createDomainKernel();
    const s = scopeOf("t-helpers");
    const obs = okOf(
      kernel.evidence.recordObservation(s, {
        observationId: "obs-1",
        subject: { kind: "topic", id: "t-1" },
        content: "reading",
        observedAt: now(0),
        provenance: prov(personActor("boss")),
      }),
    );
    const retracted = { ...obs, status: "retracted" as const };
    const claimRecord = okOf(
      kernel.epistemics.registerClaim(s, {
        claimId: "claim-1",
        statement: "inflation is declining",
        derivedFrom: ["obs-1"],
        provenance: prov(personActor("boss"), 1),
      }),
    );
    expect(claimEntry(claimRecord, [retracted], now(60)).support).toBe("superseded");
  });
});

describe("beliefRevisionEntry builder (current revision, read-side assertion)", () => {
  it("reflects the current revision only", () => {
    const kernel = createDomainKernel();
    const s = scopeOf("t-helpers");
    const obs = okOf(
      kernel.evidence.recordObservation(s, {
        observationId: "obs-1",
        subject: { kind: "topic", id: "t-1" },
        content: "reading",
        observedAt: now(0),
        provenance: prov(personActor("boss")),
      }),
    );
    const claimRecord = okOf(
      kernel.epistemics.registerClaim(s, {
        claimId: "claim-1",
        statement: "inflation declining",
        derivedFrom: ["obs-1"],
        provenance: prov(personActor("boss"), 1),
      }),
    );
    const claimE = claimEntry(claimRecord, [obs], now(60));
    okOf(
      kernel.epistemics.reviseBelief(s, {
        beliefId: "b-1",
        subject: { kind: "topic", id: "t-1" },
        statement: "first understanding",
        supportingClaimIds: ["claim-1"],
        provenance: prov(personActor("boss"), 2),
        now: now(2),
        audit: { actor: personActor("boss"), at: now(2), reason: "seed" },
      }),
    );
    const record = okOf(
      kernel.epistemics.reviseBelief(s, {
        beliefId: "b-1",
        subject: { kind: "topic", id: "t-1" },
        statement: "second understanding",
        supportingClaimIds: ["claim-1"],
        provenance: prov(personActor("boss"), 3),
        now: now(3),
        audit: { actor: personActor("boss"), at: now(3), reason: "refined" },
      }),
    );
    const entry = beliefRevisionEntry(record, [claimE], now(60));
    expect(entry.revision).toBe(2);
    expect(entry.statement).toBe("second understanding");
    expect(entry.asserted).toBe(true);
  });

  it("assertion is re-derived: all-retracted support builds as not asserted", () => {
    const entry = beliefRevisionEntry(
      {
        scope: scopeOf("t-helpers"),
        beliefId: "b-1" as never,
        subject: { kind: "topic", id: "t-1" },
        currentRevision: 1,
        revisions: [
          {
            revisionNumber: 1,
            statement: "understanding",
            supportingClaimIds: ["claim-1" as never],
            provenance: prov(personActor("boss")),
            freshness: { asOf: now(0) },
            createdAt: now(0),
          },
        ],
      },
      [
        claimEntry(
          {
            scope: scopeOf("t-helpers"),
            claimId: "claim-1" as never,
            statement: "declining",
            derivedFrom: ["obs-1" as never],
            provenance: prov(personActor("boss")),
            freshness: { asOf: now(0) },
            status: "retracted",
          },
          [
            {
              scope: scopeOf("t-helpers"),
              observationId: "obs-1" as never,
              subject: { kind: "topic", id: "t-1" },
              content: "reading",
              provenance: prov(personActor("boss")),
              freshness: { asOf: now(0) },
              status: "retracted",
              observedAt: now(0),
            },
          ],
          now(60),
        ),
      ],
      now(60),
    );
    expect(entry.asserted).toBe(false);
  });
});

describe("memory, goal-revision, membership and audit builders", () => {
  it("memoryEntry carries the current version content", () => {
    const entry = memoryEntry(
      {
        scope: scopeOf("t-helpers"),
        memoryId: "mem-1" as never,
        subject: { kind: "topic", id: "t-1" },
        currentVersion: 2,
        versions: [
          {
            version: 1,
            content: "old",
            provenance: prov(personActor("boss")),
            freshness: { asOf: now(0) },
            createdAt: now(0),
          },
          {
            version: 2,
            content: "current knowledge",
            provenance: prov(personActor("boss"), 5),
            freshness: { asOf: now(5) },
            createdAt: now(5),
          },
        ],
      },
      now(60),
    );
    expect(entry.version).toBe(2);
    expect(entry.content).toBe("current knowledge");
    expect(entry.freshness).toBe("current");
  });

  it("goalRevisionEntry carries the revision summary; recordId is goalId@revision", () => {
    const entry = goalRevisionEntry(
      "goal-1",
      {
        revisionNumber: 1,
        objective: "Overhaul invoicing",
        desiredState: "SLA met",
        metrics: [],
        horizonStart: now(0),
        horizonEnd: daysFromNow(60),
        owner: { personId: "boss" as never, labels: ["executive"] },
        priority: "high",
        expectedEvidence: [
          { description: "processing logs", subject: { kind: "process", id: "p-1" } },
        ],
        successCriteria: [],
        provenance: prov(personActor("boss")),
        createdAt: now(0),
      },
      now(60),
    );
    expect(entry.recordId).toBe("goal-1@1");
    expect(entry.ownerPersonId).toBe("boss");
    expect(entry.expectedEvidence).toHaveLength(1);
    expect(entry.freshness).toBe("current");
  });

  it("membershipEntry carries status verbatim; freshness is the grant's knowledge age", () => {
    const entry = membershipEntry(
      {
        scope: scopeOf("t-helpers"),
        membershipId: "mem-1" as never,
        personId: "boss" as never,
        organizationId: "o-1",
        unitId: "u-1",
        roles: ["owner"],
        status: "active",
        grantedAt: now(0),
        grantedBy: personActor("boss"),
      },
      daysFromNow(45) as DomainTimestamp,
    );
    expect(entry.status).toBe("active");
    expect(entry.freshness).toBe("stale");
    const ended = membershipEntry(
      {
        scope: scopeOf("t-helpers"),
        membershipId: "mem-1" as never,
        personId: "boss" as never,
        organizationId: "o-1",
        roles: ["owner"],
        status: "ended",
        grantedAt: now(0),
        grantedBy: personActor("boss"),
      },
      now(60),
    );
    expect(ended.status).toBe("ended");
  });

  it("auditEntry carries who/when/why and no freshness class", () => {
    const entry = auditEntry({
      scope: scopeOf("t-helpers"),
      auditId: "audit-1",
      subject: { kind: "goal", id: "goal-1" },
      action: "goal.revised",
      actor: personActor("boss"),
      at: now(4),
      reason: "priority change",
      details: { revisionNumber: 2 },
    });
    expect(entry.action).toBe("goal.revised");
    expect(entry.reason).toBe("priority change");
    expect(Object.hasOwn(entry, "freshness")).toBe(false);
  });
});

describe("in-memory query log", () => {
  it("append + get roundtrip; list is tenant-scoped and insertion-ordered", () => {
    const log = createInMemoryQueryLog();
    const a = scopeOf("tenant-a");
    const b = scopeOf("tenant-b");
    const first = okOf(
      log.appendQueryLog(a, {
        scope: a,
        queryId: "q-1",
        kind: "ask-about-subject",
        subject: { kind: "topic", id: "t-1" },
        askedBy: personActor("boss"),
        at: now(0),
        reason: "board review",
        classification: "evidenced",
      }),
    );
    expect(first.queryId).toBe("q-1");
    log.appendQueryLog(b, {
      scope: b,
      queryId: "q-2",
      kind: "situation",
      askedBy: personActor("boss"),
      at: now(1),
      reason: "standup",
    });
    expect(log.listQueryLogs(a)).toHaveLength(1);
    expect(log.listQueryLogs(b)).toHaveLength(1);
    expect(okOf(log.getQueryLog(a, "q-1")).classification).toBe("evidenced");
  });

  it("cross-tenant and missing lookups fail closed as a uniform not-found", () => {
    const log = createInMemoryQueryLog();
    const a = scopeOf("tenant-a");
    const b = scopeOf("tenant-b");
    log.appendQueryLog(a, {
      scope: a,
      queryId: "q-1",
      kind: "who-owns",
      subject: { kind: "goal", id: "goal-1" },
      askedBy: personActor("boss"),
      at: now(0),
      reason: "audit",
    });
    const foreign = log.getQueryLog(b, "q-1");
    const missing = log.getQueryLog(a, "nope");
    expect(foreign.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe("company-not-found");
    if (!missing.ok) expect(missing.error.code).toBe("company-not-found");
  });
});

describe("typed errors and vocabularies", () => {
  it("CompanyError carries its code and is recognized by isCompanyError", () => {
    const error = new CompanyError("company-invariant", "boom");
    expect(isCompanyError(error)).toBe(true);
    expect(isCompanyError(new Error("plain"))).toBe(false);
    expect(error.code).toBe("company-invariant");
  });

  it("the honesty vocabularies are closed and guarded", () => {
    expect(isKnownAnswerClassification("evidenced")).toBe(true);
    expect(isKnownAnswerClassification("certain")).toBe(false);
    expect(isKnownBlindSpotKind("stale-evidence")).toBe(true);
    expect(isKnownBlindSpotKind("covered")).toBe(false);
    expect(isKnownAttentionCriterion("horizon-elapsed")).toBe(true);
    expect(isKnownAttentionCriterion("horizon-overdue")).toBe(false);
  });
});
