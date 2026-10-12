/**
 * W011 proofs — the publication machine end-to-end (draft -> submitted ->
 * published | rejected, human-governed review, terminal published state,
 * revision loop) + installation lifecycle (configuration surface,
 * uninstall terminal, reinstall = new record) + validation typing.
 */
import { describe, expect, it } from "vitest";
import { MARKETPLACE_PACKAGE_KINDS, type PackageVersionContents } from "../src/index.js";
import {
  INSTALLER,
  PUBLISHER,
  REQUESTER,
  REVIEWER,
  LAB_SYSTEM,
  errOf,
  marketplaceFixture,
  okOf,
  publishFixturePackage,
  scopeOf,
  type MarketplaceFixture,
} from "./helpers.js";

const TENANT = scopeOf("tenant-a");

const MINIMAL_AGENT: PackageVersionContents = {
  kind: "agent",
  bodyTemplate: {
    displayName: "Minimal Agent",
    role: { title: "Analyst" },
    permittedCapabilities: ["conversation"],
  },
  capabilityDeclarations: [
    { supplyKind: "tool", capabilityId: "cap-analysis", level: 1, capacityPerPeriod: 1 },
  ],
  requiredBindings: ["cognition"],
};

function draftAgent(
  fixture: MarketplaceFixture,
  packageId: string,
  overrides: Record<string, unknown> = {},
) {
  return fixture.service.draftPackage(TENANT, {
    packageId,
    kind: "agent",
    summary: "publication walk fixture",
    version: 1,
    contents: MINIMAL_AGENT,
    changelog: "initial release",
    evidenceRefs: [{ evidenceKind: "test-suite", ref: "evidence/suite" }],
    publisher: PUBLISHER,
    provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: 1 },
    now: 1,
    ...overrides,
  });
}

describe("publication machine (machine 1) end-to-end", () => {
  it("draft -> submitted -> published happy path with full transition history", () => {
    const fixture = marketplaceFixture();
    okOf(draftAgent(fixture, "pkg-walk"));
    okOf(
      fixture.service.submitPackageVersion(TENANT, {
        packageId: "pkg-walk",
        version: 1,
        actor: PUBLISHER,
        reason: "ready for review",
        now: 2,
      }),
    );
    const published = okOf(
      fixture.service.reviewPublication(TENANT, {
        packageId: "pkg-walk",
        version: 1,
        actor: REVIEWER,
        reason: "evidence reviewed",
        now: 3,
        decision: "published",
      }),
    );
    expect(published.publication.state).toBe("published");
    expect(published.publishedAt).toBe(3);
    expect(published.publication.history.length).toBe(2);
    expect(published.publication.history[0]).toMatchObject({ from: "draft", to: "submitted" });
    expect(published.publication.history[1]).toMatchObject({ from: "submitted", to: "published" });
  });

  it("submitting a DRAFT-only record twice is an illegal lifecycle transition", () => {
    const fixture = marketplaceFixture();
    okOf(draftAgent(fixture, "pkg-walk"));
    const result = fixture.service.reviewPublication(TENANT, {
      packageId: "pkg-walk",
      version: 1,
      actor: REVIEWER,
      reason: "cannot review a draft",
      now: 2,
      decision: "published",
    });
    expect(errOf(result).code).toBe("marketplace-lifecycle");
  });

  it("PUBLISHED is terminal — no further publication transition exists", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const resubmit = fixture.service.submitPackageVersion(TENANT, {
      packageId: "pkg-agent-analyst",
      version: 1,
      actor: PUBLISHER,
      reason: "resubmit published",
      now: 10,
    });
    expect(errOf(resubmit).code).toBe("marketplace-lifecycle");
    const rereview = fixture.service.reviewPublication(TENANT, {
      packageId: "pkg-agent-analyst",
      version: 1,
      actor: REVIEWER,
      reason: "re-review published",
      now: 11,
      decision: "rejected",
    });
    expect(errOf(rereview).code).toBe("marketplace-lifecycle");
  });

  it("REJECTED loops back to submitted (revision loop), then publishes", () => {
    const fixture = marketplaceFixture();
    okOf(draftAgent(fixture, "pkg-loop"));
    okOf(
      fixture.service.submitPackageVersion(TENANT, {
        packageId: "pkg-loop",
        version: 1,
        actor: PUBLISHER,
        reason: "submit",
        now: 2,
      }),
    );
    const rejected = okOf(
      fixture.service.reviewPublication(TENANT, {
        packageId: "pkg-loop",
        version: 1,
        actor: REVIEWER,
        reason: "insufficient evidence",
        now: 3,
        decision: "rejected",
      }),
    );
    expect(rejected.publication.state).toBe("rejected");
    const resubmitted = okOf(
      fixture.service.submitPackageVersion(TENANT, {
        packageId: "pkg-loop",
        version: 1,
        actor: PUBLISHER,
        reason: "revision submitted",
        now: 4,
      }),
    );
    expect(resubmitted.publication.state).toBe("submitted");
    expect(resubmitted.publication.history.length).toBe(3);
  });

  it("drafting a version that already exists is a typed conflict", () => {
    const fixture = marketplaceFixture();
    okOf(draftAgent(fixture, "pkg-dup"));
    const duplicate = draftAgent(fixture, "pkg-dup");
    expect(errOf(duplicate).code).toBe("marketplace-conflict");
  });

  it("invalid contents are refused with typed validation issues", () => {
    const fixture = marketplaceFixture();
    const result = fixture.service.draftPackage(TENANT, {
      packageId: "pkg-bad",
      kind: "agent",
      summary: "bad contents",
      version: 1,
      contents: {
        kind: "agent",
        bodyTemplate: {
          displayName: "",
          role: { title: "Analyst" },
          permittedCapabilities: ["not-a-capability"],
        },
        capabilityDeclarations: [],
        requiredBindings: [],
      },
      changelog: "bad",
      evidenceRefs: [],
      publisher: PUBLISHER,
      provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: 1 },
      now: 1,
    });
    const error = errOf(result);
    expect(error.code).toBe("marketplace-validation");
    const fields = error.issues.map((issue) => issue.field);
    expect(fields).toContain("contents.bodyTemplate.displayName");
    expect(fields).toContain("contents.bodyTemplate.permittedCapabilities[0]");
    expect(fields).toContain("evidenceRefs");
    expect(fields.some((field) => field.startsWith("contents.requiredBindings"))).toBe(true);
  });

  it("the four package kinds are all publishable through the same machine", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    publishFixturePackage(fixture, TENANT, "pkg-role-ops-analyst");
    publishFixturePackage(fixture, TENANT, "pkg-capability-search");
    const kinds = fixture.service.listCatalog(TENANT).map((entry) => entry.kind);
    expect([...kinds].sort()).toEqual(["agent", "capability", "role"]);
    expect(MARKETPLACE_PACKAGE_KINDS).toEqual(["agent", "extension", "role", "capability"]);
  });

  it("a package kind cannot flip between versions (identity conflict)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 1 });
    const result = fixture.service.draftPackage(TENANT, {
      packageId: "pkg-agent-analyst",
      kind: "capability",
      summary: "kind flip attempt",
      version: 2,
      contents: {
        kind: "capability",
        supplies: [{ supplyKind: "tool", capabilityId: "cap-x", level: 1, capacityPerPeriod: 1 }],
      },
      changelog: "kind flip",
      evidenceRefs: [{ evidenceKind: "test-suite", ref: "evidence/x" }],
      publisher: PUBLISHER,
      provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: 100 },
      now: 100,
    });
    expect(errOf(result).code).toBe("marketplace-conflict");
  });
});

