# W012 — Cross-platform continuity: WORK-NOTES

Work item (spec/WORK-ITEM-CATALOG.md §W012): **Web/Desktop/CLI/future-Mobile
continuity, remote attachments and runtime resume.** Owner W-C. Paths
`packages/desktop/**`, `apps/zcode-cli/**` + assigned shared/server seams;
the semantic layer landed in `packages/aurum-application/src/continuity/**`
(the W010 precedent: application orchestration is the semantic integration
point; substrate edits stay surgical mounts). Branch
`work/w012-cross-platform`. History: fd6a503 (APPROACH) → 6f8ed20 (banked
WIP) → 5e8110b (layer 1: continuity domain, 11 proofs) →
2b45a99 (**merge of main c00dd2f** — see the branch-state note) → layer A
commit (A2-A5 semantic + proofs) → layers B+C commit (desktop + CLI +
evidence) → the Layer D finisher (WORK-NOTES 9eb1b3f + scope-hygiene
3affb48 — see the delivery-state note).

## Branch-state note (documented per the dispatch instructions)

The banked branch forked at 874faab; main had since merged W013 (outcome
learning, application suite 401/401). The dispatch's gate table expects
"401 pre-existing + your continuity proofs", so the branch was brought
current with a **merge of main c00dd2f** (2b45a99 — a merge, NOT a rebase:
the banked commits 5e8110b/6f8ed20/fd6a503 are preserved verbatim in the
history). The merge conflicted in exactly one file —
`packages/aurum-application/src/contract.ts` (both sides had appended an
area export + header lines) — resolved by keeping BOTH the learning (W013)
and continuity (W012) exports. Post-merge: application 412/412
(401 pre-existing + 11 layer-1 continuity), domain 111/111, infra 140/140.

## File map (line counts; policy-clean under maxFileLines 400 / contract 300 / 12 methods)

### The semantic layer (managed module `aurum-application`, arch-checked)

