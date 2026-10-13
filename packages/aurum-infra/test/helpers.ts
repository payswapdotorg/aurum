/**
 * P001 test helpers: a per-file PGlite harness plus Result utilities that
 * mirror the domain test helpers (the same fixtures, so equivalence suites
 * can drive both kernels with identical inputs).
 */
import { expect } from "vitest";
import { createDomainKernel } from "@aurum/domain";
import type {
  ActorReference,
  AuditInput,
  DomainError,
  DomainTimestamp,
  PersonId,
  ProvenanceRecord,
  Result,
  TenantScope,
} from "@aurum/domain";
import { tenantScope as makeTenantScope } from "@aurum/domain";
import { createPgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";
import type { PgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";

const T0 = 1_700_000_000_000;

export function scope(name: string): TenantScope {
  const result = makeTenantScope(name);
  if (!result.ok) throw new Error(`test setup: invalid tenant name ${name}`);
  return result.value;
}

export function okOf<T>(result: Result<T, DomainError>): T {
  expect(result.ok, `expected ok, got error: ${result.ok ? "" : result.error.message}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

export function errOf<T>(result: Result<T, DomainError>): DomainError {
  expect(
    result.ok,
    `expected error, got value: ${result.ok ? JSON.stringify(result.value) : ""}`,
  ).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

/** Fresh in-memory kernel (the semantic reference). */
export function memoryKernel() {
  return createDomainKernel();
}

/** Boots an isolated migrated PGlite database on the production driver. */
export async function pgHarness(): Promise<PgLiteHarness> {
  return createPgLiteHarness();
}

export const now = (secondsAfterBase = 0): DomainTimestamp =>
  (T0 + secondsAfterBase * 1000) as DomainTimestamp;

export const personActor = (personId: string): ActorReference => ({
  kind: "person",
  personId: personId as PersonId,
});

export const systemActor = (name: string): ActorReference => ({ kind: "system", name });

export const provenance = (actor: ActorReference, atSeconds = 0): ProvenanceRecord => ({
  actor,
  source: "human-entered",
  recordedAt: now(atSeconds),
});

export const auditInput = (actor: ActorReference, reason: string, atSeconds = 0): AuditInput => ({
  actor,
  at: now(atSeconds),
  reason,
});

/** Asserts a promise rejects; returns the rejection message. */
export async function rejectionMessage(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the operation to reject, but it resolved");
}

/**
 * Equivalence assertion (the P001 oracle pattern): a storage Result must
 * equal the in-memory reference Result — values deep-equal, errors identical
 * in code, message and issues (stable projection; no Error-instance quirks).
 */
export function expectSameResult<T>(actual: Result<T>, expected: Result<T>): void {
  if (expected.ok && actual.ok) {
    expect(actual).toEqual(expected);
    return;
  }
  expect(actual.ok, `ok-ness must match (expected ${JSON.stringify(expected)})`).toBe(expected.ok);
  if (!expected.ok && !actual.ok) {
    expect({
      code: actual.error.code,
      message: actual.error.message,
      issues: actual.error.issues,
    }).toEqual({
      code: expected.error.code,
      message: expected.error.message,
      issues: expected.error.issues,
    });
  }
}
