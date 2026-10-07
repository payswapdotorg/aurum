/**
 * aurum-provider module manifest. Dependency declaration mirrors
 * architecture-policy.yaml; the only public surface is contract.ts
 * (re-exported through index.ts).
 */
export const aurumproviderModule = {
  id: "aurum-provider",
  requires: ["shared"],
  publicEntrypoints: ["index.ts"],
} as const;