| File                              | Lines | Layer    | Role                                                                                                                                                                             |
| --------------------------------- | ----: | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/records.ts`               |   188 | domain   | layer-1 vocabulary: session variants, EXPLICIT `continuous`/`replay` modes, `ContinuityEntry` union (lifecycle, store copy-on-writes, kernel effect-writes, attachments)         |
| `domain/errors.ts`                |    75 | domain   | layer-1 `ContinuityError` namespace (6 codes; uniform not-found = no existence leaks)                                                                                            |
| `domain/replay.ts`                |    75 | domain   | layer-1 pure replay validation (first-record/contiguity/duplicates/foreign-session) + summary                                                                                    |
| `domain/digests.ts`               |    49 | domain   | labeled attachment digests: SHA-256 via WebCrypto, honest FNV-1a-64 fallback                                                                                                     |
| `domain/ports.ts`                 |   295 | domain   | layer-1 ledger/surface/composer/replayer ports + `TowerServiceAccess` (the R6 widening: same 11 methods, reads/results maybe-promise)                                            |
| `app/continuityInputs.ts`         |   116 | app      | one typed validator per input shape (`continuity-validation` issues)                                                                                                             |
| `app/sessionViews.ts`             |    96 | app      | pure session/attachment view folds over ledger records                                                                                                                           |
| `app/continuityService.ts`        |   344 | app      | the 9-method service: open/attach/resume/ensure + attachments; live registry (references only); recovery idempotency (live id → UNCHANGED)                                       |
| `adapters/in-memory-ledger.ts`    |    75 | adapters | reference append-only ledger (identity + order stamping, no update/delete)                                                                                                       |
| `adapters/json-file-ledger.ts`    |    99 | adapters | persistence ledger (the cross-process replay source; temp+rename appends; honest sync-IO bounds)                                                                                 |
| `adapters/recording-wrappers.ts`  |   219 | adapters | journaling store/seam wrappers — journal AFTER the real store confirms; kernel effect-writes journal their inputs                                                                |
| `adapters/session-kernel.ts`      |   251 | adapters | the TWO named compositions (R3): `createContinuousTowerSession` + `createTowerReplayer` (the fold: applies records through REAL stores/seams; holds no reasoning/substrate port) |
| `adapters/attachment-surfaces.ts` |    81 | adapters | in-memory (web/CLI/tests) + file-system (desktop-shaped) + refusing surfaces                                                                                                     |
| `adapters/tower-rpc.ts`           |   159 | adapters | the wire-agnostic envelope (R6): method table + arity edge, handler (dispatch to the REAL service), client (a `TowerServiceAccess`)                                              |
| `contract.continuity.ts`          |    98 | contract | public surface; re-exported from `src/contract.ts` (one line)                                                                                                                    |
| `APPROACH.md`                     |   126 | note     | rulings R1-R7 + layer plan (the binding continuation contract)                                                                                                                   |

Surgical W010 edits (the only application/web touch outside `src/continuity`):
`control-tower/adapters/local-runtime.ts` (kernel/cognitionSeams/stores
injection points on `LocalControlTowerRuntimeOptions` + the
`LocalTowerStoreInjection` shape), `control-tower/contract.control-tower.ts`
(one type re-export), `packages/aurum-application/tsconfig.json`
(`"types": ["node"]` — the infra precedent: node builtins for the
persistence adapters, resolved from the hoisted root `@types/node`, no
package.json/lockfile change), `packages/web/src/tower/towerRuntime.ts`
(`TowerSession.runtime` widened to `TowerRuntimeAccess` = `{ tower:
TowerServiceAccess }`), `packages/web/src/tower/TowerApp.tsx` (the two
reads await the maybe-promise — the compile-required consequence), and
`src/contract.ts` (the merge-conflict resolution noted above + the
W012/W013 header lines).

### The desktop mount (unmanaged module `desktop`; carried by scoped tsc + the tsup bundle)

| File                                                                               | Lines | Role                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/aurum/towerIpc.ts`                                                       |    26 | the TWO shared constants (channel + command id), dependency-free so the preload shares the source                                     |
| `src/main/aurum/towerSessionHost.ts`                                               |   136 | the CONTINUOUS session host: JSON-file ledger + fs surface under userData, ensure→attach, the single ipcMain.handle over the envelope |
| `src/main/aurum/towerWindow.ts`                                                    |    49 | the ONE window (singleton; reload re-attaches — the live runtime is main-process resident)                                            |
| `src/preload/aurumTower.ts`                                                        |    20 | the ONE preload bridge (contextBridge → ipcRenderer.invoke; zero semantic logic)                                                      |
| `src/renderer/aurum-tower.html`                                                    |    24 | the page shell (CSP-hardened)                                                                                                         |
| `src/renderer/src/aurum-tower/aurumTowerPage.tsx`                                  |    84 | the composition swap: web `TowerApp` (source alias) over `createTowerRpcClient` behind the SAME `TowerSession` shape                  |
| mounts in `src/main/index.ts`, `desktopApplicationMenu.ts`                         |   +13 | the host registration + the one menu command item                                                                                     |
| bridges: `tsconfig.main/preload/renderer.json`, `tsup.config.ts`, `vite.config.ts` |   ~40 | interim CR-W012-desktop bridges (paths/alias/include)                                                                                 |

### The CLI mount (unmanaged zcode-cli workspace; carried by the runnable evidence)

| File                                             | Lines | Role                                                                                                         |
| ------------------------------------------------ | ----: | ------------------------------------------------------------------------------------------------------------ |
| `packages/cli/src/aurum-command.ts`              |   373 | `zcode aurum status\|charter\|resume` — replay-mode sessions over a JSON-file ledger; honest unwired refuser |
| `packages/cli/src/aurum-evidence-runner.ts`      |    36 | the per-process harness entry (drives the REAL `runAurumCommand`)                                            |
| `packages/cli/scripts/aurum-resume-evidence.mjs` |   102 | the recorded 3-process cross-process resume run (the runnable evidence)                                      |
| dispatch + help                                  |   +12 | the `case "aurum"` in `run.ts` + en-US/zh-CN command list lines                                              |
| bridges: `tsconfig.json`, `scripts/build.mjs`    |    +9 | interim CR-W012-cli bridges (paths + esbuild alias)                                                          |

## Rulings register (APPROACH R1-R7 → code)

1. **R1 one authority** — the ledger journals store/seam writes AFTER the
   real store confirms (`recording-wrappers.ts`); the service holds runtime
   references only (`live` map); replay re-applies through the real
   stores/seams of a fresh composition. Hygiene tripwires lock the
   append-only port + no-update/delete.
2. **R2 replay never re-runs** — the fold (`session-kernel.ts`) applies
   records through `TowerReplayTargets` (stores + kernel picks); it holds
   NO reasoning port and NO substrate. Proofs: counted instruments —
   `continuity-replay.test.ts` "ZERO model invocations" (scripted reasoner
   call count 1 → replay 0) + "ZERO substrate submissions" (counter
   0 → 0); plus the structural hygiene tripwire (no `requestReasoning` /
   `submitPlanTask` call anywhere in `src/continuity/**`).
