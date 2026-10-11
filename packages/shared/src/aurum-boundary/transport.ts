/**
 * Aurum-facing platform boundary — execution transport port (W001).
 *
 * The port is the capability-typed contract for submitting work to the
 * ZCode substrate and observing its platform lifecycle: submit, poll, await
 * completion, cancel — plus an optional pause/resume extension for
 * environments that declare those controls.
 *
 * Contract rules (locked by the consumer test in this directory):
 * - `submit` is idempotent per `submissionKey`: a replay returns the SAME
 *   ticket with `replay: true` and never executes twice.
 * - `poll`/`awaitCompletion` report platform states only; once terminal,
 *   the same logical settlement is returned (append-only, `stale` marks
 *   superseded reads).
 * - rejections use `AurumBoundaryError` (typed; never bare strings);
 *   unknown rejections are normalized with `toAurumBoundaryErrorDetail`.
 * - the port never exposes substrate internals: tickets, handles and
 *   envelope fields are opaque. Adapters translate, the boundary never
 *   leaks the other direction.
 */

import type { AurumTransportResultEnvelope } from "./envelope.js";
import type { AurumCapabilityHandle, AurumSubmissionTicket } from "./identifiers.js";
import type { AurumTransportLifecycleState, AurumTransportTerminalState } from "./lifecycle.js";

/**
 * One unit of work submitted to the platform. The payload is opaque to the
 * boundary: the adapter defines its encoding and never lets it influence
 * boundary semantics.
 */
export interface AurumTransportSubmissionSpec {
  /** Capability handle obtained from a seam registry lookup. */
  readonly capability: AurumCapabilityHandle;
  /** Opaque work payload; encoding is adapter-defined. */
  readonly payload: string;
  /** Opaque payload media-type label (e.g. "application/json"). */
  readonly payloadMediaType: string;
  /**
   * Idempotency key: adapters MUST deduplicate submissions carrying the
   * same key (same ticket returned, `replay: true` on the ack).
   */
  readonly submissionKey?: string;
  /** Wall-clock completion deadline in epoch milliseconds, if bounded. */
  readonly deadlineEpochMs?: number;
}

/** Acknowledgement of a submission. */
export interface AurumTransportSubmissionAck {
  /** Ticket for all subsequent lifecycle operations. */
  readonly ticket: AurumSubmissionTicket;
  /** Platform state at acknowledgement time (pending or running). */
  readonly state: AurumTransportLifecycleState;
  /** True when this submission was deduplicated by `submissionKey`. */
  readonly replay: boolean;
}

/** Poll/await options. */
export interface AurumTransportAwaitOptions {
  /** Abort the wait; the adapter rejects with `aurum-transport/await-aborted`. */
  readonly signal?: AbortSignal;
  /** Advisory poll interval in milliseconds for `awaitCompletion` implementations. */
  readonly pollIntervalMs?: number;
}

/** Platform-lifecycle snapshot of one submission. */
export interface AurumTransportProgressSnapshot {
  readonly ticket: AurumSubmissionTicket;
  readonly state: AurumTransportLifecycleState;
  /** Present iff `state` is terminal. */
  readonly envelope?: AurumTransportResultEnvelope;
}

/** Result of a control request (cancel, pause, resume). */
export type AurumTransportControlOutcome =
  | { readonly outcome: "applied"; readonly state: AurumTransportLifecycleState }
  | { readonly outcome: "already-terminal"; readonly state: AurumTransportTerminalState };

/**
 * The execution transport port. Implemented by ZCode substrate adapters;
 * consumed by Aurum application/execution services.
 */
export interface AurumExecutionTransportPort {
  /**
   * Submit work for execution. Rejects with `AurumBoundaryError`
   * (`submission-invalid` / `capability-unavailable` / `transport-closed`).
   */
  submit(spec: AurumTransportSubmissionSpec): Promise<AurumTransportSubmissionAck>;

  /**
   * Read the current platform lifecycle snapshot. Rejects with
   * `ticket-unknown` for tickets the adapter never issued (or no longer
   * retains).
   */
  poll(ticket: AurumSubmissionTicket): Promise<AurumTransportProgressSnapshot>;

  /**
   * Wait for terminal state and return the normalized result envelope.
   * Rejects with `await-aborted` when the signal fires, and with
   * `deadline-exceeded` when the submission deadline passes first.
   */
  awaitCompletion(
    ticket: AurumSubmissionTicket,
    options?: AurumTransportAwaitOptions,
  ): Promise<AurumTransportResultEnvelope>;

  /**
   * Request cancellation. Resolves with the control outcome; rejects with
   * `not-cancellable` when the capability declares no cancel support.
   */
  cancel(ticket: AurumSubmissionTicket): Promise<AurumTransportControlOutcome>;
}

/**
 * Optional pause/resume extension of the transport port, implemented by
 * adapters whose capability descriptors declare `pausable`/`resumable`.
 * Consumers feature-check the extension; unsupported control requests on
 * the base port reject with `control-unsupported`.
 */
export interface AurumPausableTransportPort {
  /** Suspend an in-flight submission. */
  pause(ticket: AurumSubmissionTicket): Promise<AurumTransportControlOutcome>;
  /** Continue a paused submission. */
  resume(ticket: AurumSubmissionTicket): Promise<AurumTransportControlOutcome>;
}
