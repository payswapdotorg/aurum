/**
 * W001 structural consumer test (compile-time contract exercise).
 *
 * A compile-only consumer that imports EVERY public export of the boundary
 * surface and exercises the type shapes — proving the contracts are
 * structurally consumable by a downstream Aurum package without importing
 * any ZCode internals. If an export disappears or a shape drifts so that
 * this file no longer compiles (vitest typechecks via esbuild transform +
 * the assertions run), the gate fails.
 *
 * The runtime assertions are deliberately weak: this test's real teeth are
 * TYPE-level. Only the exported guards and mint functions run.
 */

import { describe, expect, it } from "vitest";

import {
  AURUM_BOUNDARY_SURFACE_VERSION,
  AURUM_TRANSPORT_CAPABILITY_CLASSES,
  AURUM_TRANSPORT_LIFECYCLE_STATES,
  AURUM_TRANSPORT_TERMINAL_STATES,
  AurumBoundaryError,
  isAurumBoundaryError,
  isAurumTransportCapabilityClass,
  isAurumTransportLifecycleState,
  isAurumTransportResultEnvelope,
  isAurumTransportTerminalState,
  mintAurumCapabilityHandle,
  mintAurumSubmissionTicket,
  toAurumBoundaryErrorDetail,
} from "./index.js";
import type {
  AurumBoundaryErrorDetail,
  AurumBoundaryErrorCode,
  AurumCapabilityHandle,
  AurumExecutionTransportPort,
  AurumPausableTransportPort,
  AurumSeamDescribeResult,
  AurumSeamLookupFailure,
  AurumSeamLookupQuery,
  AurumSeamLookupResult,
  AurumSeamRegistry,
  AurumSeamResolvedCapability,
  AurumSubmissionTicket,
  AurumTransportAwaitOptions,
  AurumTransportCapabilityClass,
  AurumTransportCapabilityDescriptor,
  AurumTransportControlOutcome,
  AurumTransportControlSurface,
  AurumTransportCostLine,
  AurumTransportLifecycleState,
  AurumTransportProgressSnapshot,
  AurumTransportResultEnvelope,
  AurumTransportSubmissionAck,
  AurumTransportSubmissionSpec,
  AurumTransportTerminalState,
} from "./index.js";

// ---------------------------------------------------------------------------
// Type-shape fixtures. Every named type is referenced here; if any exported
// type changes shape incompatibly, THIS section stops compiling.
// ---------------------------------------------------------------------------

const controlSurface: AurumTransportControlSurface = {
  cancellable: true,
  pausable: true,
  resumable: true,
};

const descriptor: AurumTransportCapabilityDescriptor = {
  capabilityId: "cap-1",
  capabilityClass: "browser",
  variant: "headless",
  control: controlSurface,
  maxConcurrentSubmissions: 4,
  notes: "fixture",
};

const errorDetail: AurumBoundaryErrorDetail = {
  code: "aurum-seam/capability-unavailable",
  message: "fixture",
  retryable: false,
};

const errorCode: AurumBoundaryErrorCode = "aurum-transport/internal";

const costLine: AurumTransportCostLine = { unit: "input-tokens", quantity: 12 };

const ticket: AurumSubmissionTicket = mintAurumSubmissionTicket("ticket-1");
const handle: AurumCapabilityHandle = mintAurumCapabilityHandle("handle-1");

const lifecycleState: AurumTransportLifecycleState = "running";
const terminalState: AurumTransportTerminalState = "settled";

const envelope: AurumTransportResultEnvelope = {
  ticket,
  status: terminalState,
  result: "opaque",
  cost: [costLine],
  evidenceRef: "opaque-evidence-ref",
  stale: false,
};

const submissionSpec: AurumTransportSubmissionSpec = {
  capability: handle,
  payload: "opaque",
  payloadMediaType: "application/json",
  submissionKey: "idem-1",
  deadlineEpochMs: 4102444800000,
};

const awaitOptions: AurumTransportAwaitOptions = {
  signal: undefined,
  pollIntervalMs: 250,
};

const controlOutcome: AurumTransportControlOutcome = {
  outcome: "applied",
  state: "cancelled",
};

const snapshot: AurumTransportProgressSnapshot = {
  ticket,
  state: lifecycleState,
  envelope,
};

const lookupQuery: AurumSeamLookupQuery = { capabilityClass: "local" };

const resolved: AurumSeamResolvedCapability = {
  ok: true,
  handle,
  descriptor,
};

const lookupFailure: AurumSeamLookupFailure = {
  ok: false,
  error: errorDetail,
};

const lookupResult: AurumSeamLookupResult = resolved;
const describeResult: AurumSeamDescribeResult = { ok: true, descriptor };

// A minimal conforming transport port implementation proves the interface
// is implementable exactly as declared.
const transportPort: AurumExecutionTransportPort = {
  async submit(spec: AurumTransportSubmissionSpec) {
    return { ticket: spec.capability, state: "pending", replay: false };
  },
  async poll(activeTicket: AurumSubmissionTicket) {
    return { ticket: activeTicket, state: lifecycleState };
  },
  async awaitCompletion(activeTicket: AurumSubmissionTicket) {
    return { ...envelope, ticket: activeTicket };
  },
  async cancel(activeTicket: AurumSubmissionTicket) {
    return { outcome: "already-terminal", state: terminalState } as const;
  },
};

