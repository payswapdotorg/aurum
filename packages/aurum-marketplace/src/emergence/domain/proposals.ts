/**
 * Emergence proposal records (W014 domain layer): the governed ROLE and
 * PACKAGE proposals — evidence, demand and alternatives as MANDATORY typed
 * fields (catalog acceptance clause a).
 *
 * THE GOVERNED SHAPE (both kinds share it):
 * - `evidence` — the derived gap EMBEDDED VERBATIM (with its citation
 *   chain: verbatim outcome/unknown ids, affected goals/missions, the
 *   detection query for reproducibility);
 * - `demand` — recurrence count, affected goals/missions, demanded
 *   capabilities, effort/metric signals (all mechanical, from the gap);
 * - `alternatives` — MANDATORY non-empty typed array (see alternatives.ts;
 *   validation refuses an empty list — alternatives are never optional,
 *   never free text).
 *
 * PROPOSE/DISPOSE LAW: any actor may PROPOSE (the constitution: "Lab may
 * … propose roles"); only a PERSON may review (accept/decline) — a typed
 * fail-closed refusal otherwise (R7; employment-impacting recommendations
 * stay human-authorized). Publication is NOT part of this lifecycle: the
 * catalog-draft projection (catalogDraft.ts) is the ONLY bridge toward
 * the W011 publication machine, and it requires an ACCEPTED proposal.
 */
import { deepFreezeMarketplace } from "../../marketplace/contract.marketplace.js";
import type {
  MarketplaceActorReference,
  MarketplaceProvenanceStamp,
  MarketplaceTenantScope,
  MarketplaceTenantScopedRecord,
  MarketplaceTimestamp,
  MarketplaceValidationIssue,
  CapabilitySupplyDeclaration,
} from "../../marketplace/contract.marketplace.js";
import { marketplaceProvenanceIssues } from "../../marketplace/contract.marketplace.js";
import type { EmergenceAlternative } from "./alternatives.js";
import type { EmergenceGap } from "./gaps.js";
import {
  emergenceLifecycleIllegal,
  emergenceUnauthorized,
  emergenceValidationError,
} from "./errors.js";
import type { EmergenceError } from "./errors.js";
import { emergenceProposalTransitionLegal, EMERGENCE_ALTERNATIVES_RULE } from "./vocabulary.js";
import type { EmergenceProposalState } from "./vocabulary.js";
import type { Result } from "../../marketplace/contract.marketplace.js";
import { err, ok } from "../../marketplace/contract.marketplace.js";

/** The workforce-role shape a role proposal drafts (RolePackage-shaped). */
export interface EmergenceRoleShape {
  readonly roleDefinition: {
    readonly title: string;
    readonly description?: string;
    readonly responsibilities: readonly string[];
    readonly skills: readonly string[];
    readonly authorityRequirements: readonly string[];
  };
  readonly requiredCapabilities: readonly string[];
}

/** The capability-package bundle a package proposal drafts. */
export interface EmergencePackageBundle {
  readonly capabilitySupplies: readonly CapabilitySupplyDeclaration[];
  readonly processRequirements: readonly string[];
  readonly workforceRequirements: readonly string[];
}

/** The evidence block: the derived gap, embedded verbatim. */
export interface EmergenceEvidenceBlock {
  readonly gap: EmergenceGap;
}

/** The demand block: mechanical demand signals from the gap. */
export interface EmergenceDemandBlock {
  readonly recurrenceCount: number;
  readonly affectedGoalIds: readonly string[];
  readonly affectedMissionRefs: readonly string[];
  readonly demandedCapabilities: readonly { capabilityId: string; level: number }[];
  readonly effortShareSum?: number;
  readonly metricName?: string;
}

/** The review outcome (present iff the proposal reached a terminal state). */
export interface EmergenceProposalReview {
  readonly decision: "accepted" | "declined";
  readonly reviewer: MarketplaceActorReference;
  readonly at: MarketplaceTimestamp;
  readonly reason: string;
}

interface EmergenceProposalBase extends MarketplaceTenantScopedRecord {
  readonly proposalId: string;
  readonly state: EmergenceProposalState;
  readonly evidence: EmergenceEvidenceBlock;
  readonly demand: EmergenceDemandBlock;
  readonly alternatives: readonly EmergenceAlternative[];
  readonly alternativesRule: string;
  readonly proposedBy: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly createdAt: MarketplaceTimestamp;
  readonly review?: EmergenceProposalReview;
}

/** A governed ROLE proposal (projects onto a RolePackage draft). */
export interface EmergenceRoleProposal extends EmergenceProposalBase {
  readonly kind: "role";
  readonly roleShape: EmergenceRoleShape;
}

/** A governed PACKAGE proposal (projects onto a CapabilityPackage draft). */
export interface EmergencePackageProposal extends EmergenceProposalBase {
  readonly kind: "package";
  readonly bundle: EmergencePackageBundle;
}

