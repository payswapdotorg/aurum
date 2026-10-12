# CR-W003b — public TenantId constructor on @aurum/domain

- **Work item:** W003 follow-up (requester side: packages/aurum-provider,
  packages/aurum-agent)
- **Requester:** W-C
- **Owner of requested API:** W-B (packages/aurum-domain)
- **Status:** open

## Requested API

A public constructor for the canonical `TenantId`, exported from
@aurum/domain's public entrypoint (src/index.ts → contract.ts →
domain/core/contract.core.ts), so consumers can mint the branded value
without a local constructor.

## Reason

The CR-W003 migration (branch work/cr-w003-canonical-tenant-id,
commits 36a726e + 9f31713) adopted the canonical `TenantId` TYPE in both
consumer packages: their `src/domain/ids.ts` now re-export
`TenantId` from `@aurum/domain`, and the provider-fabric-lookup bridge
cast is gone. Verified on main and during that migration: the domain
public entrypoint exports the TYPE only — there is no public
`TenantId` constructor (no `asTenantId`-style function; the only public
path to a branded `TenantId` value is `tenantScope(string): Result<TenantScope>`
followed by `.value.tenantId`, which couples minting to the scope object).

Both consumers therefore kept their local `asTenantId(value: string):
TenantId` constructors, now returning the canonical type. A single
canonical constructor would let those local constructors retire at the
next breaking window — the same retirement the CR-W003 migration
performed for the brands.

## Proposed shape

Either form is fine; the consumers' current semantics are opaque
(no validation at mint time), so (a) is the drop-in:

- (a) opaque: `export function asTenantId(value: string): TenantId`
  exported from domain/core (ids.ts-adjacent), re-exported through
  contract.core.ts / contract.ts / index.ts.
- (b) validating, house `toId` style:
  `export function tenantId(value: string): Result<TenantId>` with the
  same rules as `tenantScope` (non-empty, ≤128 chars, no control
  characters).

## Compatibility impact

- Type-only for callers; runtime stays an opaque string brand.
- No change to tenant isolation semantics or to `tenantScope`.

## Tests / migration

- Domain: constructor identity/validation tests (if form (b)).
- W-C then swaps both packages' local `asTenantId` to re-export the
  domain constructor (one commit each, no behavioral change), and the
  existing proof test (packages/aurum-agent/test/tenant-id-canonical.test.ts)
  keeps the cross-package identity locked.
