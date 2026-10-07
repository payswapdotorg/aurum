/**
 * aurum-agent module manifest. Dependency declaration mirrors
 * architecture-policy.yaml; the only public surface is contract.ts
 * (re-exported through index.ts).
 */
export const aurumagentModule = {
  id: "aurum-agent",
  requires: ["shared", "aurum-provider"],
  publicEntrypoints: ["index.ts"],
} as const;
