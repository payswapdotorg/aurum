/**
 * Aurum-facing platform boundary — public surface (W001).
 *
 * This directory is the SINGLE place where Aurum-facing platform
 * capabilities are declared (spec/WORK-ITEM-CATALOG.md §W001). Everything
 * is pure TypeScript over stdlib only: no package imports, no runtime
 * dependencies, no substrate or Aurum domain types.
 *
 * Consumption: import from `@zcode/shared` (the boundary is re-exported by
 * packages/shared/src/index.ts). Do NOT deep-import boundary modules.
 *
 * Surface map:
 * - lifecycle.ts    — platform lifecycle vocabulary + guards
 * - capability.ts   — capability classes + descriptors + control surface
 * - errors.ts       — typed error vocabulary (detail + Error class)
 * - identifiers.ts  — opaque ticket/handle types + adapter-side mints
 * - envelope.ts     — normalized result envelope + structural guard
 * - transport.ts    — execution transport port (+ pause/resume extension)
 * - seam.ts         — seam registry contract (handle lookup)
 *
 * Adapter-seam doctrine, non-goals and the canonical flow: README.md.
 */

export const AURUM_BOUNDARY_SURFACE_VERSION = "1.0.0";

export {
  AURUM_TRANSPORT_LIFECYCLE_STATES,
  AURUM_TRANSPORT_TERMINAL_STATES,
  isAurumTransportLifecycleState,
  isAurumTransportTerminalState,
} from "./lifecycle.js";
export type {
  AurumTransportLifecycleState,
  AurumTransportTerminalState,
} from "./lifecycle.js";

export {
  AURUM_TRANSPORT_CAPABILITY_CLASSES,
  isAurumTransportCapabilityClass,
} from "./capability.js";
export type {
  AurumTransportCapabilityClass,
  AurumTransportCapabilityDescriptor,
  AurumTransportControlSurface,
} from "./capability.js";

export {
  AurumBoundaryError,
  isAurumBoundaryError,
  toAurumBoundaryErrorDetail,
} from "./errors.js";
export type { AurumBoundaryErrorDetail, AurumBoundaryErrorCode } from "./errors.js";

export { mintAurumCapabilityHandle, mintAurumSubmissionTicket } from "./identifiers.js";
export type { AurumCapabilityHandle, AurumSubmissionTicket } from "./identifiers.js";

export { isAurumTransportResultEnvelope } from "./envelope.js";
export type {
  AurumTransportCostLine,
  AurumTransportResultEnvelope,
} from "./envelope.js";

export type {
  AurumExecutionTransportPort,
  AurumPausableTransportPort,
  AurumTransportAwaitOptions,
  AurumTransportControlOutcome,
  AurumTransportProgressSnapshot,
  AurumTransportSubmissionAck,
  AurumTransportSubmissionSpec,
} from "./transport.js";

export type {
  AurumSeamDescribeResult,
  AurumSeamLookupFailure,
  AurumSeamLookupQuery,
  AurumSeamLookupResult,
  AurumSeamRegistry,
  AurumSeamResolvedCapability,
} from "./seam.js";
