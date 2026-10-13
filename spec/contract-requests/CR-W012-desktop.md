# CR-W012-desktop — wire `@aurum/application` into `@zcode/desktop`

- **Work item:** W012 (cross-platform continuity; the desktop mount under
  `packages/desktop/src/main/aurum/**`, `src/preload/aurumTower.ts`,
  `src/renderer/aurum-tower.html` + `src/renderer/src/aurum-tower/**`)
- **Requester:** W-C (W012 dispatch — filing per the APPROACH R7 ruling:
  cross-package wiring needs a CR; lockfiles are TL-owned)
- **Owner of requested change:** TL (root `pnpm-lock.yaml` + dependency
  wiring; the interim bridges below are worker-owned and are REMOVED by the
  TL when this CR resolves — the exact CR-W009/W010/W011/P001/P002 pattern)
- **Status:** OPEN

## Requested change

Add one workspace dependency to `packages/desktop/package.json`:

```jsonc
{
  "dependencies": {
    "@aurum/application": "workspace:*",
  },
}
```

then run one `pnpm install` so the lockfile records the
`link:../aurum-application` entry under the `packages/desktop` importer
(mirroring CR-W010's wiring of `@aurum/application` into `@zcode/web`).

## Reason

The desktop main-process session host
(`src/main/aurum/towerSessionHost.ts`) composes the CONTINUOUS tower
session from the application package's public contract
(`createContinuityService`, `createContinuousTowerSession`,
`createTowerReplayer`, `createJsonFileContinuityLedger`,
`createFileSystemAttachmentSurface`, `createTowerRpcHandler`), and the
tower renderer page (`src/renderer/src/aurum-tower/aurumTowerPage.tsx`)
consumes `createTowerRpcClient` + `tenantScope` + the envelope types from
the same public entrypoint. None of that resolves today through a real
dependency link; three worker-owned interim bridges carry it.

## Interim bridges (worker-owned; remove at CR resolution)

1. `packages/desktop/tsconfig.main.json` — a `paths` mapping
   `@aurum/application` → `../aurum-application/dist/index.d.ts` (the
   main project typechecks against the built declarations; `rootDir`
   discipline makes source-mode impossible in this emitting project) plus
   a project reference to `../aurum-application` for build ordering.
2. `packages/desktop/tsup.config.ts` — an esbuild `alias` on the main
   config resolving `@aurum/application` →
   `../aurum-application/src/index.ts` (the runtime bundle inlines the
   workspace SOURCE; the alias is what actually ships the host today).
3. `packages/desktop/vite.config.ts` — a `resolve.alias` for
   `@aurum/application` → `../aurum-application/src/index.ts` (the
   renderer dev server + build), plus the new multi-page input
   `aurum-tower` (the page itself is permanent W012 surface, not a
   bridge).
4. `packages/desktop/tsconfig.renderer.json` — `paths` for
   `@aurum/application` (declarations), `include` of `../web/src/tower`
   (the tower page REUSES the web tower components by source alias, the
   W010 mount-agnostic ruling; the web tower sources typecheck inside the
   renderer program), a project reference to `../aurum-application`, and
   the removal of the (noEmit-moot) `outDir`/`rootDir` pair that blocked
   outside-source imports. After the CR lands, the reference stays useful;
   the `paths` + `include` bridges can go once a real link exists (the
   source-alias include of `../web/src/tower` is the one piece that stays
   until a shared tower-component package exists — see limitations).
5. `packages/desktop/tsconfig.preload.json` — includes
   `src/main/aurum/towerIpc.ts` (the dependency-free channel/command
   constants shared with the preload). Not a resolution bridge — permanent
   shape.

## Post-CR cleanup (at TL integration)

- Drop the `paths` block from `tsconfig.main.json` (resolution then goes
  through the link's `exports["."].types` = `./dist/index.d.ts`).
- Drop the esbuild alias from `tsup.config.ts` (keep an eye on
  `noExternal` semantics: the alias currently forces inlining; with a real
  link, decide whether `@aurum/application` stays inlined like
  `@zcode/shared` — recommended: yes, add it to the main config's
  `noExternal` list).
- Drop the `resolve.alias` from `vite.config.ts` (the link's
  `exports["."].default` = `./src/index.ts` serves the dev server
  identically).
- Drop the `paths` block from `tsconfig.renderer.json`; keep the
  `../web/src/tower` include OR promote the shared tower components to a
  real shared package (the W010 WORK-NOTES named that the components are
  mount-agnostic; a `@aurum/tower-ui` package is the clean successor).

## Why the delivery does not ship the dep itself

The worker-branch law freezes `package.json` + `pnpm-lock.yaml` (a dep
without the lockfile entry breaks `pnpm install --frozen-lockfile` on TL
verification; manual symlinks do not survive a fresh install — the
CR-W009 analysis, unchanged).

## Compatibility impact

- No behavioral change for existing desktop surfaces: the bridges resolve
  the identical public entrypoint; the W012 mount is additive (one IPC
  channel + one window + one menu item + one preload entry).
- `packages/desktop` is an UNMANAGED module in `architecture-policy.yaml`
  (`managed: false`), so the architecture checker is silent on the
  desktop→application edge; the semantic boundary is enforced by the W012
  proof suites in `packages/aurum-application` (continuity hygiene:
  contract-only sibling consumption, no agent/provider imports).
- The desktop root `tsc -b packages/desktop` gate carries 216 PRE-EXISTING
  legacy errors (125 renderer + 88 main/preload/scheduler) that predate
  W012; the W012 delivery adds ZERO new errors (verified by error-count
  parity before/after). See the W012 WORK-NOTES gate table.

## Tests / migration

- The continuity proofs live in `packages/aurum-application`
  (65 continuity tests; bridge-independent — they import `../src/index.js`
  directly).
- The desktop mount is carried by: the full `tsup` bundle build (verified:
  `out/main/index.js` contains the session host + channel constant;
  `out/preload/aurumTower.cjs` contains the bridge), the scoped tsc
  projects (main/preload/renderer — zero new errors), and the honest
  limitation that packages/desktop has NO test infrastructure of its own
  (the repo's own `pnpm typecheck` only builds `tsconfig.host.json` from
  the desktop tree).

## Precedent

CR-W009, CR-W010, CR-W011, CR-P001, CR-P002 (worker files the CR; TL
wires the lockfile entry at the integration checkpoint; the branch already
contains the consumer code that uses the dep).
