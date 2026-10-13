# W010 — Control tower + conversation: APPROACH (continuation contract)

Status: LIVE WORK NOTE — written at dispatch start (Task 23-a). If this worker
is killed, the next continuation starts here: read this file, then
`git log --oneline main..HEAD` for the delivered layers.

Work item (catalog §W010): Aurum management control tower and conversation
experience. Owner W-A. Paths: `packages/ui/**`, `packages/web/**` + applicable
Aurum application projection code. Acceptance: (1) no coding-centric primary
information architecture; (2) every semantic action goes through public
contract; (3) UI never becomes company truth; (4) Web and Desktop presentation
remain projection variants.

## 0. What exists (explored at dispatch start)

- `packages/web` is the ZCode web client (Vite + React 19): `src/main.tsx`
  bootstraps by PATHNAME DISPATCH — OAuth callback pages, conversation-share
  landing pages (`/share`, `/cn/share`), and otherwise the coding-centric
  `Root` workspace shell from `@zcode/ui` over a ZCode server WebSocket. It
  has NO test infrastructure (no vitest, no test script; CI runs
  fmt/lint/typecheck/arch only). `packages/ui` has exactly one legacy
  `node:test` file that cannot even execute in this checkout without a build
  step (imports `../../shared/src/*.js` specifiers that only exist post-build).
- `packages/aurum-application` is the semantic integration point (ARCHITECTURE
  §package dependency direction: application → Web/Desktop/CLI). It currently
  exposes four areas via `src/contract.ts` composed re-exports: lab (W008),
  plans (W009), company (W004), cognition (W007). House style per area:
  `domain/` (records + ports as STRUCTURAL PICKS of kernel interfaces +
  errors + pure derivations), `app/` (service factories, ≤12 methods), a
  `contract.<area>.ts` public surface, `adapters/` (in-memory + kernel seam
  wiring), tests in `packages/aurum-application/test/<area>-*.test.ts` with
  real-kernel fixtures (see `test/helpers.ts`, `test/cognition-helpers.ts`).
- No server-side Aurum RPC exists yet (no aurum imports anywhere in
  `packages/server/src`). Remote transport/continuity is W012's item.

## 1. Rulings (the design law for this item)

