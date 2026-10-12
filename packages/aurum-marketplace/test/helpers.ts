/**
 * W011 test helpers: fixtures and Result narrowing utilities for the
 * marketplace module. Mirrors the W009 `plans-helpers.ts` pattern: imports
 * the marketplace surface from the PUBLIC contract (../src/index.js) —
 * the same boundary other modules use.
 *
 * Fixtures:
 * - a full in-memory dependency set (catalog + governance stores, audit
 *   ledger, authority double, registration double) wired through
 *   `createMarketplaceService`;
 * - a `publishFixturePackage` helper that walks the REAL publication
 *   machine (draft -> submitted -> published) for a deterministic package;
 * - a deterministic demand profile for recruitment scenarios.
 */
import { expect } from "vitest";
import {
  createInMemoryMarketplaceAuditLedger,
  createInMemoryMarketplaceCatalogStore,
  createInMemoryMarketplaceGovernanceStore,
  createInMemoryAuthorityDouble,
  createInMemoryWorkforceRegistrationDouble,
  createMarketplaceService,
  marketplacePersonActor,
  marketplaceSystemActor,
  marketplaceTenantScope,
  type DraftPackageInput,
  type InMemoryAuthorityDouble,
  type InMemoryMarketplaceAuditLedger,
  type InMemoryMarketplaceCatalogStore,
  type InMemoryMarketplaceGovernanceStore,
  type InMemoryWorkforceRegistrationDouble,
  type MarketplaceError,
  type MarketplaceService,
  type MarketplaceTenantScope,
  type PackageVersionContents,
  type Result,
  type TaughtCitation,
} from "../src/index.js";

const T0 = 1_700_000_000_000;

export const PUBLISHER = marketplacePersonActor("person-publisher-1");
export const REVIEWER = marketplacePersonActor("person-reviewer-1");
export const INSTALLER = marketplacePersonActor("person-installer-1");
export const REQUESTER = marketplacePersonActor("person-requester-1");
export const RESOLVER = marketplacePersonActor("person-resolver-1");
export const LAB_SYSTEM = marketplaceSystemActor("aurum-lab");

export function scopeOf(name: string): MarketplaceTenantScope {
  const result = marketplaceTenantScope(name);
  if (!result.ok) throw new Error(`test setup: invalid tenant name ${name}`);
  return result.value;
}

