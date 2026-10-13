/**
 * W014 proofs — proposal completeness (catalog acceptance clause a):
 * every governed proposal carries EVIDENCE (the derived gap embedded
 * verbatim with its citation chain), DEMAND (recurrence, affected
 * goals/missions, demanded capabilities, effort/metric signals — all
 * mechanical) and ALTERNATIVES (MANDATORY, typed, mechanically derived
 * from the marketplace surfaces — ranked catalog packages with mechanical
 * shortfalls, overlapping open recruitments, or the typed none-available
 * fallback). Plus: no fabricated gap can back a proposal (re-detection),
 * the validation matrix, conflicts, and tenant isolation.
 */
import { describe, expect, it } from "vitest";
import { buildEmergenceProposal, type EmergenceGap, type EmergenceProposal } from "../src/index.js";
import {
  LAB_SYSTEM,
  T0,
  emergenceFixture,
  errOf,
  okOf,
  proposeStandardRole,
  scopeOf,
  seedRecurringFailures,
  standardBundle,
  type EmergenceFixture,
} from "./emergence-helpers.js";
import { publishFixturePackage, REQUESTER, type MarketplaceFixture } from "./helpers.js";

const TENANT = scopeOf("tenant-a");
const QUERY = { now: T0 + 1000 };

function firstGap(fixture: EmergenceFixture, kind = "capability-shortfall"): EmergenceGap {
  const gaps = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
  const gap = gaps.find((candidate) => candidate.signalKind === kind);
  if (!gap) throw new Error(`test setup: no ${kind} gap seeded`);
  return gap;
}

describe("proposal completeness: evidence + demand + alternatives all present", () => {
  it("a role proposal embeds the gap VERBATIM (gapId, outcomeIds, signalKind, query) as its evidence", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    const proposal = okOf(proposeStandardRole(fixture, TENANT, gap.gapId));
    expect(proposal.kind).toBe("role");
    expect(proposal.state).toBe("proposed");
    expect(proposal.evidence.gap).toEqual(gap);
    expect(proposal.evidence.gap.outcomeIds).toEqual(["out-1", "out-2", "out-3"]);
    expect(proposal.alternatives.length).toBeGreaterThan(0);
    expect(proposal.alternativesRule).toBe("emergence-alternatives-v1");
  });

  it("the demand block is mechanical from the gap: recurrence, goals, missions, capabilities, effort, metric", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    const proposal = okOf(proposeStandardRole(fixture, TENANT, gap.gapId));
    expect(proposal.demand.recurrenceCount).toBe(gap.recurrenceCount);
    expect(proposal.demand.affectedGoalIds).toEqual(gap.affectedGoalIds);
    expect(proposal.demand.affectedMissionRefs).toEqual(gap.affectedMissionRefs);
    expect(proposal.demand.demandedCapabilities).toEqual(gap.demandedCapabilities);
    expect(proposal.demand.effortShareSum).toBe(gap.effortShareSum);
    const metricGap = firstGap(fixture, "metric-shortfall");
    const metricProposal = okOf(
      proposeStandardRole(fixture, TENANT, metricGap.gapId, "prop-metric"),
    );
    expect(metricProposal.demand.metricName).toBe("time-to-resolution");
  });

  it("the roleShape and package bundle are carried on their proposal kinds", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    const roleProposal = okOf(proposeStandardRole(fixture, TENANT, gap.gapId));
    expect(roleProposal.kind).toBe("role");
    if (roleProposal.kind !== "role") throw new Error("unreachable");
    expect(roleProposal.roleShape.roleDefinition.title).toBe("Verification Analyst");
    const packageProposal = okOf(
      fixture.emergence.propose(TENANT, {
        kind: "package",
        proposalId: "prop-pkg-1",
        gapId: gap.gapId,
        query: QUERY,
        bundle: standardBundle(),
        proposedBy: LAB_SYSTEM,
        provenance: { actor: LAB_SYSTEM, source: "system-captured", recordedAt: T0 + 500 },
        now: T0 + 500,
      }),
    );
    expect(packageProposal.kind).toBe("package");
    if (packageProposal.kind !== "package") throw new Error("unreachable");
    expect(packageProposal.bundle.capabilitySupplies).toEqual(standardBundle().capabilitySupplies);
    expect(packageProposal.bundle.processRequirements).toEqual(["two-person-review-before-payout"]);
    expect(packageProposal.bundle.workforceRequirements).toEqual([
      "one-verification-analyst-on-shift",
    ]);
  });
});