/** The discriminated proposal union. */
export type EmergenceProposal = EmergenceRoleProposal | EmergencePackageProposal;

function textIssues(value: unknown, field: string, max: number): MarketplaceValidationIssue[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [{ field, problem: "must be a non-empty string" }];
  }
  if (value.trim().length > max) {
    return [{ field, problem: `must be at most ${max} characters` }];
  }
  return [];
}

function nonEmptyListIssues(
  values: readonly string[] | undefined,
  field: string,
): MarketplaceValidationIssue[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [{ field, problem: "must be a non-empty list" }];
  }
  const issues: MarketplaceValidationIssue[] = [];
  values.forEach((value, index) => {
    issues.push(...textIssues(value, `${field}[${index}]`, 200));
  });
  return issues;
}

/** Validates an alternatives block: MANDATORY, non-empty, well-formed. */
export function alternativesIssues(
  alternatives: readonly EmergenceAlternative[] | undefined,
): MarketplaceValidationIssue[] {
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    return [
      {
        field: "alternatives",
        problem: "must list at least one considered alternative (alternatives are mandatory)",
      },
    ];
  }
  const issues: MarketplaceValidationIssue[] = [];
  alternatives.forEach((alternative, index) => {
    const field = `alternatives[${index}]`;
    if (!alternative || typeof alternative !== "object") {
      issues.push({ field, problem: "is required" });
      return;
    }
    if (
      alternative.kind !== "catalog-package" &&
      alternative.kind !== "open-recruitment" &&
      alternative.kind !== "none-available"
    ) {
      issues.push({ field: `${field}.kind`, problem: "must be a known alternative kind" });
      return;
    }
    issues.push(...textIssues(alternative.shortfall, `${field}.shortfall`, 500));
    if (alternative.kind === "catalog-package") {
      issues.push(...textIssues(alternative.packageId, `${field}.packageId`, 128));
      if (!Number.isInteger(alternative.version) || alternative.version < 1) {
        issues.push({ field: `${field}.version`, problem: "must be an integer >= 1" });
      }
    } else if (alternative.kind === "open-recruitment") {
      issues.push(...textIssues(alternative.requestId, `${field}.requestId`, 128));
    }
  });
  return issues;
}

/** Validates the proposal input's shared governed shape. */
function baseIssues(input: {
  proposalId?: unknown;
  gap?: EmergenceGap | undefined;
  alternatives?: readonly EmergenceAlternative[] | undefined;
  provenance?: MarketplaceProvenanceStamp;
}): MarketplaceValidationIssue[] {
  const issues: MarketplaceValidationIssue[] = [];
  issues.push(...textIssues(input.proposalId, "proposalId", 128));
  if (!input.gap || typeof input.gap !== "object") {
    issues.push({ field: "gap", problem: "the derived gap is required (evidence)" });
  } else if (input.gap.outcomeIds.length === 0 && (input.gap.unknownIds?.length ?? 0) === 0) {
    issues.push({
      field: "gap.citations",
      problem: "the gap must cite at least one record id (no fabrication)",
    });
  }
  issues.push(...alternativesIssues(input.alternatives));
  issues.push(...marketplaceProvenanceIssues(input.provenance));
  return issues;
}

function roleShapeIssues(shape: EmergenceRoleShape | undefined): MarketplaceValidationIssue[] {
  if (!shape || typeof shape !== "object") {
    return [{ field: "roleShape", problem: "is required for role proposals" }];
  }
  const issues: MarketplaceValidationIssue[] = [];
  issues.push(...textIssues(shape.roleDefinition?.title, "roleShape.roleDefinition.title", 128));
  issues.push(
    ...nonEmptyListIssues(
      shape.roleDefinition?.responsibilities,
      "roleShape.roleDefinition.responsibilities",
    ),
  );
  issues.push(
    ...nonEmptyListIssues(shape.roleDefinition?.skills, "roleShape.roleDefinition.skills"),
  );
  issues.push(
    ...nonEmptyListIssues(
      shape.roleDefinition?.authorityRequirements,
      "roleShape.roleDefinition.authorityRequirements",
    ),
  );
  issues.push(...nonEmptyListIssues(shape.requiredCapabilities, "roleShape.requiredCapabilities"));
  return issues;
}

function bundleIssues(bundle: EmergencePackageBundle | undefined): MarketplaceValidationIssue[] {
  if (!bundle || typeof bundle !== "object") {
    return [{ field: "bundle", problem: "is required for package proposals" }];
  }
  const issues: MarketplaceValidationIssue[] = [];
  if (!Array.isArray(bundle.capabilitySupplies) || bundle.capabilitySupplies.length === 0) {
    issues.push({
      field: "bundle.capabilitySupplies",
      problem: "must declare at least one capability supply",
    });
  }
  issues.push(...nonEmptyListIssues(bundle.processRequirements, "bundle.processRequirements"));
  issues.push(...nonEmptyListIssues(bundle.workforceRequirements, "bundle.workforceRequirements"));
  return issues;
}

