/**
 * Company evidence gathering (W004 app layer): the shared read-side assembly
 * every subject-scoped company query starts from. It reads ONLY the
 * tenant-scoped query seams, builds chain entries with the domain builders,
 * and never invents a record: what is not in the kernel does not appear
 * here. Chains are walked to the bottom — every claim's sources are fetched
 * through the evidence seam, so a claim whose observations were retracted
 * still sees them (with their retracted status) and degrades honestly.
 */
import type {
  ContradictionRecord,
  DomainTimestamp,
  FreshnessPolicy,
  ObservationRecord,
  SubjectReference,
  TenantScope,
  UnknownRecord,
} from "@aurum/domain";
import { beliefRevisionEntry, claimEntry, memoryEntry, observationEntry } from "../domain/chain.js";
import type { BeliefEntry, ClaimEntry, MemoryEntry, ObservationEntry } from "../domain/records.js";
import type { CompanyDomainViews } from "../domain/ports.js";

/** Everything gathered about one subject, ready for classification/reporting. */
export interface SubjectEvidence {
  readonly subject: SubjectReference;
  readonly observations: readonly ObservationEntry[];
  readonly beliefs: readonly BeliefEntry[];
  readonly memories: readonly MemoryEntry[];
  readonly openUnknowns: readonly UnknownRecord[];
  readonly openContradictions: readonly ContradictionRecord[];
}

/** True when the reference list mentions the subject (kind + id). */
export function referencesSubject(
  references: readonly { readonly kind: string; readonly id: string }[],
  subject: { readonly kind: string; readonly id: string },
): boolean {
  return references.some((ref) => ref.kind === subject.kind && ref.id === subject.id);
}

/** Builds one claim entry with its sources fetched through the seams. */
function chainClaim(
  views: CompanyDomainViews,
  scope: TenantScope,
  claimId: string,
  now: DomainTimestamp,
  policy: FreshnessPolicy | undefined,
): ClaimEntry | undefined {
  const claim = views.epistemics.getClaim(scope, claimId);
  if (!claim.ok) return undefined;
  const sources: ObservationRecord[] = [];
  for (const observationId of claim.value.derivedFrom) {
    const observation = views.evidence.getObservation(scope, observationId);
    if (observation.ok) sources.push(observation.value);
  }
  return claimEntry(claim.value, sources, now, policy);
}

/**
 * Gathers all evidence about one subject: observations (any status, with
 * their freshness), belief chains (current revisions, support re-derived),
 * memory versions, and the inquiry blind-spot seams (open unknowns and
 * open contradictions that reference the subject).
 */
export function gatherSubjectEvidence(
  views: CompanyDomainViews,
  scope: TenantScope,
  subject: SubjectReference,
  now: DomainTimestamp,
  policy?: FreshnessPolicy,
): SubjectEvidence {
  const observations = views.evidence
    .listObservations(scope, subject)
    .map((record) => observationEntry(record, now, policy));

  const memories = views.memory
    .listMemory(scope, subject)
    .map((record) => memoryEntry(record, now, policy));

  const beliefs: BeliefEntry[] = [];
  for (const record of views.epistemics.listBeliefs(scope, subject)) {
    const current = record.revisions[record.currentRevision - 1];
    if (current === undefined) continue;
    const claims: ClaimEntry[] = [];
    for (const claimId of current.supportingClaimIds) {
      const entry = chainClaim(views, scope, claimId, now, policy);
      if (entry !== undefined) claims.push(entry);
    }
    beliefs.push(beliefRevisionEntry(record, claims, now, policy));
  }

  const openUnknowns = views.inquiry
    .listOpenUnknowns(scope)
    .filter((unknown) => referencesSubject(unknown.relatedSubjects, subject));

  const openContradictions = views.inquiry
    .listOpenContradictions(scope)
    .filter((contradiction) => referencesSubject(contradiction.between, subject));

  return { subject, observations, beliefs, memories, openUnknowns, openContradictions };
}
