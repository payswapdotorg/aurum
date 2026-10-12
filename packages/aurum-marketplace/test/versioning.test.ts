/**
 * W011 ACCEPTANCE — versioning (assignment: "installed version pinned;
 * publisher updates don't mutate installed instances") and
 * immutable-once-published records.
 */
import { describe, expect, it } from "vitest";
import {
  errOf,
  installAndActivate,
  marketplaceFixture,
  okOf,
  publishFixturePackage,
  scopeOf,
} from "./helpers.js";

const TENANT = scopeOf("tenant-a");

describe("versioning: installed version pinned; publisher updates don't mutate installed instances", () => {
  it("publishing v2 does not mutate an existing installation pinned to v1", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 1 });
    const installation = okOf(
      fixture.service.installPackage(TENANT, {
        installationId: "inst-1",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: { kind: "person", personId: "person-1" },
        provenance: {
          actor: { kind: "person", personId: "person-1" },
          source: "system-captured",
          recordedAt: 10,
        },
        now: 10,
      }),
    );
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 2, now: 100 });
    const afterUpdate = okOf(fixture.service.getInstallation(TENANT, "inst-1"));
    expect(afterUpdate).toEqual(installation);
    expect(afterUpdate.installedVersion).toBe(1);
  });

  it("publishing v2 does not mutate the v1 VERSION RECORD (byte-identical)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 1 });
    const v1Before = okOf(fixture.service.getPackageVersion(TENANT, "pkg-agent-analyst", 1));
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 2, now: 100 });
    const v1After = okOf(fixture.service.getPackageVersion(TENANT, "pkg-agent-analyst", 1));
    expect(v1After).toEqual(v1Before);
  });

  it("updating means a NEW installation of the new version (no in-place version bump)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 1 });
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 2, now: 100 });
    okOf(
      fixture.service.installPackage(TENANT, {
        installationId: "inst-v1",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: { kind: "person", personId: "person-1" },
        provenance: {
          actor: { kind: "person", personId: "person-1" },
          source: "system-captured",
          recordedAt: 110,
        },
        now: 110,
      }),
    );
    okOf(
      fixture.service.installPackage(TENANT, {
        installationId: "inst-v2",
        packageId: "pkg-agent-analyst",
        version: 2,
        installedBy: { kind: "person", personId: "person-1" },
        provenance: {
          actor: { kind: "person", personId: "person-1" },
          source: "system-captured",
          recordedAt: 120,
        },
        now: 120,
      }),
    );
    const v1Installation = okOf(fixture.service.getInstallation(TENANT, "inst-v1"));
    const v2Installation = okOf(fixture.service.getInstallation(TENANT, "inst-v2"));
    expect(v1Installation.installedVersion).toBe(1);
    expect(v2Installation.installedVersion).toBe(2);
    expect(fixture.service.listInstallations(TENANT).length).toBe(2);
  });

  it("a published version record is deep-frozen (immutable-once-published)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const version = okOf(fixture.service.getPackageVersion(TENANT, "pkg-agent-analyst", 1));
    expect(Object.isFrozen(version)).toBe(true);
    expect(Object.isFrozen(version.contents)).toBe(true);
    expect(() => {
      (version as unknown as { changelog: string }).changelog = "tampered";
    }).toThrow();
  });

  it("each version carries its OWN changelog and evidence (rich provenance)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 1 });
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 2, now: 100 });
    const v1 = okOf(fixture.service.getPackageVersion(TENANT, "pkg-agent-analyst", 1));
    const v2 = okOf(fixture.service.getPackageVersion(TENANT, "pkg-agent-analyst", 2));
    expect(v1.changelog).toBe("fixture release 1");
    expect(v2.changelog).toBe("fixture release 2");
    expect(v1.evidenceRefs[0]?.ref).toContain("suite-v1");
    expect(v2.evidenceRefs[0]?.ref).toContain("suite-v2");
    expect(v2.publication.state).toBe("published");
    expect(v2.publishedAt).toBeDefined();
  });

  it("the activation ALSO pins the version it activated", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 1 });
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 2, now: 100 });
    const { activationId } = installAndActivate(fixture, TENANT, "pkg-agent-analyst", {
      version: 1,
    });
    const activation = okOf(fixture.service.getActivation(TENANT, activationId));
    expect(activation.version).toBe(1);
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 3, now: 200 });
    const activationAfter = okOf(fixture.service.getActivation(TENANT, activationId));
    expect(activationAfter).toEqual(activation);
  });

  it("installing a not-yet-published NEW version is refused (v1 published, v2 still draft)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst", { version: 1 });
    // Draft v2 without publishing:
    okOf(
      fixture.service.draftPackage(TENANT, {
        packageId: "pkg-agent-analyst",
        kind: "agent",
        summary: "fixture package pkg-agent-analyst",
        version: 2,
        contents: {
          kind: "agent",
          bodyTemplate: {
            displayName: "Analyst Agent",
            role: { title: "Analyst" },
            permittedCapabilities: ["conversation"],
          },
          capabilityDeclarations: [
            { supplyKind: "tool", capabilityId: "cap-analysis", level: 4, capacityPerPeriod: 8 },
          ],
          requiredBindings: ["cognition"],
        },
        changelog: "draft v2",
        evidenceRefs: [{ evidenceKind: "test-suite", ref: "evidence/v2" }],
        publisher: { kind: "person", personId: "person-publisher-1" },
        provenance: {
          actor: { kind: "person", personId: "person-publisher-1" },
          source: "system-captured",
          recordedAt: 50,
        },
        now: 50,
      }),
    );
    const result = fixture.service.installPackage(TENANT, {
      installationId: "inst-v2",
      packageId: "pkg-agent-analyst",
      version: 2,
      installedBy: { kind: "person", personId: "person-1" },
      provenance: {
        actor: { kind: "person", personId: "person-1" },
        source: "system-captured",
        recordedAt: 60,
      },
      now: 60,
    });
    expect(errOf(result).code).toBe("marketplace-unpublished");
  });
});
