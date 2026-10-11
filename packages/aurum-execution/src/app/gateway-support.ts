/**
 * Gateway support helpers (W006 app layer): the shared internal operations of
 * the Agent Gateway and the recovery path — event journaling, environment
 * resolution (semantic registry + W001 seam handle), exactly-once settlement
 * persistence, and failure settlement construction.
 *
 * Everything here operates on execution-local state ONLY (session store +
 * execution journal). The kernel is never referenced: THE AUTHORITY LAW is
 * structural — these helpers have no domain imports at all.
 */
import type {
  AurumCapabilityHandle,
  AurumSeamRegistry,
  AurumSubmissionTicket,
  AurumTransportAwaitOptions,
} from "@zcode/shared/aurum-boundary";
import {
  ok,
  executionEnvironmentUnavailable,
  executionInvariant,
  executionNotWired,
  type ExecutionError,
  type Result,
} from "../domain/errors.js";
import type { ExecutionJournalEntry } from "../domain/ports.js";
import type {
  ExecutionClock,
  ExecutionEnvironment,
  ExecutionEnvironmentRegistry,
  ExecutionIdGenerator,
  ExecutionJournal,
  ExecutionSessionStore,
} from "../domain/ports.js";
import type { EnvironmentSelectionQuery } from "../domain/vocabulary.js";
import { buildExecutionSettlement } from "../domain/envelope.js";
import type { ExecutionSettlement } from "../domain/envelope.js";
import { settleSession } from "../domain/session.js";
import type { ExecutionSession } from "../domain/session.js";
import type { ExecutionRequestId, ExecutionTenantId } from "../domain/ids.js";
import { failureOfKind, settlementContextOf, settlementInputOf } from "./settlement.js";
import type { AurumTransportResultEnvelope } from "@zcode/shared/aurum-boundary";
import type { ExecutionFailureKind } from "../domain/vocabulary.js";

/** Options for awaiting settlement (boundary await options pass through). */
export interface AwaitSettledOptions extends AurumTransportAwaitOptions {}

/** The shared dependency surface of the gateway and the recovery path. */
export interface GatewayCoreDeps {
  readonly environments: ExecutionEnvironmentRegistry;
  readonly seam: AurumSeamRegistry;
  readonly sessions: ExecutionSessionStore;
  readonly journal: ExecutionJournal;
  readonly clock: ExecutionClock;
  readonly ids: ExecutionIdGenerator;
}

/** Appends one journal event; a journal failure fails the operation (typed). */
export function appendEvent(
  deps: GatewayCoreDeps,
  tenantId: ExecutionTenantId,
  requestId: ExecutionRequestId,
  kind: ExecutionJournalEntry["kind"],
  detail?: string,
): Result<ExecutionJournalEntry, ExecutionError> {
  const entry: ExecutionJournalEntry = {
    journalId: deps.ids.next(),
    tenantId,
    requestId,
    kind,
    at: deps.clock.now(),
    ...(detail === undefined ? {} : { detail }),
  };
  return deps.journal.append(entry);
}

/** Journal kind for one terminal semantic status. */
export function terminalEventOf(
  status: ExecutionSettlement["status"],
): "session-settled" | "session-failed" | "session-cancelled" {
  switch (status) {
    case "settled":
      return "session-settled";
    case "failed":
      return "session-failed";
    case "cancelled":
      return "session-cancelled";
  }
}

export interface EnvironmentResolution {
  readonly environment: ExecutionEnvironment;
  readonly handle: AurumCapabilityHandle;
  readonly capabilityId: string;
}

/**
 * Resolves an execution environment for a selection query: semantic registry
 * selection + fail-closed wiring gate + W001 seam handle acquisition. The
 * capability ids from both seams must agree (invariant otherwise).
 */
export function resolveEnvironment(
  deps: GatewayCoreDeps,
  query: EnvironmentSelectionQuery,
): Result<EnvironmentResolution, ExecutionError> {
  const selected = deps.environments.selectEnvironment(query);
  if (!selected.ok) return selected;
  const environment = selected.value;
  if (!environment.descriptor.wired) {
    return { ok: false, error: executionNotWired(query.environmentClass) };
  }
  const lookup = deps.seam.lookup({
    capabilityClass: query.environmentClass,
    ...(query.variant === undefined ? {} : { variant: query.variant }),
  });
  if (!lookup.ok) {
    return {
      ok: false,
      error: executionEnvironmentUnavailable(
        `${query.environmentClass}${query.variant === undefined ? "" : `/${query.variant}`}`,
      ),
    };
  }
  const capabilityId = lookup.descriptor.capabilityId;
  if (capabilityId !== environment.descriptor.environmentId) {
    return {
      ok: false,
      error: executionInvariant(
        `seam capability ${capabilityId} does not match selected environment ${environment.descriptor.environmentId}`,
      ),
    };
  }
  return {
    ok: true,
    value: { environment, handle: lookup.handle, capabilityId },
  };
}

