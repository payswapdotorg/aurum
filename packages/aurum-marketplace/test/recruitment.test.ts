/**
 * W011 proofs — the recruitment lifecycle: deterministic ranking with
 * inspectable criteria; ranking only considers PUBLISHED versions;
 * resolution requires the W002 authority citation (PROPOSE/DISPOSE);
 * installation+activation are SEQUENCED separate transitions; the W005
 * registration is BY REFERENCE (never a record copy); resolved/cancelled
 * are terminal.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RECRUITMENT_WEIGHTS, populateDeterministicCatalog, createInMemoryMarketplaceCatalogStore, type MarketplaceService } from "../src/index.js";
import {
  INSTALLER,
  REQUESTER,
  RESOLVER,
  errOf,
  marketplaceFixture,
  okOf,
  scopeOf,
  teachCitation,
  type MarketplaceFixture,
} from "./helpers.js";

const TENANT = scopeOf("tenant-a");

function openStandardRequest(
  service: MarketplaceService,
  requestId = "rec-1",
  now = 1000,
  overrides: Record<string, unknown> = {},
) {
  return service.openRecruitment(TENANT, {
    requestId,
    demand: [{ capabilityId: "cap-analysis", minLevel: 2 }],
    requiredEvidenceKinds: ["test-suite"],
    requestedBy: REQUESTER,
    provenance: { actor: REQUESTER, source: "system-captured", recordedAt: now },
    now,
    ...overrides,
  });
}

describe("recruitment ranking: determinism + inspectability", () => {
  function seededFixture(): MarketplaceFixture {
    const fixture = marketplaceFixture();
    populateDeterministicCatalog(fixture.catalogStore, TENANT);
    return fixture;
  }

  it("the same request against the same catalog produces the IDENTICAL ranking (repeated)", () => {
    const fixture = seededFixture();
    const first = okOf(openStandardRequest(fixture.service, "rec-1"));
    const second = okOf(openStandardRequest(fixture.service, "rec-2"));
    const view = okOf(fixture.service.rankedCandidates(TENANT, "rec-1"));
    expect(first.proposal).toEqual(second.proposal);
    expect(view).toEqual(first.proposal);
  });

  it("two independently-built fixtures produce the identical ranking (cross-fixture determinism)", () => {
    const fixtureA = seededFixture();
    const fixtureB = seededFixture();
    const rankingA = okOf(openStandardRequest(fixtureA.service, "rec-1")).proposal;
    const rankingB = okOf(openStandardRequest(fixtureB.service, "rec-1")).proposal;
    expect(rankingA).toEqual(rankingB);
  });

  it("every ranked candidate carries its raw criteria, weights and weighted score (inspectability)", () => {
    const fixture = seededFixture();
    const proposal = okOf(openStandardRequest(fixture.service)).proposal;
    expect(proposal.length).toBeGreaterThan(0);
    for (const candidate of proposal) {
      expect(candidate.criteria.capabilityMatch).toBeGreaterThanOrEqual(0);
      expect(candidate.criteria.capabilityMatch).toBeLessThanOrEqual(1);
      expect(candidate.criteria.evidenceStrength).toBeGreaterThanOrEqual(0);
      expect(candidate.criteria.versionMaturity).toBeGreaterThan(0);
      expect(candidate.criteria.scopeDiscipline).toBeGreaterThanOrEqual(0);
      // The weighted score is EXACTLY the weighted sum of the criteria.
      const expected =
        candidate.criteria.capabilityMatch * DEFAULT_RECRUITMENT_WEIGHTS.capabilityMatch +
        candidate.criteria.evidenceStrength * DEFAULT_RECRUITMENT_WEIGHTS.evidenceStrength +
        candidate.criteria.versionMaturity * DEFAULT_RECRUITMENT_WEIGHTS.versionMaturity +
        candidate.criteria.scopeDiscipline * DEFAULT_RECRUITMENT_WEIGHTS.scopeDiscipline;
      expect(Math.abs(candidate.weightedScore - Math.round(expected * 10000) / 10000)).toBeLessThan(1e-9);
    }
    // The weights themselves are recorded on the request (inspectable).
    const request = okOf(fixture.service.getRecruitment(TENANT, "rec-1"));
    expect(request.weights).toEqual(DEFAULT_RECRUITMENT_WEIGHTS);
  });

  it("ties are broken by packageId ascending (codepoint order) — deterministic", () => {
    const fixture = seededFixture();
    // Demand satisfied by NOBODY: all candidates tie at capabilityMatch 0
    // (evidence + maturity + discipline still differ). Build a demand that
    // levels the field to prove the tiebreak rules the order.
    const proposal = okOf(
      openStandardRequest(fixture.service, "rec-tie", 1000, {
        demand: [{ capabilityId: "cap-nonexistent", minLevel: 5 }],
        requiredEvidenceKinds: [],
      }),
    ).proposal;
    expect(proposal.length).toBeGreaterThan(1);
    for (let index = 1; index < proposal.length; index += 1) {
      const previous = proposal[index - 1]!;
      const current = proposal[index]!;
      const scoreOrder = previous.weightedScore > current.weightedScore;
      const tiebreak = previous.weightedScore === current.weightedScore && previous.packageId < current.packageId;
      expect(scoreOrder || tiebreak).toBe(true);
    }
  });

  it("unpublished versions NEVER appear in the ranking", () => {
    const fixture = seededFixture();
    // Draft a strictly-better package without publishing it.
    okOf(
      fixture.service.draftPackage(TENANT, {
        packageId: "pkg-super-secret",
        kind: "capability",
        summary: "unpublished super package",
        version: 1,
        contents: {
          kind: "capability",
          supplies: [
            { supplyKind: "tool", capabilityId: "cap-analysis", level: 5, capacityPerPeriod: 999 },
          ],
        },
        changelog: "draft",
        evidenceRefs: [{ evidenceKind: "test-suite", ref: "evidence/secret" }],
        publisher: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 1 },
        now: 1,
      }),
    );
    const proposal = okOf(openStandardRequest(fixture.service)).proposal;
    expect(proposal.some((candidate) => candidate.packageId === "pkg-super-secret")).toBe(false);
  });

  it("excluded package ids are filtered deterministically", () => {
    const fixture = seededFixture();
    const proposal = okOf(
      openStandardRequest(fixture.service, "rec-ex", 1000, {
        excludedPackageIds: ["pkg-capability-search-connector"],
      }),
    ).proposal;
    expect(proposal.some((candidate) => candidate.packageId === "pkg-capability-search-connector")).toBe(false);
  });

  it("targetPackageKinds filters the candidate field (e.g. role packages only)", () => {
    const fixture = seededFixture();
    const proposal = okOf(
      openStandardRequest(fixture.service, "rec-role", 1000, {
        targetPackageKinds: ["role"],
      }),
    ).proposal;
    expect(proposal.length).toBeGreaterThan(0);
    expect(proposal.every((candidate) => candidate.kind === "role")).toBe(true);
  });
});

describe("recruitment resolution: propose/dispose + sequenced landing", () => {
  function resolvedFixture(): MarketplaceFixture {
    const fixture = marketplaceFixture();
    populateDeterministicCatalog(fixture.catalogStore, TENANT);
    teachCitation(fixture.authority, TENANT.tenantId, "action-55");
    okOf(openStandardRequest(fixture.service));
    return fixture;
  }

  it("resolution REQUIRES a valid W002 citation — refusal leaves everything untouched", () => {
    const fixture = marketplaceFixture();
    populateDeterministicCatalog(fixture.catalogStore, TENANT);
    okOf(openStandardRequest(fixture.service));
    const result = fixture.service.resolveRecruitment(TENANT, {
      requestId: "rec-1",
      chosenPackageId: "pkg-agent-analyst",
      installationId: "inst-1",
      activationId: "act-1",
      actorRefs: ["actor-ops-1"],
      grants: [{ grantKind: "capability", ref: "cap-analysis", level: 4 }],
      citation: { actionId: "action-not-taught", approvedBy: RESOLVER, approvedAt: 2000 },
      resolvedBy: RESOLVER,
      now: 2000,
    });
    expect(errOf(result).code).toBe("marketplace-unauthorized");
    // The request is still open; nothing landed anywhere.
    const request = okOf(fixture.service.getRecruitment(TENANT, "rec-1"));
    expect(request.state).toBe("open");
    expect(fixture.service.listInstallations(TENANT).length).toBe(0);
    expect(fixture.service.listActivations(TENANT).length).toBe(0);
    expect(fixture.registration.allRecords().length).toBe(0);
  });

  it("resolution lands install + activate + register as SEPARATE records with separate audit entries", () => {
    const fixture = resolvedFixture();
    const resolved = okOf(
      fixture.service.resolveRecruitment(TENANT, {
        requestId: "rec-1",
        chosenPackageId: "pkg-agent-analyst",
        installationId: "inst-1",
        activationId: "act-1",
        actorRefs: ["actor-ops-1"],
        grants: [{ grantKind: "capability", ref: "cap-analysis", level: 4 }],
        citation: { actionId: "action-55", approvedBy: RESOLVER, approvedAt: 2000 },
        resolvedBy: RESOLVER,
        now: 2000,
      }),
    );
    expect(resolved.state).toBe("resolved");
    expect(resolved.resolution?.chosenPackageId).toBe("pkg-agent-analyst");
    expect(resolved.resolution?.installationId).toBe("inst-1");
    expect(resolved.resolution?.activationId).toBe("act-1");
    // Machine 2 + machine 3 records exist SEPARATELY:
    const installation = okOf(fixture.service.getInstallation(TENANT, "inst-1"));
    expect(installation.state).toBe("installed");
    expect(installation.installedVersion).toBe(1);
    const activation = okOf(fixture.service.getActivation(TENANT, "act-1"));
    expect(activation.state).toBe("activated");
    expect(activation.installationId).toBe("inst-1");
    // The audit trail shows each transition separately:
    const actions = fixture.auditLedger.listAudit(TENANT).map((entry) => entry.action);
    expect(actions).toContain("marketplace.package-installed");
    expect(actions).toContain("marketplace.package-activated");
    expect(actions).toContain("marketplace.recruitment-registered");
    expect(actions).toContain("marketplace.recruitment-resolved");
  });

  it("the W005 registration is BY REFERENCE — no package contents ever copied", () => {
    const fixture = resolvedFixture();
    okOf(
      fixture.service.resolveRecruitment(TENANT, {
        requestId: "rec-1",
        chosenPackageId: "pkg-agent-analyst",
        installationId: "inst-1",
        activationId: "act-1",
        actorRefs: ["actor-ops-1"],
        grants: [{ grantKind: "capability", ref: "cap-analysis", level: 4 }],
        citation: { actionId: "action-55", approvedBy: RESOLVER, approvedAt: 2000 },
        resolvedBy: RESOLVER,
        now: 2000,
      }),
    );
    const registrations = fixture.registration.allRecords();
    expect(registrations.length).toBe(1);
    const registration = registrations[0]!;
    expect(registration.packageRef).toBe("pkg-agent-analyst");
    expect(registration.installationRef).toBe("inst-1");
    expect(registration.requestRef).toBe("rec-1");
    // BY-REFERENCE LAW: no bodyTemplate, no changelog, no evidenceRefs, no
    // permittedCapabilities list on the registration record:
    const serialized = JSON.stringify(registration);
    expect(serialized).not.toContain("bodyTemplate");
    expect(serialized).not.toContain("permittedCapabilities");
    expect(serialized).not.toContain("requiredBindings");
    expect(serialized).not.toContain("evidence/");
  });

  it("resolving with a package NOT in the ranked proposal is refused", () => {
    const fixture = resolvedFixture();
    const result = fixture.service.resolveRecruitment(TENANT, {
      requestId: "rec-1",
      chosenPackageId: "pkg-not-in-catalog",
      installationId: "inst-1",
      activationId: "act-1",
      actorRefs: ["actor-ops-1"],
      grants: [{ grantKind: "capability", ref: "cap-analysis" }],
      citation: { actionId: "action-55", approvedBy: RESOLVER, approvedAt: 2000 },
      resolvedBy: RESOLVER,
      now: 2000,
    });
    const error = errOf(result);
    expect(error.code).toBe("marketplace-validation");
    expect(error.issues[0]?.field).toBe("chosenPackageId");
  });

  it("RESOLVED is terminal — no second resolution, no cancel", () => {
    const fixture = resolvedFixture();
    const resolution = {
      requestId: "rec-1",
      chosenPackageId: "pkg-agent-analyst",
      installationId: "inst-1",
      activationId: "act-1",
      actorRefs: ["actor-ops-1"],
      grants: [{ grantKind: "capability", ref: "cap-analysis", level: 4 }],
      citation: { actionId: "action-55", approvedBy: RESOLVER, approvedAt: 2000 },
      resolvedBy: RESOLVER,
      now: 2000,
    };
    okOf(fixture.service.resolveRecruitment(TENANT, resolution));
    const second = fixture.service.resolveRecruitment(TENANT, { ...resolution, installationId: "inst-2", activationId: "act-2" });
    expect(errOf(second).code).toBe("marketplace-conflict");
    const cancelled = fixture.service.cancelRecruitment(TENANT, {
      requestId: "rec-1",
      actor: REQUESTER,
      reason: "too late",
      now: 3000,
    });
    expect(errOf(cancelled).code).toBe("marketplace-lifecycle");
  });

  it("cancel resolves nothing: open -> cancelled, no install/activation/registration", () => {
    const fixture = marketplaceFixture();
    populateDeterministicCatalog(fixture.catalogStore, TENANT);
    okOf(openStandardRequest(fixture.service));
    const cancelled = okOf(
      fixture.service.cancelRecruitment(TENANT, {
        requestId: "rec-1",
        actor: REQUESTER,
        reason: "need vanished",
        now: 2000,
      }),
    );
    expect(cancelled.state).toBe("cancelled");
    expect(fixture.service.listInstallations(TENANT).length).toBe(0);
    expect(fixture.registration.allRecords().length).toBe(0);
  });

  it("role packages register through the ROLE seam; agent packages through the ACTOR seam", () => {
    const fixture = marketplaceFixture();
    populateDeterministicCatalog(fixture.catalogStore, TENANT);
    teachCitation(fixture.authority, TENANT.tenantId, "action-55");
    okOf(
      openStandardRequest(fixture.service, "rec-role", 1000, {
        targetPackageKinds: ["role"],
      }),
    );
    okOf(
      fixture.service.resolveRecruitment(TENANT, {
        requestId: "rec-role",
        chosenPackageId: "pkg-role-ops-analyst",
        installationId: "inst-role",
        activationId: "act-role",
        actorRefs: ["actor-ops-9"],
        grants: [{ grantKind: "capability", ref: "cap-analysis", level: 3 }],
        citation: { actionId: "action-55", approvedBy: RESOLVER, approvedAt: 2000 },
        resolvedBy: RESOLVER,
        now: 2000,
      }),
    );
    const registrations = fixture.registration.allRecords();
    expect(registrations.length).toBe(1);
    expect(registrations[0]?.title).toBe("Operations Analyst");
    expect(registrations[0]?.requiredCapabilities).toEqual(["cap-analysis", "cap-communication"]);
    // And the agent path (default request) lands the actor seam:
    okOf(openStandardRequest(fixture.service, "rec-agent", 1100));
    teachCitation(fixture.authority, TENANT.tenantId, "action-56");
    okOf(
      fixture.service.resolveRecruitment(TENANT, {
        requestId: "rec-agent",
        chosenPackageId: "pkg-agent-analyst",
        installationId: "inst-agent",
        activationId: "act-agent",
        actorRefs: ["actor-ops-1"],
        grants: [{ grantKind: "capability", ref: "cap-analysis", level: 4 }],
        citation: { actionId: "action-56", approvedBy: RESOLVER, approvedAt: 2200 },
        resolvedBy: RESOLVER,
        now: 2200,
      }),
    );
    expect(fixture.registration.allRecords().length).toBe(2);
    expect(fixture.registration.allRecords()[1]?.actorKind).toBe("agent");
  });

  it("recruitment never needs the INSTALLER identity — the resolver disposes, install/activate cite the resolver", () => {
    const fixture = resolvedFixture();
    okOf(
      fixture.service.resolveRecruitment(TENANT, {
        requestId: "rec-1",
        chosenPackageId: "pkg-agent-analyst",
        installationId: "inst-1",
        activationId: "act-1",
        actorRefs: ["actor-ops-1"],
        grants: [{ grantKind: "capability", ref: "cap-analysis", level: 4 }],
        citation: { actionId: "action-55", approvedBy: RESOLVER, approvedAt: 2000 },
        resolvedBy: RESOLVER,
        now: 2000,
      }),
    );
    const installation = okOf(fixture.service.getInstallation(TENANT, "inst-1"));
    expect(installation.installedBy).toEqual(RESOLVER);
    expect(INSTALLER.kind).toBe("person"); // sanity: identities stay distinct
  });

  it("invalid recruitment requests are refused with typed issues", () => {
    const fixture = marketplaceFixture();
    const result = fixture.service.openRecruitment(TENANT, {
      requestId: "",
      demand: [],
      requiredEvidenceKinds: "not-an-array",
      requestedBy: REQUESTER,
      provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 1 },
      now: 1,
    } as unknown as Parameters<typeof fixture.service.openRecruitment>[1]);
    const error = errOf(result);
    expect(error.code).toBe("marketplace-validation");
    const fields = error.issues.map((issue) => issue.field);
    expect(fields).toContain("requestId");
    expect(fields).toContain("demand");
  });
});

describe("deterministic catalog double", () => {
  it("populates four published packages of all four kinds through the REAL publication machine", () => {
    const store = createInMemoryMarketplaceCatalogStore();
    populateDeterministicCatalog(store, TENANT);
    const versions = store.listVersions(TENANT);
    expect(versions.length).toBe(4);
    expect(versions.every((version) => version.publication.state === "published")).toBe(true);
    const kinds = versions.map((version) => version.contents.kind).sort();
    expect(kinds).toEqual(["agent", "capability", "extension", "role"]);
  });

  it("is tenant-scoped: populating tenant A leaves tenant B's catalog empty", () => {
    const store = createInMemoryMarketplaceCatalogStore();
    populateDeterministicCatalog(store, TENANT);
    expect(store.listVersions(scopeOf("tenant-b")).length).toBe(0);
  });
});
