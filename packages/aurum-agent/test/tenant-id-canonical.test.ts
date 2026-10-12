/**
 * CR-W003 (canonical TenantId adoption) — the focused proof.
 *
 * WHAT THIS LOCKS:
 * 1. TYPE-LEVEL (compile-assert): the TenantId exported by @aurum/agent's
 *    public entrypoint, the TenantId exported by @aurum/provider's public
 *    entrypoint, and the canonical TenantId owned by @aurum/domain are the
 *    SAME nominal type. The provider-fabric-lookup adapter therefore
 *    compiles WITHOUT any cast (`tenantId as unknown as ProviderTenantId`
 *    is retired). These assertions are checked by the TypeScript compiler
 *    (the src-level proof is that packages/aurum-agent compiles with the
 *    cast removed; this file makes the identity explicit and fails any
 *    typecheck that runs over the test suite if the brands ever diverge
 *    again — e.g. by a revert of either package's ids.ts re-export).
 * 2. RUNTIME (behavioral lock): ids remain opaque plain strings — the
 *    migration is type-only, exactly as CR-W003 requires.
 *
 * The cross-package behavioral journey (agent-minted tenant id flowing
 * through the real ProviderFabricBindingLookup) stays covered by
 * provider-integration.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { TenantId as CanonicalTenantId } from "@aurum/domain";
import type { ProviderFabric, TenantId as ProviderTenantId } from "@aurum/provider";
import type { TenantId as AgentTenantId } from "../src/index.js";
import { asTenantId } from "../src/index.js";
import { asTenantId as providerAsTenantId } from "@aurum/provider";

/** Exact type equality (compile-assert helper). */
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/** Compile-time expectation: the argument must be `true`. */
type Expect<T extends true> = T;

// --- Compile-assert: one canonical TenantId across all three packages ---
type _agentIsCanonical = Expect<Equal<AgentTenantId, CanonicalTenantId>>;
type _providerIsCanonical = Expect<Equal<ProviderTenantId, CanonicalTenantId>>;
type _agentIsProvider = Expect<Equal<AgentTenantId, ProviderTenantId>>;

// The provider fabric's own consumption point — the exact call the bridge
// adapter makes — takes the canonical TenantId: an agent-minted TenantId
// is accepted with NO cast (the retired `as unknown as` pattern).
type _fabricConsumesCanonical = Expect<
  Equal<Parameters<ProviderFabric["bindings"]["getBinding"]>[0], CanonicalTenantId>
>;

describe("CR-W003: canonical TenantId adoption (agent = provider = domain)", () => {
  it("ids remain opaque plain strings at runtime (type-only migration)", () => {
    const agentMinted = asTenantId("tenant-a");
    expect(typeof agentMinted).toBe("string");
    expect(agentMinted).toBe("tenant-a");
    // The same value minted through either package's constructor is the
    // same opaque string — brands vanish at runtime:
    expect(providerAsTenantId("tenant-a")).toBe(agentMinted);
  });

  it("runtime constructors are interchangeable for identical values", () => {
    const values = ["tenant-a", "tenant-b", "org/123:env-prod"];
    for (const value of values) {
      expect(asTenantId(value)).toBe(providerAsTenantId(value));
    }
  });
});
