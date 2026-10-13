/**
 * Continuity area public surface (W012): cross-platform session continuity —
 * the append-only continuity ledger, the two EXPLICIT session modes
 * (`continuous` desktop / `replay` web-mobile-cli), replay that reconstructs
 * WITHOUT re-running effects, remote attachments over a substrate surface,
 * and the wire-agnostic RPC envelope behind the same service interfaces.
 *
 * THE ONE-AUTHORITY LAW (APPROACH R1): this area journals and replays WHAT
 * THE SESSION'S REAL COMPOSITION DID — it owns no command path, holds no
 * second copy of any store, and decides nothing. The kernel + the four area
 * services remain the only semantic authority on every platform.
 *
 * Cross-module consumption: `@aurum/domain` is imported ONLY through its
 * public package entrypoint; sibling areas are consumed through their
 * contract files (the intra-package public surfaces composed by
 * src/contract.ts). The continuity area imports NEITHER `@aurum/agent` NOR
 * `@aurum/provider` — bodies resolve through the kernel/agent package
 * identically on every platform (no second Agent Body; tripwire-locked in
 * test/continuity-contract-hygiene.test.ts).
 */
// --- typed errors (domain) ---
export {
  continuityConflict,
  continuityInvariant,
  continuityNotFound,
  continuityState,
  continuitySurfaceRefused,
  continuityValidationError,
  isContinuityError,
} from "./domain/errors.js";
export type { ContinuityError, ContinuityErrorCode } from "./domain/errors.js";

// --- record vocabulary (domain) ---
export { CONTINUITY_COMPOSITION_ID } from "./domain/records.js";
export type {
  AttachmentDigest,
  AttachmentView,
  ContinuityEntry,
  ContinuityMode,
  ContinuityRecord,
  KernelWriteEntry,
  ReplayReport,
  SessionInfo,
  SessionVariant,
} from "./domain/records.js";

// --- replay validation + summary (domain, pure) ---
export { replayIssues, replaySummaryOf } from "./domain/replay.js";

// --- attachment digests (domain, pure default) ---
export { attachmentDigestOf, fnv1a64Of } from "./domain/digests.js";

// --- ports (domain) ---
export type {
  CloseAttachmentInput,
  ComposedTowerSession,
  ContinuityLedger,
  ContinuityService,
  ContinuityServiceDeps,
  EnsureSessionInput,
  EnsuredSession,
  LiveTowerSession,
  MaybePromise,
  OpenAttachmentInput,
  OpenSessionInput,
  ResumeSessionInput,
  TowerAttachmentSurface,
  TowerReplayTargets,
  TowerReplayer,
  TowerRuntimeComposer,
  TowerServiceAccess,
  TowerSessionBinding,
} from "./domain/ports.js";

// --- service (app) ---
export { createContinuityService } from "./app/continuityService.js";

// --- reference adapters (adapters) ---
export { createInMemoryContinuityLedger } from "./adapters/in-memory-ledger.js";
export { createJsonFileContinuityLedger } from "./adapters/json-file-ledger.js";
export { createContinuousTowerSession, createTowerReplayer } from "./adapters/session-kernel.js";
export type { TowerSessionKernelOptions } from "./adapters/session-kernel.js";
export {
  createFileSystemAttachmentSurface,
  createInMemoryAttachmentSurface,
  createRefusingAttachmentSurface,
} from "./adapters/attachment-surfaces.js";
export {
  createTowerRpcClient,
  createTowerRpcHandler,
  TOWER_RPC_METHODS,
} from "./adapters/tower-rpc.js";
export type {
  TowerRpcEnvelope,
  TowerRpcHandler,
  TowerRpcSettled,
  TowerRpcTransport,
} from "./adapters/tower-rpc.js";