3. **R3 explicit modes** — `createContinuousTowerSession` (desktop; the
   live registry returns the SAME runtime, `toBe` reference proofs) and
   `resumeSession` (replay path; live id → UNCHANGED, dead id → replay +
   `session-resumed` record). The mode is a recorded vocabulary value,
   never inferred.
4. **R4 no second Agent Body** — hygiene tripwire: zero `@aurum/agent` /
   `@aurum/provider` imports under `src/continuity/**`; records carry actor
   references + substrate attachment references only.
5. **R5 attachments are runtime records** — `TowerAttachmentSurface` port +
   in-memory/file-system/refusing adapters; replay sees attachment HISTORY
   (fold skips attachment entries — never re-materializes); re-open is a
   NEW event (open-once ids; new ref). Proofs: `continuity-attachments.test.ts`
   - the replay-history proof.
6. **R6 envelope behind the same interfaces** — `TowerServiceAccess`
   (maybe-promise widening; the LOCAL tower satisfies it structurally —
   compile-time witness proof); envelope edge = membership + arity ONLY
   (typed refusals, no dispatch); args validated by the owning service
   (verbatim-Result + no-re-wrap proofs); the desktop preload carries it
   over `ipcRenderer.invoke`.
7. **R7 surgical mounts** — desktop: host + 1 channel + 1 command id + 1
   window + 1 page + 1 preload bridge (+13 mount lines in two legacy
   files); CLI: 1 command file + 1 dispatch case + help lines; the
   cross-package wiring is in `CR-W012-desktop.md` + `CR-W012-cli.md` with
   interim tsconfig/bundler bridges (the CR-W010 pattern).

## Acceptance clauses → locking proofs (65 continuity tests; 54 new + 11 layer-1)

Catalog W012 acceptance: **one semantic authority; no second Agent Body;
desktop continuous and web/mobile replayable semantics remain explicit;
remote recovery does not duplicate runs.**

| Clause                                              | Proof (test → clause)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| one semantic authority                              | `continuity-contract-hygiene.test.ts` (10): ledger port append-only (no update/delete methods); domain IO-free; sibling areas via contracts only; one error namespace (6 codes); RPC edge owns membership+arity only (no second validation authority). `continuity-rpc.test.ts` (10): owning service's Result crosses the envelope VERBATIM (`.toBe` object identity), errors never re-wrapped (`isContinuityError(...) === false`).                                                            |
| no second Agent Body                                | `continuity-contract-hygiene.test.ts` "no continuity source imports @aurum/agent or @aurum/provider (R4)" — source-scan tripwire over every file under `src/continuity/**`.                                                                                                                                                                                                                                                                                                                     |
| desktop continuous + web/mobile replayable EXPLICIT | `continuity-replay-validation.test.ts` (11, layer 1): mode+variant recorded on `session-opened`, never inferred; composition identity stable. `continuity-service.test.ts` (13): open journals `session-opened` FIRST; **attach returns the SAME runtime reference** (`toBe` — desktop continuity); resume-on-live-id returns the session UNCHANGED (no records appended, no phantom resume); dead-id resume journals `session-resumed`; `ensureSession` dispositions opened/attached/replayed. |
| remote recovery does not duplicate runs             | `continuity-replay.test.ts` (7): **ZERO model invocations after replay (counted)**; **ZERO substrate submissions (counted)**; dead-id resume reconstructs EQUIVALENT state (byte-identical `toStrictEqual` overview + mission record; kernel effects readable through the real seams); replay continues recording; corrupt ledger fails typed (invariant), never partial. Plus `continuity-ledgers.test.ts` (7): JSON-file ledger round-trip across instances (the cross-process source).       |
| remote attachments (R5)                             | `continuity-attachments.test.ts` (7): materialize + labeled digest (sha-256); open-once conflict; double-close state error; history order; typed validation; surface refusal propagates (no record); tenant fence uniform not-found. Plus the replay-history + no-phantom-re-attach proof in `continuity-replay.test.ts`.                                                                                                                                                                       |

Application suite: **466/466** = 401 pre-existing (incl. W013 learning) +
11 layer-1 + 54 new continuity proofs.

## Seam consumption map (what this area consumes, through which contracts)

