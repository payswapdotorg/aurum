# CR-W003 — TenantId / evidence vocabulary unification with aurum-domain

- **Work item:** W003 (packages/aurum-provider, packages/aurum-agent)
- **Requester:** W-C
- **Owner of requested API:** W-B (packages/aurum-domain)
- **Status:** open

## Requested API

A canonical, shared `TenantId` (and eventually an evidence-reference
vocabulary) owned by the domain kernel, consumable by `@aurum/provider` and
`@aurum/agent` through their public entrypoints.

## Reason

Both W003 packages currently declare structurally identical but nominally
distinct branded `TenantId` types (provider: `packages/aurum-provider/src/domain/ids.ts`;
agent: `packages/aurum-agent/src/domain/ids.ts`). The only reconciliation
point today is a single, documented cast in
`packages/aurum-agent/src/adapters/provider-fabric-lookup.ts`. A canonical
type from aurum-domain would remove that cast and make cross-package tenant
identity one concept.

Similarly, `ProviderEvidence` (W003) predates the domain kernel's
evidence/observation contracts; when those land, a mapping or a shared
reference shape should be agreed so provider-plane evidence can be cited by
the Aurum evidence system without duplication.

## Proposed shape

- aurum-domain exports `TenantId` (+ constructor) from its public entrypoint.
- aurum-provider and aurum-agent re-export or alias it in their own
  entrypoints; the local brands retire at the next breaking window.
- No behavioral change: ids remain opaque strings at runtime; tenant
  isolation semantics are unchanged and stay test-locked in both packages.

## Compatibility impact

- In-flight consumers of `@aurum/provider` / `@aurum/agent` public surfaces
  see no runtime change; a type-only refinement.
- The cast in `provider-fabric-lookup.ts` disappears.

## Tests / migration

- Both packages' tenant-isolation suites continue to pass unchanged.
- Migration is one PR per package (swap brand source, keep constructors).
