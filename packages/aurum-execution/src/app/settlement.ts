/**
 * Settlement normalization (W006 app layer): platform envelope → semantic
 * settlement, and platform rejections → typed execution errors.
 *
 * This is the ONLY place platform vocabulary maps into semantic vocabulary
 * (spec/ZCODE-SUBSTRATE-MAP.md canonical flow: "... execution -> normalized
 * result -> Aurum outcome/evidence"). Cost lines and evidence references
 * cross verbatim (opaque); platform lifecycle states map onto the semantic
 * terminal states; platform error details ride inside normalized failure
 * details. Nothing here mutates domain state — normalization produces values.
 */
import {
  toAurumBoundaryErrorDetail,
  type AurumBoundaryErrorDetail,
  type AurumTransportLifecycleState,
  type AurumTransportResultEnvelope,
} from "@zcode/shared/aurum-boundary";
import {
  ExecutionError as TypedExecutionError,
  executionAwaitAborted,
  executionControlUnsupported,
  executionInvariant,
  executionTransportFailed,
  type ExecutionError,
} from "../domain/errors.js";
import type {
  ExecutionCostLine,
  ExecutionFailureDetail,
  SettlementContext,
  SettlementInput,
} from "../domain/envelope.js";
import type { ExecutionSettlementStatus } from "../domain/lifecycle.js";
import type { ExecutionSession } from "../domain/session.js";
import type { ExecutionFailureKind } from "../domain/vocabulary.js";

/** Maps a terminal platform state onto the semantic settlement status. */
export function platformStatusToSemantic(
  status: AurumTransportLifecycleState,
): ExecutionSettlementStatus {
  switch (status) {
    case "settled":
      return "settled";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "pending":
    case "running":
    case "paused":
      throw executionInvariant(
        `a settlement was normalized from non-terminal platform state "${status}"`,
      );
  }
}

/** Cost lines cross verbatim (opaque units; normalization is app-side). */
function costLinesOf(envelope: AurumTransportResultEnvelope): ExecutionCostLine[] | undefined {
  if (envelope.cost === undefined) return undefined;
  return envelope.cost.map((line) => ({ unit: line.unit, quantity: line.quantity }));
}

/** Builds the settlement INPUT from a terminal platform envelope. */
export function settlementInputOf(
  envelope: AurumTransportResultEnvelope,
  at: number,
): SettlementInput {
  const status = platformStatusToSemantic(envelope.status);
  const cost = costLinesOf(envelope);
  const failure = status === "failed" ? { failure: failureFromPlatform(envelope.error) } : {};
  return {
    status,
    settledAt: at,
    ...(envelope.result === undefined ? {} : { result: envelope.result }),
    ...(cost === undefined ? {} : { cost }),
    ...(envelope.evidenceRef === undefined ? {} : { evidenceRef: envelope.evidenceRef }),
    ...failure,
  };
}

/** Platform-reported failure detail → normalized failure detail (verbatim). */
export function failureFromPlatform(
  detail: AurumBoundaryErrorDetail | undefined,
): ExecutionFailureDetail {
  if (detail === undefined) {
    return {
      kind: "platform-failed",
      code: "aurum-boundary/unknown",
      message: "platform reported failure without detail",
      retryable: false,
    };
  }
  return {
    kind: "platform-failed",
    code: detail.code,
    message: detail.message,
    retryable: detail.retryable,
  };
}

/** Builds a normalized failure detail for gateway-level failures. */
export function failureOfKind(
  kind: ExecutionFailureKind,
  detail: { code?: string; message: string; retryable: boolean },
): ExecutionFailureDetail {
  return {
    kind,
    code: detail.code ?? "execution/local",
    message: detail.message,
    retryable: detail.retryable,
  };
}

/** Settlement context derived from a session (echoes + provenance). */
export function settlementContextOf(session: ExecutionSession): SettlementContext {
  if (session.environmentId === undefined || session.capabilityId === undefined) {
    throw executionInvariant(
      `session ${session.requestId as string} has no environment selection to cite`,
    );
  }
  return {
    tenantId: session.tenantId,
    requestId: session.requestId,
    authority: session.authority,
    ...(session.occupancy === undefined ? {} : { occupancy: session.occupancy }),
    environment: {
      environmentId: session.environmentId,
      environmentClass: session.environmentClass,
      variant: session.environmentVariant ?? session.variant ?? "",
      capabilityId: session.capabilityId,
    },
  };
}

/**
 * Normalizes ANY platform rejection into a typed execution error — never a
 * bare throw. `deadline-exceeded`/`await-aborted`/control codes keep their
 * meaning; everything else is a transport failure (the authority law: typed
 * results, never semantic rewrites).
 */
export function mapBoundaryRejection(error: unknown): ExecutionError {
  const detail = toAurumBoundaryErrorDetail(error);
  switch (detail.code) {
    case "aurum-transport/deadline-exceeded":
      return new TypedExecutionError("execution/timeout", detail.message, { cause: error });
    case "aurum-transport/await-aborted":
      return executionAwaitAborted();
    case "aurum-transport/control-unsupported":
    case "aurum-transport/not-cancellable":
      return executionControlUnsupported(detail.message);
    case "aurum-transport/ticket-unknown":
      return new TypedExecutionError("execution/interrupted", detail.message, { cause: error });
    default:
      return executionTransportFailed(`${detail.code}: ${detail.message}`, error);
  }
}
