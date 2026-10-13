/**
 * Alternatives derivation (W014 domain layer): the MANDATORY alternatives
 * block of every emergence proposal, derived MECHANICALLY from the
 * marketplace's own surfaces — never free text (catalog acceptance clause
 * a: "proposal has evidence, demand and alternatives").
 *
 * TWO SURFACES ARE CONSULTED (deterministically, in this order):
 * 1. the tenant's PUBLISHED catalog — ranked against the gap's demanded
 *    capabilities with W011's OWN pure ranker (`rankCandidatePackages`,
 *    the same deterministic weighted scoring recruitment uses), each of
 *    the top candidates carrying a MECHANICAL shortfall reason (the
 *    uncovered capability list at required levels, its capabilityMatch);
 * 2. the tenant's OPEN recruitment requests whose demand overlaps the
 *    gap's demanded capabilities (an unresolved attempt to fill this need
 *    is itself an alternative that fell short);
 * 3. when BOTH scans come back empty, the typed `none-available` fallback
 *    records the empty scan itself (the tenant has no existing surface
 *    for this demand — the honest alternative is "nothing exists").
 *
 * The alternatives list is therefore never empty, never fabricated, and
 * never caller-authored: it is a pure function of (gap, catalog,
 * recruitments).
 */
import {
  DEFAULT_RECRUITMENT_WEIGHTS,
  packageSuppliesOf,
  rankCandidatePackages,
} from "../../marketplace/contract.marketplace.js";
import type {
  PackageVersionRecord,
  RecruitmentRequest,
} from "../../marketplace/contract.marketplace.js";
import { EMERGENCE_ALTERNATIVES_RULE } from "./vocabulary.js";
import type { EmergenceGap } from "./gaps.js";

/** How many ranked catalog candidates are recorded as alternatives. */
export const TOP_ALTERNATIVES_LIMIT = 3;

/** A marketplace catalog package considered as an alternative. */
export interface CatalogPackageAlternative {
  readonly kind: "catalog-package";
  readonly packageId: string;
  readonly version: number;
  readonly packageKind: string;
  /** Mechanical shortfall reason (machine-generated, inspectable). */
  readonly shortfall: string;
  /** The ranked criteria of this alternative (inspectability law). */
  readonly coverage: {
    readonly capabilityMatch: number;
    readonly uncovered: readonly string[];
  };
}

/** An open recruitment request considered as an alternative. */
export interface OpenRecruitmentAlternative {
  readonly kind: "open-recruitment";
  readonly requestId: string;
  readonly shortfall: string;
  readonly overlappingCapabilities: readonly string[];
}

/** The empty-scan fallback (only when both surfaces are empty). */
export interface NoneAvailableAlternative {
  readonly kind: "none-available";
  readonly shortfall: string;
  readonly scan: { readonly catalogCandidates: number; readonly openRecruitments: number };
}

/** One typed alternative. MANDATORY on every proposal; never free text. */
export type EmergenceAlternative =
  | CatalogPackageAlternative
  | OpenRecruitmentAlternative
  | NoneAvailableAlternative;

function uncoveredOf(gap: EmergenceGap, version: PackageVersionRecord): readonly string[] {
  const supplies = packageSuppliesOf(version);
  return Object.freeze(
    gap.demandedCapabilities
      .filter(
        (entry) =>
          !supplies.some(
            (supply) => supply.capabilityId === entry.capabilityId && supply.level >= entry.level,
          ),
      )
      .map((entry) => `${entry.capabilityId} (level ${entry.level} required, no supply)`),
  );
}

function catalogAlternativesOf(
  gap: EmergenceGap,
  catalogVersions: readonly PackageVersionRecord[],
): readonly EmergenceAlternative[] {
  if (gap.demandedCapabilities.length === 0) return [];
  const ranked = rankCandidatePackages(
    {
      demand: gap.demandedCapabilities.map((entry) => ({
        capabilityId: entry.capabilityId,
        minLevel: entry.level,
      })),
      targetPackageKinds: undefined,
      requiredEvidenceKinds: [],
      excludedPackageIds: [],
      weights: DEFAULT_RECRUITMENT_WEIGHTS,
    },
    catalogVersions,
  );
  return ranked.slice(0, TOP_ALTERNATIVES_LIMIT).map((candidate) => {
    const version = catalogVersions.find(
      (record) => record.packageId === candidate.packageId && record.version === candidate.version,
    );
    const uncovered = version ? uncoveredOf(gap, version) : [];
    const shortfall =
      uncovered.length === 0
        ? `covers the demanded profile (capabilityMatch ${candidate.criteria.capabilityMatch}) — ranked ${candidate.packageId} first; recruit or extend it before proposing something new`
        : `capabilityMatch ${candidate.criteria.capabilityMatch} — uncovered: ${uncovered.join(", ")}`;
    return {
      kind: "catalog-package" as const,
      packageId: candidate.packageId,
      version: candidate.version,
      packageKind: candidate.kind,
      shortfall,
      coverage: {
        capabilityMatch: candidate.criteria.capabilityMatch,
        uncovered,
      },
    };
  });
}

function recruitmentAlternativesOf(
  gap: EmergenceGap,
  recruitments: readonly RecruitmentRequest[],
): readonly EmergenceAlternative[] {
  if (gap.demandedCapabilities.length === 0) return [];
  const demanded = new Set(gap.demandedCapabilities.map((entry) => entry.capabilityId));
  return Object.freeze(
    recruitments
      .filter((request) => request.state === "open")
      .map((request) => ({
        request,
        overlapping: request.demand
          .map((entry) => entry.capabilityId)
          .filter((capabilityId) => demanded.has(capabilityId)),
      }))
      .filter((entry) => entry.overlapping.length > 0)
      .sort((a, b) => (a.request.requestId < b.request.requestId ? -1 : 1))
      .map((entry) => ({
        kind: "open-recruitment" as const,
        requestId: entry.request.requestId,
        shortfall: `recruitment ${entry.request.requestId} is still open for overlapping capabilities (${entry.overlapping.join(", ")}) — no candidate has landed`,
        overlappingCapabilities: Object.freeze([...entry.overlapping]),
      })),
  );
}

/**
 * Derives the alternatives block for a gap: ranked catalog candidates with
 * mechanical shortfalls + overlapping open recruitments + the typed
 * none-available fallback when both scans are empty. Pure and
 * deterministic; ordering: catalog (W011 ranking rule), then recruitments
 * (requestId ascending).
 */
export function deriveEmergenceAlternatives(
  gap: EmergenceGap,
  catalogVersions: readonly PackageVersionRecord[],
  recruitments: readonly RecruitmentRequest[],
): readonly EmergenceAlternative[] {
  const catalogAlternatives = catalogAlternativesOf(gap, catalogVersions);
  const recruitmentAlternatives = recruitmentAlternativesOf(gap, recruitments);
  if (catalogAlternatives.length > 0 || recruitmentAlternatives.length > 0) {
    return Object.freeze([...catalogAlternatives, ...recruitmentAlternatives]);
  }
  return [
    {
      kind: "none-available",
      shortfall:
        "no published package and no open recruitment addresses the demanded capabilities — the tenant has no existing surface for this demand",
      scan: { catalogCandidates: catalogVersions.length, openRecruitments: recruitments.length },
    },
  ];
}

/** The alternatives rule id recorded on every proposal (inspectability). */
export function alternativesRuleId(): string {
  return EMERGENCE_ALTERNATIVES_RULE;
}
