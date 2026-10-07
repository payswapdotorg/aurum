/**
 * aurum-marketplace module manifest. Dependency declaration mirrors
 * architecture-policy.yaml; the only public surface is contract.ts
 * (re-exported through index.ts).
 */
export const aurummarketplaceModule = {
  id: "aurum-marketplace",
  requires: ["shared", "aurum-domain", "aurum-agent"],
  publicEntrypoints: ["index.ts"],
} as const;