describe("alternatives: mandatory, typed, mechanical — from the marketplace surfaces", () => {
  it("published catalog packages become ranked alternatives with MECHANICAL shortfalls (uncovered list)", () => {
    const fixture = emergenceFixture();
    publishFixturePackage(fixture.marketplace, TENANT, "pkg-capability-search");
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    const proposal = okOf(proposeStandardRole(fixture, TENANT, gap.gapId));
    const catalogAlternatives = proposal.alternatives.filter(
      (alternative) => alternative.kind === "catalog-package",
    );
    expect(catalogAlternatives.length).toBeGreaterThan(0);
    const first = catalogAlternatives[0];
    if (!first || first.kind !== "catalog-package") throw new Error("unreachable");
    // The gap demands cap-analysis:3 + cap-communication:2. The published
    // capability package supplies cap-search:5 + cap-analysis:2 — the
    // mechanical shortfall must list BOTH demanded capabilities as uncovered
    // (cap-analysis at level 3 > supplied 2, cap-communication absent).
    expect(first.coverage.uncovered).toContain("cap-analysis (level 3 required, no supply)");
    expect(first.coverage.uncovered).toContain("cap-communication (level 2 required, no supply)");
    expect(first.shortfall).toContain("capabilityMatch");
    expect(first.packageId).toBe("pkg-capability-search");
  });

  it("a package that FULLY covers the demand ranks first with the covers-the-profile shortfall", () => {
    const fixture = emergenceFixture();
    publishFixturePackage(fixture.marketplace, TENANT, "pkg-agent-analyst");
    publishFixturePackage(fixture.marketplace, TENANT, "pkg-capability-full-coverage", {
      contents: {
        kind: "capability",
        supplies: [
          { supplyKind: "tool", capabilityId: "cap-analysis", level: 4, capacityPerPeriod: 8 },
          {
            supplyKind: "connector",
            capabilityId: "cap-communication",
            level: 3,
            capacityPerPeriod: 16,
          },
        ],
      },
    });
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    const proposal = okOf(proposeStandardRole(fixture, TENANT, gap.gapId));
    const catalogAlternatives = proposal.alternatives.filter(
      (alternative) => alternative.kind === "catalog-package",
    );
    expect(catalogAlternatives[0]?.packageId).toBe("pkg-capability-full-coverage");
    const first = catalogAlternatives[0];
    if (!first || first.kind !== "catalog-package") throw new Error("unreachable");
    expect(first.coverage.uncovered).toEqual([]);
    expect(first.coverage.capabilityMatch).toBe(1);
    expect(first.shortfall).toContain("covers the demanded profile");
  });

  it("an OPEN recruitment overlapping the demand is an alternative; a resolved one is not", () => {
    const fixture = emergenceFixture();
    okOf(
      fixture.marketplace.service.openRecruitment(TENANT, {
        requestId: "rec-open-1",
        demand: [{ capabilityId: "cap-analysis", minLevel: 2 }],
        requiredEvidenceKinds: ["test-suite"],
        requestedBy: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: T0 },
        now: T0,
      }),
    );
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    const proposal = okOf(proposeStandardRole(fixture, TENANT, gap.gapId));
    const recruitmentAlternatives = proposal.alternatives.filter(
      (alternative) => alternative.kind === "open-recruitment",
    );
    expect(recruitmentAlternatives.map((alternative) => alternative.requestId)).toEqual([
      "rec-open-1",
    ]);
    expect(recruitmentAlternatives[0]?.overlappingCapabilities).toEqual(["cap-analysis"]);
  });

  it("an empty catalog + no recruitments yields the typed none-available fallback (alternatives NEVER empty)", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    const proposal = okOf(proposeStandardRole(fixture, TENANT, gap.gapId));
    expect(proposal.alternatives).toHaveLength(1);
    const fallback = proposal.alternatives[0];
    if (!fallback || fallback.kind !== "none-available") throw new Error("unreachable");
    expect(fallback.scan.catalogCandidates).toBe(0);
    expect(fallback.scan.openRecruitments).toBe(0);
    expect(fallback.shortfall).toContain("no published package and no open recruitment");
  });

  it("a direct build with an EMPTY alternatives list is a typed refusal (alternatives are mandatory)", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    const built = errOf(
      buildEmergenceProposal({
        scope: TENANT,
        proposalId: "prop-bad-1",
        gap,
        alternatives: [],
        proposedBy: LAB_SYSTEM,
        provenance: { actor: LAB_SYSTEM, source: "system-captured", recordedAt: T0 },
        now: T0,
        kind: "role",
        roleShape: {
          roleDefinition: {
            title: "T",
            responsibilities: ["r"],
            skills: ["s"],
            authorityRequirements: ["a"],
          },
          requiredCapabilities: ["c"],
        },
      }),
    );
    expect(built.code).toBe("emergence-validation");
    expect(built.issues.map((issue) => issue.field)).toContain("alternatives");
  });
});

describe("no fabrication: the backing gap must be among the CURRENT derivations", () => {
  it("an invented gap id is a typed not-found refusal; nothing is stored or audited", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const auditBefore = fixture.marketplace.auditLedger.listAudit(TENANT).length;
    const refused = errOf(proposeStandardRole(fixture, TENANT, "gap-fabricated-0001"));
    expect(refused.code).toBe("emergence-not-found");
    expect(refused.message).toContain("gap-fabricated-0001");
    expect(fixture.proposals.listProposals(TENANT)).toEqual([]);
    expect(fixture.marketplace.auditLedger.listAudit(TENANT)).toHaveLength(auditBefore);
  });

  it("evidence removed after detection means the gap no longer backs a proposal (stale gaps refuse)", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    // A second fixture with the SAME proposal id but NO evidence: the gap
    // id is not among the (empty) current derivations there.
    const other = emergenceFixture();
    const refused = errOf(proposeStandardRole(other, TENANT, gap.gapId));
    expect(refused.code).toBe("emergence-not-found");
    // The original fixture still proposes fine (deterministic ids).
    expect(okOf(proposeStandardRole(fixture, TENANT, gap.gapId)).state).toBe("proposed");
  });
});

