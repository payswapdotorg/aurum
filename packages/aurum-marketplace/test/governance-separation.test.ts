/**
 * W011 ACCEPTANCE — the four separations, end-to-end (catalog:
 * "publication is separate from installation; installation separate from
 * activation; approval is separate from execution; tenant scope is
 * enforced" — tenant scope lives in tenant-scope.test.ts).
 *
 * Separation 1+2: a package CANNOT install while unpublished — typed
 * rejection in every pre-published state (draft / submitted / rejected).
 * Separation 2+3: a package CANNOT activate without an installation —
 * typed rejection for missing and uninstalled installations.
 * Separation 3+4: activation GRANTS NOTHING without the approval seam —
 * execution requests can be opened (proposing) but citing REQUIRES a
 * valid W002 citation; nothing executes inside the marketplace ever.
 */
import { describe, expect, it } from "vitest";
import { err, ok, type MarketplaceError, type PackageVersionContents } from "../src/index.js";
import {
  LAB_SYSTEM,
  PUBLISHER,
  REQUESTER,
  REVIEWER,
  errOf,
  installAndActivate,
  marketplaceFixture,
  okOf,
  publishFixturePackage,
  scopeOf,
  teachCitation,
  type MarketplaceFixture,
} from "./helpers.js";

const TENANT = scopeOf("tenant-a");

function draftOnly(
  fixture: MarketplaceFixture,
  packageId: string,
  contents: PackageVersionContents,
) {
  okOf(
    fixture.service.draftPackage(TENANT, {
      packageId,
      kind: contents.kind,
      summary: "draft only fixture",
      version: 1,
      contents,
      changelog: "draft fixture changelog",
      evidenceRefs: [{ evidenceKind: "test-suite", ref: "evidence/x" }],
      publisher: PUBLISHER,
      provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: 1 },
      now: 1,
    }),
  );
}

describe("separation 1+2: publication is separate from installation", () => {
  it("installing a DRAFT package is refused with the typed marketplace-unpublished code", () => {
    const fixture = marketplaceFixture();
    draftOnly(fixture, "pkg-draft", {
      kind: "capability",
      supplies: [{ supplyKind: "tool", capabilityId: "cap-x", level: 1, capacityPerPeriod: 1 }],
    });
    const result = fixture.service.installPackage(TENANT, {
      installationId: "inst-1",
      packageId: "pkg-draft",
      version: 1,
      installedBy: REQUESTER,
      provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 2 },
      now: 2,
    });
    const error = errOf(result);
    expect(error.code).toBe("marketplace-unpublished");
    expect(error.message).toContain("pkg-draft");
  });

  it("installing a SUBMITTED (in-review) package is refused the same way", () => {
    const fixture = marketplaceFixture();
    const contents: PackageVersionContents = {
      kind: "capability",
      supplies: [{ supplyKind: "tool", capabilityId: "cap-x", level: 1, capacityPerPeriod: 1 }],
    };
    draftOnly(fixture, "pkg-submitted", contents);
    okOf(
      fixture.service.submitPackageVersion(TENANT, {
        packageId: "pkg-submitted",
        version: 1,
        actor: PUBLISHER,
        reason: "submit",
        now: 2,
      }),
    );
    const result = fixture.service.installPackage(TENANT, {
      installationId: "inst-1",
      packageId: "pkg-submitted",
      version: 1,
      installedBy: REQUESTER,
      provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 3 },
      now: 3,
    });
    expect(errOf(result).code).toBe("marketplace-unpublished");
  });

  it("installing a REJECTED package is refused the same way", () => {
    const fixture = marketplaceFixture();
    const contents: PackageVersionContents = {
      kind: "capability",
      supplies: [{ supplyKind: "tool", capabilityId: "cap-x", level: 1, capacityPerPeriod: 1 }],
    };
    draftOnly(fixture, "pkg-rejected", contents);
    okOf(
      fixture.service.submitPackageVersion(TENANT, {
        packageId: "pkg-rejected",
        version: 1,
        actor: PUBLISHER,
        reason: "submit",
        now: 2,
      }),
    );
    okOf(
      fixture.service.reviewPublication(TENANT, {
        packageId: "pkg-rejected",
        version: 1,
        actor: REVIEWER,
        reason: "reject",
        now: 3,
        decision: "rejected",
      }),
    );
    const result = fixture.service.installPackage(TENANT, {
      installationId: "inst-1",
      packageId: "pkg-rejected",
      version: 1,
      installedBy: REQUESTER,
      provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 4 },
      now: 4,
    });
    expect(errOf(result).code).toBe("marketplace-unpublished");
  });

  it("installing a PUBLISHED package succeeds — the only legal install state", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const installation = okOf(
      fixture.service.installPackage(TENANT, {
        installationId: "inst-1",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: REQUESTER,
        configuration: { mode: "test" },
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 10 },
        now: 10,
      }),
    );
    expect(installation.state).toBe("installed");
    expect(installation.installedVersion).toBe(1);
    expect(installation.configuration.length).toBe(1);
  });

  it("publication transitions are audited separately from installation transitions", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    installAndActivate(fixture, TENANT, "pkg-agent-analyst");
    const publicationActions = fixture.auditLedger
      .listAudit(TENANT)
      .map((entry) => entry.action)
      .filter(
        (action) =>
          action.startsWith("marketplace.package-drafted") ||
          action.startsWith("marketplace.package-submitted") ||
          action.startsWith("marketplace.package-published"),
      );
    const installationActions = fixture.auditLedger
      .listAudit(TENANT)
      .filter((entry) => entry.action === "marketplace.package-installed");
    expect(publicationActions.length).toBe(3);
    expect(installationActions.length).toBe(1);
    // No audit entry mixes both machines' subject kinds.
    for (const entry of installationActions) {
      expect(entry.subject.kind).toBe("installation");
    }
    for (const entry of fixture.auditLedger.listAudit(TENANT)) {
      if (entry.action === "marketplace.package-published") {
        expect(entry.subject.kind).toBe("package-version");
      }
    }
  });
});

