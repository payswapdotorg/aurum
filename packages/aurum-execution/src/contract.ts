/**
 * aurum-execution public contract — the ONLY cross-module surface (W006:
 * Agent Gateway + ExecutionEnvironment, spec/WORK-ITEM-CATALOG.md §W006).
 *
 * Composed re-exports of the narrow layer contracts; the package layers
 * follow the house pattern (domain/app/adapters within src/, enforced by
 * the architecture checker). Everything a consumer (W009 ExecutionPlan/relay,
 * W012 continuity, application services) needs is here:
 *
 * - the ExecutionEnvironment port + registry (descriptor / transport seam —
 *   the W001 boundary's ExecutionTransportPort composed behind it) and the
 *   replaceability guarantee: environments are doubles behind the port;
 * - the Agent Gateway (submit / await / pause / resume / cancel / recover /
 *   get / list) accepting requests that CITE domain authority (action id /
 *   audit ref — opaque here by architecture mandate) and returning
 *   NORMALIZED settlements (result / failure / cost / evidenceRef + the
 *   authority echo), never mutating semantic state;
 * - the execution session model + semantic lifecycle
 *   (pending/running/paused/settled/cancelled/failed) with exactly-once
 *   settlement and recovery semantics;
 * - typed ExecutionError vocabulary + Result;
 * - the reference in-process adapters: local (deterministic step scripts,
 *   real port semantics), sandbox (isolated workspaces, latency + failure
 *   injection), fail-closed stubs for browser/computer/workflow/remote, the
 *   in-process seam registry, in-memory stores/journal and deterministic
 *   clock/id doubles.
 *
 * Semantics guaranteed at this boundary (W006 acceptance):
 * - every record and operation is tenant-scoped; foreign-tenant references
 *   are uniformly not-found (no existence leaks);
 * - terminal sessions and settlements are immutable; duplicate delivery is
 *   idempotent (same request id settles exactly once);
 * - runtime failures produce typed error results + execution-plane journal
 *   events and NEVER rewrite semantic state (the caller records semantics
 *   through the domain seams);
 * - execution environments are replaceable behind the port.
 */
// --- typed errors + Result (domain) ---
export { ExecutionError, isExecutionError } from "./domain/errors.js";
export type { ExecutionErrorCode, Result } from "./domain/errors.js";
export { err, ok } from "./domain/errors.js";

// --- validation issue shape (domain) ---
export type { ValidationIssue } from "./domain/issues.js";

// --- identifiers + tenant scope (domain) ---
export {
  asExecutionJournalEntryId,
  asExecutionRequestId,
  asExecutionTenantId,
  executionScope,
  requestIdIssues,
} from "./domain/ids.js";
export type {
  ExecutionJournalEntryId,
  ExecutionRequestId,
  ExecutionScope,
  ExecutionTenantId,
} from "./domain/ids.js";

// --- vocabulary (domain) ---
export {
  EXECUTION_ENVIRONMENT_CLASSES,
  EXECUTION_FAILURE_KINDS,
  EXECUTION_JOURNAL_KINDS,
  isExecutionEnvironmentClass,
  isExecutionFailureKind,
  isExecutionJournalKind,
  matchesSelectionQuery,
  selectionQueryIssues,
} from "./domain/vocabulary.js";
export type {
  EnvironmentSelectionQuery,
  ExecutionControlSurface,
  ExecutionEnvironmentClass,
  ExecutionEnvironmentDescriptor,
  ExecutionFailureKind,
  ExecutionJournalKind,
} from "./domain/vocabulary.js";

// --- semantic lifecycle (domain) ---
export {
  EXECUTION_SESSION_STATES,
  EXECUTION_SESSION_TERMINAL_STATES,
  executionTransitionLegal,
  isExecutionSessionState,
  isExecutionTerminalState,
  isTerminalSessionState,
  legalExecutionTransitionsFrom,
} from "./domain/lifecycle.js";
export type {
  ExecutionSessionState,
  ExecutionSettlementStatus,
  ExecutionTerminalState,
} from "./domain/lifecycle.js";

