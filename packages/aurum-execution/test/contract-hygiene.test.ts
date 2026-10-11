/**
 * W006 contract hygiene: the public contract surface (src/contract.ts →
 * src/index.ts) is the ONLY cross-module surface — every export the work
 * item promises is present and consumable exactly through the package
 * entrypoint, the module manifest stays consistent with the TL-owned
 * architecture policy, and the layering contract holds (domain/app/adapters
 * under src/, deep-import free within the package).
 */
import { describe, expect, it } from "vitest";
import * as contract from "../src/index.js";
import { aurumexecutionModule } from "../src/module.js";

describe("W006 public contract surface", () => {
  it("exports the execution port + gateway + envelope surface (W006 clause 6)", () => {
    // Port + registry + types.
    expect(typeof contract.createAgentGateway).toBe("function");
    expect(typeof contract.createInProcessEnvironmentRegistry).toBe("function");
    expect(typeof contract.runRecovery).toBe("function");
    // Domain vocabulary + guards.
    expect(typeof contract.isExecutionSessionState).toBe("function");
    expect(typeof contract.isExecutionEnvironmentClass).toBe("function");
    expect(typeof contract.isExecutionJournalKind).toBe("function");
    expect(typeof contract.isExecutionFailureKind).toBe("function");
    expect(typeof contract.isExecutionSettlement).toBe("function");
    expect(typeof contract.isExecutionError).toBe("function");
    // Constructors + transitions + recovery semantics.
    expect(typeof contract.createPendingSession).toBe("function");
    expect(typeof contract.withSessionState).toBe("function");
    expect(typeof contract.settleSession).toBe("function");
    expect(typeof contract.submissionKeyOf).toBe("function");
    expect(typeof contract.buildExecutionSettlement).toBe("function");
    expect(typeof contract.asExecutionTenantId).toBe("function");
    expect(typeof contract.asExecutionRequestId).toBe("function");
    expect(typeof contract.executionScope).toBe("function");
    // Reference adapters.
    expect(typeof contract.createLocalEnvironment).toBe("function");
    expect(typeof contract.createSandboxEnvironment).toBe("function");
    expect(typeof contract.createStubEnvironment).toBe("function");
    expect(typeof contract.createStandardStubEnvironments).toBe("function");
    expect(typeof contract.createInMemorySessionStore).toBe("function");
    expect(typeof contract.createInMemoryJournal).toBe("function");
    expect(contract.STUB_ENVIRONMENT_CLASSES).toEqual([
      "browser",
      "computer",
      "workflow",
      "remote",
    ]);
    // Normalization helpers.
    expect(typeof contract.mapBoundaryRejection).toBe("function");
    expect(typeof contract.platformStatusToSemantic).toBe("function");
  });

  it("exports the mandated type surfaces as compile-time shapes (runtime markers)", () => {
    // Type-only exports cannot be asserted at runtime; the imports above and
    // throughout the suites typecheck against them (vitest transforms with
    // esbuild + the package tsc gate compiles the contract). Marker values:
    expect(contract.EXECUTION_ENVIRONMENT_CLASSES).toHaveLength(6);
    expect(contract.EXECUTION_SESSION_STATES).toHaveLength(6);
    expect(contract.EXECUTION_SESSION_TERMINAL_STATES).toHaveLength(3);
    expect(contract.EXECUTION_FAILURE_KINDS).toHaveLength(6);
    expect(contract.EXECUTION_JOURNAL_KINDS.length).toBeGreaterThanOrEqual(13);
  });
});

describe("W006 module manifest (TL-owned architecture policy mirror)", () => {
  it("declares the same id and requires as architecture-policy.yaml", () => {
    expect(aurumexecutionModule.id).toBe("aurum-execution");
    expect(aurumexecutionModule.requires).toEqual(["shared"]);
    expect(aurumexecutionModule.publicEntrypoints).toEqual(["index.ts"]);
  });
});