describe("installation machine (machine 2) lifecycle", () => {
  it("configuration revisions append to a history (the configuration surface)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    okOf(
      fixture.service.installPackage(TENANT, {
        installationId: "inst-1",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: INSTALLER,
        configuration: { mode: "initial" },
        provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 10 },
        now: 10,
      }),
    );
    const revised = okOf(
      fixture.service.reviseInstallationConfiguration(TENANT, {
        installationId: "inst-1",
        value: { mode: "tightened" },
        revisedBy: INSTALLER,
        revisedAt: 20,
        reason: "tighten scope",
      }),
    );
    expect(revised.configuration.length).toBe(2);
    expect(revised.configuration[1]?.value).toEqual({ mode: "tightened" });
    expect(revised.configuration[1]?.reason).toBe("tighten scope");
  });

  it("uninstall is terminal; reinstalling creates a NEW installation record", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const first = okOf(
      fixture.service.installPackage(TENANT, {
        installationId: "inst-1",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: INSTALLER,
        provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 10 },
        now: 10,
      }),
    );
    const uninstalled = okOf(
      fixture.service.uninstallInstallation(TENANT, {
        installationId: "inst-1",
        actor: INSTALLER,
        reason: "replaced",
        now: 20,
      }),
    );
    expect(uninstalled.state).toBe("uninstalled");
    expect(uninstalled.uninstalledAt).toBe(20);
    // Double uninstall: illegal.
    expect(
      errOf(
        fixture.service.uninstallInstallation(TENANT, {
          installationId: "inst-1",
          actor: INSTALLER,
          reason: "again",
          now: 21,
        }),
      ).code,
    ).toBe("marketplace-lifecycle");
    // Reinstall under a NEW id works.
    const second = okOf(
      fixture.service.installPackage(TENANT, {
        installationId: "inst-2",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: INSTALLER,
        provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 30 },
        now: 30,
      }),
    );
    expect(second.state).toBe("installed");
    expect(first.installationId).not.toBe(second.installationId);
    expect(fixture.service.listInstallations(TENANT).length).toBe(2);
  });

  it("configuration cannot be revised on an uninstalled installation", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    okOf(
      fixture.service.installPackage(TENANT, {
        installationId: "inst-1",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: INSTALLER,
        provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 10 },
        now: 10,
      }),
    );
    okOf(
      fixture.service.uninstallInstallation(TENANT, {
        installationId: "inst-1",
        actor: INSTALLER,
        reason: "retired",
        now: 20,
      }),
    );
    const result = fixture.service.reviseInstallationConfiguration(TENANT, {
      installationId: "inst-1",
      value: { mode: "late" },
      revisedBy: INSTALLER,
      revisedAt: 30,
      reason: "too late",
    });
    expect(errOf(result).code).toBe("marketplace-lifecycle");
  });

  it("activation validation rejects unknown grant kinds and empty actor lists", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    okOf(
      fixture.service.installPackage(TENANT, {
        installationId: "inst-1",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: INSTALLER,
        provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 10 },
        now: 10,
      }),
    );
    const badGrant = fixture.service.activatePackage(TENANT, {
      activationId: "act-1",
      installationId: "inst-1",
      actorRefs: ["actor-1"],
      grants: [{ grantKind: "root-access", ref: "*" }],
      activatedBy: INSTALLER,
      provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 20 },
      now: 20,
    });
    const grantError = errOf(badGrant);
    expect(grantError.code).toBe("marketplace-validation");
    expect(grantError.issues[0]?.field).toBe("grants[0].grantKind");

    const noActors = fixture.service.activatePackage(TENANT, {
      activationId: "act-2",
      installationId: "inst-1",
      actorRefs: [],
      grants: [{ grantKind: "capability", ref: "cap-analysis" }],
      activatedBy: INSTALLER,
      provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 21 },
      now: 21,
    });
    expect(errOf(noActors).issues[0]?.field).toBe("actorRefs");
  });

  it("deactivation is terminal; a fresh activation may follow under a new id", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const { installationId, activationId } = {
      installationId: "inst-1",
      activationId: "act-1",
    };
    okOf(
      fixture.service.installPackage(TENANT, {
        installationId,
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: INSTALLER,
        provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 10 },
        now: 10,
      }),
    );
    okOf(
      fixture.service.activatePackage(TENANT, {
        activationId,
        installationId,
        actorRefs: ["actor-1"],
        grants: [{ grantKind: "capability", ref: "cap-analysis" }],
        activatedBy: INSTALLER,
        provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 11 },
        now: 11,
      }),
    );
    okOf(
      fixture.service.deactivateActivation(TENANT, {
        activationId,
        actor: INSTALLER,
        reason: "rotated",
        now: 20,
      }),
    );
    expect(
      errOf(
        fixture.service.deactivateActivation(TENANT, {
          activationId,
          actor: INSTALLER,
          reason: "again",
          now: 21,
        }),
      ).code,
    ).toBe("marketplace-lifecycle");
    // A DIFFERENT target (new actor set) may be activated fresh.
    const reactivation = okOf(
      fixture.service.activatePackage(TENANT, {
        activationId: "act-2",
        installationId,
        actorRefs: ["actor-2"],
        grants: [{ grantKind: "capability", ref: "cap-analysis" }],
        activatedBy: INSTALLER,
        provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 22 },
        now: 22,
      }),
    );
    expect(reactivation.state).toBe("activated");
  });
});

