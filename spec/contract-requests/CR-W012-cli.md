# CR-W012-cli — wire `@aurum/application` into `@zcode/cli` (zcode-cli workspace)

- **Work item:** W012 (cross-platform continuity; the CLI mount
  `apps/zcode-cli/packages/cli/src/aurum-command.ts` + the `aurum` dispatch
  case + help lines in `packages/i18n`)
- **Requester:** W-C (W012 dispatch — filing per APPROACH R7: cross-package
  wiring needs a CR; lockfiles are TL-owned)
- **Owner of requested change:** TL (the `apps/zcode-cli/pnpm-lock.yaml` is
  a SEPARATE workspace lockfile; wiring a cross-workspace source dependency
  needs a TL decision — see the options below)
- **Status:** RESOLVED 2026-10-15 (TL) — option chosen: `workspace:*` under the ROOT
  workspace (the filing's option-2 shape, empirically forced): the root
  `pnpm-workspace.yaml` already globs `apps/zcode-cli/packages/*`, so the CLI
  package resolves `@aurum/application` as a root workspace member
  (`link:../../../../packages/aurum-application` recorded in the ROOT lockfile —
  the `file:` option-1 link was tried first and REJECTED live: pnpm materializes
  a directory copy whose internal `@aurum/domain` imports cannot resolve — the
  workspace symlink resolves them all). The zcode-cli subtree's OWN
  `pnpm-workspace.yaml` (the upstream standalone context) remains
  pre-existing-broken — its cross-workspace deps (@zcode/shared, @zcode/provider,
  @zcode/provider-node, @zcode/zcode-cua, @zcode/model-option-map) all live at
  the aurum root; out of CR scope, recorded here. Mount completion (never landed
  by the W012 narrative-harvest delivery): the `aurum` dispatch case in
  `src/run.ts` + bilingual help lines in `packages/i18n`. Evidence-script
  repairs (harvest artifacts): `runnerUrl` was undefined (the spawn now passes
  the path to the tsx CLI). Contract-drift repairs in `aurum-command.ts`:
  `domainNow()` now returns `DomainTimestamp` (the branded type — the delivered
  `number` return lost the brand and failed every `now:` parameter); the
  overview failure renders `JSON.stringify(error)` (ControlTowerError is a
  tagged union with no `message`). Verification: the banked Layer C runnable
  evidence EXECUTED GREEN through the real `runAurumCommand` — process 1
  charters (JSON-file ledger persists), process 2 resumes by REPLAY (7 records
  reconstructed, mission state stable), second resume idempotent — ALL CHECKS
  PASSED. CLI scoped tsc: only the pre-existing `@zcode/shared-types` TS2307
  class (shared by every CLI source; type-only, runtime-proven by the
  evidence run). Root gates: fmt clean, lint 70/0 exact baseline,
  architecture baseline 0 / new 0.

## Requested change

`zcode aurum` composes the CLI's replay-mode continuity sessions from the
root workspace's `@aurum/application` public contract
(`createContinuityService`, `createContinuousTowerSession`,
`createTowerReplayer`, `createJsonFileContinuityLedger`,
`createInMemoryAttachmentSurface`, `domainTime`, `tenantScope`). The
zcode-cli workspace (`apps/zcode-cli/pnpm-workspace.yaml`) does not include
the root `packages/*` tree, so `@aurum/application` is not resolvable there
today. The TL owns the lockfile decision; the candidate options:

1. Add `@aurum/application` to `apps/zcode-cli/packages/cli/package.json`
   as `"file:../../../../packages/aurum-application"` (pnpm records a
   filesystem link; the package stays private/workspace-shaped), or
2. Extend `apps/zcode-cli/pnpm-workspace.yaml` packages to include the root
   `packages/aurum-*` tree and use `workspace:*` (a bigger structural
   decision the TL owns).

## Interim bridge (worker-owned; remove at CR resolution)

- `apps/zcode-cli/packages/cli/tsconfig.json` — a `paths` mapping
  `@aurum/application` →
  `../../../../packages/aurum-application/src/index.ts` (typecheck + tsx
  dev runs resolve the source through it).
- `apps/zcode-cli/packages/cli/scripts/build.mjs` — an esbuild `alias` in
  `resolveBuildAliases` resolving `@aurum/application` to the same source
  entry (the production bundle inlines the workspace source).

## Reason

W012's catalog acceptance ("web/mobile replayable semantics remain
explicit") needs a REAL replay mount outside the test suite: the CLI is the
headless variant. `zcode aurum charter` opens + records; `zcode aurum
resume` reconstructs in a fresh process. The recorded runnable evidence
(`scripts/aurum-resume-evidence.mjs`) drives the REAL `runAurumCommand`
across three processes over one JSON-file ledger — the same law the
desktop host and the web mount will follow.

## Why the delivery does not ship the dep itself

The worker-branch law freezes package.json + lockfiles (both the root one
and the zcode-cli one); a `file:` dependency without its lockfile entries
breaks frozen installs on TL verification.

## Compatibility impact

- Additive: one new command (`aurum`), one dispatch case, two help lines
  (en-US + zh-CN). No existing command path touches the new module.
- The type-only imports from `@zcode/shared-types` follow the house command
  style (erased at runtime; the CLI package's own `tsc --noEmit` currently
  carries 177 pre-existing errors from unbuilt workspace dists — unchanged
  by this delivery; the runnable evidence is the CLI's verification).
- The zcode-cli workspace is UNMANAGED in the root `architecture-policy.yaml`.

## Tests / migration

- The continuity semantics are proven in `packages/aurum-application`
  (65 continuity tests). The CLI mount is carried by the recorded
  cross-process evidence run + the scoped typecheck of the command module.

## Precedent

CR-W009 / CR-W010 / CR-W011 / CR-P001 / CR-P002 (worker files the CR; the
branch already contains the consumer code; the TL wires the dependency at
the integration checkpoint and removes the interim bridges).