**R1 — semantics live in `aurum-application/src/control-tower/**` (managed
module, arch-checked).** The control tower is a PROJECTION LAYER: read-only
view models derived from the four public area surfaces (W004/W007/W008/W009)
composed through the application contract ONLY (structural picks of the
existing service interfaces — the same seam discipline the company/cognition
ports apply to the kernel). The projection adds ZERO new semantic authority:
its ACTION methods are 1:1 delegations to the existing public service methods
(`createMission`/`advance`/`cancelMission` on cognition; `submitForApproval`/
`approvePlan`/`rejectPlan`/`activatePlan`/`dispatchTask` on plans; company
queries). No new command path is invented; no second error authority (action
results are the underlying services' `Result` types, unchanged).

**R2 — the web mounts a NEW top-level route `/tower`** following the existing
share-route pattern (pathname dispatch in `main.tsx` BEFORE the ZCode `Root`
mounts). The tower renders INSTEAD of the coding-centric workspace shell: its
primary information architecture is company/goal/organization-centric (Today /
Goals / Situation / Unknowns / Missions / Plans / Approvals / Lab panels per
ARCHITECTURE §Experience plane "management control tower" list) with a
conversation pane over mission/plan records. The ZCode coding surface at `/`
is NOT touched (not W010's to own; the acceptance clause is about the Aurum
tower's IA, which must not be code/editor-centric — it is not).

**R3 — the browser consumes the tower through the projection contract.**
`packages/web` never imports kernel internals or deep paths: it imports
`@aurum/application`'s public entrypoint only. The web composes the tower
runtime via the canonical local adapter exported from the application package
(`createLocalControlTowerRuntime`): the REAL domain kernel + the REAL four
services composed in-process (the "local variant" — same semantic code, one
composition, in-memory, no persistence). This is the development/demo
composition; the server transport variant (same client surface over RPC) is
W012's work. The web holds no record-mutation code of its own: reads go
through tower view models, actions through tower delegation.

**R4 — package wiring: bridges now, CR for the link (P001 precedent).**
`packages/web/package.json` + lockfile are TL-owned. Interim worker-owned
bridges (removed by the TL when the CR lands): (a) `packages/web/tsconfig.json`
`compilerOptions.paths` mapping `@aurum/application` →
`../aurum-application/src/index.ts` (and `@aurum/domain`, `@aurum/execution` →
their src entrypoints, so the web program type-checks application SOURCE
consistently instead of mixing stale `dist` declarations); (b)
`packages/web/vite.config.ts` `resolve.alias` for `@aurum/application` → its
src (its internal `@aurum/domain`/`@aurum/execution` imports resolve through
the workspace symlinks already present in
`packages/aurum-application/node_modules`). CR:
`spec/contract-requests/CR-W010-web-application-wiring.md`.

**R5 — web test ruling: NO new web test infrastructure.** packages/web has no
test runner and CI does not run package tests; inventing one is out of scope
(task guidance: do not invent heavy infra). The PROOF burden lands where the
house pattern already lives: (a) projection-layer proofs in
`packages/aurum-application/test/control-tower-*.test.ts` (real kernel
fixtures, view models derived from real records, no semantic mutation paths,
tenant scoping, contract-only imports — mirroring the cognition/company
proofs); (b) `packages/web` is verified by the root compiler
(`tsc -b packages/web`) + fmt/lint/arch gates. Pure UI logic units that are
worth locking (route matching) stay trivial and typechecked.

**R6 — Desktop remains a projection variant structurally.** The tower VIEW
components are plain React + the `@zcode/ui` design primitives (Tailwind
classes already themed for web/desktop), and all semantics sit behind the
application contract, so the Desktop variant = the same projection mounted in
the Electron renderer. W010 wires the WEB variant (the item's named path); the
desktop mount is W012's continuity item (it owns desktop). No
desktop-specific code is added here — nothing in the tower surface is
web-locked (no `window`-only logic in the shared pieces beyond the route
bootstrap, which is web's own entry).

## 2. Incremental delivery plan (each layer independently committable)

1. **Layer A — projection layer** (`src/control-tower/`): `domain/records.ts`
   (view-model record types: `ControlTowerOverview`, goal/mission/plan/lab
   cards, `ConversationViewModel` + turns), `domain/ports.ts`
   (`ControlTowerDeps` = structural picks of the four PUBLIC service
   interfaces — no kernel import at all), `domain/overview.ts` +
   `domain/conversation.ts` (pure derivations), `app/towerService.ts`
   (`createControlTowerService`: overview + conversations + delegated
   actions), `adapters/local-runtime.ts` (`createLocalControlTowerRuntime`:
   kernel + company + lab + plans + cognition + tower, the canonical local
   composition), `contract.control-tower.ts`, re-export in `src/contract.ts`.
2. **Layer A proofs** (`test/control-tower-*.test.ts`): overview derives from
   real kernel records; conversation turns derive from real mission/plan
   journals; actions delegate 1:1 (spy seams prove zero added semantics);
   tenant isolation (cross-tenant tower reads fail closed); hygiene tripwire
   (no kernel deep imports, no write-shaped kernel picks, contract-only
   imports).
3. **Layer B — web surfaces** (`packages/web/src/tower/`): route module +
   bootstrap hook in `main.tsx`; `TowerApp` (company-centric IA, no editor);
   conversation surface (mission/plan threads, send-action controls wired to
   tower delegation); local runtime mount + seed-free honest empty state.
4. **Layer C — CR + WORK-NOTES + gates.**

## 3. Kill-recovery notes

- Typecheck: `bash -c 'cd /home/z/aurum && ./node_modules/.bin/tsc -b packages/aurum-application packages/web'`.
- Tests: `bash -c 'cd /home/z/aurum/packages/aurum-application && npx vitest run'` (baseline 305/305).
- Gates: `pnpm fmt:check`, `pnpm lint` (70w/0e baseline), `pnpm architecture:check` (+ `-- --changed`).
- NEVER push. Commit early, small commits. Do not touch /home/z/aurum-p002 or main.
