/**
 * Learning ports (W013 domain layer): the narrow, READ-ONLY seams the
 * learning loop consumes plus the learning area's own append-only outcome
 * store. Learning never mutates domain or lab state (no second authority):
 * every seam below is a query, and the only writes are the learning area's
 * OWN outcome records.
 *
 * The seams are typed as structural picks of the consumed surfaces (the
 * house pattern — the composed kernel / lab service satisfy them directly,
 * while tests can supply minimal deterministic doubles):
 * - evaluations: the lab's evaluation store (read) — the context join source;
 * - candidates : the W005 candidate registry (read) — the organization join
 *                source;
 * - lab        : the W008 search facade — the calibrated search wraps it.
 */
import type { OrganizationCandidateRegistry, Result, TenantScope } from "@aurum/domain";
import type { LabEvaluationStore, OrganizationalLab } from "../../lab/contract.lab.js";
import type { OutcomeFilter, OutcomeJoinRecord } from "./records.js";
import type { LearningError } from "./errors.js";

/** Read-only evaluation views (the lab area's own store, read seam only). */
export type LearningEvaluationViews = Pick<LabEvaluationStore, "getEvaluation">;

/** Read-only candidate views (the W005 registry, read seam only). */
export type LearningCandidateViews = Pick<OrganizationCandidateRegistry, "getCandidate">;

/**
 * The learning area's own outcome store (in-memory today; P003 adds
 * PostgreSQL storage ports behind this same shape). APPEND-ONLY: putting a
 * duplicate outcome id fails with a typed conflict — recorded outcomes
 * (including failures) are never rewritten. Tenant scoping flows through
 * the seam: cross-tenant reads fail closed as a uniform not-found.
 */
export interface OutcomeStore {
  putOutcome(
    scope: TenantScope,
    record: OutcomeJoinRecord,
  ): Result<OutcomeJoinRecord, LearningError>;
  getOutcome(scope: TenantScope, outcomeId: string): Result<OutcomeJoinRecord, LearningError>;
  listOutcomes(scope: TenantScope, filter?: OutcomeFilter): readonly OutcomeJoinRecord[];
}

/** Dependencies of the learning service factory. */
export interface OutcomeLearningDeps {
  readonly outcomes: OutcomeStore;
  readonly evaluations: LearningEvaluationViews;
  readonly candidates: LearningCandidateViews;
  readonly lab: Pick<OrganizationalLab, "searchOrganizations">;
}