- `@aurum/domain` — public entrypoint only (kernel factory, vocabulary,
  validating constructors; hygiene-locked).
- `../../cognition/contract.cognition.js` — MissionStore, KernelCognitionSeams,
  ReasoningPort (type), MissionRecord/MissionError (type).
- `../../plans/contract.plans.js` — the five plan stores + PlanAuditPort,
  ExecutionPlan (type), in-process substrate (the recording composition
  default).
- `../../lab/contract.lab.js` + `../../company/contract.company.js` —
  evaluation store, query log.
- `../../control-tower/contract.control-tower.js` —
  `createLocalControlTowerRuntime` + the W012 injection points,
  `ControlTowerService`/`ControlTowerError`/view models (the
  `TowerServiceAccess` widening targets),
  `createLocalPlanAuditPort`.
- Consumed BY: `packages/web` (the widened `TowerSession`), `packages/desktop`
  (session host + RPC client page, via CR-W012-desktop bridges),
  `apps/zcode-cli` (the aurum command, via CR-W012-cli bridges).

## Honest limitations

1. **The desktop and CLI layers are proof-light compared to the application
   suite** (the W010 web ruling, extended): packages/desktop has NO test
   infrastructure of its own (its legacy subprojects carry 216 PRE-EXISTING
   tsc errors: 125 renderer + 88 main/scheduler + 3 preload — identical
   count at the merge-base before any W012 desktop edit, zero errors from
   W012 files; the repo's own
   `pnpm typecheck` only builds `tsconfig.host.json` from the desktop
   tree). The desktop mount is carried by: zero-new-error scoped tsc, the
   FULL `tsup` bundle build (verified: `out/main/index.js` contains the
   session host + channel constant; `out/preload/aurumTower.cjs` contains
   the bridge), and the semantic proofs living in the application package.
   No Electron-level (window/renderer) smoke was recorded in this
   environment — that requires a display; the TL may want one dev-run
   smoke on a capable box.
2. **The CLI mount's verification is the recorded evidence run, not a test
   suite**: `node scripts/aurum-resume-evidence.mjs` (3 processes; ALL
   CHECKS PASSED — recorded in the layers B+C commit message). The CLI
   package's own `tsc --noEmit` carries 178 errors (177 pre-existing from
   unbuilt zcode-cli workspace dists + 1 from the new command's house-style
   type-only `@zcode/shared-types` import, which resolves once the
   workspace is built — same class as every existing command file).
3. **Kernel-plane state created OUTSIDE the session composition is not
   session-journaled**: goals, candidates, persons/memberships, and human
   action decisions made through the kernel authority surface (not the
   tower) are not continuity records. The recording composition supports a
   `seedKernel` hook (documented; used by the proofs) so a mount can
   re-establish identical kernel-plane state pre-session; reconstructing
   that state from records is kernel persistence (P-series), not session
   continuity. In practice today the desktop session starts with an empty
   kernel, so its tower-reachable state is fully journaled.