describe("separation 2+3: installation is separate from activation", () => {
  it("activating with NO installation record is refused as a uniform not-found (no existence leaks)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    // No install happened — activation must refuse. A missing installation
    // and a foreign-tenant installation are indistinguishable.
    const result = fixture.service.activatePackage(TENANT, {
      activationId: "act-1",
      installationId: "inst-missing",
      actorRefs: ["actor-1"],
      grants: [{ grantKind: "capability", ref: "cap-analysis" }],
      activatedBy: REQUESTER,
      provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 10 },
      now: 10,
    });
    const error = errOf(result);
    expect(error.code).toBe("marketplace-not-found");
    // The domain-level not-installed code fires for existing-but-uninstalled:
    expect(error.code).not.toBe("marketplace-invariant");
  });

  it("activating an UNINSTALLED installation is refused the same way", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    okOf(
      fixture.service.installPackage(TENANT, {
        installationId: "inst-1",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 10 },
        now: 10,
      }),
    );
    okOf(
      fixture.service.uninstallInstallation(TENANT, {
        installationId: "inst-1",
        actor: REQUESTER,
        reason: "no longer needed",
        now: 11,
      }),
    );
    const result = fixture.service.activatePackage(TENANT, {
      activationId: "act-1",
      installationId: "inst-1",
      actorRefs: ["actor-1"],
      grants: [{ grantKind: "capability", ref: "cap-analysis" }],
      activatedBy: REQUESTER,
      provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 12 },
      now: 12,
    });
    expect(errOf(result).code).toBe("marketplace-not-installed");
  });

  it("activation DECLARES what the package may touch (grants) and pins the installed version", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const { activationId } = installAndActivate(fixture, TENANT, "pkg-agent-analyst");
    const activation = okOf(fixture.service.getActivation(TENANT, activationId));
    expect(activation.grants).toEqual([{ grantKind: "capability", ref: "cap-analysis", level: 4 }]);
    expect(activation.actorRefs).toEqual(["actor-ops-1"]);
    expect(activation.version).toBe(1);
    expect(activation.packageKind).toBe("agent");
  });

  it("a duplicate ACTIVE activation for the same installation+target is a typed conflict", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const { installationId } = installAndActivate(fixture, TENANT, "pkg-agent-analyst");
    const result = fixture.service.activatePackage(TENANT, {
      activationId: "act-dup",
      installationId,
      actorRefs: ["actor-ops-1"],
      grants: [{ grantKind: "capability", ref: "cap-analysis", level: 4 }],
      activatedBy: REQUESTER,
      provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 200 },
      now: 200,
    });
    expect(errOf(result).code).toBe("marketplace-conflict");
  });
});

