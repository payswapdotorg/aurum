/**
 * aurum-domain module manifest. Dependency declaration mirrors
 * architecture-policy.yaml; the only public surface is contract.ts
 * (re-exported through index.ts). The kernel has zero runtime dependencies
 * on other packages — the `requires: [shared]` declaration is an allowance,
 * not a usage.
 */
export const aurumDomainModule = {
  id: "aurum-domain",
  requires: ["shared"],
  publicEntrypoints: ["index.ts"],
} as const;
