/**
 * Epistemics record types: Claim (evidence-derived proposition), Belief
 * (versioned current understanding), Hypothesis (unresolved explanation),
 * Contradiction (RETAINED conflict — never auto-merged), Unknown
 * (consequential question + consequence). spec/DOMAIN-MAPPING.md:
 * uncertain information is never collapsed into asserted truth.
 */
import type {
  BeliefId,
  ClaimId,
  ContradictionId,
  DomainTimestamp,
  HypothesisId,
  ObservationId,
  UnknownId,
} from "../core/branding.js";
import type { TenantScopedRecord } from "../core/scope.js";
import type { ActorReference, SubjectReference } from "../core/refs.js";
import type { FreshnessStamp } from "../evidence/freshness.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { EvidenceStatus } from "../evidence/records.js";

/** Claim: a proposition derived from evidence (observations). */
export interface ClaimRecord extends TenantScopedRecord {
  readonly claimId: ClaimId;
  readonly statement: string;
  /** Observations the claim was derived from (>= 1, tenant-verified). */
  readonly derivedFrom: readonly ObservationId[];
  readonly provenance: ProvenanceRecord;
  readonly freshness: FreshnessStamp;
  readonly status: EvidenceStatus;
  readonly retractedAt?: DomainTimestamp;
  readonly retractedBy?: ActorReference;
}

/** One immutable belief revision. History is append-only. */
export interface BeliefRevision {
  readonly revisionNumber: number;
  readonly statement: string;
  /** Active claims supporting this understanding (>= 1, tenant-verified). */
  readonly supportingClaimIds: readonly ClaimId[];
  readonly provenance: ProvenanceRecord;
  readonly freshness: FreshnessStamp;
  readonly createdAt: DomainTimestamp;
}

/** Belief: versioned current understanding about one subject. */
export interface BeliefRecord extends TenantScopedRecord {
  readonly beliefId: BeliefId;
  readonly subject: SubjectReference;
  /** Points at the newest revision. Older revisions are retained forever. */
  readonly currentRevision: number;
  readonly revisions: readonly BeliefRevision[];
}

export const HYPOTHESIS_STATUSES = ["open", "supported", "refuted", "retired"] as const;

export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

export function isKnownHypothesisStatus(value: string): value is HypothesisStatus {
  return (HYPOTHESIS_STATUSES as readonly string[]).includes(value);
}

/** One immutable hypothesis status entry (append-only lifecycle). */
export interface HypothesisStatusEntry {
  readonly status: HypothesisStatus;
  readonly at: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
}

/** Hypothesis: an unresolved explanation for observations/contradictions. */
export interface HypothesisRecord extends TenantScopedRecord {
  readonly hypothesisId: HypothesisId;
  readonly statement: string;
  /** What this hypothesis purports to explain. */
  readonly explains: readonly SubjectReference[];
  readonly status: HypothesisStatus;
  readonly statusHistory: readonly HypothesisStatusEntry[];
  readonly provenance: ProvenanceRecord;
  readonly freshness: FreshnessStamp;
}

export type ContradictionStatus = "open" | "resolved";

/** Contradiction: a conflict that is RETAINED, never auto-merged. */
export interface ContradictionRecord extends TenantScopedRecord {
  readonly contradictionId: ContradictionId;
  /** The conflicting records (>= 2 distinct references, retained verbatim). */
  readonly between: readonly SubjectReference[];
  readonly description: string;
  readonly status: ContradictionStatus;
  readonly recordedAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
  readonly freshness: FreshnessStamp;
  /** Present after an explicit, audited resolution. The conflict itself is retained. */
  readonly resolution?: {
    readonly outcome: string;
    readonly resolvedAt: DomainTimestamp;
    readonly resolvedBy: ActorReference;
  };
}

export type UnknownStatus = "open" | "resolved";

/** Unknown: a consequential question plus the consequence of not knowing. */
export interface UnknownRecord extends TenantScopedRecord {
  readonly unknownId: UnknownId;
  readonly question: string;
  /** What happens if this remains unknown (non-empty, validated). */
  readonly consequence: string;
  readonly relatedSubjects: readonly SubjectReference[];
  readonly status: UnknownStatus;
  readonly raisedAt: DomainTimestamp;
  readonly provenance: ProvenanceRecord;
  readonly freshness: FreshnessStamp;
  readonly resolution?: {
    readonly outcome: string;
    readonly resolvedAt: DomainTimestamp;
    readonly resolvedBy: ActorReference;
  };
}
