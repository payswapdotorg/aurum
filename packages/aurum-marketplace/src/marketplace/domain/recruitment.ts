/**
 * RECRUITMENT lifecycle (W011 domain layer): the flow that lands
 * marketplace packages into the tenant's workforce.
 *
 * request (need + constraints + evidence requirements) -> candidate
 * packages (from the tenant's PUBLISHED catalog, ranked DETERMINISTICALLY
 * with inspectable criteria) -> installation + activation of the chosen
 * one (machines 2+3, sequenced — never a fused primitive) -> registration
 * into the W005 candidate/workforce seams BY REFERENCE (the registration
 * port carries package/installation/activation refs, never record copies)
 * -> eligible for W009 plan allocation.
 *
 * PROPOSE/DISPOSE LAW: recruitment PROPOSES (the ranked proposal); the
 * W002/W005 authority seams DISPOSE (resolution requires an authority
 * citation asserted against the W002-shaped port; registration goes
 * through the W005-shaped port).
 *
 * RANKING LAW (mirrors the W008 lab evaluation discipline): deterministic
 * given the same inputs — weighted score descending, then packageId
 * ascending (codepoint order). Weights and raw criteria values are
 * recorded on EVERY ranked candidate (inspectability). No randomness, no
 * environment reads, no clock reads.
 */
import { deepFreezeMarketplace, err, ok, type Result } from "./primitives.js";
import type {
  MarketplaceActorReference,
  MarketplaceProvenanceStamp,
  MarketplaceTenantScope,
  MarketplaceTenantScopedRecord,
  MarketplaceTimestamp,
  MarketplaceValidationIssue,
} from "./primitives.js";
import { marketplaceLifecycleIllegal } from "./errors.js";
import type { MarketplaceError } from "./errors.js";
import type { PackageVersionRecord } from "./records.js";
import { isPublishedVersion } from "./publication.js";
import type { CapabilitySupplyDeclaration } from "./records.js";

/** One demanded capability of a recruitment request. */
export interface RecruitmentDemand {
  readonly capabilityId: string;
  readonly minLevel: number;
  readonly minCapacityPerPeriod?: number;
}

/** Fixed default ranking weights (deterministic; recorded on proposals). */
export const DEFAULT_RECRUITMENT_WEIGHTS = {
  capabilityMatch: 0.4,
  evidenceStrength: 0.2,
  versionMaturity: 0.1,
  scopeDiscipline: 0.3,
} as const;

export type RecruitmentWeights = typeof DEFAULT_RECRUITMENT_WEIGHTS;

/** The four inspectable criteria (each normalized to [0, 1]). */
export interface RecruitmentCriteria {
  readonly capabilityMatch: number;
  readonly evidenceStrength: number;
  readonly versionMaturity: number;
  readonly scopeDiscipline: number;
}

/** One ranked candidate package (raw criteria + weighted total). */
export interface RankedCandidatePackage {
  readonly packageId: string;
  readonly version: number;
  readonly kind: string;
  readonly criteria: RecruitmentCriteria;
  readonly weightedScore: number;
}

/** The recruitment request record (open -> resolved | cancelled). */
export interface RecruitmentRequest extends MarketplaceTenantScopedRecord {
  readonly requestId: string;
  /** The need: a demanded capability profile (+ optional target kinds). */
  readonly demand: readonly RecruitmentDemand[];
  readonly targetPackageKinds?: readonly string[];
  /** Required evidence kinds the candidates must carry. */
  readonly requiredEvidenceKinds: readonly string[];
  /** Excluded package ids (deterministic constraint surface). */
  readonly excludedPackageIds: readonly string[];
  readonly state: "open" | "resolved" | "cancelled";
  readonly requestedBy: MarketplaceActorReference;
  readonly requestedAt: MarketplaceTimestamp;
  readonly provenance: MarketplaceProvenanceStamp;
  /** The ranked proposal (set when candidates were ranked). */
  readonly proposal?: readonly RankedCandidatePackage[];
  readonly weights: RecruitmentWeights;
  /** Present iff state === "resolved": the resolution outcome. */
  readonly resolution?: RecruitmentResolution;
}

/**
 * The resolution outcome: the chosen candidate, the SEPARATE installation +
 * activation identities (machines 2+3 — two distinct audited records), and
 * the W005 registration reference (by reference, never a copy).
 */
