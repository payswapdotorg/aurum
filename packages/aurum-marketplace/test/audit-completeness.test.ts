/**
 * W011 ACCEPTANCE — audit completeness: every governance transition of
 * every machine is recorded with actor/at/reason (+ details carrying
 * evidence refs), exactly once, under its own machine's action kind.
 */
import { describe, expect, it } from "vitest";
import {
  INSTALLER,
  PUBLISHER,
  REQUESTER,
  RESOLVER,
  REVIEWER,
  marketplaceFixture,
  okOf,
  publishFixturePackage,
  scopeOf,
  teachCitation,
} from "./helpers.js";
import { populateDeterministicCatalog } from "../src/index.js";

const TENANT = scopeOf("tenant-a");

describe("audit completeness: every transition recorded with actor/reason/evidence", () => {
  it("the publication walk records drafted, submitted and published — each with actor/reason", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const entries = fixture.auditLedger.listAudit(TENANT);
    expect(entries.map((entry) => entry.action)).toEqual([
      "marketplace.package-drafted",
      "marketplace.package-submitted",
      "marketplace.package-published",
    ]);
    for (const entry of entries) {
      expect(entry.actor.kind).toBe("person");
      expect(typeof entry.reason).toBe("string");
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(typeof entry.at).toBe("number");
    }
    // The publication audit carries the evidence refs (details).
    const published = entries.find((entry) => entry.action === "marketplace.package-published");
    expect(published).toBeDefined();
    const details = published?.details as { evidenceRefs?: unknown[] } | undefined;
    expect(details?.evidenceRefs?.length).toBeGreaterThan(0);
  });

  it("the installation + activation walk records installed, activated (and revisions/uninstall/deactivate)", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    okOf(
      fixture.service.installPackage(TENANT, {
        installationId: "inst-1",
        packageId: "pkg-agent-analyst",
        version: 1,
        installedBy: INSTALLER,
        configuration: { mode: "a" },
        provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 10 },
        now: 10,
      }),
    );
    okOf(
      fixture.service.reviseInstallationConfiguration(TENANT, {
        installationId: "inst-1",
        value: { mode: "b" },
        revisedBy: INSTALLER,
        revisedAt: 11,
        reason: "tighten",
      }),
    );
    okOf(
      fixture.service.activatePackage(TENANT, {
        activationId: "act-1",
        installationId: "inst-1",
        actorRefs: ["actor-1"],
        grants: [{ grantKind: "capability", ref: "cap-analysis" }],
        activatedBy: INSTALLER,
        provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 12 },
        now: 12,
      }),
    );
    okOf(
      fixture.service.deactivateActivation(TENANT, {
        activationId: "act-1",
        actor: INSTALLER,
        reason: "rotate",
        now: 13,
      }),
    );
    okOf(
      fixture.service.uninstallInstallation(TENANT, {
        installationId: "inst-1",
        actor: INSTALLER,
        reason: "retire",
        now: 14,
      }),
    );
    const actions = fixture.auditLedger.listAudit(TENANT).map((entry) => entry.action);
    expect(actions).toContain("marketplace.package-installed");
    expect(actions).toContain("marketplace.package-configuration-revised");
    expect(actions).toContain("marketplace.package-activated");
    expect(actions).toContain("marketplace.package-deactivated");
    expect(actions).toContain("marketplace.package-uninstalled");
    // Each appears exactly once.
    for (const action of [
      "marketplace.package-installed",
      "marketplace.package-configuration-revised",
      "marketplace.package-activated",
      "marketplace.package-deactivated",
      "marketplace.package-uninstalled",
    ]) {
      expect(actions.filter((entry) => entry === action).length).toBe(1);
    }
    // The install audit carries the version + evidence refs.
    const installed = fixture.auditLedger
      .listAudit(TENANT)
      .find((entry) => entry.action === "marketplace.package-installed");
    const details = installed?.details as { version?: number; evidenceRefs?: unknown[] };
    expect(details?.version).toBe(1);
    expect(details?.evidenceRefs?.length).toBeGreaterThan(0);
  });

  it("the execution-approval walk records requested, cited, withdrawn", () => {
    const fixture = marketplaceFixture();
    teachCitation(fixture.authority, TENANT.tenantId, "action-9");
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
      fixture.service.activatePackage(TENANT, {
        activationId: "act-1",
        installationId: "inst-1",
        actorRefs: ["actor-1"],
        grants: [{ grantKind: "capability", ref: "cap-analysis" }],
        activatedBy: INSTALLER,
        provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 11 },
        now: 11,
      }),
    );
    okOf(
      fixture.service.requestExecutionUse(TENANT, {
        requestId: "exec-1",
        activationId: "act-1",
        consumerRef: "plan-1",
        purpose: "analysis",
        requestedBy: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 20 },
        now: 20,
      }),
    );
    okOf(
      fixture.service.citeExecutionApproval(TENANT, {
        requestId: "exec-1",
        citation: { actionId: "action-9", approvedBy: RESOLVER, approvedAt: 21 },
        now: 21,
      }),
    );
    okOf(
      fixture.service.requestExecutionUse(TENANT, {
        requestId: "exec-2",
        activationId: "act-1",
        consumerRef: "plan-2",
        purpose: "second analysis",
        requestedBy: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 22 },
        now: 22,
      }),
    );
    okOf(
      fixture.service.withdrawExecutionRequest(TENANT, {
        requestId: "exec-2",
        actor: REQUESTER,
        reason: "consumer cancelled",
        now: 23,
      }),
    );
    const executionActions = fixture.auditLedger
      .listAudit(TENANT)
      .map((entry) => entry.action)
      .filter((action) => action.startsWith("marketplace.execution-"));
    expect(executionActions).toEqual([
      "marketplace.execution-requested",
      "marketplace.execution-cited",
      "marketplace.execution-requested",
      "marketplace.execution-withdrawn",
    ]);
    // The cite audit carries the authority citation identity.
    const cited = fixture.auditLedger
      .listAudit(TENANT)
      .find((entry) => entry.action === "marketplace.execution-cited");
    const details = cited?.details as { actionId?: string; auditRef?: string };
    expect(details?.actionId).toBe("action-9");
  });

  it("the recruitment walk records opened, ranked, installed, activated, registered, resolved", () => {
    const fixture = marketplaceFixture();
    populateDeterministicCatalog(fixture.catalogStore, TENANT);
    teachCitation(fixture.authority, TENANT.tenantId, "action-55");
    okOf(
      fixture.service.openRecruitment(TENANT, {
        requestId: "rec-1",
        demand: [{ capabilityId: "cap-analysis", minLevel: 2 }],
        requiredEvidenceKinds: ["test-suite"],
        requestedBy: REQUESTER,
        provenance: { actor: REQUESTER, source: "system-captured", recordedAt: 1000 },
        now: 1000,
      }),
    );
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
    const actions = fixture.auditLedger.listAudit(TENANT).map((entry) => entry.action);
    expect(actions).toContain("marketplace.recruitment-opened");
    expect(actions).toContain("marketplace.recruitment-ranked");
    expect(actions).toContain("marketplace.package-installed");
    expect(actions).toContain("marketplace.package-activated");
    expect(actions).toContain("marketplace.recruitment-registered");
    expect(actions).toContain("marketplace.recruitment-resolved");
    // The ranked audit is inspectable: weights + candidates in details.
    const ranked = fixture.auditLedger
      .listAudit(TENANT)
      .find((entry) => entry.action === "marketplace.recruitment-ranked");
    const details = ranked?.details as { weights?: unknown; candidates?: unknown[] };
    expect(details?.weights).toBeDefined();
    expect((details?.candidates ?? []).length).toBeGreaterThan(0);
  });

  it("FAILED transitions record NOTHING (audit records only actual transitions)", () => {
    const fixture = marketplaceFixture();
    // A refused install (unpublished package) leaves no audit entry.
    okOf(
      fixture.service.draftPackage(TENANT, {
        packageId: "pkg-draft",
        kind: "capability",
        summary: "draft",
        version: 1,
        contents: {
          kind: "capability",
          supplies: [{ supplyKind: "tool", capabilityId: "cap-x", level: 1, capacityPerPeriod: 1 }],
        },
        changelog: "draft",
        evidenceRefs: [{ evidenceKind: "test-suite", ref: "evidence/x" }],
        publisher: PUBLISHER,
        provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: 1 },
        now: 1,
      }),
    );
    const refused = fixture.service.installPackage(TENANT, {
      installationId: "inst-1",
      packageId: "pkg-draft",
      version: 1,
      installedBy: INSTALLER,
      provenance: { actor: INSTALLER, source: "system-captured", recordedAt: 2 },
      now: 2,
    });
    expect(refused.ok).toBe(false);
    const actions = fixture.auditLedger.listAudit(TENANT).map((entry) => entry.action);
    expect(actions).toEqual(["marketplace.package-drafted"]);
    expect(actions).not.toContain("marketplace.package-installed");
  });

  it("audit refs are sequential and unique (audit-N), and REVIEWER actor identity is retained", () => {
    const fixture = marketplaceFixture();
    publishFixturePackage(fixture, TENANT, "pkg-agent-analyst");
    const refs = fixture.auditLedger.listAudit(TENANT).map((entry) => entry.auditRef);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs[0]).toBe("audit-1");
    const published = fixture.auditLedger
      .listAudit(TENANT)
      .find((entry) => entry.action === "marketplace.package-published");
    expect(published?.actor).toEqual(REVIEWER);
  });
});
