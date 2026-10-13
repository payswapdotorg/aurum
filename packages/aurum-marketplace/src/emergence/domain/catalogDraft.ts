/**
 * Catalog-draft projection (W014 domain layer): the ONLY bridge from an
 * accepted emergence proposal toward the W011 publication machine — a PURE
 * PROJECTION returning a `DraftPackageInput`-shaped VALUE.
 *
 * THE PROPOSE/NEVER-PUBLISH LAW (catalog acceptance clauses b+c): this
 * function performs NO store write and NO publication mutation. It returns
 * machine 1's ENTRY-state input (a draft, still fully governed: the
 * publisher must draft it, a publisher must submit it, and a PERSON
 * reviewer must publish it — all through the W011 governance surface,
 * unchanged). Anything but an ACCEPTED proposal is refused with the
 * dedicated `emergence-publication-refused` typed error.
 *
 * PROJECTION RULES (recorded as EMERGENCE_CATALOG_DRAFT_RULE):
 * - role proposals project onto `RolePackageContents` (the role definition
 *   + required capabilities, verbatim);
 * - package proposals project onto `CapabilityPackageContents` (the
 *   bundle's capability supplies; the bundle's process + workforce
 *   requirements stay semantically home on the PROPOSAL record and are
 *   referenced in the changelog — the four-kind catalog cannot express
 *   them first-class yet; recorded limitation, CR-worthy);
 * - the changelog cites the proposal id, its signal kind and recurrence
 *   count, and the review reason (deterministic);
 * - evidence refs are MECHANICAL: one provenance-statement ref pointing at
 *   the proposal itself + one usage-telemetry ref per contributing outcome
 *   id / unknown id (sorted), each with a bounded summary.
 */
import { err, ok } from "../../marketplace/contract.marketplace.js";
import type {
  MarketplaceProvenanceStamp,
  MarketplaceActorReference,
  MarketplaceTimestamp,
  PackageEvidenceRef,
  PackageVersionContents,
  Result,
} from "../../marketplace/contract.marketplace.js";
import { emergencePublicationRefused } from "./errors.js";
import type { EmergenceError } from "./errors.js";
import { EMERGENCE_CATALOG_DRAFT_RULE } from "./vocabulary.js";
import type { EmergenceProposal } from "./proposals.js";

/**
 * The projection result: everything `DraftPackageInput` needs except the
 * authority fields, which the PROMOTER supplies (publisher identity +
 * provenance + now) — the emergence area never authors a publisher.
 */
export interface EmergenceCatalogDraftInput {
  /** Optional explicit package id (defaults to `pkg-emergence-<proposalId>`). */
  readonly packageId?: string;
  readonly publisher: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
}

/** The projected draft (DraftPackageInput-shaped value; version defaults to 1). */
export interface EmergenceCatalogDraft {
  readonly packageId: string;
  readonly kind: string;
  readonly summary: string;
  readonly version: number;
  readonly contents: PackageVersionContents;
  readonly changelog: string;
  readonly evidenceRefs: readonly PackageEvidenceRef[];
  readonly publisher: MarketplaceActorReference;
  readonly provenance: MarketplaceProvenanceStamp;
  readonly now: MarketplaceTimestamp;
  /** The projection rule id (inspectability). */
  readonly projectionRule: string;
  /** The proposal this draft projects (back-reference). */
  readonly proposalId: string;
}

function evidenceRefsOf(proposal: EmergenceProposal): readonly PackageEvidenceRef[] {
  const refs: PackageEvidenceRef[] = [
    {
      evidenceKind: "provenance-statement",
      ref: `emergence/proposal/${proposal.proposalId}`,
      summary: `governed emergence proposal ${proposal.proposalId} (${proposal.evidence.gap.signalKind}, recurrence ${proposal.demand.recurrenceCount}, rule ${proposal.alternativesRule})`,
    },
  ];
  for (const outcomeId of proposal.evidence.gap.outcomeIds) {
    refs.push({
      evidenceKind: "usage-telemetry",
      ref: `outcome/${outcomeId}`,
      summary: `W013 outcome join evidence cited by proposal ${proposal.proposalId}`,
    });
  }
  for (const unknownId of proposal.evidence.gap.unknownIds ?? []) {
    refs.push({
      evidenceKind: "usage-telemetry",
      ref: `unknown/${unknownId}`,
      summary: `cognition unknown signal cited by proposal ${proposal.proposalId}`,
    });
  }
  return Object.freeze(refs);
}

function changelogOf(proposal: EmergenceProposal): string {
  const reviewReason = proposal.review ? proposal.review.reason : "";
  const lines = [
    `emergence proposal ${proposal.proposalId} (${proposal.evidence.gap.signalKind}, recurrence ${proposal.demand.recurrenceCount})`,
    `review: ${reviewReason}`,
  ];
  if (proposal.kind === "package") {
    lines.push(
      `process requirements: ${proposal.bundle.processRequirements.join(", ")}`,
      `workforce requirements: ${proposal.bundle.workforceRequirements.join(", ")}`,
    );
  }
  return lines.filter((line) => line.length > 0).join("; ");
}

/**
 * Projects an ACCEPTED proposal into a catalog-draft VALUE (pure; no store
 * writes, no publication mutations — the promoter runs the W011 governance
 * path with this value). Refused with `emergence-publication-refused` for
 * any non-accepted proposal: the emergence area never drafts, submits or
 * publishes.
 */
export function catalogDraftOfProposal(
  proposal: EmergenceProposal,
  input: EmergenceCatalogDraftInput,
): Result<EmergenceCatalogDraft, EmergenceError> {
  if (proposal.state !== "accepted") {
    return err(
      emergencePublicationRefused(
        `proposal ${proposal.proposalId} is ${proposal.state} — the catalog-draft projection requires an ACCEPTED proposal (the emergence area proposes; publication authority stays with the marketplace governance path)`,
      ),
    );
  }
  const packageId = input.packageId ?? `pkg-emergence-${proposal.proposalId}`;
  const contents: PackageVersionContents =
    proposal.kind === "role"
      ? {
          kind: "role",
          roleDefinition: proposal.roleShape.roleDefinition,
          requiredCapabilities: proposal.roleShape.requiredCapabilities,
        }
      : {
          kind: "capability",
          supplies: proposal.bundle.capabilitySupplies,
        };
  return ok({
    packageId,
    kind: contents.kind,
    summary: `Emergent ${contents.kind} from proposal ${proposal.proposalId}`,
    version: 1,
    contents,
    changelog: changelogOf(proposal),
    evidenceRefs: evidenceRefsOf(proposal),
    publisher: input.publisher,
    provenance: input.provenance,
    now: input.now,
    projectionRule: EMERGENCE_CATALOG_DRAFT_RULE,
    proposalId: proposal.proposalId,
  });
}