describe("validation matrix + conflicts", () => {
  it("role shape violations are typed validation refusals (title/responsibilities/skills/authority/capabilities)", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    const refused = errOf(
      fixture.emergence.propose(TENANT, {
        kind: "role",
        proposalId: "prop-bad-role",
        gapId: gap.gapId,
        query: QUERY,
        roleShape: {
          roleDefinition: {
            title: "",
            responsibilities: [],
            skills: [],
            authorityRequirements: [],
          },
          requiredCapabilities: [],
        },
        proposedBy: LAB_SYSTEM,
        provenance: { actor: LAB_SYSTEM, source: "system-captured", recordedAt: T0 },
        now: T0,
      }),
    );
    expect(refused.code).toBe("emergence-validation");
    const fields = refused.issues.map((issue) => issue.field);
    for (const expected of [
      "roleShape.roleDefinition.title",
      "roleShape.roleDefinition.responsibilities",
      "roleShape.roleDefinition.skills",
      "roleShape.roleDefinition.authorityRequirements",
      "roleShape.requiredCapabilities",
    ]) {
      expect(fields).toContain(expected);
    }
  });

  it("package bundle violations are typed validation refusals (supplies/process/workforce)", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    const refused = errOf(
      fixture.emergence.propose(TENANT, {
        kind: "package",
        proposalId: "prop-bad-pkg",
        gapId: gap.gapId,
        query: QUERY,
        bundle: { capabilitySupplies: [], processRequirements: [], workforceRequirements: [] },
        proposedBy: LAB_SYSTEM,
        provenance: { actor: LAB_SYSTEM, source: "system-captured", recordedAt: T0 },
        now: T0,
      }),
    );
    expect(refused.code).toBe("emergence-validation");
    const fields = refused.issues.map((issue) => issue.field);
    expect(fields).toContain("bundle.capabilitySupplies");
    expect(fields).toContain("bundle.processRequirements");
    expect(fields).toContain("bundle.workforceRequirements");
  });

  it("a malformed detection query refuses the proposal (typed validation)", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    const refused = errOf(proposeStandardRole(fixture, TENANT, gap.gapId, "prop-bad-query", -1));
    expect(refused.code).toBe("emergence-validation");
  });

  it("a duplicate proposalId is a typed conflict", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    okOf(proposeStandardRole(fixture, TENANT, gap.gapId, "prop-dup"));
    const refused = errOf(proposeStandardRole(fixture, TENANT, gap.gapId, "prop-dup"));
    expect(refused.code).toBe("emergence-conflict");
  });
});

describe("tenant isolation: foreign-tenant evidence never feeds a proposal", () => {
  it("tenant A proposals cite only tenant A evidence; tenant B sees none of it", () => {
    const fixture = emergenceFixture();
    const tenantB = scopeOf("tenant-b");
    seedRecurringFailures(fixture, TENANT, 3);
    seedRecurringFailures(fixture, tenantB, 2);
    const gap = firstGap(fixture);
    const proposal = okOf(proposeStandardRole(fixture, TENANT, gap.gapId));
    expect(proposal.evidence.gap.outcomeIds).toEqual(["out-1", "out-2", "out-3"]);
    // Tenant B: below threshold -> no gaps -> no proposal possible.
    expect(okOf(fixture.emergence.detectGaps(tenantB, QUERY))).toEqual([]);
    const refused = errOf(proposeStandardRole(fixture, tenantB, gap.gapId));
    expect(refused.code).toBe("emergence-not-found");
    expect(fixture.emergence.listProposals(tenantB)).toEqual([]);
  });

  it("getProposal is uniform for foreign and never-existing ids (no existence leaks)", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    okOf(proposeStandardRole(fixture, TENANT, gap.gapId, "prop-iso"));
    const tenantB = scopeOf("tenant-b");
    const foreign = errOf(fixture.emergence.getProposal(tenantB, "prop-iso"));
    const missing = errOf(fixture.emergence.getProposal(tenantB, "prop-never"));
    expect(foreign.code).toBe("emergence-not-found");
    expect(foreign.message).toBe(missing.message);
    expect(foreign.name).toBe(missing.name);
  });

  it("listProposals is tenant-scoped", () => {
    const fixture = emergenceFixture();
    const tenantB = scopeOf("tenant-b");
    seedRecurringFailures(fixture, TENANT, 3);
    const gap = firstGap(fixture);
    okOf(proposeStandardRole(fixture, TENANT, gap.gapId, "prop-list-a"));
    expect(fixture.emergence.listProposals(TENANT)).toHaveLength(1);
    expect(fixture.emergence.listProposals(tenantB)).toEqual([]);
  });
});

/** Compile-time fixture typing guards. */
export type { EmergenceFixture, EmergenceGap, EmergenceProposal, MarketplaceFixture };
