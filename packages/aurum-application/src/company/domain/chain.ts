/**
 * Company evidence-chain builders (W004, pure domain layer): thin, total
 * adapters that turn kernel records into company chain entries. Every entry
 * carries its provenance stamp (actor/source/recordedAt) and the kernel
 * freshness class of the underlying record, classified at the caller's
 * deterministic `now` — the company layer never reads a clock.
 *
 * Audit entries are the deliberate exception: the audit trail is an
 * append-only transition log, not an evidence-bearing record, so audit
 * entries carry who/when/why and no freshness class — freshness is a
 * property of evidence, and inventing one here would be fabricated certainty.
 *
 * Builders are pure: same record + same now + same policy → same entry.
 * The honesty derivations (claim support, belief assertion) are delegated to
 * domain/classification.ts so there is exactly one authority for them.
 */
import {
  classifyFreshness,
  DEFAULT_FRESHNESS_POLICY,
  type AuditRecord,
  type BeliefRecord,
  type ClaimRecord,
  type DomainTimestamp,
  type FreshnessPolicy,
  type GoalRevision,
  type MembershipRecord,
  type MemoryRecord,
  type ObservationRecord,
  type ProvenanceRecord,
} from "@aurum/domain";
import { beliefIsAsserted, claimSupportStatus } from "./classification.js";
import type {
  AuditEntry,
  BeliefEntry,
  ClaimEntry,
  GoalRevisionEntry,
  MembershipEntry,
  MemoryEntry,
  ObservationEntry,
  ProvenanceStamp,
} from "./records.js";

/** Converts a kernel provenance record into the company stamp shape. */
function stampOf(provenance: ProvenanceRecord): ProvenanceStamp {
  return { actor: provenance.actor, source: provenance.source, recordedAt: provenance.recordedAt };
}

/** Observation → entry: freshness from the observation's own stamp. */
export function observationEntry(
  record: ObservationRecord,
  now: DomainTimestamp,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): ObservationEntry {
  return {
    recordId: record.observationId,
    kind: "observation",
    observationId: record.observationId,
    content: record.content,
    status: record.status,
    observedAt: record.observedAt,
    provenance: stampOf(record.provenance),
    freshness: classifyFreshness(record.freshness, now, policy),
  };
}

/**
 * Claim → entry. `sources` are the records for the claim's derivedFrom
 * observations, in derivedFrom order; the support status is derived here
 * (active claim with zero active sources → superseded). A source the caller
 * cannot resolve must be omitted — omission degrades support conservatively.
 */
export function claimEntry(
  record: ClaimRecord,
  sources: readonly ObservationRecord[],
  now: DomainTimestamp,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): ClaimEntry {
  const derivedFrom = sources.map((source) => observationEntry(source, now, policy));
  return {
    recordId: record.claimId,
    kind: "claim",
    claimId: record.claimId,
    statement: record.statement,
    support: claimSupportStatus({ status: record.status, derivedFrom }),
    derivedFrom: Object.freeze(derivedFrom),
    provenance: stampOf(record.provenance),
    freshness: classifyFreshness(record.freshness, now, policy),
  };
}

/**
 * Belief → entry for its CURRENT revision. `claims` are the entries for the
 * current revision's supportingClaimIds, in revision order; assertion is
 * re-derived on the read side (>= 1 active support), never trusted from the
 * write side.
 */
export function beliefRevisionEntry(
  record: BeliefRecord,
  claims: readonly ClaimEntry[],
  now: DomainTimestamp,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): BeliefEntry {
  const current = record.revisions[record.currentRevision - 1];
  if (current === undefined) {
    throw new Error("company chain: belief without revisions");
  }
  return {
    recordId: record.beliefId,
    kind: "belief",
    beliefId: record.beliefId,
    subject: record.subject,
    statement: current.statement,
    revision: current.revisionNumber,
    asserted: beliefIsAsserted({ supportingClaims: claims }),
    supportingClaims: Object.freeze([...claims]),
    provenance: stampOf(current.provenance),
    freshness: classifyFreshness(current.freshness, now, policy),
  };
}

/** Memory → entry for its current version (append-only, never retracted). */
export function memoryEntry(
  record: MemoryRecord,
  now: DomainTimestamp,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): MemoryEntry {
  const current = record.versions[record.currentVersion - 1];
  if (current === undefined) {
    throw new Error("company chain: memory without versions");
  }
  return {
    recordId: record.memoryId,
    kind: "memory",
    memoryId: record.memoryId,
    subject: record.subject,
    content: current.content,
    version: current.version,
    provenance: stampOf(current.provenance),
    freshness: classifyFreshness(current.freshness, now, policy),
  };
}

/**
 * Goal revision → entry. Freshness is the knowledge age of the revision
 * record (asOf = revision createdAt) — how long ago we last learned this.
 * `recordId` is goalId@revision so multiple goals never collide.
 */
export function goalRevisionEntry(
  goalId: string,
  revision: GoalRevision,
  now: DomainTimestamp,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): GoalRevisionEntry {
  return {
    recordId: `${goalId}@${revision.revisionNumber}`,
    kind: "goal-revision",
    goalId: goalId as GoalRevisionEntry["goalId"],
    revision: revision.revisionNumber,
    objective: revision.objective,
    desiredState: revision.desiredState,
    priority: revision.priority,
    horizonStart: revision.horizonStart,
    horizonEnd: revision.horizonEnd,
    ownerPersonId: revision.owner.personId,
    metrics: revision.metrics,
    expectedEvidence: revision.expectedEvidence,
    provenance: stampOf(revision.provenance),
    freshness: classifyFreshness({ asOf: revision.createdAt }, now, policy),
  };
}

/**
 * Membership → entry. Freshness is the knowledge age of the grant
 * (asOf = grantedAt); status is carried verbatim so ended memberships never
 * back an ownership answer.
 */
export function membershipEntry(
  record: MembershipRecord,
  now: DomainTimestamp,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): MembershipEntry {
  return {
    recordId: record.membershipId,
    kind: "membership",
    membershipId: record.membershipId,
    personId: record.personId,
    organizationId: record.organizationId,
    ...(record.unitId !== undefined ? { unitId: record.unitId } : {}),
    roles: Object.freeze([...record.roles]),
    status: record.status,
    grantedAt: record.grantedAt,
    grantedBy: record.grantedBy,
    freshness: classifyFreshness({ asOf: record.grantedAt }, now, policy),
  };
}

/** Audit record → entry (transition log; deliberately no freshness class). */
export function auditEntry(record: AuditRecord): AuditEntry {
  return {
    recordId: record.auditId,
    kind: "audit",
    auditId: record.auditId,
    action: record.action,
    subject: record.subject,
    actor: record.actor,
    at: record.at,
    reason: record.reason,
    ...(record.details !== undefined ? { details: record.details } : {}),
  };
}
