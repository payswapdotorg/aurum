/**
 * Execution-plane ports (W006 domain).
 *
 * The `ExecutionEnvironment` port is THE Aurum-side execution abstraction:
 * one registered environment = a semantic descriptor (what it is, what
 * controls it honors, whether it is wired) + the W001 platform seam it drives
 * (the boundary's `AurumExecutionTransportPort`, implemented by adapters —
 * spec/ZCODE-SUBSTRATE-MAP.md canonical flow: Aurum command -> application ->
 * Agent/Execution port -> ZCode adapter -> execution -> normalized result).
 * The optional pausable extension is present iff the descriptor declares
 * pausable/resumable controls. Environments are replaceable behind this port
 * (test-locked: the same gateway suite passes over different adapter
 * doubles).
 *
 * Type-only imports from the boundary: the domain layer stays free of IO and
 * runtime dependencies; only the platform seam's TYPES are composed here.
 */
import type {
  AurumExecutionTransportPort,
  AurumPausableTransportPort,
} from "@zcode/shared/aurum-boundary";
import type { ExecutionError } from "./errors.js";
import type { Result } from "./errors.js";
import type { ExecutionEnvironmentDescriptor, EnvironmentSelectionQuery } from "./vocabulary.js";
import type { ExecutionRequestId, ExecutionTenantId } from "./ids.js";
import type { ExecutionJournalKind } from "./vocabulary.js";
import type { ExecutionSession } from "./session.js";
import type { ExecutionSessionState } from "./lifecycle.js";

/** Wall-clock port (epoch milliseconds; deterministic doubles in adapters). */
export interface ExecutionClock {
  now(): number;
}

/** Id generator port (journal ids, test doubles in adapters). */
export interface ExecutionIdGenerator {
  next(): string;
}

/**
 * One execution environment as the gateway drives it. Adapters construct
 * these; the descriptor is the semantic side, `transport` is the W001
 * platform seam, `pausable` the control extension.
 */
export interface ExecutionEnvironment {
  readonly descriptor: ExecutionEnvironmentDescriptor;
  readonly transport: AurumExecutionTransportPort;
  readonly pausable?: AurumPausableTransportPort;
}

/** The environment registry: how the gateway selects and resolves environments. */
export interface ExecutionEnvironmentRegistry {
  /** Inventory of registered environments (wired AND fail-closed stubs). */
  listEnvironments(): readonly ExecutionEnvironmentDescriptor[];
  /** Selects one environment for a query (typed failure when none matches). */
  selectEnvironment(query: EnvironmentSelectionQuery): Result<ExecutionEnvironment, ExecutionError>;
  /** Resolves the environment driving one capability id. */
  resolveByCapabilityId(capabilityId: string): Result<ExecutionEnvironment, ExecutionError>;
}

/** One append-only execution-plane journal event ("audit event"). */
export interface ExecutionJournalEntry {
  readonly journalId: string;
  readonly tenantId: ExecutionTenantId;
  readonly requestId: ExecutionRequestId;
  readonly kind: ExecutionJournalKind;
  /** Epoch milliseconds (deterministic: gateway clock). */
  readonly at: number;
  /** Diagnostic only — never parsed for policy. */
  readonly detail?: string;
}

/** The append-only execution journal port. */
export interface ExecutionJournal {
  append(entry: ExecutionJournalEntry): Result<ExecutionJournalEntry, ExecutionError>;
  listEntries(
    tenantId: ExecutionTenantId,
    requestId?: ExecutionRequestId,
  ): readonly ExecutionJournalEntry[];
}

/** Session listing filter. */
export interface ExecutionSessionFilter {
  readonly state?: ExecutionSessionState;
  /** Invert: only sessions NOT in this state (e.g. recovery scan). */
  readonly notState?: ExecutionSessionState;
}

/** The execution session store port (runtime projection state). */
export interface ExecutionSessionStore {
  putSession(session: ExecutionSession): Result<ExecutionSession, ExecutionError>;
  getSession(
    tenantId: ExecutionTenantId,
    requestId: ExecutionRequestId,
  ): Result<ExecutionSession, ExecutionError>;
  listSessions(
    tenantId: ExecutionTenantId,
    filter?: ExecutionSessionFilter,
  ): readonly ExecutionSession[];
}
