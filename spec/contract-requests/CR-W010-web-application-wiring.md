# CR-W010 — wire `@aurum/application` into `@zcode/web`

- **Work item:** W010 (control tower + conversation; the web surfaces under
  `packages/web/src/tower/**` + the `main.tsx` pathname-dispatch mount)
- **Requester:** W-A (W010 dispatch, D4 finisher — filing on behalf of the
  delivery chain; APPROACH.md R4 named this CR)
- **Owner of requested change:** TL (root `pnpm-lock.yaml` + dependency
  wiring; the interim bridges below are worker-owned, the lockfile is
  TL-owned — the exact CR-W009/W011/P001 situation)
- **Status:** RESOLVED (2026-10-13, TL — executed at integration on main 97b34e1:
  @aurum/application: workspace:\* added to packages/web/package.json; one
  pnpm install recorded the link entry (CR-W009/W011/P001 precedent); BOTH
  interim bridges removed — the web tsconfig paths block (all three aurum
  specifiers) AND the vite resolve alias; ordering proven both ways via a
  new tsconfig project reference ../aurum-application (tsc -b web-first now
  builds the referenced application dist first — the client->rpc references
  pattern, CR-W001 precedent); gates: root tsc 0 err both orders, fmt clean,
  lint 70w/0e, arch 0 viol. Original filing preserved below.)

## Requested change

Add one workspace dependency to `packages/web/package.json`:

```jsonc
{
  "dependencies": {
    "@aurum/application": "workspace:*",
  },
}
```

then run one `pnpm install` so the lockfile records the new
`link:../aurum-application` entry under the `packages/web` importer
(mirroring exactly how CR-W009 wired execution/shared into
`@aurum/application`, CR-W011 wired domain/agent into `@aurum/marketplace`,
and CR-P001 wired domain into `@aurum/infra`).

## Reason

The W010 web tower consumes the Aurum projection through the public
package entrypoint only (`import … from "@aurum/application"` — 8 files
under `packages/web/src/tower/`, verified by source scan; no kernel or
deep-path import anywhere in the web tree). Those imports resolve today
through two worker-owned interim bridges, not through a real dependency
link:

1. `packages/web/tsconfig.json` — `"paths"` mapping `@aurum/application`
   → `../aurum-application/src/index.ts` (plus `@aurum/domain` and
   `@aurum/execution` → their src entrypoints, so the web program
   type-checks application SOURCE consistently instead of mixing stale
   `dist` declarations), together with `rootDir: "../.."` +
   `composite: false` (required for that source-mode program to compile
   under the root compiler);
2. `packages/web/vite.config.ts` — a `resolve.alias` pointing
   `@aurum/application` at its src entry (the dev server; the
   application's internal `@aurum/domain`/`@aurum/execution` imports
   resolve through the workspace symlinks already present in
   `packages/aurum-application/node_modules`).

Neither bridge survives consumer-side resolution: `@aurum/application` is
absent from `packages/web/node_modules`, so a fresh checkout without the
bridges cannot typecheck or serve the tower route at all, and
`pnpm install --frozen-lockfile` on main would create no link for the
desktop variant (W012) to inherit.

## Post-CR cleanup (at TL integration)

Once the TL has run `pnpm install` and the link exists, the interim
bridges should be REMOVED so a broken link can never be masked:

- drop the `paths` block from `packages/web/tsconfig.json` — resolution
  then goes through the link (`types: ./dist/index.d.ts`, per the
  workspace-wide design; the marketplace precedent consumes
  `@aurum/domain` exactly this way, without paths). The TL may also
  restore `rootDir: "src"` + drop `composite: false` at that point if
  dist-mode typing is preferred;
- drop the `resolve.alias` for `@aurum/application` from
  `packages/web/vite.config.ts` — the link's `exports["."].default` is
  `./src/index.ts`, so dev-server behavior is identical before and after.

Both bridges point at the same public entrypoint a real link provides.

## Why the delivery does not ship the dep itself

The worker-branch law freezes `package.json` + `pnpm-lock.yaml` (a dep
without the lockfile entry breaks `pnpm install --frozen-lockfile` on TL
verification; manual symlinks do not survive a fresh install — the
CR-W009 analysis, unchanged).

## Compatibility impact

- No behavioral change: the bridges and the eventual link resolve the
  identical public entrypoint.
- `packages/web` is an UNMANAGED module in `architecture-policy.yaml`
  (`managed: false`, no `requires` list), so the architecture checker is
  silent on the web→application edge either way; the semantic boundary is
  enforced instead by the W010 proof suites (contract-only imports;
  `test/control-tower-contract-hygiene.test.ts` + the web source scan
  noted above).
- No other package imports the web package; W012 (desktop continuity) is
  the next consumer of the same pattern.

## Tests / migration

- The 32 control-tower proofs live in `packages/aurum-application`
  (vitest, bridge-independent — they import `../src/index.js` directly).
- The web program is verified by the root compiler
  (`tsc -b packages/web`) + fmt/lint/arch gates; after the CR resolves,
  bridge removal is verified by the same scoped typecheck on the
  integration branch (plus `pnpm --filter @zcode/web dev` serving
  `/tower`).

## Precedent

CR-W009, CR-W011, CR-P001 (worker files the CR; TL wires the lockfile
entry at the integration checkpoint; the branch already contains the
consumer code that uses the dep).