const pausablePort: AurumPausableTransportPort = {
  async pause(activeTicket: AurumSubmissionTicket) {
    return { outcome: "applied", state: "paused" } as const;
  },
  async resume(activeTicket: AurumSubmissionTicket) {
    return { outcome: "applied", state: lifecycleState } as const;
  },
};

// A minimal conforming seam registry implementation.
const seamRegistry: AurumSeamRegistry = {
  listCapabilities: () => [descriptor],
  lookup: (query: AurumSeamLookupQuery) =>
    query.capabilityClass === descriptor.capabilityClass ? resolved : lookupFailure,
  describe: (candidate: AurumCapabilityHandle) =>
    candidate === handle ? describeResult : { ok: false, error: errorDetail },
};

// Marker values so the fixture block is genuinely referenced and not tree-shaken
// into "unused variable" noise (oxlint may flag unused locals in tests).
void [
  errorCode,
  awaitOptions,
  controlOutcome,
  snapshot,
  lookupResult,
  transportPort,
  pausablePort,
  seamRegistry,
  describeResult,
];

// ---------------------------------------------------------------------------
// Runtime behavior of the exported guards / mints / error class.
// ---------------------------------------------------------------------------

describe("W001 boundary structural surface", () => {
  it("declares the mandated lifecycle vocabulary verbatim", () => {
    expect([...AURUM_TRANSPORT_LIFECYCLE_STATES]).toEqual([
      "pending",
      "running",
      "paused",
      "settled",
      "cancelled",
      "failed",
    ]);
    expect([...AURUM_TRANSPORT_TERMINAL_STATES]).toEqual(["settled", "cancelled", "failed"]);
  });

  it("declares the mandated capability classes verbatim", () => {
    expect([...AURUM_TRANSPORT_CAPABILITY_CLASSES]).toEqual([
      "local",
      "browser",
      "computer",
      "workflow",
      "remote",
      "sandbox",
    ]);
  });

  it("mints opaque identifiers that remain strings at runtime", () => {
    expect(mintAurumSubmissionTicket("t")).toBe("t");
    expect(mintAurumCapabilityHandle("h")).toBe("h");
    expect(typeof AURUM_BOUNDARY_SURFACE_VERSION).toBe("string");
  });

  it("accepts vocabulary members and rejects everything else", () => {
    for (const state of AURUM_TRANSPORT_LIFECYCLE_STATES) {
      expect(isAurumTransportLifecycleState(state)).toBe(true);
    }
    expect(isAurumTransportLifecycleState("succeeded")).toBe(false);
    expect(isAurumTransportLifecycleState(42)).toBe(false);
    expect(isAurumTransportTerminalState("settled")).toBe(true);
    expect(isAurumTransportTerminalState("running")).toBe(false);
    for (const capabilityClass of AURUM_TRANSPORT_CAPABILITY_CLASSES) {
      expect(isAurumTransportCapabilityClass(capabilityClass)).toBe(true);
    }
    expect(isAurumTransportCapabilityClass("mainframe")).toBe(false);
  });

  it("normalizes errors typed-ly and never throws", () => {
    const fromBoundary = toAurumBoundaryErrorDetail(
      new AurumBoundaryError("aurum-transport/internal", "boom", { retryable: true }),
    );
    expect(fromBoundary.code).toBe("aurum-transport/internal");
    expect(fromBoundary.retryable).toBe(true);
    expect(fromBoundary.message).toBe("boom");

    const fromPlainError = toAurumBoundaryErrorDetail(new Error("plain"));
    expect(fromPlainError.code).toBe("aurum-boundary/unknown");
    expect(fromPlainError.retryable).toBe(false);

    const fromBareString = toAurumBoundaryErrorDetail("bare-string");
    expect(fromBareString.code).toBe("aurum-boundary/unknown");
    expect(fromBareString.message).toBe("bare-string");

    expect(toAurumBoundaryErrorDetail(null).message).toBe("null");
    expect(isAurumBoundaryError(new Error("nope"))).toBe(false);
    expect(isAurumBoundaryError(new AurumBoundaryError("aurum-seam/handle-invalid", "x"))).toBe(
      true,
    );
  });

  it("structurally validates envelopes and rejects malformed ones", () => {
    expect(isAurumTransportResultEnvelope(envelope)).toBe(true);
    expect(isAurumTransportResultEnvelope({ ticket: "t", status: "settled" })).toBe(true);
    expect(isAurumTransportResultEnvelope({ ticket: "t", status: "succeeded" })).toBe(false);
    expect(isAurumTransportResultEnvelope({ ticket: 7, status: "settled" })).toBe(false);
    expect(isAurumTransportResultEnvelope(null)).toBe(false);
    expect(
      isAurumTransportResultEnvelope({
        ticket: "t",
        status: "failed",
        error: { code: "aurum-transport/internal", message: "m", retryable: false },
      }),
    ).toBe(true);
    expect(
      isAurumTransportResultEnvelope({
        ticket: "t",
        status: "failed",
        error: { code: "aurum-transport/internal", message: "m" },
      }),
    ).toBe(false);
    expect(
      isAurumTransportResultEnvelope({ ticket: "t", status: "settled", cost: [{ unit: "u" }] }),
    ).toBe(false);
    expect(
      isAurumTransportResultEnvelope({ ticket: "t", status: "settled", stale: "yes" }),
    ).toBe(false);
  });
});
