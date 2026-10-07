/**
 * Workforce recommendations (W005 acceptance): employment-impacting
 * recommendations preserve evidence and the human decision — evidence is
 * mandatory at proposal, only person actors may decide, decisions are
 * immutable, and inherently employment-impacting adjustments cannot be
 * proposed as non-impacting. No code path can auto-decide.
 */
import { describe, expect, it } from "vitest";
import { WORKFORCE_ADJUSTMENTS } from "../src/index.js";
import {
  errOf,
  kernel,
  now,
  okOf,
  personActor,
  provenance,
  scope,
  systemActor,
} from "./helpers.js";

const evidence = [{ kind: "observation" as const, id: "obs-workload-1" }];

function propose(
  k: ReturnType<typeof kernel>,
  s: ReturnType<typeof scope>,
  overrides: Record<string, unknown> = {},
) {
  return k.workforceRecommendations.proposeRecommendation(s, {
    recommendationId: "rec-1",
    adjustment: "agent-complement",
    subject: { kind: "person", id: "p-1" },
    rationale: "validation workload consistently exceeds capacity; agent assist closes the gap",
    evidenceRefs: evidence,
    employmentImpacting: true,
    proposedBy: systemActor("org-lab"),
    provenance: provenance(systemActor("org-lab"), 1),
    now: now(1),
    ...overrides,
  });
}

