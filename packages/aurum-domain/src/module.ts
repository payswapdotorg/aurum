/**
 * aurum-domain module manifest. Dependency declaration mirrors
 * architecture-policy.yaml; the only public surface is contract.ts
 * (re-exported through index.ts).
 */
export const aurumdomainModule = {
  id: "aurum-domain",
  requires: ["shared"],
  publicEntrypoints: ["index.ts"],
} as const;
