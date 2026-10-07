/**
 * Deterministic time and identity ports.
 *
 * The domain never reads the wall clock or mints ids by itself: services
 * receive a Clock and an IdGenerator, so every record is reproducible under
 * test doubles and the fabric itself stays free of IO.
 */
import type { TenantId } from "./ids.js";

export interface Clock {
  /** ISO-8601 UTC timestamp of "now". */
  now(): string;
}

export interface IdGenerator {
  /**
   * Mint a fresh opaque id. The generator guarantees uniqueness within the
   * process; persistence adapters may re-map to their own key space.
   */
  next(): string;
}

/** Convenience view of a tenant-scoped mutable record's bookkeeping. */
export interface RecordBookkeeping {
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TenantScoped {
  readonly tenantId: TenantId;
}
