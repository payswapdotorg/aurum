/**
 * Company intelligence record types (W004): the read-only projection
 * vocabulary. Every answer names its sources (actor/source/recordedAt) and
 * the kernel freshness class of the records it rests on; blind spots are
 * explicit, first-class fields (spec/DOMAIN-MAPPING.md: uncertain information
 * is never collapsed into asserted truth).
 */
import type {
  ActorReference,
  AuditActionKind,
  BeliefId,
  ClaimId,
  DomainJsonValue,
  DomainTimestamp,
  EvidenceStatus,
  ExpectedEvidence,
  FreshnessClass,
  GoalId,
  GoalMetric,
  GoalPriority,
  IdentityLabel,
  MembershipId,
  MemoryId,
  ObservationId,
  PersonId,
  SourceKind,
  SubjectReference,
  TenantScope,
} from "@aurum/domain";

/** Honesty classifications for company answers (W004 acceptance core). */
export const ANSWER_CLASSIFICATIONS = [
  "evidenced",
  "partial",
  "unknown",
  "learning-mission-required",
] as const;

export type AnswerClassification = (typeof ANSWER_CLASSIFICATIONS)[number];

export function isKnownAnswerClassification(value: string): value is AnswerClassification {
  return (ANSWER_CLASSIFICATIONS as readonly string[]).includes(value);
}

/** The four explicit blind-spot kinds surfaced by company reports. */
export const BLIND_SPOT_KINDS = [
  "open-unknown",
  "open-contradiction",
  "stale-evidence",
  "missing-expected-evidence",
] as const;

export type BlindSpotKind = (typeof BLIND_SPOT_KINDS)[number];

export function isKnownBlindSpotKind(value: string): value is BlindSpotKind {
  return (BLIND_SPOT_KINDS as readonly string[]).includes(value);
}

/** One explicit blind spot: what is not known, in conflict, stale or missing. */
export interface BlindSpot {
  readonly kind: BlindSpotKind;
  readonly subject: SubjectReference;
  readonly description: string;
  /** For open unknowns: the recorded cost of not knowing. */
  readonly consequence?: string;
  readonly raisedAt?: DomainTimestamp;
  readonly recordId?: string;
}

/** Provenance stamp mirrored from the kernel record (who/how/when recorded). */
export interface ProvenanceStamp {
  readonly actor: ActorReference;
  readonly source: SourceKind;
  readonly recordedAt: DomainTimestamp;
}

export interface ObservationEntry {
  /** Dedup key across every report a subject query assembles. */
  readonly recordId: string;
  readonly kind: "observation";
  readonly observationId: ObservationId;
  readonly content: string;
  readonly status: EvidenceStatus;
  readonly observedAt: DomainTimestamp;
  readonly provenance: ProvenanceStamp;
  readonly freshness: FreshnessClass;
}

export type ClaimSupportStatus = "active" | "superseded" | "retracted";

export interface ClaimEntry {
  readonly recordId: string;
  readonly kind: "claim";
  readonly claimId: ClaimId;
  readonly statement: string;
  /** Derived (domain/classification.ts): active claim + zero active sources → superseded. */
  readonly support: ClaimSupportStatus;
  readonly derivedFrom: readonly ObservationEntry[];
  readonly provenance: ProvenanceStamp;
  readonly freshness: FreshnessClass;
}

export interface BeliefEntry {
  readonly recordId: string;
  readonly kind: "belief";
  readonly beliefId: BeliefId;
  readonly subject: SubjectReference;
  readonly statement: string;
  readonly revision: number;
  /** Read-side re-derivation: asserted only while >= 1 supporting claim is active. */
  readonly asserted: boolean;
  readonly supportingClaims: readonly ClaimEntry[];
  readonly provenance: ProvenanceStamp;
  readonly freshness: FreshnessClass;
}

export interface MemoryEntry {
  readonly recordId: string;
  readonly kind: "memory";
  readonly memoryId: MemoryId;
  readonly subject: SubjectReference;
  readonly content: string;
  readonly version: number;
  readonly provenance: ProvenanceStamp;
  readonly freshness: FreshnessClass;
}