describe("workforce recommendations", () => {
  it("proposes advisory recommendations that stay pending with evidence retained", () => {
    const k = kernel();
    const s = scope("acme");
    const record = okOf(propose(k, s));
    expect(record.adjustment).toBe("agent-complement");
    expect(record.employmentImpacting).toBe(true);
    expect(record.decision.state).toBe("pending");
    expect(record.evidenceRefs).toEqual(evidence);
    expect(record.proposedBy.kind).toBe("system");
    const stored = okOf(k.workforceRecommendations.getRecommendation(s, "rec-1"));
    expect(stored.rationale).toContain("validation workload");
  });

  it("requires non-empty evidence for employment-impacting proposals", () => {
    const k = kernel();
    const s = scope("acme");
    const noEvidence = propose(k, s, { evidenceRefs: [] });
    expect(errOf(noEvidence).code).toBe("validation");
    expect(errOf(noEvidence).issues.map((i) => i.field)).toContain("evidenceRefs");
    expect(errOf(noEvidence).issues[0]?.problem).toContain("employment-impacting");

    const nonImpactingWithoutEvidence = propose(k, s, {
      employmentImpacting: false,
      evidenceRefs: [],
    });
    okOf(nonImpactingWithoutEvidence);
  });

  it("forbids un-flagging inherently employment-impacting adjustments", () => {
    const k = kernel();
    const s = scope("acme");
    for (const adjustment of ["reassignment", "hiring", "agent-replacement", "outsourcing"]) {
      const result = propose(k, s, {
        recommendationId: `rec-${adjustment}`,
        adjustment,
        employmentImpacting: false,
      });
      expect(errOf(result).code).toBe("validation");
      expect(errOf(result).issues.map((i) => i.field)).toContain("employmentImpacting");
    }
    const flagged = propose(k, s, {
      recommendationId: "rec-reassign-1",
      adjustment: "reassignment",
      employmentImpacting: true,
    });
    okOf(flagged);
    expect(WORKFORCE_ADJUSTMENTS).toEqual([
      "training",
      "reassignment",
      "hiring",
      "agent-complement",
      "agent-replacement",
      "automation",
      "outsourcing",
    ]);
  });

  it("never lets a system or agent actor decide (humans only)", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(propose(k, s));
    for (const decidedBy of [
      systemActor("org-lab"),
      { kind: "agent" as const, name: "agent-body-17" },
    ]) {
      const attempt = k.workforceRecommendations.decideRecommendation(s, {
        recommendationId: "rec-1",
        decision: "human-approved",
        decidedBy,
        reason: "auto-approved by pipeline",
        now: now(2),
      });
      expect(errOf(attempt).code).toBe("forbidden");
      expect(errOf(attempt).message).toContain("humans only");
    }
    const untouched = okOf(k.workforceRecommendations.getRecommendation(s, "rec-1"));
    expect(untouched.decision.state).toBe("pending");
  });

  it("records the human decision with decidedBy, reason and timestamp", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(propose(k, s));
    const decided = okOf(
      k.workforceRecommendations.decideRecommendation(s, {
        recommendationId: "rec-1",
        decision: "human-approved",
        decidedBy: personActor("p-manager"),
        reason: "approved for a 6-week pilot with weekly review",
        now: now(2),
      }),
    );
    expect(decided.decision.state).toBe("human-approved");
    expect(decided.decision.decidedBy?.kind).toBe("person");
    expect(decided.decision.decidedBy?.personId).toBe("p-manager" as never);
    expect(decided.decision.reason).toContain("6-week pilot");
    expect(decided.decision.decidedAt).toBe(now(2));
    expect(decided.evidenceRefs).toEqual(evidence);
    const entries = k.audit.queryAudit(s, { subject: { kind: "workforce", id: "rec-1" } });
    expect(entries.map((e) => e.action)).toEqual([
      "workforce.recommendation-proposed",
      "workforce.recommendation-decided",
    ]);
    expect(entries[1]?.actor.kind).toBe("person");
  });

  it("makes decisions immutable (re-deciding conflicts)", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(propose(k, s));
    okOf(
      k.workforceRecommendations.decideRecommendation(s, {
        recommendationId: "rec-1",
        decision: "human-rejected",
        decidedBy: personActor("p-manager"),
        reason: "not during the quarter close",
        now: now(2),
      }),
    );
    const flip = k.workforceRecommendations.decideRecommendation(s, {
      recommendationId: "rec-1",
      decision: "human-approved",
      decidedBy: personActor("p-manager"),
      reason: "changed my mind",
      now: now(3),
    });
    expect(errOf(flip).code).toBe("conflict");
    expect(errOf(flip).message).toContain("immutable");
  });

  it("validates unknown recommendations, decisions and missing reasons", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(propose(k, s));
    expect(
      errOf(
        k.workforceRecommendations.decideRecommendation(s, {
          recommendationId: "rec-404",
          decision: "human-approved",
          decidedBy: personActor("p-manager"),
          reason: "x",
          now: now(2),
        }),
      ).code,
    ).toBe("not-found");
    const badDecision = k.workforceRecommendations.decideRecommendation(s, {
      recommendationId: "rec-1",
      decision: "auto-approved" as "human-approved",
      decidedBy: personActor("p-manager"),
      reason: "x",
      now: now(2),
    });
    expect(errOf(badDecision).code).toBe("validation");
    const noReason = k.workforceRecommendations.decideRecommendation(s, {
      recommendationId: "rec-1",
      decision: "human-approved",
      decidedBy: personActor("p-manager"),
      reason: "",
      now: now(2),
    });
    expect(errOf(noReason).code).toBe("validation");
  });

  it("filters recommendations and isolates tenants", () => {
    const k = kernel();
    const acme = scope("acme");
    const other = scope("other");
    okOf(propose(k, acme));
    okOf(
      propose(k, acme, {
        recommendationId: "rec-2",
        adjustment: "training",
        employmentImpacting: false,
        evidenceRefs: [],
      }),
    );
    expect(k.workforceRecommendations.listRecommendations(acme)).toHaveLength(2);
    expect(
      k.workforceRecommendations.listRecommendations(acme, { employmentImpacting: true }),
    ).toHaveLength(1);
    expect(errOf(k.workforceRecommendations.getRecommendation(other, "rec-1")).code).toBe(
      "not-found",
    );
    expect(k.workforceRecommendations.listRecommendations(other)).toHaveLength(0);
  });
});