describe("separation 3+4: activation grants nothing; approval is separate from execution", () => {
  it("requesting execution use only PROPOSES — a request record, nothing else", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const { activationId } = installAndActivate(fixture, TENANT, "pkg-agent-analyst");
    const request = okOf(
      fixture.service.requestExecutionUse(TENANT, {
        requestId: "exec-1",
        activationId,
        consumerRef: "plan-47",
        purpose: "run analysis step",
        requestedBy: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 300 },
        now: 300,
      }),
    );
    expect(request.state).toBe("requested");
    expect(request.citation).toBeUndefined();
    // Nothing else appeared: no execution, no dispatch, nothing ran.
    expect(fixture.authority.assertions().length).toBe(0);
  });

  it("citing execution approval WITHOUT a valid W002 citation is refused and nothing changes", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const { activationId } = installAndActivate(fixture, TENANT, "pkg-agent-analyst");
    okOf(
      fixture.service.requestExecutionUse(TENANT, {
        requestId: "exec-1",
        activationId,
        consumerRef: "plan-47",
        purpose: "run analysis step",
        requestedBy: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 300 },
        now: 300,
      }),
    );
    const result = fixture.service.citeExecutionApproval(TENANT, {
      requestId: "exec-1",
      citation: { actionId: "action-unknown", approvedBy: REQUESTER, approvedAt: 301 },
      now: 301,
    });
    const error = errOf(result);
    expect(error.code).toBe("marketplace-unauthorized");
    // The request is UNCHANGED — the dispose never happened.
    const request = okOf(fixture.service.getExecutionRequest(TENANT, "exec-1"));
    expect(request.state).toBe("requested");
    expect(request.citation).toBeUndefined();
  });

  it("citing execution approval WITH a valid W002 citation records the citation — and executes nothing", () => {
    const fixture = marketplaceFixture();
    teachCitation(fixture.authority, TENANT.tenantId, "action-77");
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const { activationId } = installAndActivate(fixture, TENANT, "pkg-agent-analyst");
    okOf(
      fixture.service.requestExecutionUse(TENANT, {
        requestId: "exec-1",
        activationId,
        consumerRef: "plan-47",
        purpose: "run analysis step",
        requestedBy: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 300 },
        now: 300,
      }),
    );
    const cited = okOf(
      fixture.service.citeExecutionApproval(TENANT, {
        requestId: "exec-1",
        citation: { actionId: "action-77", approvedBy: REQUESTER, approvedAt: 301 },
        now: 301,
      }),
    );
    expect(cited.state).toBe("cited");
    expect(cited.citation?.actionId).toBe("action-77");
    // The authority seam was asserted exactly once — the marketplace
    // recorded the dispose; it never executed anything itself.
    const assertions = fixture.authority.assertions();
    expect(assertions.length).toBe(1);
    expect(assertions[0]?.accepted).toBe(true);
  });

  it("citing against a DEACTIVATED activation is refused (lifecycle guard)", () => {
    const fixture = marketplaceFixture();
    teachCitation(fixture.authority, TENANT.tenantId, "action-77");
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const { activationId } = installAndActivate(fixture, TENANT, "pkg-agent-analyst");
    okOf(
      fixture.service.requestExecutionUse(TENANT, {
        requestId: "exec-1",
        activationId,
        consumerRef: "plan-47",
        purpose: "run analysis step",
        requestedBy: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 300 },
        now: 300,
      }),
    );
    okOf(
      fixture.service.deactivateActivation(TENANT, {
        activationId,
        actor: REQUESTER,
        reason: "rotation",
        now: 305,
      }),
    );
    const result = fixture.service.citeExecutionApproval(TENANT, {
      requestId: "exec-1",
      citation: { actionId: "action-77", approvedBy: REQUESTER, approvedAt: 306 },
      now: 306,
    });
    expect(errOf(result).code).toBe("marketplace-lifecycle");
  });

  it("publication review by a NON-PERSON actor is refused (human-governed review)", () => {
    const fixture = marketplaceFixture();
    const contents: PackageVersionContents = {
      kind: "capability",
      supplies: [{ supplyKind: "tool", capabilityId: "cap-x", level: 1, capacityPerPeriod: 1 }],
    };
    draftOnly(fixture, "pkg-lab", contents);
    okOf(
      fixture.service.submitPackageVersion(TENANT, {
        packageId: "pkg-lab",
        version: 1,
        actor: PUBLISHER,
        reason: "submit",
        now: 2,
      }),
    );
    // The Lab system actor may NOT review publications.
    const result = fixture.service.reviewPublication(TENANT, {
      packageId: "pkg-lab",
      version: 1,
      actor: LAB_SYSTEM,
      reason: "lab wants to self-publish",
      now: 3,
      decision: "published",
    });
    expect(errOf(result).code).toBe("marketplace-unauthorized");
    const stillSubmitted = okOf(fixture.service.getPackageVersion(TENANT, "pkg-lab", 1));
    expect(stillSubmitted.publication.state).toBe("submitted");
  });

  it("an execution citation approved by a non-person actor is refused (W002 authority law)", () => {
    const fixture = marketplaceFixture();
    teachCitation(fixture.authority, TENANT.tenantId, "action-77");
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const { activationId } = installAndActivate(fixture, TENANT, "pkg-agent-analyst");
    okOf(
      fixture.service.requestExecutionUse(TENANT, {
        requestId: "exec-1",
        activationId,
        consumerRef: "plan-47",
        purpose: "run analysis step",
        requestedBy: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 300 },
        now: 300,
      }),
    );
    const result = fixture.service.citeExecutionApproval(TENANT, {
      requestId: "exec-1",
      citation: { actionId: "action-77", approvedBy: LAB_SYSTEM, approvedAt: 301 },
      now: 301,
    });
    expect(errOf(result).code).toBe("marketplace-unauthorized");
  });
});

