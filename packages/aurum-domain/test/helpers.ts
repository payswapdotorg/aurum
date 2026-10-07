/**
 * Test helpers: fixtures and Result narrowing utilities. Tests import the
 * public contract only (../src/index.js) — the same boundary other modules
 * will use, which is itself part of what W002 proves.
 */
import { expect } from "vitest";
import type {
  ActorReference,
  AuditInput,
  DomainError,
  DomainTimestamp,
  PersonId,
  ProvenanceRecord,
  Result,
  TenantScope,
} from "../src/index.js";
import { tenantScope as makeTenantScope, createDomainKernel } from "../src/index.js";

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

export function kernel() {
  return createDomainKernel();
}

export const now = (secondsAfterBase = 0): DomainTimestamp =>
  (T0 + secondsAfterBase * 1000) as DomainTimestamp;

export const personActor = (personId: string): ActorReference => ({
  kind: "person",
  personId: personId as PersonId,
});

export const systemActor = (name: string): ActorReference => ({ kind: "system", name });

/** ProvenanceRecord fixture for evidence-bearing commands. */
export const provenance = (actor: ActorReference, atSeconds = 0): ProvenanceRecord => ({
  actor,
  source: "human-entered",
  recordedAt: now(atSeconds),
});

/** AuditInput fixture for consequential transitions. */
export const auditInput = (actor: ActorReference, reason: string, atSeconds = 0): AuditInput => ({
  actor,
  at: now(atSeconds),
  reason,
});
