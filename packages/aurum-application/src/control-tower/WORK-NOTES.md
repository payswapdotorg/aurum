# W010 — Control tower + conversation: WORK-NOTES

Work item (spec/WORK-ITEM-CATALOG.md §W010): **Aurum management control
tower and conversation experience.** Owner W-A. Paths `packages/ui/**`,
`packages/web/**` + applicable Aurum application projection code. Deps
W001+W004+W007 satisfied at base 8f24706. Branch
`work/w010-control-tower`, local only (PAT dead; TL owns pushes).
History: 2215d52 (APPROACH note) → 9b16e14 (Layer A projection layer) →
221d960/559277c (two deadline-kill banks, TL-recovered) → d460635 +
afaf619 (Layer A proofs, 32/32) → 0144167 (Layer B web surfaces) → this
Layer C finisher commit (audit repairs + CR-W010 + these notes).

Deliverable in one line: a READ-ONLY semantic projection of the four
public areas (company W004, cognition W007, lab W008, plans W009) in
`aurum-application/src/control-tower/**`, plus a company-centric web
experience mounted at `/tower` that consumes that projection through the
public contract only.

## File map (line counts; projection files policy-clean under maxFileLines 400 / contract 300 / 12 methods)

### The semantic projection (managed module `aurum-application`, arch-checked)

| File                             | Lines | Layer    | Role                                                                                                                                                                             |
| -------------------------------- | ----: | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/records.ts`              |   171 | domain   | read-only view models: `ControlTowerOverview`, goal/mission/plan/lab cards, `PendingApproval`, `ConversationViewModel` + turn kinds/roles                                        |
| `domain/errors.ts`               |    39 | domain   | `ControlTowerError` tagged union — area-tagged wraps of the owning areas' typed errors + one local `tower-validation`; no second error authority                                 |
| `domain/ports.ts`                |   110 | domain   | `ControlTowerDeps` = structural picks of the four PUBLIC service interfaces (no kernel import); `ControlTowerService` (11 methods: 2 reads + 9 indexed-access-typed 1:1 actions) |
| `domain/overview.ts`             |   191 | domain   | pure board derivations: goal/mission/plan/lab cards + pending approvals (copy or count, never judge)                                                                             |
| `domain/conversation.ts`         |   205 | domain   | pure thread derivations: mission stage journals + plan immutable histories → conversation turns                                                                                  |
| `app/towerService.ts`            |   143 | app      | `overview` + `conversation` reads (logged company query, verbatim report pass-through); nine action methods = pass-throughs                                                      |
| `adapters/kernel-plan-wiring.ts` |   210 | adapters | kernel goal/candidate views, REAL `PlanApprovalAuthority` pass-through (citation + human-decision assertion), local plan audit port                                              |
| `adapters/local-runtime.ts`      |   166 | adapters | `createLocalControlTowerRuntime`: real kernel + four real services + tower; `createUnwiredReasoner` (default model boundary refuses)                                             |
| `contract.control-tower.ts`      |    82 | contract | public surface (view models, derivations, ports, service factory, local composition) — re-exported from `src/contract.ts` (one line)                                             |
| `APPROACH.md`                    |   134 | note     | the continuation contract: six rulings + layer plan (preserved as the design record)                                                                                             |

Touch outside the area: `src/contract.ts` (composed re-export line +
area-list header comment) and one line in `src/company/contract.company.ts`
(re-export of the previously unexported `ContradictionEntry` report type —
all sibling report entries were already exported; the tower Unknowns panel
consumes it through the public contract).

### The web variant (unmanaged module `web`; verified by root tsc + gates, see test-infrastructure ruling)

| File                               |  Lines | Role                                                                                                                                              |
| ---------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/main.tsx`        |    +18 | pathname dispatch: `isTowerPath` → `renderTowerPage` BEFORE any ZCode server bootstrap (APPROACH R2)                                              |
| `tower/towerRoute.ts`              |     54 | pure route model (board / mission / plan) + canonical paths; the only routing logic the surface owns                                              |
| `tower/towerRuntime.ts`            |     43 | session composition: `createLocalControlTowerRuntime` + `tenantScope("studio")`; honest bounds header                                             |
| `tower/TowerApp.tsx`               |    386 | host: route state, board/thread reads, `runDelegated` (awaits the promise-of-Result of the W007 async loop), operator label + plan-citation state |
| `tower/TowerBoard.tsx`             |    320 | the Today IA: Approvals, Situation, Goals, Unknowns, Missions (+ charter compose), Plans, Lab                                                     |
| `tower/TowerThread.tsx`            |    102 | mission/plan thread: journal turns, awaiting-decisions, advance/run controls, follow-up compose                                                   |
| `tower/towerCompose.tsx`           |    114 | CharterForm (board) + MissionFollowUp (thread) — both charter a mission through the SAME delegated `createMission`                                |
| `tower/towerPanels.tsx`            |    141 | read-only situation/unknowns rows (goal situation, blind spot, unknown, contradiction, stale, missing)                                            |
| `tower/towerWidgets.tsx`           |    136 | TurnRow, PendingApprovalRow (approve cites an approved action id — the authority law), Section, EmptyNote                                         |
| `tower/towerFormat.ts`             |     76 | pure helpers: error rendering, timestamps, VALIDATED branded constructors (`domainTime`/`personId` via the contract re-exports — never raw casts) |
| `tsconfig.json` / `vite.config.ts` | +10/+5 | interim source-mode bridges (CR-W010 pending; TL removes on link)                                                                                 |

