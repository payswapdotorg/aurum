/**
 * aurum-agent module manifest. Dependency declaration mirrors
 * architecture-policy.yaml (requires shared + aurum-provider; the provider
 * import is confined to the public entrypoint @aurum/provider).
 */
export const aurumagentModule = {
  id: "aurum-agent",
  requires: ["shared", "aurum-provider"],
  publicEntrypoints: ["index.ts"],
} as const;
