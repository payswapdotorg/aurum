/**
 * Aurum-facing platform boundary — seam registry contract (W001).
 *
 * This is HOW an Aurum package obtains a platform capability handle without
 * importing ZCode internals: it asks a seam registry. The registry is
 * implemented on the substrate side (the ZCode adapter that owns the real
 * environments) and exposes nothing but opaque handles and plain
 * descriptors. No substrate type, no configuration object, no address book
 * ever crosses this seam.
 *
 * Lookup is synchronous and total: it returns an ok/false discriminated
 * result (plain data) instead of throwing, so registry misuse can never
 * become an exceptional control path in consumer code.
 */

import type {
  AurumTransportCapabilityClass,
  AurumTransportCapabilityDescriptor,
} from "./capability.js";
import type { AurumBoundaryErrorDetail } from "./errors.js";
import type { AurumCapabilityHandle } from "./identifiers.js";

/** What a consumer is looking for. */
export interface AurumSeamLookupQuery {
  /** Required execution-environment class. */
  readonly capabilityClass: AurumTransportCapabilityClass;
  /**
   * Optional opaque variant label for narrowing within a class; omit to
   * accept any variant the adapter offers.
   */
  readonly variant?: string;
}

/** Successful seam resolution: a handle plus the descriptor it names. */
export interface AurumSeamResolvedCapability {
  readonly ok: true;
  readonly handle: AurumCapabilityHandle;
  readonly descriptor: AurumTransportCapabilityDescriptor;
}

/** Failed seam resolution: typed error detail, never an exception. */
export interface AurumSeamLookupFailure {
  readonly ok: false;
  readonly error: AurumBoundaryErrorDetail;
}

/** Result of a seam registry lookup. */
export type AurumSeamLookupResult = AurumSeamResolvedCapability | AurumSeamLookupFailure;

/** Result of describing an already-issued handle. */
export type AurumSeamDescribeResult =
  | { readonly ok: true; readonly descriptor: AurumTransportCapabilityDescriptor }
  | { readonly ok: false; readonly error: AurumBoundaryErrorDetail };

/**
 * The seam registry contract. Implemented by the substrate adapter;
 * consumed by Aurum packages. All operations are synchronous, read-only
 * and side-effect free — the registry only hands out references, it never
 * executes anything (execution lives behind the transport port).
 */
export interface AurumSeamRegistry {
  /** Inventory of capabilities the adapter currently offers. */
  listCapabilities(): readonly AurumTransportCapabilityDescriptor[];
  /**
   * Resolve a capability to an opaque handle. Fails with
   * `capability-unavailable` (nothing matching right now) or
   * `capability-unknown-class` (class outside the platform vocabulary) or
   * `registry-closed` (adapter shutting down).
   */
  lookup(query: AurumSeamLookupQuery): AurumSeamLookupResult;
  /**
   * Describe a previously issued handle. Fails with `handle-invalid`
   * when the handle was not issued by this registry (or has been retired).
   */
  describe(handle: AurumCapabilityHandle): AurumSeamDescribeResult;
}
