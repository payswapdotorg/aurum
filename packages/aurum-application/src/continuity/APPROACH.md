# W012 — Cross-platform continuity: APPROACH

Work item (spec/WORK-ITEM-CATALOG.md §W012): **Web/Desktop/CLI/future-Mobile
continuity, remote attachments and runtime resume.** Owner W-C. Paths
`packages/desktop/**`, `apps/zcode-cli/**` + assigned shared/server seams; the
SEMANTIC layer of the item lands here, in the managed application package
(`src/continuity/**`), because substrate edits stay surgical mounts while
semantics live in managed Aurum packages (constitution: application
orchestration is the semantic integration point). Base main 874faab (W001,
W009, W010 all merged — dependencies satisfied). Direct predecessor: the W010
control tower (projection + web mount) whose WORK-NOTES hand this item the
composition points: `towerRuntime.ts`'s session composition, the
mount-agnostic tower components, and the "one composition swapped per variant,
W012 replaces it with RPC behind the same `ControlTowerService` interface"
transport ruling.

## The problem in one paragraph

W010 delivered ONE projection (the tower) with ONE canonical local
composition, mounted in-process by the web. Every platform that mounts it
today starts a FRESH in-memory kernel: nothing survives a reload, no platform
can resume a session another platform (or an earlier process of itself)
started, and there is no transport story for a renderer that must reach a
kernel living in another process. W012 makes the continuity semantics
explicit and shared: a session kernel with TWO named composition modes —
`continuous` (desktop: the live runtime outlives renderer reloads; a
re-attach returns the SAME runtime) and `replay` (web/mobile/CLI: state is
reconstructed by REPLAYING the recorded semantic records into a fresh
composition, never by re-executing work) — plus the remote-attachment surface
(substrate capability, recorded as runtime records) and a wire-agnostic RPC
envelope behind the SAME service interfaces.

## Rulings

- **R1 — One semantic authority, the ledger is a record, not a brain.**
  The continuity ledger journals WHAT THE SESSION'S REAL COMPOSITION DID:
  mission/plan/handoff/completion/escalation/evaluation records, kernel
  effect-writes (the cognition seam calls), plan audit entries, query-log
  entries, session lifecycle + attachment events. It decides nothing, owns no
  command path, and holds no second copy of any store: replay re-applies the
  records THROUGH the real stores and seams of a freshly composed runtime.
  The kernel + the four area services remain the only authority for every
  new decision. This is the append-only-records law the constitution names
  ("web/mobile reconstruct state by REPLAYING the semantic records").

- **R2 — Replay reconstructs; it never re-runs.** The replay fold applies
  recorded records and recorded seam calls to the fresh composition. It holds
  NO reference to the reasoning port or the execution substrate: a replay
  cannot invoke a model or dispatch a task (proven by counting doubles —
  zero invocations). Post-replay continuation runs from the journal boundary
  exactly as W007/W009 resume semantics dictate (next stage derived from the
  journal; `runToCompletion` idempotent on terminal missions; handoff
  delivery idempotent; substrate submission keys idempotent). This is the
  "remote recovery does not duplicate runs" clause made structural.

- **R3 — The mode difference is explicit in the composition, not implicit.**
  `createContinuousTowerSession` (desktop) and the replay path
  (`resumeSession` on the continuity service) are two NAMED, exported
  compositions over the SAME `createLocalControlTowerRuntime`. A continuous
  session registers itself live; `attachSession` returns the SAME live
  runtime (reference-equal) — desktop continuity. `resumeSession` on a live
  id returns that session UNCHANGED (no replay, no re-execution); on a
  recorded-but-dead id it replays and registers the reconstructed session.
  Every platform variant picks its mode at its mount; nothing detects
  "platform" implicitly.

- **R4 — No second Agent Body.** The continuity area imports neither
  `@aurum/agent` nor `@aurum/provider`; its records carry actor REFERENCES
  (labels) and substrate attachment REFERENCES only — never body state,
  model bindings, or credentials. Bodies resolve through the kernel/agent
  package identically on every platform (W003 semantics); the session
  kernel transports sessions, not agents. Tripwire-locked in the proof
  suite.

- **R5 — Remote attachments are runtime records over a substrate port.**
  The `TowerAttachmentSurface` port is the substrate seam (ZCODE-SUBSTRATE-MAP
  "remote attachments"; the desktop host's prompt-attachment materialization
  machinery is the production adapter). Opening an attachment materializes
  content through the surface and records `{name, contentType, digest}` +
  the surface's materialization reference in the ledger — runtime-plane
  records, never semantic authority. Replayed sessions see their attachment
  HISTORY; re-materializing is a NEW attachment event (no phantom re-attach,
  no duplicate refs). Reference adapters: an in-memory surface (web/CLI/
  tests) + the desktop main-process surface.

- **R6 — The transport is an envelope behind the SAME interfaces.**
  `TowerServiceAccess` (the tower service with reads/results permitted to
  arrive as promises) is the transport-target widening of W010's session
  composition: the local tower satisfies it synchronously; an RPC client
  satisfies it asynchronously. The wire-agnostic envelope
  (`{method, args}` + the service's own `Result` verbatim) lives in this
  area's adapters; the desktop IPC layer only provides the wire
  (`ipcRenderer.invoke`). Method-name membership + arity are checked at the
  envelope edge; every argument is validated by the owning service exactly
  as in-process callers are (no second validation authority).

- **R7 — Substrate edits stay surgical mounts.** Desktop: a main-process
  session host + one IPC channel + one command id + one window + one
  renderer page REUSING the web tower components (source alias, the W010
  mount-agnostic ruling) + one preload bridge. CLI: one command file + one
  dispatch case + help lines. Web: the session composition gains the
  replayable mode (a storage-backed ledger + resume-on-mount). Shared: two
  channel/command constants. Cross-package wiring needs →
  `spec/contract-requests/CR-W012-*.md` (lockfiles TL-owned; interim
  bridges follow the CR-W010/P001 pattern: tsconfig paths + bundler alias,
  removed by the TL on CR resolution).

## Layer plan

- **Layer A (this area, semantic):** `domain/` records + ports + errors +
  replay validation; `app/` the continuity service (open/attach/resume +
  attachments, live registry, idempotency); `adapters/` the in-memory +
  JSON-file ledgers, the recording store/seam wrappers (the journaling
  composition around `createLocalControlTowerRuntime`), the session kernel
  (continuous + replay compositions), the reference attachment surfaces,
  and the RPC envelope/handler/client. Surgical W010 edits: store/seam/kernel
  injection points on `LocalControlTowerRuntimeOptions`, the
  `TowerServiceAccess` widening on the web session type. Proof suite in
  `packages/aurum-application/test/continuity-*.test.ts`.
- **Layer B (desktop):** `packages/desktop/src/main/aurum/**` (host + IPC +
  window), the renderer page, the preload bridge, shared channel/command
  constants, vite/tsconfig bridges, CR-W012-desktop.
- **Layer C (CLI):** `apps/zcode-cli/packages/cli/src/aurum-command.ts` +
  dispatch + help + tsconfig/esbuild bridge + CR-W012-cli; a recorded
  cross-process resume run as runnable evidence.
- **Layer D:** WORK-NOTES + final gates.
