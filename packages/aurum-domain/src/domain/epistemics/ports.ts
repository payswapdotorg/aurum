/**
 * Epistemics ports. `EvidenceLookup` is the minimal in-tenant evidence
 * verification capability injected by the kernel: a claim must reference
 * observations that exist in the same tenant, and a belief must rest on
 * active claims — the structural chain that prevents fabricating certainty.
 */
import type { Result } from "../core/result.js";
import type { TenantScope } from "../core/scope.js";
import type { SubjectReference } from "../core/refs.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { AuditInput } from "../audit/records.js";
import type { FreshnessStamp } from "../evidence/freshness.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type {
  BeliefRecord,
  ClaimRecord,
  ContradictionRecord,
  HypothesisRecord,
  HypothesisStatus,
  UnknownRecord,
} from "./records.js";

/** Minimal in-tenant evidence verification (wired by the kernel). */
export interface EvidenceLookup {
  observationExists(scope: TenantScope, observationId: string): boolean;
  claimIsUsable(scope: TenantScope, claimId: string): boolean;
}

export interface RegisterClaimInput {
  readonly claimId: string;
  readonly statement: string;
  readonly derivedFrom: readonly string[];
  readonly provenance: ProvenanceRecord;
  readonly freshness?: FreshnessStamp;
}

export interface RetractClaimInput {
  readonly reason: string;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

export interface ReviseBeliefInput {
  readonly beliefId: string;
  readonly subject: SubjectReference;
  readonly statement: string;
  readonly supportingClaimIds: readonly string[];
  readonly provenance: ProvenanceRecord;
  readonly freshness?: FreshnessStamp;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

/** Claims and beliefs: the asserted-understanding side of epistemics. */
export interface EpistemicsLedger {
  registerClaim(scope: TenantScope, input: RegisterClaimInput): Result<ClaimRecord>;
  getClaim(scope: TenantScope, claimId: string): Result<ClaimRecord>;
  retractClaim(scope: TenantScope, claimId: string, input: RetractClaimInput): Result<ClaimRecord>;
  /**
   * Appends a belief revision. If the belief does not exist yet, this creates
   * it with revision 1; otherwise it appends the next revision. The previous
   * revision is never modified.
   */
  reviseBelief(scope: TenantScope, input: ReviseBeliefInput): Result<BeliefRecord>;
  getBelief(scope: TenantScope, beliefId: string): Result<BeliefRecord>;
  listBeliefs(scope: TenantScope, subject: SubjectReference): readonly BeliefRecord[];
}

export interface OpenHypothesisInput {
  readonly hypothesisId: string;
  readonly statement: string;
  readonly explains: readonly SubjectReference[];
  readonly provenance: ProvenanceRecord;
  readonly freshness?: FreshnessStamp;
  readonly now: DomainTimestamp;
}

export interface RecordHypothesisStatusInput {
  readonly hypothesisId: string;
  readonly status: HypothesisStatus;
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

export interface RecordContradictionInput {
  readonly contradictionId: string;
  readonly between: readonly SubjectReference[];
  readonly description: string;
  readonly provenance: ProvenanceRecord;
  readonly freshness?: FreshnessStamp;
  readonly now: DomainTimestamp;
}

export interface ResolveContradictionInput {
  readonly contradictionId: string;
  readonly outcome: string;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

export interface RaiseUnknownInput {
  readonly unknownId: string;
  readonly question: string;
  readonly consequence: string;
  readonly relatedSubjects?: readonly SubjectReference[];
  readonly provenance: ProvenanceRecord;
  readonly freshness?: FreshnessStamp;
  readonly now: DomainTimestamp;
}

export interface ResolveUnknownInput {
  readonly unknownId: string;
  readonly outcome: string;
  readonly now: DomainTimestamp;
  readonly audit: AuditInput;
}

/** Hypotheses, contradictions and unknowns: the inquiry side. */
export interface InquiryLedger {
  openHypothesis(scope: TenantScope, input: OpenHypothesisInput): Result<HypothesisRecord>;
  recordHypothesisStatus(
    scope: TenantScope,
    input: RecordHypothesisStatusInput,
  ): Result<HypothesisRecord>;
  getHypothesis(scope: TenantScope, hypothesisId: string): Result<HypothesisRecord>;
  recordContradiction(
    scope: TenantScope,
    input: RecordContradictionInput,
  ): Result<ContradictionRecord>;
  getContradiction(scope: TenantScope, contradictionId: string): Result<ContradictionRecord>;
  listOpenContradictions(scope: TenantScope): readonly ContradictionRecord[];
  /** Explicit, audited resolution. The conflict record itself is retained. */
  resolveContradiction(
    scope: TenantScope,
    input: ResolveContradictionInput,
  ): Result<ContradictionRecord>;
  raiseUnknown(scope: TenantScope, input: RaiseUnknownInput): Result<UnknownRecord>;
  getUnknown(scope: TenantScope, unknownId: string): Result<UnknownRecord>;
  listOpenUnknowns(scope: TenantScope): readonly UnknownRecord[];
  /** Explicit, audited resolution. Unknowns never disappear silently. */
  resolveUnknown(scope: TenantScope, input: ResolveUnknownInput): Result<UnknownRecord>;
}
