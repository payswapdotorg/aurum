/**
 * W006 fail-closed STUB proofs (work-order clause 3): browser / computer /
 * workflow / remote are REGISTERED but NOT wired — typed, fail-closed
 * "not yet wired" rejections at the gateway admission gate, defense-in-depth
 * rejections on the stub transports, and honest visibility in both the
 * semantic registry and the W001 seam.
 */
import { describe, expect, it } from "vitest";
import { errOf, journalKindsOf, localHarness, requestOf, scopeOf } from "./helpers.js";
import {
  createStandardStubEnvironments,
  createStubEnvironment,
  STUB_ENVIRONMENT_CLASSES,
  type ExecutionEnvironment,
} from "../src/index.js";

const A = scopeOf("tenant-a");

describe("W006 fail-closed stubs (gateway admission gate)", () => {
  it("rejects submissions to every stub class with the TYPED not-wired error", async () => {
    const h = localHarness();
    for (const environmentClass of STUB_ENVIRONMENT_CLASSES) {
      const error = errOf(
        await h.gateway.submitExecution(
          A,
          requestOf(`stub-${environmentClass}`, { environmentClass }),
        ),
      );
      expect(error.code, `class ${environmentClass}`).toBe("execution/not-wired");
      expect(error.message).toContain(environmentClass);
      // No session is created for a fail-closed admission.
      const session = h.gateway.getExecution(A, `stub-${environmentClass}`);
      expect(session.ok).toBe(false);
      // The refusal is journaled as execution-plane audit evidence.
      expect(journalKindsOf(h, A, `stub-${environmentClass}`)).toContain("failure-recorded");
    }
  });

  it("repeats the typed rejection deterministically on re-delivery", async () => {
    const h = localHarness();
    const first = errOf(
      await h.gateway.submitExecution(A, requestOf("stub-r", { environmentClass: "browser" })),
    );
    const second = errOf(
      await h.gateway.submitExecution(A, requestOf("stub-r", { environmentClass: "browser" })),
    );
    expect(second.code).toBe(first.code);
    expect(second.message).toBe(first.message);
    expect(h.gateway.listExecutions(A)).toHaveLength(0);
  });
});

describe("W006 fail-closed stubs (registry + seam visibility)", () => {
  it("lists all four stubs in the semantic registry and the W001 seam", () => {
    const h = localHarness();
    const descriptors = h.registry.listEnvironments();
    for (const environmentClass of STUB_ENVIRONMENT_CLASSES) {
      const stub = descriptors.find(
        (descriptor) => descriptor.environmentClass === environmentClass,
      );
      expect(stub, `registry lists ${environmentClass}`).toBeDefined();
      expect(stub?.wired).toBe(false);
      expect(stub?.control).toEqual({ cancellable: false, pausable: false, resumable: false });
    }
    const seamDescriptors = h.seam.listCapabilities();
    for (const environmentClass of STUB_ENVIRONMENT_CLASSES) {
      const found = seamDescriptors.find(
        (descriptor) => descriptor.capabilityClass === environmentClass,
      );
      expect(found, `seam lists ${environmentClass}`).toBeDefined();
      expect(found?.notes).toContain("not yet wired");
    }
  });

  it("issues seam handles for stub capabilities (registration is visible, execution is not)", () => {
    const h = localHarness();
    const lookup = h.seam.lookup({ capabilityClass: "computer" });
    expect(lookup.ok).toBe(true);
    if (lookup.ok) {
      const described = h.seam.describe(lookup.handle);
      expect(described.ok && described.descriptor.capabilityId).toBe("stub-computer");
    }
  });

  it("resolves stubs through the semantic registry by capability id", () => {
    const h = localHarness();
    const resolved = h.registry.resolveByCapabilityId("stub-workflow");
    expect(resolved.ok).toBe(true);
    expect(resolved.ok && resolved.value.descriptor.wired).toBe(false);
  });
});

describe("W006 fail-closed stubs (defense in depth on the transport)", () => {
  it("every stub transport method rejects with a typed boundary error", async () => {
    for (const environment of createStandardStubEnvironments() as readonly ExecutionEnvironment[]) {
      const stubClass = environment.descriptor.environmentClass;
      await expect(environment.transport.submit({} as never)).rejects.toThrow(/not yet wired/);
      await expect(environment.transport.poll("t" as never)).rejects.toThrow(/not yet wired/);
      await expect(environment.transport.awaitCompletion("t" as never)).rejects.toThrow(
        /not yet wired/,
      );
      await expect(environment.transport.cancel("t" as never)).rejects.toThrow(/not yet wired/);
      expect(environment.pausable).toBeUndefined();
      expect(stubClass).toBeTruthy();
    }
  });

  it("individual stub construction is deterministic and id-stable", () => {
    const browser = createStubEnvironment({ environmentClass: "browser" });
    expect(browser.descriptor.environmentId).toBe("stub-browser");
    expect(browser.descriptor.variant).toBe("not-wired");
    expect(browser.descriptor.wired).toBe(false);
    const remote = createStubEnvironment({ environmentClass: "remote", environmentId: "custom" });
    expect(remote.descriptor.environmentId).toBe("custom");
    expect(remote.descriptor.environmentClass).toBe("remote");
  });
});
