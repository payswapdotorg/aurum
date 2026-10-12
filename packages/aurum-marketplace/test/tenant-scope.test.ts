/**
 * W011 ACCEPTANCE — tenant scope is enforced (catalog: "tenant scope is
 * enforced"). Catalog visibility is per-tenant; foreign-tenant records
 * are indistinguishable from never-existing ids (closed failure, no
 * existence leaks); configuration never leaks across tenants.
 */
import { describe, expect, it } from "vitest";
import {
  errOf,
  installAndActivate,
  marketplaceFixture,
  okOf,
  publishFixturePackage,
  scopeOf,
  teachCitation,
} from "./helpers.js";

const TENANT_A = scopeOf("tenant-a");
const TENANT_B = scopeOf("tenant-b");
const TENANT_C = scopeOf("tenant-c");

describe("tenant scope: catalog visibility vs per-tenant installations", () => {
  it("a package published in tenant A is INVISIBLE in tenant B's catalog", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT_A, "pkg-agent-analyst");
    expect(fixture.service.listCatalog(TENANT_A).length).toBe(1);
    expect(fixture.service.listCatalog(TENANT_B).length).toBe(0);
  });

  it("catalog visibility does NOT imply installation — visibility and installation are separate tenant facts", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT_A, "pkg-agent-analyst");
    // Visible in the catalog but NOT installed:
    expect(fixture.service.listCatalog(TENANT_A).length).toBe(1);
    expect(fixture.service.listInstallations(TENANT_A).length).toBe(0);
    // After installation, the catalog entry and the installation record are
    // distinct records with distinct identities.
    installAndActivate(fixture, TENANT_A, "pkg-agent-analyst");
    expect(fixture.service.listCatalog(TENANT_A).length).toBe(1);
    expect(fixture.service.listInstallations(TENANT_A).length).toBe(1);
  });

  it("tenant B installing tenant A's package: foreign-tenant ≡ missing (byte-identical refusal)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT_A, "pkg-agent-analyst");
    const foreign = fixture.service.installPackage(TENANT_B, {
      installationId: "inst-b1",
      packageId: "pkg-agent-analyst",
      version: 1,
      installedBy: { kind: "person", personId: "person-b" },
      provenance: {
        actor: { kind: "person", personId: "person-b" },
        source: "system-captured",
        recordedAt: 10,
      },
      now: 10,
    });
    const neverExisting = fixture.service.installPackage(TENANT_B, {
      installationId: "inst-b2",
      packageId: "pkg-never-existed",
      version: 1,
      installedBy: { kind: "person", personId: "person-b" },
      provenance: {
        actor: { kind: "person", personId: "person-b" },
        source: "system-captured",
        recordedAt: 10,
      },
      now: 10,
    });
    const foreignError = errOf(foreign);
    const missingError = errOf(neverExisting);
    expect(foreignError.code).toBe("marketplace-not-found");
    expect(foreignError.message).toBe(missingError.message);
    expect(foreignError.name).toBe(missingError.name);
  });

  it("no cross-tenant leakage of CONFIGURATION", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT_A, "pkg-agent-analyst");
    okOf(
      fixture.service.installPackage(TENANT_A, {
        installationId: "inst-a1",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: { kind: "person", personId: "person-a" },
        configuration: { secretRef: "opaque-ref-a", mode: "prod" },
        provenance: {
          actor: { kind: "person", personId: "person-a" },
          source: "system-captured",
          recordedAt: 10,
        },
        now: 10,
      }),
    );
    // Tenant B cannot see the installation AT ALL:
    expect(fixture.service.listInstallations(TENANT_B).length).toBe(0);
    const foreignRead = fixture.service.getInstallation(TENANT_B, "inst-a1");
    expect(errOf(foreignRead).code).toBe("marketplace-not-found");
    // Tenant C likewise:
    expect(fixture.service.listInstallations(TENANT_C).length).toBe(0);
    // Tenant A still sees its own configuration:
    const own = okOf(fixture.service.getInstallation(TENANT_A, "inst-a1"));
    expect(own.configuration[0]?.value).toEqual({ secretRef: "opaque-ref-a", mode: "prod" });
  });

  it("activations, execution requests and recruitments are all tenant-scoped", () => {
    const fixture = marketplaceFixture();
    teachCitation(fixture.authority, TENANT_A.tenantId, "action-77");
    publishFixturePackage(fixture, TENANT_A, "pkg-agent-analyst");
    const { activationId } = installAndActivate(fixture, TENANT_A, "pkg-agent-analyst");
    okOf(
      fixture.service.requestExecutionUse(TENANT_A, {
        requestId: "exec-a1",
        activationId,
        consumerRef: "plan-a1",
        purpose: "tenant A analysis",
        requestedBy: { kind: "person", personId: "person-a" },
        provenance: {
          actor: { kind: "person", personId: "person-a" },
          source: "system-captured",
          recordedAt: 300,
        },
        now: 300,
      }),
    );
    // Tenant B sees none of it:
    expect(fixture.service.listActivations(TENANT_B).length).toBe(0);
    expect(errOf(fixture.service.getActivation(TENANT_B, activationId)).code).toBe(
      "marketplace-not-found",
    );
    expect(fixture.service.listRecruitments(TENANT_B).length).toBe(0);
    expect(errOf(fixture.service.getExecutionRequest(TENANT_B, "exec-a1")).code).toBe(
      "marketplace-not-found",
    );
  });

  it("audit entries are tenant-scoped (no cross-tenant audit reads)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT_A, "pkg-agent-analyst");
    publishFixturePackage(fixture, TENANT_B, "pkg-role-ops-analyst");
    const auditA = fixture.service.listAudit(TENANT_A);
    const auditB = fixture.service.listAudit(TENANT_B);
    expect(auditA.length).toBe(3);
    expect(auditB.length).toBe(3);
    expect(auditA.every((entry) => entry.scope.tenantId === TENANT_A.tenantId)).toBe(true);
    expect(auditB.every((entry) => entry.scope.tenantId === TENANT_B.tenantId)).toBe(true);
  });

  it("an authority citation taught in tenant A does not authorize tenant B (the seam is tenant-scoped)", () => {
    const fixture = marketplaceFixture();
    teachCitation(fixture.authority, TENANT_A.tenantId, "action-77");
    publishFixturePackage(fixture, TENANT_A, "pkg-agent-analyst");
    publishFixturePackage(fixture, TENANT_B, "pkg-role-ops-analyst");
    const { activationId } = installAndActivate(fixture, TENANT_A, "pkg-agent-analyst");
    // Open an execution request in tenant A but cite with tenant B's scope:
    okOf(
      fixture.service.requestExecutionUse(TENANT_A, {
        requestId: "exec-a1",
        activationId,
        consumerRef: "plan-a1",
        purpose: "cross-tenant citation attempt",
        requestedBy: { kind: "person", personId: "person-a" },
        provenance: {
          actor: { kind: "person", personId: "person-a" },
          source: "system-captured",
          recordedAt: 300,
        },
        now: 300,
      }),
    );
    // Tenant B walks the same citation through ITS scope — refused.
    publishFixturePackage(fixture, TENANT_B, "pkg-agent-analyst");
    const { activationId: activationB } = installAndActivate(
      fixture,
      TENANT_B,
      "pkg-agent-analyst",
    );
    okOf(
      fixture.service.requestExecutionUse(TENANT_B, {
        requestId: "exec-b1",
        activationId: activationB,
        consumerRef: "plan-b1",
        purpose: "tenant B analysis",
        requestedBy: { kind: "person", personId: "person-b" },
        provenance: {
          actor: { kind: "person", personId: "person-b" },
          source: "system-captured",
          recordedAt: 400,
        },
        now: 400,
      }),
    );
    const result = fixture.service.citeExecutionApproval(TENANT_B, {
      requestId: "exec-b1",
      citation: {
        actionId: "action-77",
        approvedBy: { kind: "person", personId: "person-b" },
        approvedAt: 401,
      },
      now: 401,
    });
    expect(errOf(result).code).toBe("marketplace-unauthorized");
  });

  it("the same package id may exist independently in two tenants (no shared state)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT_A, "pkg-agent-analyst");
    publishFixturePackage(fixture, TENANT_B, "pkg-agent-analyst");
    installAndActivate(fixture, TENANT_A, "pkg-agent-analyst", { installationId: "inst-a" });
    // Tenant B's catalog still lists its OWN version record; tenant A's
    // installation is invisible; installing in B creates a SEPARATE record.
    const installationB = okOf(
      fixture.service.installPackage(TENANT_B, {
        installationId: "inst-b",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: { kind: "person", personId: "person-b" },
        provenance: {
          actor: { kind: "person", personId: "person-b" },
          source: "system-captured",
          recordedAt: 20,
        },
        now: 20,
      }),
    );
    expect(installationB.scope.tenantId).toBe(TENANT_B.tenantId);
    expect(fixture.service.listInstallations(TENANT_A).length).toBe(1);
    expect(fixture.service.listInstallations(TENANT_B).length).toBe(1);
  });
});
