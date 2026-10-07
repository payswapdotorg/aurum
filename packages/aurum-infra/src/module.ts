/**
 * aurum-infra module manifest. Dependency declaration mirrors
 * architecture-policy.yaml; the only public surface is contract.ts
 * (re-exported through index.ts).
 */
export const auruminfraModule = {
  id: "aurum-infra",
  requires: ["shared", "aurum-domain"],
  publicEntrypoints: ["index.ts"],
} as const;
