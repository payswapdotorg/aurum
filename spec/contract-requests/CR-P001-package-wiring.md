# CR-P001 — wire `@aurum/domain` into `@aurum/infra`

- **Work item:** P001 (packages/aurum-infra/src/domain-storage/\*\* +
  packages/aurum-infra/migrations/domain/\*\*)
- **Requester:** W-B (P001 dispatch, persistence lane)
- **Owner of requested change:** TL (root `pnpm-lock.yaml` + dependency
  wiring; the infra `package.json` and the interim alias/paths below are
  worker-owned, the lockfile is TL-owned — the exact CR-W009/W011 situation)
- **Status:** OPEN (filed 2026-10-13 at P001 delivery, branch
  `work/p001-domain-storage`)

## Requested change

Add one workspace dependency to `packages/aurum-infra/package.json`:

```jsonc
{
  "dependencies": {
    "@aurum/domain": "workspace:*",
  },
}
```

then run one `pnpm install` so the lockfile records the new
`link:../aurum-domain` entry under the `packages/aurum-infra` importer
(mirroring exactly how CR-W011 wired `@aurum/domain` + `@aurum/agent` into
`@aurum/marketplace`, and CR-W009 wired execution/shared into
`@aurum/application` before that).

## Reason

`architecture-policy.yaml` ALREADY lists the policy-approved dep for the
infra module:

```yaml
- id: aurum-infra
  requires: [shared, aurum-domain]
```

and `packages/aurum-infra/src/module.ts` already declares the same
`requires` list. So the architecture checker does NOT flag the imports —
only the package resolution is missing.

The P001 delivery (every domain-storage adapter + every proof suite) imports
`@aurum/domain` in 34 source/test files (22 under `src/`, 12 under `test/`).
Those imports resolve today through two worker-owned interim bridges, not
through a real dependency link:

1. `packages/aurum-infra/tsconfig.json` — `"paths": { "@aurum/domain":
["../aurum-domain/dist/index.d.ts"] }` (root-compiler typecheck);
2. `packages/aurum-infra/vitest.config.ts` — a resolve alias pointing
   `@aurum/domain` at `../aurum-domain/src/index.ts` (the proof suites).

Neither bridge survives consumer-side resolution: plain node ESM imports from
inside `packages/aurum-infra` fail with `ERR_MODULE_NOT_FOUND` (verified on
the branch — a scratch script importing `@aurum/domain` from
`packages/aurum-infra` cannot resolve it), and `pnpm install
--frozen-lockfile` on a fresh clone would not create any link for P002/P003
consumers to inherit.

## Post-CR cleanup (worker-owned, at TL integration)

Once the TL has run `pnpm install` and the link exists, the interim bridges
should be REMOVED (by the P-series worker or the TL at the integration
checkpoint) so a broken link can never be masked:

- drop the `paths` entry from `packages/aurum-infra/tsconfig.json`
  (moduleResolution `nodenext` then resolves the link's `dist/index.d.ts`);
- drop the resolve alias from `packages/aurum-infra/vitest.config.ts`
  (vitest then resolves through node_modules exactly like consumers).

Both bridges point at the same public entrypoint a real link provides, so
behavior is identical before and after — the alias comment in
`vitest.config.ts` documents this contract.

## Why the delivery does not ship the dep itself

The P-series hard laws freeze `package.json` + `pnpm-lock.yaml` on worker
branches (a package.json dep without the lockfile entry breaks
`pnpm install --frozen-lockfile` on TL verification, and manual symlinks do
not survive a fresh install — the CR-W009 analysis, unchanged).

## Compatibility impact

- No behavioral change at runtime: the bridges and the eventual link resolve
  the identical public entrypoint (`packages/aurum-domain/src/index.ts` /
  its built `dist`).
- No other package imports `@aurum/infra` yet (P002/P003 are the first
  consumers; the P001 final report carries the consumer notes).
- `pnpm install --frozen-lockfile` stays green on this branch because
  neither `package.json` nor the lockfile changed here.

## Tests / migration

- The 95-proof infra suite is bridge-agnostic (it runs under the alias
  today and under the link after the CR — the same specifier either way).
- After the CR resolves, the removal of the two interim bridges is itself
  verified by the full gate battery (scoped root-compiler typecheck + infra
  suite) on the integration branch.

## Precedent

CR-W009 (rpc → shared link; execution + shared → application) and CR-W011
(domain + agent → marketplace) established the pattern: a worker needing a
workspace dep files a CR; the TL wires the lockfile entry at the next
integration checkpoint; the worker's branch already contains the consumer
code that uses the dep (here: the entire domain-storage layer).
