/**
 * Composed PG-backed application stores (P003): the composition factories.
 * Composition is consumer-owned by default (one factory per store, the
 * P001 discipline); these conveniences wire the application-area stores
 * onto ONE database handle — the shapes the proofs and the learning-loop
 * retrieval drive:
 *
 * - `createPgApplicationStorage` — the `ApplicationStoragePorts` boundary
 *   (evaluations + outcomes) on one handle;
 * - `createPgLearningLoopRetrieval` — the retrieval paths the
 *   outcome-learning loop consumes: the two join anchors (the lab
 *   evaluation store + the P001 candidate registry — extend, never
 *   duplicate) plus the outcome evidence listing.
 *
 * A single database serving domain + fabric + application areas is the
 * caller composing the factories over the same handle (the harnesses and
 * the registry proofs demonstrate exactly that shared-database shape).
 */
import type { ApplicationStoragePorts, LearningLoopRetrieval } from "@aurum/application";
import type { Db } from "../domain-storage/pg/db.js";
import { createPgCandidateRegistry } from "../domain-storage/adapters/candidate-store.js";
import { createPgLabEvaluationStore } from "./adapters/evaluation-store.js";
import { createPgOutcomeRecordStore } from "./adapters/outcome-store.js";

/** Every application-area record store on one database handle. */
export function createPgApplicationStorage(sql: Db): ApplicationStoragePorts {
  return {
    evaluations: createPgLabEvaluationStore(sql),
    outcomes: createPgOutcomeRecordStore(sql),
  };
}

/**
 * The retrieval paths the outcome-learning loop consumes on one database
 * handle: the context-join anchor (lab evaluations), the organization-join
 * anchor (the P001 candidate registry) and the outcome evidence listing.
 */
export function createPgLearningLoopRetrieval(sql: Db): LearningLoopRetrieval {
  return {
    evaluations: createPgLabEvaluationStore(sql),
    candidates: createPgCandidateRegistry(sql),
    outcomes: createPgOutcomeRecordStore(sql),
  };
}
