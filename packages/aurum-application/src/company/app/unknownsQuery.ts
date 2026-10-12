/**
 * Company unknowns query (W004 app layer): the tenant-wide blind-spot report —
 * one list per blind-spot kind. The consequential subject set (every subject
 * declared to matter: goal expected-evidence subjects, open-unknown related
 * subjects, open-contradiction subjects) is exactly what the kernel lets us
 * enumerate honestly — there is no tenant-wide evidence seam by design, and
 * this report never pretends otherwise. All lists are ordered by record id.
 */
import type {
  DomainTimestamp,
  FreshnessClass,
  FreshnessPolicy,
  SubjectReference,
  TenantScope,
} from "@aurum/domain";
import { classifyFreshness, DEFAULT_FRESHNESS_POLICY } from "@aurum/domain";
import { gatherSubjectEvidence } from "./evidenceGathering.js";
import { readExpectedEvidence } from "./coverageQuery.js";
import { worstSupportFreshness } from "../domain/classification.js";
import type { StaleEntry, UnknownReport } from "../domain/records.js";
import type { CompanyDomainViews } from "../domain/ports.js";

/** Freshness that can still be relied on as current. */
const RELIABLE_FRESHNESS: readonly FreshnessClass[] = ["current", "aging"];

/** Primary related subject, or the record itself when declared without one. */
function primarySubject(
  relations: readonly SubjectReference[],
  fallbackKind: "unknown" | "contradiction",
  fallbackId: string,
): SubjectReference {
  const first = relations[0];
  return first !== undefined ? first : { kind: fallbackKind, id: fallbackId };
}

/** Stale evidence across the consequential subject set (deduped, ordered). */
function staleEvidenceOf(
  views: CompanyDomainViews,
  scope: TenantScope,
  subjects: readonly SubjectReference[],
  now: DomainTimestamp,
  policy: FreshnessPolicy,
): StaleEntry[] {
  const stale: StaleEntry[] = [];
  const seen = new Set<string>();
  for (const subject of subjects) {
    const key = `${subject.kind}/${subject.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const evidence = gatherSubjectEvidence(views, scope, subject, now, policy);
    for (const observation of evidence.observations) {
      if (observation.status !== "active") continue;
      if (RELIABLE_FRESHNESS.includes(observation.freshness)) continue;
      stale.push({
        recordId: observation.recordId,
        subject,
        description: `observation "${observation.content}" is ${observation.freshness}`,
        freshness: observation.freshness,
      });
    }
    for (const memory of evidence.memories) {
      if (RELIABLE_FRESHNESS.includes(memory.freshness)) continue;
      stale.push({
        recordId: memory.recordId,
        subject,
        description: `memory version ${memory.version} is ${memory.freshness}`,
        freshness: memory.freshness,
      });
    }
    for (const belief of evidence.beliefs) {
      if (!belief.asserted) continue;
      const worst = worstSupportFreshness(belief);
      if (worst !== undefined && RELIABLE_FRESHNESS.includes(worst)) continue;
      stale.push({
        recordId: belief.recordId,
        subject,
        description: `belief ${belief.beliefId} revision ${belief.revision} rests on ${worst}-freshness support`,
        freshness: worst ?? "unknown",
      });
    }
  }
  return stale.sort((left, right) => left.recordId.localeCompare(right.recordId));
}

/** The unknowns query: open unknowns, contradictions, stale and missing. */
export function reportUnknowns(
  views: CompanyDomainViews,
  scope: TenantScope,
  now: DomainTimestamp,
  policy?: FreshnessPolicy,
): UnknownReport {
  const freshnessPolicy = policy ?? DEFAULT_FRESHNESS_POLICY;
  const openUnknowns = views.inquiry.listOpenUnknowns(scope);
  const openContradictions = views.inquiry.listOpenContradictions(scope);

  // The declared-consequential subject set (deduped, insertion-ordered).
  const consequentialSubjects: SubjectReference[] = [];
  const pushSubject = (subject: SubjectReference): void => {
    if (
      !consequentialSubjects.some((item) => item.kind === subject.kind && item.id === subject.id)
    ) {
      consequentialSubjects.push(subject);
    }
  };
  for (const unknown of openUnknowns) {
    for (const relation of unknown.relatedSubjects) pushSubject(relation);
  }
  for (const contradiction of openContradictions) {
    for (const relation of contradiction.between) pushSubject(relation);
  }

  const missingEntries: {
    readonly recordId: string;
    readonly subject: SubjectReference;
    readonly description: string;
  }[] = [];
  for (const goal of views.goals.listGoals(scope)) {
    const current = goal.revisions[goal.currentRevision - 1];
    if (current === undefined) continue;
    for (const reading of readExpectedEvidence(
      views,
      scope,
      current.expectedEvidence,
      now,
      freshnessPolicy,
    )) {
      if (reading.status === "unevidenced") {
        missingEntries.push({
          recordId: `${goal.goalId}:${reading.description}`,
          subject: { kind: "goal", id: goal.goalId },
          description: `expected evidence "${reading.description}" has no usable observations`,
        });
      }
    }
    for (const expectation of current.expectedEvidence) pushSubject(expectation.subject);
  }

  return {
    asOf: now,
    openUnknowns: Object.freeze(
      openUnknowns.map((unknown) => ({
        recordId: unknown.unknownId,
        subject: primarySubject(unknown.relatedSubjects, "unknown", unknown.unknownId),
        question: unknown.question,
        consequence: unknown.consequence,
        raisedAt: unknown.raisedAt,
        freshness: classifyFreshness(unknown.freshness, now, freshnessPolicy),
      })),
    ),
    openContradictions: Object.freeze(
      openContradictions.map((contradiction) => ({
        recordId: contradiction.contradictionId,
        subject: primarySubject(
          contradiction.between,
          "contradiction",
          contradiction.contradictionId,
        ),
        description: contradiction.description,
        recordedAt: contradiction.recordedAt,
        freshness: classifyFreshness(contradiction.freshness, now, freshnessPolicy),
      })),
    ),
    staleEvidence: Object.freeze(
      staleEvidenceOf(views, scope, consequentialSubjects, now, freshnessPolicy),
    ),
    missingExpectedEvidence: Object.freeze(
      missingEntries.sort((left, right) => left.recordId.localeCompare(right.recordId)),
    ),
  };
}
