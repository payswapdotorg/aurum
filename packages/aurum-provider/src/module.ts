/**
 * aurum-provider module manifest. Dependency declaration mirrors
 * architecture-policy.yaml. The public entrypoint is index.ts, which
 * composes contract.ts (types/ports/pure logic) with the deterministic
 * seam doubles from adapters/.
 */
export const aurumproviderModule = {
  id: "aurum-provider",
  requires: ["shared"],
  publicEntrypoints: ["index.ts"],
} as const;
