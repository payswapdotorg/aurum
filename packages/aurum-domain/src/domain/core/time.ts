/**
 * Domain time. The kernel never reads a clock (that would be an environment
 * effect). Every command carries an explicit `now` and every record stores
 * timestamps as branded epoch milliseconds, keeping the domain deterministic
 * and testable.
 */
import { ok, err, type Result } from "./result.js";
import { validationError } from "./errors.js";
import type { DomainTimestamp } from "./branding.js";

/** Validates and brands epoch milliseconds (>= 0, finite). */
export function domainTime(ms: number): Result<DomainTimestamp> {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
    return err(
      validationError([{ field: "time", problem: "must be finite epoch milliseconds >= 0" }]),
    );
  }
  return ok(ms as DomainTimestamp);
}

/** A bounded time window used by goal horizons and audit queries. */
export interface TimeWindow {
  readonly start: DomainTimestamp;
  readonly end: DomainTimestamp;
}

export function isValidTimeWindow(window: TimeWindow): boolean {
  return window.start <= window.end;
}