export interface GoalRevisionEntry {
  readonly recordId: string;
  readonly kind: "goal-revision";
  readonly goalId: GoalId;
  readonly revision: number;
  readonly objective: string;
  readonly desiredState: string;
  readonly priority: GoalPriority;
  readonly horizonStart: DomainTimestamp;
  readonly horizonEnd: DomainTimestamp;
  readonly ownerPersonId: PersonId;
  readonly metrics: readonly GoalMetric[];
  readonly expectedEvidence: readonly ExpectedEvidence[];
  readonly provenance: ProvenanceStamp;
  /** Knowledge age of the revision record (asOf = revision createdAt). */
  readonly freshness: FreshnessClass;
}

export interface MembershipEntry {
  readonly recordId: string;
  readonly kind: "membership";
  readonly membershipId: MembershipId;
  readonly personId: PersonId;
  readonly organizationId: string;
  readonly unitId?: string;
  readonly roles: readonly string[];
  readonly status: "active" | "ended";
  readonly grantedAt: DomainTimestamp;
  readonly grantedBy: ActorReference;
  /** Knowledge age of the grant (asOf = grantedAt). */
  readonly freshness: FreshnessClass;
}

/** Audit trail entry: who/when/why of one consequential transition. */
export interface AuditEntry {
  readonly recordId: string;
  readonly kind: "audit";
  readonly auditId: string;
  readonly action: AuditActionKind;
  readonly subject: SubjectReference;
  readonly actor: ActorReference;
  readonly at: DomainTimestamp;
  readonly reason: string;
  readonly details?: DomainJsonValue;
}

/** "What do we know about X" — the honest subject answer. */
export interface CompanyAnswer {
  readonly subject: SubjectReference;
  readonly classification: AnswerClassification;
  /** Deterministic, inspectable explanation of the classification. */
  readonly classificationBasis: string;
  readonly answeredAt: DomainTimestamp;
  readonly observations: readonly ObservationEntry[];
  readonly beliefs: readonly BeliefEntry[];
  readonly memories: readonly MemoryEntry[];
  readonly blindSpots: readonly BlindSpot[];
}

export type OwnershipBasis = "goal-revision" | "active-membership";

export interface OwnershipEntry {
  readonly personId: PersonId;
  /** Best-effort display labels from the identity directory. */
  readonly labels: readonly IdentityLabel[];
  readonly basis: OwnershipBasis;
  /** goalId@revision / membershipId — the record the ownership rests on. */
  readonly basisRecordId: string;
  readonly detail: string;
  readonly recordedAt: DomainTimestamp;
  /** Who recorded the basis (revision provenance actor / grantedBy). */
  readonly actor: ActorReference;
  readonly freshness: FreshnessClass;
}

export interface OwnershipAnswer {
  readonly subject: SubjectReference;
  readonly classification: AnswerClassification;
  readonly classificationBasis: string;
  readonly owners: readonly OwnershipEntry[];
  readonly blindSpots: readonly BlindSpot[];
}

export type RevisionEnrichmentKind = "goal" | "belief" | "memory";

/** Content enrichment for versioned-record transitions. */
export interface RevisionEnrichment {
  readonly kind: RevisionEnrichmentKind;
  readonly number: number;
  /** objective / belief statement / memory content of that revision. */
  readonly statement: string;
}

export interface ChangeEntry {
  readonly recordId: string;
  readonly at: DomainTimestamp;
  /** Audit action, or "observation.recorded" for newly recorded evidence. */
  readonly action: AuditActionKind | "observation.recorded";
  readonly subject: SubjectReference;
  readonly actor: ActorReference;
  readonly reason: string;
  readonly summary: string;
  readonly retraction: boolean;
  readonly enrichment?: RevisionEnrichment;
}

export interface ChangeReport {
  readonly since: DomainTimestamp;
  readonly until: DomainTimestamp;
  /** Sorted by `at` ascending; deduped by record id. */
  readonly changes: readonly ChangeEntry[];
}

export type CoverageStatus = "covered" | "stale" | "unevidenced";

export interface CoverageEntry {
  readonly subject: SubjectReference;
  readonly description: string;
  readonly status: CoverageStatus;
  readonly freshness: FreshnessClass;
  readonly evidenceRecordId?: string;
}

/** Per-record freshness reading for one evidence-bearing record. */
export interface RecordFreshness {
  readonly recordId: string;
  readonly kind: "observation" | "claim" | "belief" | "memory" | "expected-evidence";
  readonly description: string;
  readonly freshness: FreshnessClass;
}
export interface CoverageReport {
  readonly subject: SubjectReference;
  readonly covered: readonly CoverageEntry[];
  readonly stale: readonly CoverageEntry[];
  readonly unevidenced: readonly CoverageEntry[];
  readonly freshness: readonly RecordFreshness[];
  readonly blindSpots: readonly BlindSpot[];
}

