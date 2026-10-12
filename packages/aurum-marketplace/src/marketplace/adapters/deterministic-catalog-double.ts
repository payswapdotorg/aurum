/**
 * Deterministic catalog double (W011 adapter): pre-populates an in-memory
 * catalog store with PUBLISHED packages of all four kinds, fully
 * deterministic (fixed ids, versions, evidence, timestamps). Used by the
 * proof suites and by downstream consumers (W014) as a working catalog
 * before PostgreSQL persistence lands (P-series debt).
 */
import type { MarketplaceTenantScope } from "../domain/primitives.js";
import { marketplacePersonActor } from "../domain/primitives.js";
import type { InMemoryMarketplaceCatalogStore } from "./in-memory-catalog-store.js";
import { reviewPublication, submitForPublication } from "../domain/publication.js";
import { buildDraftPackageVersion } from "../domain/records.js";
import type { PackageVersionContents } from "../domain/records.js";

const T0 = 1_700_000_000_000;
const PUBLISHER = marketplacePersonActor("person-publisher-1");
const REVIEWER = marketplacePersonActor("person-reviewer-1");

/** The fixed, deterministic catalog fixture ids. */
export const DETERMINISTIC_CATALOG_PACKAGE_IDS = [
  "pkg-agent-analyst",
  "pkg-extension-research-tools",
  "pkg-role-ops-analyst",
  "pkg-capability-search-connector",
] as const;

const CONTENTS: Record<string, PackageVersionContents> = {
  "pkg-agent-analyst": {
    kind: "agent",
    bodyTemplate: {
      displayName: "Marketplace Analyst Agent",
      role: { title: "Analyst", description: "Deterministic analyst body template" },
      permittedCapabilities: ["conversation", "information-retrieval", "web-search"],
      memoryPolicy: { retention: "session", sharing: "team" },
      escalation: { onUncertainty: "ask-human" },
    },
    capabilityDeclarations: [
      { supplyKind: "tool", capabilityId: "cap-analysis", level: 4, capacityPerPeriod: 8 },
    ],
    requiredBindings: ["cognition", "analysis"],
  },
  "pkg-extension-research-tools": {
    kind: "extension",
    additionalCapabilities: ["web-search", "browser-use"],
    capabilitySupplies: [
      { supplyKind: "tool", capabilityId: "cap-research", level: 3, capacityPerPeriod: 4 },
    ],
    requiresBodyCapabilities: ["information-retrieval"],
  },
  "pkg-role-ops-analyst": {
    kind: "role",
    roleDefinition: {
      title: "Operations Analyst",
      description: "Deterministic role package",
      responsibilities: ["monitor-operations", "report-deviations"],
      skills: ["data-analysis", "communication"],
      authorityRequirements: ["read-operations-telemetry"],
    },
    requiredCapabilities: ["cap-analysis", "cap-communication"],
  },
  "pkg-capability-search-connector": {
    kind: "capability",
    supplies: [
      { supplyKind: "connector", capabilityId: "cap-search", level: 5, capacityPerPeriod: 100 },
      { supplyKind: "tool", capabilityId: "cap-analysis", level: 2, capacityPerPeriod: 2 },
    ],
  },
};

/**
 * Populates a catalog store with the four deterministic PUBLISHED packages
 * in the given tenant. Fully governed: each package is drafted, submitted
 * and reviewed through the real publication machine.
 */
export function populateDeterministicCatalog(
  store: InMemoryMarketplaceCatalogStore,
  scope: MarketplaceTenantScope,
): void {
  let tick = 0;
  for (const packageId of DETERMINISTIC_CATALOG_PACKAGE_IDS) {
    tick += 1;
    const now = T0 + tick;
    const contents = CONTENTS[packageId];
    if (!contents) continue;
    store.putPackage({
      scope,
      packageId,
      kind: contents.kind,
      summary: `deterministic ${contents.kind} package ${packageId}`,
      publisher: PUBLISHER,
      provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: now },
      createdAt: now,
    });
    const draft = buildDraftPackageVersion({
      scope,
      packageId,
      version: 1,
      contents,
      changelog: `initial deterministic release of ${packageId}`,
      evidenceRefs: [
        { evidenceKind: "test-suite", ref: `evidence/${packageId}/suite-v1` },
        { evidenceKind: "provenance-statement", ref: `evidence/${packageId}/provenance-v1` },
      ],
      publisher: PUBLISHER,
      provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: now },
      now,
    });
    store.putVersion(draft);
    const submitted = submitForPublication(draft, {
      actor: PUBLISHER,
      at: now + 1,
      reason: `deterministic submission of ${packageId}`,
    });
    if (submitted.ok) {
      store.putVersion(submitted.value);
      const reviewed = reviewPublication(submitted.value, "published", REVIEWER, {
        actor: REVIEWER,
        at: now + 2,
        reason: `deterministic review of ${packageId}`,
      });
      if (reviewed.ok) store.putVersion(reviewed.value);
    }
  }
}