4. **Web mount storage-backed resume is NOT wired** (R7's web line): the
   web session type is widened (`TowerServiceAccess`) and its reads are
   transport-ready, but the `/tower` mount still composes the in-process
   local runtime per page load. Wiring the JSON-file/localStorage ledger +
   resume-on-mount into `packages/web` exceeded the sanctioned surgical
   edits ("the TowerServiceAccess widening on the web session type" only);
   the composition swap point is ready (`towerRuntime.ts`).
5. **JSON-file ledger bounds**: synchronous IO, full-file rewrite per
   append (temp+rename), no cross-process file locking (one writer process
   per file — the desktop host owns its file; the CLI evidence is
   sequential). A torn write can lose the LAST append (contiguity check
   catches it typed on the next replay); PostgreSQL-backed continuity is
   P-series.
6. **The unwired reasoner is the desktop/CLI default**: advancing a
   mission through the reason stage fails typed `mission-model-refused`
   and the mission stays resumable (nothing fabricated). The evidence
   charter drives exactly ONE stage (orient — reads only). Wiring a real
   reasoning adapter is provider-plane follow-up (W003 fabric exists; the
   composition takes a `reasoning` option).
7. **Envelope refusals across Electron IPC degrade to display-level**:
   structured clone preserves the serialized error shape but not the
   `ContinuityError` class identity; the desktop page renders the message
   (the in-process typed-channel semantics are proof-locked in the
   application suite).
8. **`sessionInfo`/`listSessions` are host-plane** (no scope argument —
   they project the local ledger; they are not transport-exposed). The
   scope-carrying attachment methods enforce the tenant fence (uniform
   not-found, proof-locked).
9. **maxFileLines headroom**: `continuityService.ts` 344/400,
   `session-kernel.ts` 251/400, `ports.ts` 295/300 (contract-adjacent port
   file, under the 300 contract cap), `aurum-command.ts` 373/400 (unmanaged
   CLI — the cap does not bind).
10. **CRs OPEN**: `CR-W012-desktop.md` (@aurum/application link into
    packages/desktop + 5 interim bridges) and `CR-W012-cli.md` (the
    cross-workspace dependency decision + 2 interim bridges). Both follow
    the CR-W010 precedent; the TL wires the lockfile entries at
    integration and removes the bridges.

## Test inventory (65 continuity proofs)

- `continuity-replay-validation.test.ts` — 11 (layer 1: the replay contract of the records)
- `continuity-service.test.ts` — 13 (open/attach/resume/ensure semantics + idempotency + tenant fence)
- `continuity-replay.test.ts` — 7 (never-re-runs counted; equivalent-state reconstruction; history; continuation; corrupt refusals)
- `continuity-ledgers.test.ts` — 7 (append-only, identity, isolation, JSON round-trip)
- `continuity-attachments.test.ts` — 7 (surface records, digests, lifecycle, refusals)
- `continuity-rpc.test.ts` — 10 (membership/arity refusals, verbatim delegation, client, local-satisfies-access witness)
- `continuity-contract-hygiene.test.ts` — 10 (R4 tripwire, IO-free domain, contracts-only, append-only port, surface shape)
- `continuity-helpers.ts` — shared fixtures (counting reasoner/substrate instruments; kernel-plane observation seed)

## Exact gate outputs (at the Layer D tip 3affb48; re-run after the hygiene commit)

- `./node_modules/.bin/tsc -b packages/aurum-application packages/web packages/desktop` →
  application + web: exit 0. **packages/desktop: exit 1 with 216
  PRE-EXISTING legacy errors** (125 renderer + 88 main/preload/scheduler +
  3 preload — identical count at the merge-base before any W012 desktop
  edit; zero errors from W012 files). The repo's own gate
  (`pnpm typecheck`) builds only `packages/desktop/tsconfig.host.json`
  from the desktop tree — the desktop root config was never tsc-clean.
  This is recorded honestly rather than "fixed": repairing 216 legacy
  substrate errors would violate the surgical-mount law.
- `pnpm fmt:check` → clean (3452 files)
- `pnpm lint` → 70 warnings / 0 errors (baseline unchanged)
- `pnpm architecture:check` → 0 violations; `-- --changed` → 0 violations
- application vitest → 466/466 (401 pre-existing + 65 continuity)
- domain vitest → 111/111; infra vitest → 140/140; provider 57/57,
  agent 29/29, execution 90/90, marketplace 82/82 (regression nets
  unchanged)
- desktop `npx tsup` → all four bundles build success
  (main/preload/host/scheduler; re-run after the hygiene commit)
- CLI evidence → `node scripts/aurum-resume-evidence.mjs` → ALL CHECKS
  PASSED (3 processes)

## Delivery-state note (recorded honestly)

- **Scope hygiene 3affb48**: the layer-1 banking (5e8110b) accidentally
  committed 4 tsc-emitted artifacts under `packages/desktop/src/scheduler/`
  (`.d.ts`/`.d.ts.map`/`.js`/`.js.map` for `schedulerProtocol`, 71 lines of
  generated output). `tsc -b packages/desktop` emits next to sources
  because the legacy desktop configs set no `noEmit`; the banking's add
  swept them. Removed at 3affb48 — `packages/desktop/src/scheduler` is
  byte-identical to main again (5 sources, zero emitted). HAZARD for the
  TL: any `tsc -b packages/desktop` run regenerates the 4 files as
  untracked output; a TL-owned root `.gitignore` rule (or a `noEmit`
  change in the legacy desktop configs — a substrate edit I did not make)
  closes it.
- **Push state**: this pod is fetch-only — `git push origin` fails with
  `could not read Username for 'https://github.com'` (no credentials;
  anonymous read works). The branch is fully banked at the Layer D tip
  with a clean tree; the remote `origin/work/w012-cross-platform` still
  holds the banked tip 5e8110b. The TL pushes/merges at integration
  (the W010/W013 chain left no `work/w013` remote branch either).
