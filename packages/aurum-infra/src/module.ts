/**
 * aurum-infra module manifest. Dependency declaration mirrors
 * architecture-policy.yaml; the only public surface is contract.ts
 * (re-exported through index.ts). P002 adds the fabric-store dependency on
 * the provider/agent packages (CR-P002-package-wiring — the persistence
 * adapters implement their store ports); the policy `requires` list is the
 * TL-owned half of that CR.
 */
export const auruminfraModule = {
  id: "aurum-infra",
  requires: ["shared", "aurum-domain", "aurum-provider", "aurum-agent"],
  publicEntrypoints: ["index.ts"],
} as const;
