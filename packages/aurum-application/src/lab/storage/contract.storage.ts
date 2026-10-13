/**
 * application-storage public surface (P003, application side): the storage
 * PORTS of the lab/learning records plus the async in-memory doubles —
 * types and IO-free adapters only; the PostgreSQL adapters implementing
 * these ports live in aurum-infra (`application-storage`, the P-series
 * boundary rule: adapters stay in infra).
 *
 * Composed into the package contract (src/contract.ts) — the only
 * cross-module seam — so the persistence authority consumes the ports
 * through the public entrypoint, exactly like every other area surface.
 */
// --- ports (types only) ---
export type {
  ApplicationStoragePorts,
  AsyncPort,
  CandidateAnchorRetrieval,
  EvaluationAnchorRetrieval,
  LabEvaluationStorage,
  LearningLoopRetrieval,
  OutcomeRecordStorage,
} from "./ports.js";

// --- storage-area errors (the append-only refusal) ---
export { labEvaluationAppendRefusal } from "./errors.js";

// --- async in-memory doubles (the DB-free mode behind the same ports) ---
export {
  createAsyncInMemoryEvaluationStore,
  createAsyncInMemoryOutcomeStore,
} from "./in-memory.js";

// --- reference error constructors re-exported for the storage boundary ---
// The PostgreSQL adapters resolve the byte-identical not-found error the
// W008 in-memory reference produces; the constructor is re-exported here
// so the boundary imports it from one surface (the lab contract exports
// only the LabError class itself). The learning error constructors
// (learningConflict / learningNotFound) are already on the package surface
// through the learning area contract and are NOT duplicated here.
export { labNotFound } from "../domain/errors.js";
