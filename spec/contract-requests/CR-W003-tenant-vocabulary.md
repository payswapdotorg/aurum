# CR-W003 — TenantId / evidence vocabulary unification with aurum-domain

- **Work item:** W003 (packages/aurum-provider, packages/aurum-agent)
- **Requester:** W-C
- **Owner of requested API:** W-B (packages/aurum-domain)
- **Status:** resolved-by-CR-W003-migration (2026-10-12, W-C) — TenantId
  half delivered on branch `work/cr-w003-canonical-tenant-id`
  (base 7a77a35f): commits 36a726e (provider adoption), 9f31713 (agent
  adoption + bridge-cast removal), d2c6503 (focused proof test). The
  evidence-reference vocabulary half remains open — see "Remaining open".

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

## Delivery record (CR-W003-migration, TenantId half)

What retired:

- The LOCAL `TenantId` brands in both packages
  (`packages/aurum-provider/src/domain/ids.ts`,
  `packages/aurum-agent/src/domain/ids.ts`) — each ids.ts is now a thin
  re-export of the canonical type from `@aurum/domain` (an import plus a
  type-only re-export line), so every internal `./ids.js` import keeps
  resolving. All other branded ids in both files are untouched.
- The single documented reconciliation cast in
  `packages/aurum-agent/src/adapters/provider-fabric-lookup.ts`
  (`tenantId as unknown as ProviderTenantId`, previously line 30) —
  the adapter now passes the tenant id straight through to the provider
  fabric; the bridge comment is gone.
- The interim CR note in agent ids.ts ("TenantId is currently a local
  brand…") — replaced by a retirement record.

What stayed (constructor gap): the domain public entrypoint exports the
canonical TYPE only; there is no public `TenantId` constructor (the only
public mint path is `tenantScope(string): Result<TenantScope>` →
`.value.tenantId`). Per this CR's migration rules, both packages'
`asTenantId` constructors stay local and now RETURN the canonical type.
The constructor itself is requested in CR-W003b
(spec/contract-requests/CR-W003b-tenant-id-constructor.md).

Mechanics:

- `@aurum/domain: workspace:*` added to both packages' package.json
  dependencies; pnpm-lock.yaml diff is exactly the two workspace-link
  blocks (aurum-agent importer + aurum-provider importer) — W003
  precedent, nothing else in the lockfile moved.
- architecture-policy.yaml `requires` lists for aurum-provider /
  aurum-agent were NOT touched (TL-owned): the policy still declares
  `[shared]` / `[shared, aurum-provider]`. The architecture checker does
  not flag package-specifier imports, so gates pass; the TL may want to
  add `aurum-domain` to both modules' requires at the next policy pass
  so the declared architecture mirrors the manifest reality.

Evidence (all from /home/z/aurum-crw003, branch tip d2c6503):

- `node scripts/check-workspace-freshness.mjs` — OK (ahead 3 / behind 7,
  threshold 50).
- `pnpm fmt:check` — all files formatted.
- `pnpm lint` — 0 errors (70 warnings, byte-identical count at base
  7a77a35 — zero new findings).
- `npx tsc -b` scoped to `packages/aurum-domain`, `packages/aurum-provider`
  and `packages/aurum-agent` — 0 errors; this compiles the cast-free
  provider-fabric-lookup adapter, which is the primary proof.
- `pnpm architecture:check -- --changed` — OK, violations 0, baseline 0,
  new 0.
- `pnpm --filter @aurum/provider test` — 57/57 (unchanged suite).
- `pnpm --filter @aurum/agent test` — 29/29 (27 prior + 2 new; tenant
  isolation suite untouched and green).
- Focused proof: `packages/aurum-agent/test/tenant-id-canonical.test.ts`
  — type-level compile-asserts that agent's, provider's and the domain's
  TenantId are the SAME nominal type and that the provider fabric's
  `getBinding` consumption point takes exactly the canonical TenantId
  (the retired cast expressed as a compiler check; verified to fail a
  deliberately-wrong variant during development), plus a runtime lock
  that ids remain opaque plain strings.
- `pnpm install --frozen-lockfile` — clean at tip.

## Compatibility impact

- In-flight consumers of `@aurum/provider` / `@aurum/agent` public surfaces
  see no runtime change; a type-only refinement.
- The cast in `provider-fabric-lookup.ts` disappears.

## Tests / migration

- Both packages' tenant-isolation suites continue to pass unchanged. ✓
- Migration is one PR per package (swap brand source, keep constructors).
  Delivered as one commit per package on one branch (same surgical
  content, TL merges both together).

## Remaining open

- **Evidence-reference vocabulary (the "eventually" half): REMAINING
  OPEN — deliberately not done in this migration.** When the domain
  kernel's evidence/observation contracts are consumed by provider-plane
  work, file a future CR to agree the mapping or shared reference shape
  so `ProviderEvidence` can be cited by the Aurum evidence system
  without duplication.
- **CR-W003b:** public `TenantId` constructor on @aurum/domain, so the
  consumers' local `asTenantId` constructors can retire.
- **TL note:** add `aurum-domain` to the aurum-provider / aurum-agent
  `requires` lists in architecture-policy.yaml (and the module.ts
  manifests that mirror it) at the next policy pass.