## The projection-variant ruling (acceptance clause 4: Web and Desktop remain projection variants)

**Where the semantics live:** ONE semantic projection —
`aurum-application/src/control-tower/**` (managed, arch-checked, proof
suite). It owns the view-model derivations, the error vocabulary, the
service surface and the canonical local composition. No presentation
framework, no DOM, no routing exists in it.

**What a variant is:** a mount of that projection. The WEB variant =
pathname dispatch in `packages/web/src/main.tsx` (the share-route
pattern) + the session composition in `towerRuntime.ts` + React rendering
over view models. The DESKTOP variant (W012's item) = the same projection
mounted in the Electron renderer — nothing in the tower surface is
web-locked: the shared pieces (`TowerBoard`, `TowerThread`, `towerPanels`,
`towerWidgets`, `towerCompose`, `towerFormat`) are plain React +
workspace-themed Tailwind classes with zero `window`/browser-API use; the
only web-owned pieces are the route bootstrap (`main.tsx`, `towerRoute`
consumers via `history.pushState` in `TowerApp`) and the entry
composition.

**One composition, swapped per variant:** today both variants (web now,
desktop next) mount `createLocalControlTowerRuntime` in-process — the
real kernel + the four real services, in-memory, session-scoped. The
W012 transport variant replaces exactly that composition with RPC behind
the SAME `ControlTowerService` interface; the client surface and every
proof above it are composition-independent by construction (the
delegation tests rebuild the tower over instrumented deps of the same
shape).

**UI-never-truth (clause 3) at the composition level:** the browser
kernel is a session-scoped projection variant — reloading the page starts
a fresh kernel; nothing persists, so the web can never become a second
company truth. Server-side authority + persistence are W012/P-series.

## Action-routing map (acceptance clause 2: every semantic action through public contract)

Every control routes through the tower service, which holds NO kernel
handle (tripwire-proven); each action is a 1:1 indexed-access-typed
delegation to the owning area's public service method, returning that
service's own `Result` verbatim.

| UI action (web surface)                                            | Tower service method         | Underlying public contract call(s)                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board load / Refresh (and post-action refresh)                     | `overview(scope, read)`      | `company.situation` + `company.goalAttention` + `company.reportUnknowns` (one logged query object, forwarded identically); `plans.listPlans`; `cognition.listMissions`; `lab.listEvaluations`; `plans.readyTasks`/`listEscalations` for active plans |
| Open mission/plan thread                                           | `conversation(scope, topic)` | `cognition.getMission` / `plans.getPlan` (the thread is derived from the exact record returned)                                                                                                                                                      |
| Charter a mission (board compose)                                  | `createMission`              | `cognition.createMission` (same call the thread-side follow-up uses; success navigates to the new thread)                                                                                                                                            |
| Ask the next question (thread compose)                             | `createMission`              | `cognition.createMission` — the ONLY semantic "send" the contract offers for new questions                                                                                                                                                           |
| Advance mission (board + thread)                                   | `advanceMission`             | `cognition.advance` (one journal-derived stage; async — the UI awaits the promise of Result)                                                                                                                                                         |
| Run mission to completion (board + thread)                         | `runMissionToCompletion`     | `cognition.runToCompletion`                                                                                                                                                                                                                          |
| Cancel mission (board)                                             | `cancelMission`              | `cognition.cancelMission`                                                                                                                                                                                                                            |
| Approve plan (board + thread; requires a cited approved action id) | `approvePlan`                | `plans.approvePlan` (humanDecision + citation carried through — the kernel-side `kernelApprovalAuthority` asserts the citation)                                                                                                                      |
| Reject plan (board + thread)                                       | `rejectPlan`                 | `plans.rejectPlan`                                                                                                                                                                                                                                   |
| _(no web control — see limitations)_                               | `submitPlanForApproval`      | `plans.submitForApproval` (delegation-proven; plan authoring surface is the plans area's own)                                                                                                                                                        |
| _(no web control — see limitations)_                               | `activatePlan`               | `plans.activatePlan` (delegation-proven)                                                                                                                                                                                                             |
| _(no web control — see limitations)_                               | `dispatchTask`               | `plans.dispatchTask` (delegation-proven; execution-substrate era)                                                                                                                                                                                    |

Read path honesty: plan CREATION stays on the plans area surface (the
recorder proof asserts the tower never touches `createPlan`); mission
actions stop at `recommended` (the W007 gate law) — the tower displays
them as pending but has no mission-action approval control, because that
path belongs to the kernel authority surface, not a projection.

## Acceptance clauses → locking proofs (32 proofs, 4 files + shared helpers)

1. **No coding-centric primary information architecture** — the tower's
   IA is company/goal/organization-centric: Approvals, Situation, Goals,
   Unknowns, Missions, Plans, Lab panels (`TowerBoard.tsx`; ARCHITECTURE
   §Experience plane "management control tower" list). There is no
   editor/code surface anywhere under `/tower`; the ZCode coding
   workspace at `/` is a different experience surface, untouched
   (APPROACH R2 — not W010's to own). Structural: enforced by the surface
   itself (no code-centric component exists); the panels' contents are
   proof-derived (below).
2. **Every semantic action goes through public contract** —
   `test/control-tower-delegation.test.ts` (7): recorder-instrumented
   deps prove for EVERY tower method that exactly ONE area method fires
   (the one claimed), arguments are forwarded reference-identically, and
   the area's own `Result` returns VERBATIM (value and error objects) —
   including the async cognition seam (the tower awaits the service's own
   promise) and the error-namespace law (a delegated failure is the
   area's own `MissionError`/`PlanError`, never re-wrapped;
   `isControlTowerError(actionError) === false`). Plus the structural
   half: `test/control-tower-contract-hygiene.test.ts` (9) locks the
   picks (no `createPlan`/`issueHandoff`/kernel authority picks), the
   11-method surface shape, no execution/provider/agent imports, no
   kernel in domain+app layers, IO-free domain, `@aurum/domain` via
   package specifier only, no lint-disables, kernel composed through area
   contracts only.
3. **UI never becomes company truth** — `test/control-tower-overview.test.ts`
   (9): every board value derives from real kernel records (goal ledger,
   evidence ledger, action authority, candidate registry through the four
   services); the situation/attention/unknowns panels pass the company
   reports through VERBATIM (`toStrictEqual`); empty tenants get honest
   empty boards (no fabricated cards); readiness appears only for active
   plans; tenant isolation (rival board empty, rival threads fail closed
   with the owning area's uniform not-found — no existence leak).
   `test/control-tower-conversation.test.ts` (7): one turn per journal
   entry in journal order, the reason turn renders the model's bounded
   summary VERBATIM (the tower never rephrases model output), gate turns
   await a human exactly while gated actions sit at `recommended`, plan
   threads mirror creation + immutable approval/lifecycle histories with
   verbatim citations, cancelled threads append the human turn, unknown
   topics/records fail typed.
4. **Web and Desktop remain projection variants** — the structural
   ruling above: semantics in the managed module (hygiene tripwires prove
   no presentation/framework dependency), web is a pathname-dispatch
   mount consuming the public package entrypoint only (verified: 8 files
   under `packages/web/src/tower/`, every `@aurum` import is the bare
   package specifier), and the composition arrives as a prop
   (`TowerApp({ session })`) so the desktop mount swaps it without touching
   the components.

## Design rulings (APPROACH → code, condensed)

1. **Zero new semantic authority.** The tower's `ControlTowerDeps` are
   structural picks of the four PUBLIC service interfaces — the same seam
   discipline the areas apply to the kernel. The tower cannot approve a
   mission action (no kernel pick at all), cannot create a plan (pick
   absent), cannot invent an error namespace (area-tagged wraps only).
2. **Reads are logged queries.** `overview` takes the company area's
   `TowerReadInput` (now + askedBy + reason) and forwards the SAME object
   to all three company seams — the query log records the tower's reads
   like any other company query.
3. **The conversation is a projection of records, not a channel.** The
   thread derives from the mission's own stage journal and the plan's own
   immutable histories; the only "send" is chartering a follow-up mission
   (the one public-contract path for new questions). No chat state exists
   anywhere.
4. **Indexed-access typing locks the delegation.** `readonly createMission:
CognitionService["createMission"]` etc. — the compiler keeps the
   signature 1:1; the delegation proofs keep the behavior 1:1.
5. **The canonical local composition is honest by default:** unwired
   reasoner REFUSES (`mission-model-refused`, mission stays resumable at
   the reason boundary — no fabricated content, no fake completion);
   execution substrate is the W009 in-process reference double; plan
   audit port is application-local.
6. **The kernel reaches plans through a REAL authority pass-through**
   (`kernel-plan-wiring.ts`): citations are asserted against the kernel's
   action authority + audit trail (decision state + same-human history),
   never assumed — the UI cannot smuggle an approval past the citation
   law by routing through the tower.
7. **Web test-infrastructure ruling (APPROACH R5):** packages/web has NO
   test runner and CI runs fmt/lint/typecheck/arch only; inventing one
   was ruled out of scope. The proof burden lives where the house pattern
   already is — the 32 vitest proofs in aurum-application — and the web
   program is verified by the root compiler (`tsc -b packages/web`) plus
   the standard gates. The routing module stays trivial and typechecked.

## Honest limitations

1. **The web layer itself is proof-light by ruling** (R5): no automated
   browser tests exist. Web verification = root-compiler typecheck of the
   full web program (source-mode through the tsconfig bridge), fmt/lint
   gates, plus the one recorded dev-time browser smoke (vite dev +
   headless Chromium over the real in-browser kernel — the async-seam fix
   in 0144167 came out of it). Rendering regressions would NOT be caught
   by CI; the semantic layer below them is fully proven.
2. **Three delegated actions have no web control**
   (`submitPlanForApproval`, `activatePlan`, `dispatchTask`): they are
   contract-complete and delegation-proven 1:1, but the board/thread
   offer no buttons for them. Plan authoring (create/submit) stays on the
   plans surface by design; activate/dispatch controls are follow-up
   polish once plan threads render task graphs. Nothing is half-wired —
   no UI path calls them today.
3. **In-memory, session-scoped composition:** reloading `/tower` starts a
   fresh kernel; the local composition never persists. Server transport
   (same client surface over RPC) and PostgreSQL authority are W012 /
   P-series. The default reasoner is the unwired refuser — driving a
   mission through the reason stage surfaces `mission-model-refused`
   (typed, readable, mission resumable); wiring a real reasoning adapter
   is provider-plane follow-up.
4. **Board IA covers the four areas that exist** (company, cognition,
   lab, plans). ARCHITECTURE's full tower list (Risks, Opportunities,
   Processes, Capabilities, Workforce, Agents, Executions, Evidence,
   Recommendations, Marketplace, Settings) lands panel-by-panel as the
   corresponding application areas land (W013/W014/W015; marketplace is a
   sibling package not yet composed into the tower).
5. **No authenticated identity:** the operator field is a local label;
   `tenantScope("studio")` is fixed per session. The kernel authority
   still decides every consequential transition (approve requires the
   human-decision citation; mission actions stop at recommended) — but
   tenant/operator selection UI is future work.
6. **Mission-action approvals are display-only:** the pending-approval
   panel renders mission gate recommendations with the honest note that
   approving them runs through the kernel authority surface (later
   wiring); only PLAN approvals have decide controls.
7. **Navigation is client-side** (`history.pushState` + popstate); any
   `/tower` path falls back to the board (honest fallback, no 404 game).
   Deep-link serving in production requires the standard SPA history
   fallback on the static host (vite dev provides it).
8. **maxFileLines headroom:** `TowerApp.tsx` 386/400 (web is unmanaged —
   the cap does not bind — but the file should split before growing);
   `kernel-plan-wiring.ts` 210, `conversation.ts` 205.
9. **CR-W010 is OPEN** (filed by this finisher): `@aurum/application` is
   not yet a real dependency of `packages/web`; two interim bridges
   (tsconfig paths + vite alias) carry resolution and are removed by the
   TL when the CR lands (P001 precedent).
10. **What W012 (desktop continuity) inherits:** the projection + web
    components are mount-agnostic (no window-API in the shared pieces);
    the composition point to swap is `towerRuntime.ts`'s
    `createTowerSession`; the route model (`towerRoute.ts`) is reusable;
    the interim bridges + CR-W010 pattern is the wiring template for the
    desktop package; the honest-bounds headers in both runtime files are
    the composition contract to preserve.

## Test inventory (32 proofs)

- `control-tower-overview.test.ts` — 9 (clause 3: board derives from real records; tenant isolation; validation)
- `control-tower-conversation.test.ts` — 7 (clause 3: threads mirror journals verbatim; bounded-content verbatim rendering)
- `control-tower-delegation.test.ts` — 7 (clause 2: 1:1 forwarding, verbatim Results, error namespaces, reads-only overview)
- `control-tower-contract-hygiene.test.ts` — 9 (clauses 2+3: structural tripwires)
- `control-tower-helpers.ts` — shared fixtures (canonical local runtime + scripted reasoner + kernel seeds; not a test file)

Application suite: 337/337 = 305 pre-existing + 32 tower.

## Exact gate outputs (at this Layer C commit; see the commit message for the recorded runs)

- `./node_modules/.bin/tsc -b packages/aurum-application packages/web` → exit 0 (root compiler; full `pnpm typecheck` OOMs on this box — Task-20 law)
- `pnpm fmt:check` → clean
- `pnpm lint` → 70 warnings / 0 errors (documented baseline)
- `pnpm architecture:check` → 0 violations (full and `-- --changed`)
- application 337/337; regression net: domain 111/111, provider 57/57, agent 29/29, execution 90/90, marketplace 82/82
