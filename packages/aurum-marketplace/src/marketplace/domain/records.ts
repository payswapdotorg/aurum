/**
 * Marketplace record types (W011 domain layer): the four package kinds +
 * their versioned immutable content payloads, with deep validation.
 *
 * THE FOUR KINDS (catalog: "AgentPackage/ExtensionPackage/RolePackage/
 * CapabilityPackage governance"):
 * - AgentPackage: an agent body TEMPLATE (structurally compatible with
 *   @aurum/agent's CreateAgentBodyInput) + capability declarations +
 *   required model-binding purposes. The marketplace NEVER instantiates
 *   bodies — instantiation belongs to the W003 fabric, downstream of an
 *   activation + approval.
 * - ExtensionPackage: capability extensions for EXISTING bodies (additional
 *   permitted capabilities + capability supplies + a compatibility profile).
 * - RolePackage: a workforce role definition (responsibilities, skills,
 *   authority requirements) composable with the W005 role vocabulary
 *   (WorkforceRoleRecord-shaped: title + requiredCapabilities).
 * - CapabilityPackage: a standalone capability supply (tools, connectors,
 *   software).
 *
 * ALL records are tenant-scoped, versioned, immutable-once-published, with
 * rich provenance (publisher, evidence of claims, changelog).
 */
import type { MarketplaceActorReference } from "./primitives.js";
import type {
  MarketplaceProvenanceStamp,
  MarketplaceTenantScopedRecord,
  MarketplaceTimestamp,
} from "./primitives.js";
import type { MarketplaceValidationIssue } from "./primitives.js";
import type { MarketplacePackageKind, PublicationState } from "./vocabulary.js";
import {
  isKnownMarketplaceAgentCapability,
  isKnownMarketplaceBodyModelPurpose,
  isKnownCapabilitySupplyKind,
  isKnownMarketplaceEvidenceKind,
  isKnownMarketplacePackageKind,
} from "./vocabulary.js";

/** One declared capability supply of a package. */
export interface CapabilitySupplyDeclaration {
  readonly supplyKind: "tool" | "connector" | "software";
  /** The capability this supply provides (opaque capability id, W005 space). */
  readonly capabilityId: string;
  /** Proficiency level supplied (0..5, W005 proficiency scale). */
  readonly level: number;
  /** Capacity per period (opaque units). */
  readonly capacityPerPeriod: number;
  /** Optional opaque descriptor (never parsed by the marketplace). */
  readonly descriptor?: string;
}

/**
 * AgentPackage content: the agent body template + capability declarations +
 * required model-binding purposes. Structurally compatible with the W003
 * fabric's CreateAgentBodyInput (local mirror; the fabric adapter is a
 * documented post-CR stub).
 */
export interface AgentPackageContents {
  readonly kind: "agent";
  readonly bodyTemplate: {
    readonly displayName: string;
    readonly role: { readonly title: string; readonly description?: string };
    readonly permittedCapabilities: readonly string[];
    readonly memoryPolicy?: {
      readonly retention: "none" | "session" | "persistent";
      readonly sharing: "private" | "team" | "organization";
    };
    readonly escalation?: {
      readonly onUncertainty: "ask-human" | "proceed-with-caution" | "block";
    };
  };
  /** Capabilities the body is declared to supply (W005 capability ids). */
  readonly capabilityDeclarations: readonly CapabilitySupplyDeclaration[];
  /** Model-binding purposes the body requires (cognition/conversation/...). */
  readonly requiredBindings: readonly ("cognition" | "conversation" | "analysis" | "background")[];
}

/** ExtensionPackage content: capability extension for existing bodies. */
export interface ExtensionPackageContents {
  readonly kind: "extension";
  /** Additional permitted capabilities granted to compatible bodies. */
  readonly additionalCapabilities: readonly string[];
  /** Capability supplies the extension provides. */
  readonly capabilitySupplies: readonly CapabilitySupplyDeclaration[];
  /**
   * Compatibility profile: bodies must declare ALL of these capabilities
   * (and none of `incompatibleWith`) for the extension to apply.
   */
  readonly requiresBodyCapabilities: readonly string[];
  readonly incompatibleWith?: readonly string[];
}

/** RolePackage content: a workforce role definition (W005-composable). */
export interface RolePackageContents {
  readonly kind: "role";
  readonly roleDefinition: {
    readonly title: string;
    readonly description?: string;
    readonly responsibilities: readonly string[];
    readonly skills: readonly string[];
    /** Authority requirements — what actors in this role may be authorized for. */
    readonly authorityRequirements: readonly string[];
  };
  /** Capabilities the role requires (WorkforceRoleRecord.requiredCapabilities). */
  readonly requiredCapabilities: readonly string[];
}

/** CapabilityPackage content: a standalone capability supply. */
export interface CapabilityPackageContents {
  readonly kind: "capability";
  readonly supplies: readonly CapabilitySupplyDeclaration[];
}