export function okOf<T>(result: Result<T, MarketplaceError>): T {
  expect(result.ok, `expected ok, got error: ${result.ok ? "" : result.error.message}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

export function errOf(result: Result<unknown, MarketplaceError>): MarketplaceError {
  expect(result.ok, `expected err, got value: ${result.ok ? String(result.value) : ""}`).toBe(
    false,
  );
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

export interface MarketplaceFixture {
  readonly service: MarketplaceService;
  readonly catalogStore: InMemoryMarketplaceCatalogStore;
  readonly governanceStore: InMemoryMarketplaceGovernanceStore;
  readonly auditLedger: InMemoryMarketplaceAuditLedger;
  readonly authority: InMemoryAuthorityDouble;
  readonly registration: InMemoryWorkforceRegistrationDouble;
}

export function marketplaceFixture(taught: readonly TaughtCitation[] = []): MarketplaceFixture {
  const catalogStore = createInMemoryMarketplaceCatalogStore();
  const governanceStore = createInMemoryMarketplaceGovernanceStore();
  const auditLedger = createInMemoryMarketplaceAuditLedger();
  const authority = createInMemoryAuthorityDouble(taught);
  const registration = createInMemoryWorkforceRegistrationDouble();
  const service = createMarketplaceService({
    catalog: catalogStore,
    governance: governanceStore,
    audit: auditLedger,
    authority,
    registration,
  });
  return { service, catalogStore, governanceStore, auditLedger, authority, registration };
}

const AGENT_CONTENTS: PackageVersionContents = {
  kind: "agent",
  bodyTemplate: {
    displayName: "Analyst Agent",
    role: { title: "Analyst", description: "analysis body template" },
    permittedCapabilities: ["conversation", "information-retrieval"],
    memoryPolicy: { retention: "session", sharing: "private" },
    escalation: { onUncertainty: "ask-human" },
  },
  capabilityDeclarations: [
    { supplyKind: "tool", capabilityId: "cap-analysis", level: 4, capacityPerPeriod: 8 },
  ],
  requiredBindings: ["cognition", "analysis"],
};

const ROLE_CONTENTS: PackageVersionContents = {
  kind: "role",
  roleDefinition: {
    title: "Ops Analyst",
    description: "role package fixture",
    responsibilities: ["monitor-operations"],
    skills: ["data-analysis"],
    authorityRequirements: ["read-telemetry"],
  },
  requiredCapabilities: ["cap-analysis", "cap-communication"],
};

const CAPABILITY_CONTENTS: PackageVersionContents = {
  kind: "capability",
  supplies: [
    { supplyKind: "connector", capabilityId: "cap-search", level: 5, capacityPerPeriod: 100 },
    { supplyKind: "tool", capabilityId: "cap-analysis", level: 2, capacityPerPeriod: 2 },
  ],
};

export const FIXTURE_CONTENTS: Record<string, PackageVersionContents> = {
  "pkg-agent-analyst": AGENT_CONTENTS,
  "pkg-role-ops-analyst": ROLE_CONTENTS,
  "pkg-capability-search": CAPABILITY_CONTENTS,
};

/** Walks the REAL publication machine to a published version. */
export function publishFixturePackage(
  fixture: MarketplaceFixture,
  scope: MarketplaceTenantScope,
  packageId: string,
  options: { version?: number; contents?: PackageVersionContents; now?: number } = {},
): void {
  const contents = options.contents ?? FIXTURE_CONTENTS[packageId] ?? AGENT_CONTENTS;
  const version = options.version ?? 1;
  const now = options.now ?? T0;
  okOf(
    fixture.service.draftPackage(scope, {
      packageId,
      kind: contents.kind,
      summary: `fixture package ${packageId}`,
      version,
      contents,
      changelog: `fixture release ${version}`,
      evidenceRefs: [
        { evidenceKind: "test-suite", ref: `evidence/${packageId}/suite-v${version}` },
        {
          evidenceKind: "provenance-statement",
          ref: `evidence/${packageId}/provenance-v${version}`,
        },
      ],
      publisher: PUBLISHER,
      provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: now },
      now,
    }),
  );
  okOf(
    fixture.service.submitPackageVersion(scope, {
      packageId,
      version,
      actor: PUBLISHER,
      reason: `submit ${packageId} v${version}`,
      now: now + 1,
    }),
  );
  okOf(
    fixture.service.reviewPublication(scope, {
      packageId,
      version,
      actor: REVIEWER,
      reason: `review ${packageId} v${version}`,
      now: now + 2,
      decision: "published",
    }),
  );
}

/** Teaches the authority double one valid citation in the given tenant. */
export function teachCitation(
  authority: InMemoryAuthorityDouble,
  tenantId: string,
  actionId: string,
  approvedBy = RESOLVER,
): TaughtCitation {
  const taught: TaughtCitation = {
    tenantId,
    actionId,
    approvedBy,
  };
  authority.teach(taught);
  return taught;
}

/** A standard install+activate walk over a published package. */
export function installAndActivate(
  fixture: MarketplaceFixture,
  scope: MarketplaceTenantScope,
  packageId: string,
  options: { installationId?: string; activationId?: string; now?: number; version?: number } = {},
): { installationId: string; activationId: string } {
  const now = options.now ?? T0 + 100;
  const installationId = options.installationId ?? `inst-${packageId}`;
  const activationId = options.activationId ?? `act-${packageId}`;
  okOf(
    fixture.service.installPackage(scope, {
      installationId,
      packageId,
      version: options.version ?? 1,
      installedBy: INSTALLER,
      configuration: { mode: "fixture" },
      provenance: { actor: INSTALLER, source: "system-captured", recordedAt: now },
      now,
    }),
  );
  okOf(
    fixture.service.activatePackage(scope, {
      activationId,
      installationId,
      actorRefs: ["actor-ops-1"],
      grants: [{ grantKind: "capability", ref: "cap-analysis", level: 4 }],
      activatedBy: INSTALLER,
      provenance: { actor: INSTALLER, source: "system-captured", recordedAt: now },
      now: now + 1,
    }),
  );
  return { installationId, activationId };
}

export { T0 };