/**
 * Builds a governed proposal in the `proposed` state. Validates the full
 * governed shape: evidence (the gap with its citation chain), demand
 * (mechanical fields from the gap), alternatives (MANDATORY), the
 * role/package draft shape and provenance. Exactly one of roleShape /
 * bundle must be present (the kind is derived from it).
 */
export function buildEmergenceProposal(
  input: {
    readonly scope: MarketplaceTenantScope;
    readonly proposalId: string;
    readonly gap: EmergenceGap;
    readonly alternatives: readonly EmergenceAlternative[];
    readonly proposedBy: MarketplaceActorReference;
    readonly provenance: MarketplaceProvenanceStamp;
    readonly now: MarketplaceTimestamp;
  } & (
    | { readonly kind: "role"; readonly roleShape: EmergenceRoleShape }
    | { readonly kind: "package"; readonly bundle: EmergencePackageBundle }
  ),
): Result<EmergenceProposal, EmergenceError> {
  const issues = [
    ...baseIssues(input),
    ...(input.kind === "role" ? roleShapeIssues(input.roleShape) : bundleIssues(input.bundle)),
  ];
  if (issues.length > 0) {
    return err(emergenceValidationError(issues));
  }
  const demand: EmergenceDemandBlock = deepFreezeMarketplace({
    recurrenceCount: input.gap.recurrenceCount,
    affectedGoalIds: input.gap.affectedGoalIds,
    affectedMissionRefs: input.gap.affectedMissionRefs,
    demandedCapabilities: input.gap.demandedCapabilities,
    ...(input.gap.effortShareSum !== undefined ? { effortShareSum: input.gap.effortShareSum } : {}),
    ...(input.gap.metricName !== undefined ? { metricName: input.gap.metricName } : {}),
  });
  const base = {
    scope: input.scope,
    proposalId: input.proposalId,
    state: "proposed" as const,
    evidence: deepFreezeMarketplace({ gap: input.gap }),
    demand,
    alternatives: Object.freeze([...input.alternatives]),
    alternativesRule: EMERGENCE_ALTERNATIVES_RULE,
    proposedBy: input.proposedBy,
    provenance: input.provenance,
    createdAt: input.now,
  };
  if (input.kind === "role") {
    return ok(
      deepFreezeMarketplace({
        ...base,
        kind: "role" as const,
        roleShape: deepFreezeMarketplace({
          roleDefinition: deepFreezeMarketplace({
            ...input.roleShape.roleDefinition,
            responsibilities: Object.freeze([...input.roleShape.roleDefinition.responsibilities]),
            skills: Object.freeze([...input.roleShape.roleDefinition.skills]),
            authorityRequirements: Object.freeze([
              ...input.roleShape.roleDefinition.authorityRequirements,
            ]),
          }),
          requiredCapabilities: Object.freeze([...input.roleShape.requiredCapabilities]),
        }),
      }),
    );
  }
  return ok(
    deepFreezeMarketplace({
      ...base,
      kind: "package" as const,
      bundle: deepFreezeMarketplace({
        capabilitySupplies: Object.freeze([...input.bundle.capabilitySupplies]),
        processRequirements: Object.freeze([...input.bundle.processRequirements]),
        workforceRequirements: Object.freeze([...input.bundle.workforceRequirements]),
      }),
    }),
  );
}

/**
 * Reviews a proposal (the DISPOSE). HUMAN-GOVERNED: the reviewer must be a
 * `person` actor — the Lab (and any system/agent/external actor) proposes,
 * humans dispose. Fail-closed typed refusal otherwise, with the proposal
 * untouched. `proposed -> accepted | declined` only; terminal states
 * refuse further transitions.
 */
export function reviewEmergenceProposal(
  proposal: EmergenceProposal,
  input: {
    readonly decision: "accepted" | "declined";
    readonly reviewer: MarketplaceActorReference;
    readonly reason: string;
    readonly now: MarketplaceTimestamp;
  },
): Result<EmergenceProposal, EmergenceError> {
  if (input.reviewer.kind !== "person") {
    return err(
      emergenceUnauthorized(
        "emergence proposal review is human-governed: the Lab proposes, never disposes (reviewer must be a person actor)",
      ),
    );
  }
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    return err(
      emergenceValidationError([{ field: "reason", problem: "must be a non-empty string" }]),
    );
  }
  if (!emergenceProposalTransitionLegal(proposal.state, input.decision)) {
    return err(emergenceLifecycleIllegal("emergence proposal", proposal.state, input.decision));
  }
  return ok(
    deepFreezeMarketplace({
      ...proposal,
      state: input.decision,
      review: deepFreezeMarketplace({
        decision: input.decision,
        reviewer: input.reviewer,
        at: input.now,
        reason: input.reason.trim(),
      }),
    }),
  );
}