/** The discriminated content union of the four package kinds. */
export type PackageVersionContents =
  | AgentPackageContents
  | ExtensionPackageContents
  | RolePackageContents
  | CapabilityPackageContents;

/** Evidence of claims: a typed reference backing a package's claims. */
export interface PackageEvidenceRef {
  readonly evidenceKind: string;
  readonly ref: string;
  /** Optional summary (bounded, no secrets). */
  readonly summary?: string;
}

/**
 * One immutable version of a package. The content payload is frozen at
 * PUBLICATION; a publisher iterating publishes a NEW version — existing
 * installations stay pinned to the version they installed (W011
 * versioning law).
 */
export interface PackageVersionRecord extends MarketplaceTenantScopedRecord {
  readonly packageId: string;
  readonly version: number;
  readonly contents: PackageVersionContents;
  /** Human-readable changelog entry for THIS version (non-empty). */
  readonly changelog: string;
  /** Evidence of claims (publisher-supplied, review-examined). */
  readonly evidenceRefs: readonly PackageEvidenceRef[];
  readonly publisher: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly createdAt: MarketplaceTimestamp;
  /** Machine 1 state (draft -> submitted -> published | rejected). */
  readonly publication: {
    readonly state: PublicationState;
    readonly history: readonly {
      readonly from: PublicationState;
      readonly to: PublicationState;
      readonly actor: MarketplaceActorReference;
      readonly at: MarketplaceTimestamp;
      readonly reason: string;
    }[];
  };
  readonly publishedAt?: MarketplaceTimestamp;
}

/** The package identity record (kind + owner + current versions index). */
export interface MarketplacePackage extends MarketplaceTenantScopedRecord {
  readonly packageId: string;
  readonly kind: MarketplacePackageKind;
  readonly summary: string;
  readonly publisher: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly createdAt: MarketplaceTimestamp;
}

function textIssues(value: unknown, field: string, max: number): MarketplaceValidationIssue[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [{ field, problem: "must be a non-empty string" }];
  }
  if (value.trim().length > max) {
    return [{ field, problem: `must be at most ${max} characters` }];
  }
  return [];
}

function validateSupplies(
  supplies: readonly CapabilitySupplyDeclaration[],
  fieldPrefix: string,
): MarketplaceValidationIssue[] {
  const issues: MarketplaceValidationIssue[] = [];
  if (supplies.length === 0) {
    issues.push({ field: fieldPrefix, problem: "must declare at least one supply" });
  }
  const seen = new Set<string>();
  supplies.forEach((supply, index) => {
    const field = `${fieldPrefix}[${index}]`;
    if (!isKnownCapabilitySupplyKind(supply.supplyKind)) {
      issues.push({ field: `${field}.supplyKind`, problem: "must be a known supply kind" });
    }
    issues.push(...textIssues(supply.capabilityId, `${field}.capabilityId`, 128));
    if (
      typeof supply.level !== "number" ||
      !Number.isInteger(supply.level) ||
      supply.level < 0 ||
      supply.level > 5
    ) {
      issues.push({ field: `${field}.level`, problem: "must be an integer in 0..5" });
    }
    if (
      typeof supply.capacityPerPeriod !== "number" ||
      !Number.isFinite(supply.capacityPerPeriod) ||
      supply.capacityPerPeriod <= 0
    ) {
      issues.push({ field: `${field}.capacityPerPeriod`, problem: "must be finite and > 0" });
    }
    if (supply.descriptor !== undefined && supply.descriptor.trim().length === 0) {
      issues.push({ field: `${field}.descriptor`, problem: "must be non-empty when present" });
    }
    const key = `${supply.capabilityId}`;
    if (seen.has(key)) {
      issues.push({ field: `${field}.capabilityId`, problem: "duplicated capability supply" });
    }
    seen.add(key);
  });
  return issues;
}

function validateCapabilityIds(
  values: readonly string[],
  fieldPrefix: string,
): MarketplaceValidationIssue[] {
  const issues: MarketplaceValidationIssue[] = [];
  values.forEach((value, index) => {
    issues.push(...textIssues(value, `${fieldPrefix}[${index}]`, 128));
  });
  return issues;
}

