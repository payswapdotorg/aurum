/**
 * The emergence service facade (W014 app layer): composes gap detection,
 * alternatives derivation, proposal construction and the human-governed
 * review into the public `EmergenceService`. In-memory over the store
 * ports (house pattern — PostgreSQL persistence is the TL-tracked
 * P-series debt).
 *
 * NO PUBLICATION CAPABILITY: this service performs ZERO catalog writes.
 * There is no draft/submit/publish/review-publication method, and no code
 * path reaches a W011 publication mutation (tripwire-locked). The ONLY
 * bridge toward the catalog is the PURE `catalogDraftOfProposal`
 * projection (domain), invoked by the promoter after a PERSON accepted the
 * proposal — the W011 governance path (publisher drafts, publisher
 * submits, PERSON reviewer publishes) runs unchanged afterwards.
 *
 * NO FABRICATION: `propose` re-detects the backing gap from the tenant's
 * CURRENT evidence with the caller's query — a gap id that is not among
 * the current derivations is a typed refusal; the proposal embeds the
 * re-derived gap verbatim (citation chain intact).
 *
 * DETERMINISM: `now` is always a caller input; no clock reads, no
 * randomness. Every transition appends exactly ONE audit entry.
 */
import { err, ok, type Result } from "../../marketplace/contract.marketplace.js";
import type { MarketplaceError } from "../../marketplace/contract.marketplace.js";
import type { EmergenceError } from "../domain/errors.js";
import {
  emergenceConflict,
  emergenceInvariant,
  emergenceNotFound,
  emergenceUnauthorized,
  emergenceValidationError,
} from "../domain/errors.js";
import { detectEmergenceGaps } from "../domain/gaps.js";
import { deriveEmergenceAlternatives } from "../domain/alternatives.js";
import { buildEmergenceProposal, reviewEmergenceProposal } from "../domain/proposals.js";
import type { EmergenceServiceDeps } from "../domain/ports.js";
import type { EmergenceService } from "./inputs.js";

/** The audit subject shape used by every emergence transition. */
function proposalSubject(proposalId: string): { kind: string; id: string } {
  return { kind: "emergence-proposal", id: proposalId };
}

/**
 * Maps marketplace errors (the audit seam's Result surface) into the
 * emergence namespace with the codes preserved verbatim (the W013
 * `mapLabError` pattern — no second error authority, no swallowed detail).
 */
export function mapMarketplaceError(error: MarketplaceError): EmergenceError {
  if (error.code === "marketplace-validation") return emergenceValidationError(error.issues);
  if (error.code === "marketplace-not-found") return emergenceNotFound(error.message);
  if (error.code === "marketplace-conflict") return emergenceConflict(error.message);
  if (error.code === "marketplace-unauthorized") return emergenceUnauthorized(error.message);
  return emergenceInvariant(`marketplace seam refusal: ${error.message}`);
}

/** Builds the emergence service over its ports. */
export function createEmergenceService(deps: EmergenceServiceDeps): EmergenceService {
  return {
    detectGaps(scope, query) {
      return detectEmergenceGaps(
        deps.evidence.listOutcomeEvidence(scope),
        deps.evidence.listUnknownSignals(scope),
        query,
      );
    },

    propose(scope, input) {
      const gaps = detectEmergenceGaps(
        deps.evidence.listOutcomeEvidence(scope),
        deps.evidence.listUnknownSignals(scope),
        input.query,
      );
      if (!gaps.ok) return err(gaps.error);
      const gap = gaps.value.find((candidate) => candidate.gapId === input.gapId);
      if (!gap) {
        return err(
          emergenceNotFound(`gap ${input.gapId} among the current derivations for this tenant`),
        );
      }
      const alternatives = deriveEmergenceAlternatives(
        gap,
        deps.catalog.listVersions(scope),
        deps.recruitments.listRecruitments(scope),
      );
      const existing = deps.proposals.getProposal(scope, input.proposalId);
      if (existing.ok) {
        return err(emergenceConflict(`emergence proposal ${input.proposalId} already exists`));
      }
      const built = buildEmergenceProposal(
        input.kind === "role"
          ? {
              scope,
              proposalId: input.proposalId,
              gap,
              alternatives,
              proposedBy: input.proposedBy,
              provenance: input.provenance,
              now: input.now,
              kind: "role",
              roleShape: input.roleShape,
            }
          : {
              scope,
              proposalId: input.proposalId,
              gap,
              alternatives,
              proposedBy: input.proposedBy,
              provenance: input.provenance,
              now: input.now,
              kind: "package",
              bundle: input.bundle,
            },
      );
      if (!built.ok) return err(built.error);
      const put = deps.proposals.putProposal(built.value);
      if (!put.ok) return err(put.error);
      const auditRef = deps.audit.append(scope, {
        subject: proposalSubject(input.proposalId),
        action: "marketplace.emergence-proposed",
        actor: input.proposedBy,
        at: input.now,
        reason: `emergence proposal ${input.proposalId} (${input.kind}) proposed from gap ${input.gapId} (${gap.signalKind}, recurrence ${gap.recurrenceCount})`,
        details: {
          gapId: gap.gapId,
          signalKind: gap.signalKind,
          recurrenceCount: gap.recurrenceCount,
          outcomeIds: gap.outcomeIds,
          unknownIds: gap.unknownIds ?? [],
          alternatives: built.value.alternatives.map((alternative) => alternative.kind),
        },
      });
      if (!auditRef.ok) return err(mapMarketplaceError(auditRef.error));
      return ok(built.value);
    },

    reviewProposal(scope, input) {
      const fetched = deps.proposals.getProposal(scope, input.proposalId);
      if (!fetched.ok) return err(fetched.error);
      const reviewed = reviewEmergenceProposal(fetched.value, {
        decision: input.decision,
        reviewer: input.reviewer,
        reason: input.reason,
        now: input.now,
      });
      if (!reviewed.ok) return err(reviewed.error);
      const put = deps.proposals.putProposal(reviewed.value);
      if (!put.ok) return err(put.error);
      const auditRef = deps.audit.append(scope, {
        subject: proposalSubject(input.proposalId),
        action:
          input.decision === "accepted"
            ? "marketplace.emergence-accepted"
            : "marketplace.emergence-declined",
        actor: input.reviewer,
        at: input.now,
        reason: input.reason,
        details: { decision: input.decision, gapId: reviewed.value.evidence.gap.gapId },
      });
      if (!auditRef.ok) return err(mapMarketplaceError(auditRef.error));
      return ok(reviewed.value);
    },

    getProposal(scope, proposalId) {
      return deps.proposals.getProposal(scope, proposalId);
    },

    listProposals(scope) {
      return deps.proposals.listProposals(scope);
    },
  };
}

/** Uniform not-found helper re-exported for view consumers. */
export function emergenceRecordNotFound(recordKind: string): Result<never, EmergenceError> {
  return err(emergenceNotFound(recordKind));
}
