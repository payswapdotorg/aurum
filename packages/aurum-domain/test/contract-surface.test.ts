/**
 * Smoke test: verifies the public entrypoint resolves and exposes the
 * composed kernel plus the contract surface symbols.
 */
import { describe, expect, it } from "vitest";
import type { DomainTimestamp } from "../src/index.js";
import {
  createDomainKernel,
  tenantScope,
  isDomainError,
  classifyFreshness,
  DEFAULT_FRESHNESS_POLICY,
  AUDIT_ACTIONS,
  ACTION_STATES,
  HYPOTHESIS_STATUSES,
  IDENTITY_LABELS,
  ROLES,
  EVIDENCE_STATUSES,
  SOURCE_KINDS,
  GOAL_PRIORITIES,
  SUBJECT_KINDS,
  ACTOR_KINDS,
} from "../src/index.js";
import { scope } from "./helpers.js";

describe("public contract surface", () => {
  it("exposes the composed kernel factory and vocabularies", () => {
    const kernel = createDomainKernel();
    expect(kernel).toBeTruthy();
    expect(kernel.identity).toBeTruthy();
    expect(kernel.organization).toBeTruthy();
    expect(kernel.events).toBeTruthy();
    expect(kernel.evidence).toBeTruthy();
    expect(kernel.epistemics).toBeTruthy();
    expect(kernel.inquiry).toBeTruthy();
    expect(kernel.goals).toBeTruthy();
    expect(kernel.memory).toBeTruthy();
    expect(kernel.actions).toBeTruthy();
    expect(kernel.audit).toBeTruthy();
  });

  it("exposes vocabulary constants and pure helpers", () => {
    expect(tenantScope("acme").ok).toBe(true);
    expect(isDomainError(new Error("plain"))).toBe(false);
    expect(
      classifyFreshness(
        { asOf: 1 as DomainTimestamp },
        1 as DomainTimestamp,
        DEFAULT_FRESHNESS_POLICY,
      ),
    ).toBe("current");
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(0);
    expect(ACTION_STATES).toContain("executed");
    expect(HYPOTHESIS_STATUSES).toContain("refuted");
    expect(IDENTITY_LABELS).toContain("employee");
    expect(ROLES).toContain("approver");
    expect(EVIDENCE_STATUSES).toContain("active");
    expect(SOURCE_KINDS).toContain("human-entered");
    expect(GOAL_PRIORITIES).toContain("critical");
    expect(SUBJECT_KINDS).toContain("goal");
    expect(ACTOR_KINDS).toContain("system");
  });

  it("rejects invalid tenant scope values", () => {
    expect(tenantScope("").ok).toBe(false);
    expect(tenantScope("   ").ok).toBe(false);
    expect(tenantScope("x".repeat(129)).ok).toBe(false);
    expect(scope("acme").tenantId).toBe("acme");
  });
});