/** Validates the discriminated contents payload of a package version. */
export function packageContentsIssues(
  contents: PackageVersionContents | undefined,
  field = "contents",
): MarketplaceValidationIssue[] {
  if (!contents || typeof contents !== "object") {
    return [{ field, problem: "is required" }];
  }
  if (!isKnownMarketplacePackageKind(contents.kind)) {
    return [{ field: `${field}.kind`, problem: "must be a known package kind" }];
  }
  const issues: MarketplaceValidationIssue[] = [];
  if (contents.kind === "agent") {
    issues.push(...textIssues(contents.bodyTemplate.displayName, `${field}.bodyTemplate.displayName`, 128));
    issues.push(...textIssues(contents.bodyTemplate.role.title, `${field}.bodyTemplate.role.title`, 128));
    contents.bodyTemplate.permittedCapabilities.forEach((capability, index) => {
      if (!isKnownMarketplaceAgentCapability(capability)) {
        issues.push({
          field: `${field}.bodyTemplate.permittedCapabilities[${index}]`,
          problem: "must be a known agent capability (W003 fabric vocabulary)",
        });
      }
    });
    if (contents.bodyTemplate.permittedCapabilities.length === 0) {
      issues.push({
        field: `${field}.bodyTemplate.permittedCapabilities`,
        problem: "must declare at least one capability",
      });
    }
    contents.requiredBindings.forEach((purpose, index) => {
      if (!isKnownMarketplaceBodyModelPurpose(purpose)) {
        issues.push({
          field: `${field}.requiredBindings[${index}]`,
          problem: "must be a known body-model purpose (W003 fabric vocabulary)",
        });
      }
    });
    if (contents.requiredBindings.length === 0) {
      issues.push({ field: `${field}.requiredBindings`, problem: "must declare at least one binding purpose" });
    }
    issues.push(...validateSupplies(contents.capabilityDeclarations, `${field}.capabilityDeclarations`));
  } else if (contents.kind === "extension") {
    issues.push(
      ...validateCapabilityIds(contents.additionalCapabilities, `${field}.additionalCapabilities`),
    );
    if (contents.additionalCapabilities.length === 0) {
      issues.push({ field: `${field}.additionalCapabilities`, problem: "must declare at least one capability" });
    }
    issues.push(...validateSupplies(contents.capabilitySupplies, `${field}.capabilitySupplies`));
    if (contents.requiresBodyCapabilities.length === 0) {
      issues.push({ field: `${field}.requiresBodyCapabilities`, problem: "must declare a compatibility profile" });
    }
  } else if (contents.kind === "role") {
    const def = contents.roleDefinition;
    issues.push(...textIssues(def.title, `${field}.roleDefinition.title`, 128));
    if (def.responsibilities.length === 0) {
      issues.push({ field: `${field}.roleDefinition.responsibilities`, problem: "must be non-empty" });
    }
    if (def.skills.length === 0) {
      issues.push({ field: `${field}.roleDefinition.skills`, problem: "must be non-empty" });
    }
    if (def.authorityRequirements.length === 0) {
      issues.push({ field: `${field}.roleDefinition.authorityRequirements`, problem: "must be non-empty" });
    }
    issues.push(...validateCapabilityIds(def.responsibilities, `${field}.roleDefinition.responsibilities`));
    issues.push(...validateCapabilityIds(def.skills, `${field}.roleDefinition.skills`));
    issues.push(...validateCapabilityIds(def.authorityRequirements, `${field}.roleDefinition.authorityRequirements`));
    issues.push(...validateCapabilityIds(contents.requiredCapabilities, `${field}.requiredCapabilities`));
  } else {
    issues.push(...validateSupplies(contents.supplies, `${field}.supplies`));
  }
  return issues;
}

/** Validates a package version record in isolation (kind + provenance). */
export function packageVersionIssues(input: {
  packageId?: unknown;
  version?: unknown;
  contents?: PackageVersionContents;
  changelog?: unknown;
  evidenceRefs?: unknown;
}): MarketplaceValidationIssue[] {
  const issues: MarketplaceValidationIssue[] = [];
  issues.push(...textIssues(input.packageId, "packageId", 128));
  if (typeof input.version !== "number" || !Number.isInteger(input.version) || input.version < 1) {
    issues.push({ field: "version", problem: "must be an integer >= 1" });
  }
  issues.push(...textIssues(input.changelog, "changelog", 2000));
  issues.push(...packageContentsIssues(input.contents));
  const evidenceRefs = input.evidenceRefs;
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    issues.push({ field: "evidenceRefs", problem: "must list at least one evidence reference" });
  } else {
    evidenceRefs.forEach((evidence, index) => {
      const field = `evidenceRefs[${index}]`;
      if (!evidence || typeof evidence !== "object") {
        issues.push({ field, problem: "is required" });
        return;
      }
      if (!isKnownMarketplaceEvidenceKind(evidence.evidenceKind)) {
        issues.push({ field: `${field}.evidenceKind`, problem: "must be a known evidence kind" });
      }
      issues.push(...textIssues(evidence.ref, `${field}.ref`, 256));
    });
  }
  return issues;
}

/** Validated construction of a DRAFT package version (machine 1 entry). */
export function buildDraftPackageVersion(input: {
  readonly scope: MarketplaceTenantScopedRecord["scope"];
  readonly packageId: string;
  readonly version: number;
  readonly contents: PackageVersionContents;
  readonly changelog: string;
  readonly evidenceRefs: readonly PackageEvidenceRef[];
  readonly publisher: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
}): PackageVersionRecord {
  return {
    scope: input.scope,
    packageId: input.packageId,
    version: input.version,
    contents: input.contents,
    changelog: input.changelog.trim(),
    evidenceRefs: Object.freeze([...input.evidenceRefs]),
    publisher: input.publisher,
    provenance: input.provenance,
    createdAt: input.now,
    publication: { state: "draft", history: Object.freeze([]) },
  };
}
