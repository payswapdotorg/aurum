# aurum-provider

Owner: W-C (work item W003)

The Provider Fabric: eight deliberately SEPARATE concerns —
ProviderDefinition (what a provider IS; registry entry or custom definition
over an EXISTING wire protocol), ProviderAccount (credentials as opaque
SecretRefs only), ProviderProtocol + capability vocabulary, ModelCatalogEntry
(manual AND discovered, both first-class), ModelBinding (append-only
supersession, one active per purpose), ProviderHealth (observed state),
ProviderAvailability (available NOW — never implied by catalog listing;
explicit unknown/unavailable with staleness) and ProviderEvidence.

Laws enforced here:

- credential MATERIAL never enters any contract, record, note or error
  (unanchored credential-pattern sanitization on every free-text surface);
- provider SDK types never cross the domain boundary — discovery/execution
  transport is a seam (interface + deterministic fixture doubles in
  adapters/; no real network in tests);
- "listed" never equals "available";
- bindings supersede, never hard-delete;
- every store is tenant-scoped; foreign ids fail uniformly not-found.

Surfaces: `src/index.ts` (public entrypoint; composes `src/contract.ts` with
the deterministic seam doubles). Tests: `pnpm --filter @aurum/provider test`.