// --- domain authority citations (opaque; kernel-aligned) ---
export {
  authorityCitationIssues,
  modelOccupancyIssues,
} from "./domain/authority.js";
export type { AuthorityCitation, ModelOccupancy } from "./domain/authority.js";

// --- normalized settlement envelope (domain) ---
export {
  buildExecutionSettlement,
  isExecutionSettlement,
} from "./domain/envelope.js";
export type {
  ExecutionCostLine,
  ExecutionEnvironmentProvenance,
  ExecutionFailureDetail,
  ExecutionSettlement,
  SettlementContext,
  SettlementInput,
} from "./domain/envelope.js";

// --- session model + transitions (domain) ---
export {
  createPendingSession,
  executionRequestIssues,
  settleSession,
  terminalStateOf,
  totalCostOf,
  failureOf,
  withAcknowledgement,
  withEnvironmentSelected,
  withSessionState,
} from "./domain/session.js";
export type { ExecutionRequest, ExecutionSession, SessionDeps } from "./domain/session.js";

// --- recovery semantics (domain) ---
export {
  interruptedSessionsOf,
  isRecoverableSession,
  recoveryRouteOf,
  submissionKeyOf,
} from "./domain/recovery.js";
export type { RecoveryRoute, RecoveryRouteDecision } from "./domain/recovery.js";

// --- ports (domain) ---
export type {
  ExecutionClock,
  ExecutionEnvironment,
  ExecutionEnvironmentRegistry,
  ExecutionIdGenerator,
  ExecutionJournal,
  ExecutionJournalEntry,
  ExecutionSessionFilter,
  ExecutionSessionStore,
} from "./domain/ports.js";

// --- settlement normalization (app) ---
export {
  failureOfKind,
  failureFromPlatform,
  mapBoundaryRejection,
  platformStatusToSemantic,
  settlementContextOf,
  settlementInputOf,
} from "./app/settlement.js";

// --- Agent Gateway (app) ---
export { createAgentGateway } from "./app/gateway.js";
export type {
  AgentGateway,
  AgentGatewayDeps,
  AwaitSettledOptions,
  ExecutionSubmission,
} from "./app/gateway.js";

// --- recovery service (app) ---
export { runRecovery } from "./app/recovery.js";
export type {
  RecoveryOutcome,
  RecoveryOutcomeKind,
  RecoveryReport,
} from "./app/recovery.js";

// --- reference adapters (adapters) ---
export {
  FixedEpochClock,
  SequentialIdGenerator,
  SteppingEpochClock,
} from "./adapters/deterministic.js";
export {
  createInMemorySessionStore,
  InMemoryExecutionSessionStore,
} from "./adapters/in-memory-session-store.js";
export {
  createInMemoryJournal,
  InMemoryExecutionJournal,
} from "./adapters/in-memory-journal.js";
export { createInProcessEnvironmentRegistry } from "./adapters/seam-registry.js";
export type { InProcessEnvironmentRegistry } from "./adapters/seam-registry.js";
export { createLocalEnvironment } from "./adapters/local-environment.js";
export type {
  LocalEnvironmentConfig,
  LocalEnvironmentController,
  LocalWorkload,
  LocalWorkloadStep,
} from "./adapters/local-environment.js";
export { createSandboxEnvironment } from "./adapters/sandbox-environment.js";
export type {
  SandboxEnvironmentConfig,
  SandboxEnvironmentController,
} from "./adapters/sandbox-environment.js";
export {
  createStandardStubEnvironments,
  createStubEnvironment,
  STUB_ENVIRONMENT_CLASSES,
} from "./adapters/stub-environments.js";
export type { StubEnvironmentClass, StubEnvironmentConfig } from "./adapters/stub-environments.js";