export interface RecruitmentResolution {
  readonly chosenPackageId: string;
  readonly chosenVersion: number;
  readonly installationId: string;
  readonly activationId: string;
  /** The W005-seam registration reference (opaque; the seam owns the record). */
  readonly registrationRef: string;
  readonly resolvedBy: MarketplaceActorReference;
  readonly resolvedAt: MarketplaceTimestamp;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function suppliesOf(version: PackageVersionRecord): readonly CapabilitySupplyDeclaration[] {
  const contents = version.contents;
  if (contents.kind === "agent") return contents.capabilityDeclarations;
  if (contents.kind === "extension") return contents.capabilitySupplies;
  if (contents.kind === "capability") return contents.supplies;
  return contents.requiredCapabilities.map((capabilityId) => ({
    supplyKind: "tool" as const,
    capabilityId,
    level: 3,
    capacityPerPeriod: 1,
  }));
}

/**
 * The package version's declared capability supplies (any kind; role
 * packages project their required capabilities at a nominal level). Used
 * by recruitment ranking AND by the registration payload (the W005 seam's
 * capability allocation inputs).
 */
export function packageSuppliesOf(
  version: PackageVersionRecord,
): readonly CapabilitySupplyDeclaration[] {
  return suppliesOf(version);
}

/**
 * Ranks PUBLISHED catalog versions against a request. Deterministic:
 * weighted score descending, then packageId ascending. Only versions in
 * `published` state within the request's tenant participate; non-matching
 * kinds and excluded ids are filtered out. Every result carries its raw
 * criteria + weights (inspectability law).
 */
export function rankCandidatePackages(
  request: Pick<
    RecruitmentRequest,
    "demand" | "targetPackageKinds" | "requiredEvidenceKinds" | "excludedPackageIds" | "weights"
  >,
  catalogVersions: readonly PackageVersionRecord[],
): readonly RankedCandidatePackage[] {
  const candidates = catalogVersions.filter(
    (version) =>
      isPublishedVersion(version) &&
      !request.excludedPackageIds.includes(version.packageId) &&
      (request.targetPackageKinds === undefined ||
        request.targetPackageKinds.includes(version.contents.kind)),
  );
  const ranked: RankedCandidatePackage[] = candidates.map((version) => {
    const supplies = suppliesOf(version);
    // capabilityMatch: fraction of demand entries covered at level+capacity.
    let met = 0;
    for (const entry of request.demand) {
      const covering = supplies.filter(
        (supply) =>
          supply.capabilityId === entry.capabilityId &&
          supply.level >= entry.minLevel &&
          (entry.minCapacityPerPeriod === undefined ||
            supply.capacityPerPeriod >= entry.minCapacityPerPeriod),
      );
      if (covering.length > 0) met += 1;
    }
    const capabilityMatch = request.demand.length === 0 ? 1 : met / request.demand.length;
    // evidenceStrength: fraction of required evidence kinds present.
    const presentKinds = new Set(version.evidenceRefs.map((evidence) => evidence.evidenceKind));
    let evidenced = 0;
    for (const kind of request.requiredEvidenceKinds) {
      if (presentKinds.has(kind)) evidenced += 1;
    }
    const evidenceStrength =
      request.requiredEvidenceKinds.length === 0
        ? 1
        : evidenced / request.requiredEvidenceKinds.length;
    // versionMaturity: min(version, 10) / 10 — deterministic from the record.
    const versionMaturity = Math.min(version.version, 10) / 10;
    // scopeDiscipline: share of the package's supplies the request demanded
    // (least-privilege: over-supplying packages rank lower).
    const demandedIds = new Set(request.demand.map((entry) => entry.capabilityId));
    const inScope = supplies.filter((supply) => demandedIds.has(supply.capabilityId)).length;
    const scopeDiscipline = supplies.length === 0 ? 1 : inScope / supplies.length;
    const criteria: RecruitmentCriteria = {
      capabilityMatch: round4(capabilityMatch),
      evidenceStrength: round4(evidenceStrength),
      versionMaturity: round4(versionMaturity),
      scopeDiscipline: round4(scopeDiscipline),
    };
    const weightedScore = round4(
      criteria.capabilityMatch * request.weights.capabilityMatch +
        criteria.evidenceStrength * request.weights.evidenceStrength +
        criteria.versionMaturity * request.weights.versionMaturity +
        criteria.scopeDiscipline * request.weights.scopeDiscipline,
    );
    return {
      packageId: version.packageId,
      version: version.version,
      kind: version.contents.kind,
      criteria,
      weightedScore,
    };
  });
  return Object.freeze(
    [...ranked].sort(
      (a, b) => b.weightedScore - a.weightedScore || (a.packageId < b.packageId ? -1 : 1),
    ),
  );
}

/** Validates a recruitment request's shape. */
export function recruitmentRequestIssues(input: {
  requestId?: unknown;
  demand?: unknown;
  requiredEvidenceKinds?: unknown;
}): MarketplaceValidationIssue[] {
  const issues: MarketplaceValidationIssue[] = [];
  if (typeof input.requestId !== "string" || input.requestId.trim().length === 0) {
    issues.push({ field: "requestId", problem: "must be a non-empty string" });
  }
  const demand = input.demand;
  if (!Array.isArray(demand) || demand.length === 0) {
    issues.push({ field: "demand", problem: "must list at least one demanded capability" });
  } else {
    demand.forEach((entry, index) => {
      const field = `demand[${index}]`;
      if (!entry || typeof entry !== "object") {
        issues.push({ field, problem: "is required" });
        return;
      }
      if (typeof entry.capabilityId !== "string" || entry.capabilityId.trim().length === 0) {
        issues.push({ field: `${field}.capabilityId`, problem: "must be a non-empty string" });
      }
      if (!Number.isInteger(entry.minLevel) || entry.minLevel < 0 || entry.minLevel > 5) {
        issues.push({ field: `${field}.minLevel`, problem: "must be an integer in 0..5" });
      }
    });
  }
  const kinds = input.requiredEvidenceKinds;
  if (!Array.isArray(kinds)) {
    issues.push({ field: "requiredEvidenceKinds", problem: "must be an array" });
  }
  return issues;
}

/** Builds an OPEN recruitment request (pure construction). */
export function buildRecruitmentRequest(input: {
  readonly scope: MarketplaceTenantScope;
  readonly requestId: string;
  readonly demand: readonly RecruitmentDemand[];
  readonly targetPackageKinds?: readonly string[];
  readonly requiredEvidenceKinds: readonly string[];
  readonly excludedPackageIds: readonly string[];
  readonly requestedBy: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
}): RecruitmentRequest {
  return deepFreezeMarketplace({
    scope: input.scope,
    requestId: input.requestId,
    demand: Object.freeze([...input.demand]),
    ...(input.targetPackageKinds
      ? { targetPackageKinds: Object.freeze([...input.targetPackageKinds]) }
      : {}),
    requiredEvidenceKinds: Object.freeze([...input.requiredEvidenceKinds]),
    excludedPackageIds: Object.freeze([...input.excludedPackageIds]),
    state: "open" as const,
    requestedBy: input.requestedBy,
    requestedAt: input.now,
    provenance: input.provenance,
    weights: DEFAULT_RECRUITMENT_WEIGHTS,
  });
}

/** Attaches the ranked proposal to an OPEN request (pure). */
export function attachProposal(
  request: RecruitmentRequest,
  proposal: readonly RankedCandidatePackage[],
): Result<RecruitmentRequest, MarketplaceError> {
  if (request.state !== "open") {
    return err(marketplaceLifecycleIllegal("recruitment", request.state, "open"));
  }
  return ok(
    deepFreezeMarketplace({
      ...request,
      proposal: Object.freeze([...proposal]),
    }),
  );
}

/** Marks a request resolved (pure — the app layer performs machine 2+3+registration first). */
export function resolveRequest(
  request: RecruitmentRequest,
  resolution: RecruitmentResolution,
): Result<RecruitmentRequest, MarketplaceError> {
  if (request.state !== "open") {
    return err(marketplaceLifecycleIllegal("recruitment", request.state, "resolved"));
  }
  return ok(
    deepFreezeMarketplace({
      ...request,
      state: "resolved" as const,
      resolution,
    }),
  );
}

/** Marks a request cancelled (pure). */
export function cancelRequest(
  request: RecruitmentRequest,
): Result<RecruitmentRequest, MarketplaceError> {
  if (request.state !== "open") {
    return err(marketplaceLifecycleIllegal("recruitment", request.state, "cancelled"));
  }
  return ok(deepFreezeMarketplace({ ...request, state: "cancelled" as const }));
}
