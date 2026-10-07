/**
 * aurum-application module manifest. Dependency declaration mirrors
 * architecture-policy.yaml; the only public surface is contract.ts
 * (re-exported through index.ts).
 */
export const aurumapplicationModule = {
  id: "aurum-application",
  requires: ["shared", "aurum-domain", "aurum-provider", "aurum-agent", "aurum-execution"],
  publicEntrypoints: ["index.ts"],
} as const;