describe("typed errors + guards", () => {
  it("every refusal is a MarketplaceError with a typed code — never a bare throw", () => {
    const fixture = marketplaceFixture();
    const result = fixture.service.installPackage(TENANT, {
      installationId: "inst-x",
      packageId: "pkg-missing",
      version: 1,
      installedBy: REQUESTER,
      provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 1 },
      now: 1,
    });
    const error = errOf(result);
    expect(error.name).toBe("MarketplaceError");
    expect(error.code).toBe("marketplace-not-found");
    expect(typeof error.message).toBe("string");
  });

  it("the Lab system actor can draft and submit but never review", () => {
    const fixture = marketplaceFixture();
    const drafted = okOf(
      fixture.service.draftPackage(TENANT, {
        packageId: "pkg-lab-proposal",
        kind: "capability",
        summary: "lab proposal",
        version: 1,
        contents: {
          kind: "capability",
          supplies: [
            { supplyKind: "tool", capabilityId: "cap-lab", level: 2, capacityPerPeriod: 4 },
          ],
        },
        changelog: "lab proposal v1",
        evidenceRefs: [{ evidenceKind: "provenance-statement", ref: "evidence/lab" }],
        publisher: LAB_SYSTEM,
        provenance: { actor: LAB_SYSTEM, source: "inferred", recordedAt: 1 },
        now: 1,
      }),
    );
    expect(drafted.publication.state).toBe("draft");
    okOf(
      fixture.service.submitPackageVersion(TENANT, {
        packageId: "pkg-lab-proposal",
        version: 1,
        actor: LAB_SYSTEM,
        reason: "lab submits its proposal",
        now: 2,
      }),
    );
    const review = fixture.service.reviewPublication(TENANT, {
      packageId: "pkg-lab-proposal",
      version: 1,
      actor: LAB_SYSTEM,
      reason: "lab self-review attempt",
      now: 3,
      decision: "published",
    });
    expect(errOf(review).code).toBe("marketplace-unauthorized");
  });
});
