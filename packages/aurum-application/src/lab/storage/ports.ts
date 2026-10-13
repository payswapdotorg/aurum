/**
 * Application storage ports (P003, types ONLY — zero IO): the async
 * PostgreSQL storage boundary of the lab/learning application records,
 * derived structurally from the very same synchronous ports the W008/W013
 * in-memory references implement — the P001 `AsyncStore` pattern carried
 * onto the application layer. Because the mapping is structural
 * (`AsyncPort<P>`), any change to a sync port propagates to the storage
 * boundary automatically; the boundary can never drift from the contract
 * it persists.
 *
 * What is persisted (the W008 records.ts law): the lab evaluation record is
 * "the lab's own append-only evidence" and carries the outcome-learning
 * join keys verbatim — fingerprintDigest, fingerprintAxes, constraint set,
 * weights, modifiers, ranking rule. ONE record kind serves both production
 * paths (searchOrganizations records the search; evaluateOrganizations
 * records the standalone candidate evaluation), exactly like the
 * in-memory reference store; the outcome join record (W013) carries the
 * seven join dimensions through the same boundary.
 *
 * APPEND-ONLY LAW (catalog P003 acceptance): evaluations and outcomes are
 * append-only, per-tenant evidence at this boundary — a duplicate record id
 * resolves as a typed refusal (never a rewrite, never an update/delete
 * surface), and every operation stays tenant-scoped with foreign-tenant
 * reads uniformly not-found. The W013 anchor-required law carries through:
 * there is NO global-evidence API here — evidence retrieval is the W013
 * `listOutcomes` port (tenant + optional anchor/class filters) and the
 * conditional aggregation stays anchored (fingerprint or class key).
 */
import type { TenantScope } from "@aurum/domain";
import type { LabEvaluationStore } from "../domain/ports.js";
import type {
  LearningCandidateViews,
  LearningEvaluationViews,
  OutcomeStore,
} from "../../learning/contract.learning.js";

/**
 * Structural async mapping of an application port: every method keeps its
 * name and parameters (leading `TenantScope` included) and returns a
 * Promise of the synchronous result. The `Result` discipline is preserved —
 * adapters resolve with Result values, they never reject with domain
 * failures (the P001 `AsyncStore` mapping, scope-first).
 */
export type AsyncPort<P> = {
  [K in keyof P]: P[K] extends (scope: TenantScope, ...args: infer A) => infer R
    ? (scope: TenantScope, ...args: A) => Promise<Awaited<R>>
    : never;
};

/**
 * Storage port for lab evaluation records — the append-only evidence of
 * both lab production paths (search records and candidate evaluations),
 * tenant-scoped, join keys carried verbatim.
 */
export type LabEvaluationStorage = AsyncPort<LabEvaluationStore>;

/** Storage port for the learning area's append-only outcome join records. */
export type OutcomeRecordStorage = AsyncPort<OutcomeStore>;

/**
 * Retrieval path: the context-join anchor (the lab evaluation an outcome
 * joins to), by evaluation id within the requesting tenant.
 */
export type EvaluationAnchorRetrieval = AsyncPort<LearningEvaluationViews>;

/**
 * Retrieval path: the organization-join anchor (the W005 candidate value),
 * by candidate id within the requesting tenant. The PostgreSQL
 * implementation is the P001 candidate registry (`CandidateStorage`) —
 * extend, never duplicate.
 */
export type CandidateAnchorRetrieval = AsyncPort<LearningCandidateViews>;

/**
 * The retrieval paths the outcome-learning loop consumes, async: the two
 * join anchors plus the outcome evidence listing (by tenant, optionally by
 * anchor ids or by conditioning class/shape keys). No global-evidence
 * surface exists on this boundary — the W013 conditional aggregation stays
 * anchor-required at its own service layer.
 */
export interface LearningLoopRetrieval {
  readonly evaluations: EvaluationAnchorRetrieval;
  readonly candidates: CandidateAnchorRetrieval;
  readonly outcomes: OutcomeRecordStorage;
}

/**
 * The composed application-storage boundary: the two append-only record
 * stores a PostgreSQL (or in-memory) application storage must provide. A
 * persistence authority (P003, aurum-infra) implements exactly this shape;
 * the synchronous in-memory references implement the sync twin.
 */
export interface ApplicationStoragePorts {
  readonly evaluations: LabEvaluationStorage;
  readonly outcomes: OutcomeRecordStorage;
}