/** Resolves the environment + fresh seam handle for an existing session. */
export function resolveEnvironmentForSession(
  deps: GatewayCoreDeps,
  session: ExecutionSession,
): Result<EnvironmentResolution, ExecutionError> {
  if (session.capabilityId === undefined) {
    return {
      ok: false,
      error: executionInvariant(
        `session ${session.requestId as string} has no capability id to resolve`,
      ),
    };
  }
  const byCapability = deps.environments.resolveByCapabilityId(session.capabilityId);
  if (!byCapability.ok) return byCapability;
  const query: EnvironmentSelectionQuery = {
    environmentClass: session.environmentClass,
    ...(session.variant === undefined ? {} : { variant: session.variant }),
  };
  return resolveEnvironment(deps, query);
}

export interface SettlementApplication {
  readonly session: ExecutionSession;
  readonly settlement: ExecutionSettlement;
  /** False when an identical settlement was already applied (exactly-once). */
  readonly firstSettlement: boolean;
}

/**
 * Applies a settlement to a session EXACTLY ONCE and persists it:
 * - identical duplicate → suppressed (firstSettlement false, no rewrite);
 * - divergent re-settlement → typed invariant error;
 * - terminal event journaled on first application.
 */
export function applySettlement(
  deps: GatewayCoreDeps,
  session: ExecutionSession,
  settlement: ExecutionSettlement,
): Result<SettlementApplication, ExecutionError> {
  const settled = settleSession(session, settlement, deps.clock.now());
  if (!settled.ok) return settled;
  const stored = deps.sessions.putSession(settled.value.session);
  if (!stored.ok) return stored;
  if (settled.value.firstSettlement) {
    const event = appendEvent(
      deps,
      session.tenantId,
      session.requestId,
      terminalEventOf(settlement.status),
      settlement.status === "failed"
        ? `kind=${settlement.failure?.kind ?? "unknown"}`
        : undefined,
    );
    if (!event.ok) return event;
  } else {
    const suppressed = appendEvent(
      deps,
      session.tenantId,
      session.requestId,
      "duplicate-suppressed",
      "identical settlement re-delivered",
    );
    if (!suppressed.ok) return suppressed;
  }
  return ok({
    session: stored.value,
    settlement,
    firstSettlement: settled.value.firstSettlement,
  });
}

/** Normalizes a terminal platform envelope and applies it to the session. */
export function applyPlatformEnvelope(
  deps: GatewayCoreDeps,
  session: ExecutionSession,
  envelope: AurumTransportResultEnvelope,
): Result<SettlementApplication, ExecutionError> {
  const input = settlementInputOf(envelope, deps.clock.now());
  const settlement = buildExecutionSettlement(settlementContextOf(session), input);
  return applySettlement(deps, session, settlement);
}

/** Builds + applies a failed settlement for a gateway-level failure. */
export function failSession(
  deps: GatewayCoreDeps,
  session: ExecutionSession,
  kind: ExecutionFailureKind,
  message: string,
  options: { code?: string; retryable?: boolean } = {},
): Result<SettlementApplication, ExecutionError> {
  const settlement = buildExecutionSettlement(settlementContextOf(session), {
    status: "failed",
    settledAt: deps.clock.now(),
    failure: failureOfKind(kind, {
      code: options.code,
      message,
      retryable: options.retryable ?? false,
    }),
  });
  return applySettlement(deps, session, settlement);
}

/**
 * Re-brands a ticket this gateway legitimately received from the issuing
 * transport (stored as an opaque string on the session) for a return call.
 * No foreign tickets are ever constructed here.
 */
export function reissueTicket(ticket: string): AurumSubmissionTicket {
  return ticket as AurumSubmissionTicket;
}

/** Failure kind for a submission-level typed error. */
export function submissionFailureKindOf(
  error: ExecutionError,
): "transport-failed" | "deadline-exceeded" | "interrupted" {
  switch (error.code) {
    case "execution/timeout":
      return "deadline-exceeded";
    case "execution/interrupted":
      return "interrupted";
    default:
      return "transport-failed";
  }
}

/**
 * Journals + settles a failed session after a submission transport failure,
 * then returns the ORIGINAL typed error (the authority law: typed result +
 * audit event; the session — execution-local state — records the failure,
 * the kernel is untouched).
 */
export function submitFailure(
  deps: GatewayCoreDeps,
  session: ExecutionSession,
  mapped: ExecutionError,
): Result<never, ExecutionError> {
  const event = appendEvent(
    deps,
    session.tenantId,
    session.requestId,
    "failure-recorded",
    `submission transport failure: ${mapped.message}`,
  );
  if (!event.ok) return event;
  const applied = failSession(
    deps,
    session,
    submissionFailureKindOf(mapped),
    mapped.message,
    { code: mapped.code, retryable: mapped.code === "execution/transport-failed" },
  );
  if (!applied.ok) return applied;
  return { ok: false, error: mapped };
}
