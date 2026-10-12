/**
 * Company ports (W004 domain layer): the narrow, READ-ONLY seams the company
 * intelligence slice consumes from the composed domain kernel, plus the
 * slice's own query-log port. The company never mutates domain state (no
 * second authority): every seam below is a query. Write-shaped kernel
 * methods (register/record/retract/revise/...) are structurally absent —
 * test/company-contract-hygiene.test.ts trips on any appearance.
 *
 * The seams are typed as structural picks of the kernel interfaces so the
 * composed kernel satisfies them directly, while tests can supply minimal
 * deterministic doubles.
 */
import type {
  AuditTrail,
  DomainTimestamp,
  EpistemicsLedger,
  EvidenceLedger,
  GoalLedger,
  IdentityDirectory,
  InquiryLedger,
  OrganizationalMemory,
  Result,
  TenantScope,
} from "@aurum/domain";
import type { CompanyError } from "./errors.js";
import type { CompanyQueryLogRecord } from "./records.js";

/**
 * Read-only domain views the company consumes (tenant-scoped queries only):
 * - evidence  : observations about a subject + claim-source lookups;
 * - epistemics: beliefs with their claim chains (assertion re-derived);
 * - inquiry   : open unknowns + open contradictions (the blind-spot seams);
 * - goals     : goal landscape + per-revision lookups (ownership, horizon);
 * - memory    : organizational knowledge versions;
 * - identity  : memberships (active ownership) + person labels;
 * - audit     : the append-only transition log (what changed since).
 */
export interface CompanyDomainViews {
  readonly evidence: Pick<EvidenceLedger, "getObservation" | "listObservations">;
  readonly epistemics: Pick<EpistemicsLedger, "getBelief" | "getClaim" | "listBeliefs">;
  readonly inquiry: Pick<InquiryLedger, "listOpenUnknowns" | "listOpenContradictions">;
  readonly goals: Pick<GoalLedger, "getGoal" | "getGoalRevision" | "listGoals">;
  readonly memory: Pick<OrganizationalMemory, "getMemory" | "listMemory">;
  readonly identity: Pick<IdentityDirectory, "getPerson" | "listMemberships">;
  readonly audit: Pick<AuditTrail, "queryAudit">;
}

/**
 * The company slice's own query log (in-memory today; PostgreSQL ports land
 * with the persistence work items). Tenant scoping flows through the seam:
 * cross-tenant reads fail closed as a uniform not-found. One record per
 * successfully answered company query — who asked, what, when, why.
 */
export interface CompanyQueryLog {
  appendQueryLog(
    scope: TenantScope,
    record: CompanyQueryLogRecord,
  ): Result<CompanyQueryLogRecord, CompanyError>;
  getQueryLog(scope: TenantScope, queryId: string): Result<CompanyQueryLogRecord, CompanyError>;
  listQueryLogs(scope: TenantScope): readonly CompanyQueryLogRecord[];
}

/** Dependencies of the company intelligence service factory. */
export interface CompanyIntelligenceDeps {
  readonly views: CompanyDomainViews;
  readonly queryLog: CompanyQueryLog;
}

/** Timestamped read helper shared by the app layer (deterministic `now`). */
export type Now = DomainTimestamp;