describe("execution NEVER happens inside the marketplace (runtime proof)", () => {
  it("the full governance walk produces records only — no execution-shaped side effects", () => {
    const fixture = marketplaceFixture();
    teachCitation(fixture.authority, TENANT.tenantId, "action-77");
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const { installationId, activationId } = installAndActivate(
      fixture,
      TENANT,
      "pkg-agent-analyst",
    );
    // Every marketplace operation that exists for this fixture:
    okOf(
      fixture.service.requestExecutionUse(TENANT, {
        requestId: "exec-1",
        activationId,
        consumerRef: "plan-47",
        purpose: "run analysis step",
        requestedBy: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 300 },
        now: 300,
      }),
    );
    const cited = okOf(
      fixture.service.citeExecutionApproval(TENANT, {
        requestId: "exec-1",
        citation: { actionId: "action-77", approvedBy: REQUESTER, approvedAt: 301 },
        now: 301,
      }),
    );
    // The terminal record is a CITATION — the W009/W006 planes consume it
    // through their own approval seams. Nothing ran: the only state that
    // exists is governance records.
    expect(cited.state).toBe("cited");
    const installations = fixture.service.listInstallations(TENANT);
    expect(installations.length).toBe(1);
    const activations = fixture.service.listActivations(TENANT);
    expect(activations.length).toBe(1);
    // The authority seam saw exactly ONE assertion (the cite) — it was
    // never asked to run anything.
    expect(fixture.authority.assertions().length).toBe(1);
  });

  it("the registration seam is only called through recruitment resolution (never directly by governance)", () => {
    const fixture = marketplaceFixture();
    teachCitation(fixture.authority, TENANT.tenantId, "action-77");
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    installAndActivate(fixture, TENANT, "pkg-agent-analyst");
    // Governance + execution walks never touch the workforce seam.
    expect(fixture.registration.allRecords().length).toBe(0);
  });
});