export type HorizonState = "upcoming" | "active" | "elapsed";

export type ExpectedEvidenceCoverage = "none-declared" | "unevidenced" | "partial" | "covered";

export interface GoalSituation {
  readonly goalId: GoalId;
  readonly revision: number;
  readonly objective: string;
  readonly priority: GoalPriority;
  readonly horizonStart: DomainTimestamp;
  readonly horizonEnd: DomainTimestamp;
  readonly horizonState: HorizonState;
  readonly ownerPersonId: PersonId;
  readonly openUnknowns: number;
  readonly openContradictions: number;
  readonly expectedEvidenceCoverage: ExpectedEvidenceCoverage;
  readonly expectedEvidenceCount: number;
  readonly provenance: ProvenanceStamp;
  readonly freshness: FreshnessClass;
}

export interface SituationReport {
  readonly asOf: DomainTimestamp;
  readonly goals: readonly GoalSituation[];
  readonly totals: {
    readonly goals: number;
    readonly openUnknowns: number;
    readonly openContradictions: number;
  };
  readonly blindSpots: readonly BlindSpot[];
}

/** The five deterministic, inspectable attention criteria (goalAttention). */
export const ATTENTION_CRITERIA = [
  "horizon-elapsed",
  "horizon-closing",
  "open-contradiction",
  "open-unknown",
  "missing-expected-evidence",
] as const;

export type AttentionCriterion = (typeof ATTENTION_CRITERIA)[number];

export function isKnownAttentionCriterion(value: string): value is AttentionCriterion {
  return (ATTENTION_CRITERIA as readonly string[]).includes(value);
}

export interface CriterionFinding {
  readonly criterion: AttentionCriterion;
  /** Deterministic explanation of why the criterion fired. */
  readonly detail: string;
}

export interface GoalAttention {
  readonly goalId: GoalId;
  readonly revision: number;
  readonly objective: string;
  readonly priority: GoalPriority;
  /** Number of criteria that fired (0 is excluded from the report). */
  readonly score: number;
  readonly criteria: readonly CriterionFinding[];
}

export interface AttentionReport {
  readonly asOf: DomainTimestamp;
  readonly horizonClosingWithinMs: number;
  readonly attention: readonly GoalAttention[];
}

export interface UnknownEntry {
  readonly recordId: string;
  readonly subject: SubjectReference;
  readonly question: string;
  readonly consequence: string;
  readonly raisedAt: DomainTimestamp;
  readonly freshness: FreshnessClass;
}

export interface ContradictionEntry {
  readonly recordId: string;
  readonly subject: SubjectReference;
  readonly description: string;
  readonly recordedAt: DomainTimestamp;
  readonly freshness: FreshnessClass;
}

export interface StaleEntry {
  readonly recordId: string;
  readonly subject: SubjectReference;
  readonly description: string;
  readonly freshness: FreshnessClass;
}

export interface MissingEntry {
  readonly recordId: string;
  readonly subject: SubjectReference;
  readonly description: string;
}

/** The four blind-spot kinds, one list each (reportUnknowns). */
export interface UnknownReport {
  readonly asOf: DomainTimestamp;
  readonly openUnknowns: readonly UnknownEntry[];
  readonly openContradictions: readonly ContradictionEntry[];
  readonly staleEvidence: readonly StaleEntry[];
  readonly missingExpectedEvidence: readonly MissingEntry[];
}

export const QUERY_KINDS = [
  "ask-about-subject",
  "who-owns",
  "what-changed-since",
  "report-coverage",
  "situation",
  "goal-attention",
  "report-unknowns",
] as const;

export type QueryKind = (typeof QUERY_KINDS)[number];

/** One successfully answered company query: who asked, what, when, why. */
export interface CompanyQueryLogRecord {
  readonly scope: TenantScope;
  readonly queryId: string;
  readonly kind: QueryKind;
  readonly subject?: SubjectReference;
  readonly since?: DomainTimestamp;
  readonly askedBy: ActorReference;
  readonly at: DomainTimestamp;
  readonly reason: string;
  /** Present for ask-about-subject: the honesty outcome, logged. */
  readonly classification?: AnswerClassification;
}
