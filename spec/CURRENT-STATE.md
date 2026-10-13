# Aurum Rebuild Current State

Date: 2026-10-11 (updated ~06:00Z by the resident TL)

Repository: payswapdotorg/aurum
Canonical branch: main
ZCode baseline: 29628c9acdb81b703bbd4080c207a0e7ce5e276e
Current integration SHA: see git log of main (W000 → 3477e3c → 20abfba → b1dab63 → 20db9ec lineage)

feat/ui-plugin is non-canonical until independently evaluated.

## Foundation (W000) — COMPLETE

- PR #1 (rebuild/architecture-foundation-2026-10-07, foundation 55babf8 + TL format
  repair eaa528b) merged → main 3477e3c. CI green at merge.
- TL scaffold 20abfba: all eight packages/aurum-\* pre-seeded (package.json with
  vitest+typescript, strict self-contained tsconfig, src/module.ts manifest mirroring
  architecture-policy.yaml requires, src/contract.ts placeholder, src/index.ts
  re-export); root typecheck builds all eight; pnpm-lock.yaml updated once by the TL.
  Rationale: three parallel Wave-1 workers would otherwise all mutate the lockfile.
  CI green.

## Wave 1 status

- W002 Aurum domain kernel — DELIVERED + MERGED (main 20db9ec).
  Worker delivery 46fd095 (base 20abfba), 5 commits, 67 files, +6680.
  TL independent verification: scope clean (aurum-domain only); frozen-lockfile
  install OK; freshness ahead 7/behind 0; fmt clean (3105 files); lint 0 errors
  (70 pre-existing warnings); architecture 0 violations (full and --changed);
  package tsc -b 0 errors; tests 64/64 (11 files; every test imports only the
  public contract boundary). Acceptance proven: two-tenant isolation (uniform
  not-found, byte-identical foreign-vs-never-existing errors), immutability
  (append-only histories, deep-frozen mutation throws), contradiction retention
  (no auto-resolution), unknown-explicitness, freshness classification, typed
  errors. Kernel is a pure in-memory state machine by design (persistence is
  later work per the catalog).

- W003 Provider Fabric + Agent Body — DELIVERED + MERGED (main b1dab63).
  Worker delivery b253616 (base 20abfba), 1 commit, 65 files, +6658.
  TL independent verification: scope clean (aurum-provider/aurum-agent only,
  plus pnpm-lock.yaml +4 = the mechanically-required @aurum/provider workspace
  link and spec/contract-requests/CR-W003-tenant-vocabulary.md); gates all
  green; tests 57/57 (provider) + 27/27 (agent) including byte-for-byte
  AgentBody identity across model swaps (including updatedAt), append-only
  binding ledger, unanchored credential sanitization, catalog≠availability,
  two-tenant isolation. Honest limitations registered by the worker: fixture
  transport doubles only (no live providers by design), in-memory reference
  stores, no background health prober.

- W001 ZCode substrate hardening — DISPATCH BLOCKED (platform-side).
  Four dispatch attempts + a minimal diagnostic all landed prompts but never
  spawned assistant turns; server-side chat records remain empty (phantom
  shells). Root cause class: account agent-generation quota drain (the
  documented daily-reset window is 05:38Z–09:36Z; home-composer sends also
  gate, confirming the account-level state). One clean re-dispatch is staged
  and will fire when the quota resets. No code exists yet for W001; W004/W006
  (which depend on it) are queued behind it.

## Contract requests

- CR-W003-tenant-vocabulary (open): W-C requests a canonical TenantId (and
  eventually evidence-reference vocabulary) from aurum-domain (W-B) to remove
  the single documented cast in aurum-agent's provider-fabric-lookup adapter.
  Resolution belongs to W005 (the next aurum-domain work item).

## Verification protocol in force

Every delivery is verified by the TL against the actual tree (never worker
summaries): fetch → scope check → frozen-lockfile install → workspace
freshness → fmt:check → lint → architecture:check --changed (and full) →
package-level tsc -b → every aurum package test suite (regression net) →
integration-branch merge → main push → GitHub CI green on the exact SHA →
record. Logs: replay deployment scripts/worker-prompts/logs/ (TL station).

## Next actions

1. On quota reset: re-dispatch W001 (Worker A) and dispatch W005 (Worker B;
   deps W002 ✓). W006 (Worker C) queues behind W001.
2. Resolve CR-W003 within W005 review.
3. Wave 2 remainder (W004, W006) as dependencies complete; then Waves 3-6
   per WORK-ITEM-DAG.

The status above is derived from source, tests, integrated SHAs and evidence.

## Wave 2 (W005) — MERGED (2026-10-07 20:22Z)

- W005 "Process/capability/workforce + organization contracts" DELIVERED on
  work/w005-process-workforce @ 6489b5b (2 commits, 41 files, +6415/-8:
  process/capability/workforce semantics + the shared OrganizationCandidate/
  ActorAssignment/CapabilityAllocation vocabulary extending the W002 kernel;
  4 test suites — process, workforce, workforce-recommendations, w005-acceptance).
- TL verification (never trusting the worker summary): scope clean (all within
  packages/aurum-domain/\*\*), freshness/fmt/lint/architecture PASS, package
  suites aurum-domain 111/111, aurum-provider 57/57, aurum-agent 27/27.
- MERGED: main -> a345707 (ff-only integration/W005). CI green expected on push.
- Delivery context (platform honesty): delivered through three GLM-5.3 capacity
  sieges — a mid-flight stream kill cured in-place (§8 stop/continue, zero
  narrative loss), a 3.7h queued-turn freeze, and a stalled final push that
  self-resumed during a capacity flicker.
- Wave 3 W008 (Organizational Lab core) dispatched at base a345707.

Current integration lineage: W000 -> 3477e3c -> 20abfba -> b1dab63 -> 20db9ec
-> 8024c15 -> a345707 (W005).

## 2026-10-11 session (resident TL, continuous watch)

Integration lineage extended: ... a345707 (W005) -> efddf942 (docs) -> c639eff
(TL format repair; CI-red fix: oxfmt on this file) -> 18d0ed6 (P-series specs) ->
1eaee9f (W001 merged) -> 4e8b35d (CR-W001 wiring, PR #2) -> c02429c (CR docs) ->
7c1dafa (W008 merged). All CI green on exact SHAs.

- W001 ZCode substrate hardening — DELIVERED + MERGED (main 1eaee9f).
  Worker delivery 9640218 (base c639eff), 2 commits, 14 files, +1413.
  TL verification: scope clean (packages/shared/\*\* + the allowed CR file);
  frozen install; fmt; lint 0 err; architecture 0 viol (changed + full);
  scoped tsc 0 err; shared 14/14 (leakage tripwires + consumer fixtures);
  regression net domain 111/111 provider 57/57 agent 27/27. The
  aurum-boundary surface ships as a `./aurum-boundary` subpath export.
  CR-W001-rpc-envelope-reexport EXECUTED by the TL (PR #2, 4e8b35d):
  workspace link + lockfile entry + type-only re-export + rpc tsconfig
  project-reference (required — without it typecheck drags shared source
  into rpc's compile context; client->rpc references pattern).
- W008 Organizational Lab core — DELIVERED + MERGED (main 7c1dafa).
  Worker delivery 5a9ff94 (base 18d0ed6), 2 commits, 25 files, +~3900:
  lab domain/app/adapters layering, contract.lab.ts public surface,
  in-memory evaluation store, and 55 test-locked proofs (fingerprint
  determinism, ranking determinism + inspectability, allocation issue
  gating, contextual rule end-to-end, tenant isolation, Lab-cannot-execute
  tripwire, contract hygiene). TL verification: all gates green (fmt, lint
  0 err, architecture 0 viol, application 55/55, regression net intact).
  Delivery context honesty: the session survived multiple GLM-5.3 capacity
  sieges; implementation and tests were pushed as separate commits across
  stream stalls (sandbox execution continues while chat streams freeze —
  recorded as a standing operational lesson).
- P-series (persistence lane) added to WORK-ITEM-CATALOG + WORK-ITEM-DAG
  (18d0ed6): P001 domain storage [W002,W005], P002 fabric storage
  [W003,P001], P003 lab/application storage [W008,W013,P001,P002].
  PostgreSQL semantic authority must not trail in-memory semantics by more
  than one integrated wave; P-workers reuse the P001 machinery.
- Operational lessons (2026-10-11, binding for dispatch diagnosis):
  1. Agent sandboxes execute INDEPENDENTLY of chat message streams — a
     session with server msgs=1/batch=0 can have a live, working sandbox;
     the reliable liveness signals are DOM command output and branch
     pushes, never the chat record alone.
  2. True phantoms (no DOM commands, no pushes, 45+ min) are re-dispatched
     at the account quota-reset window, not before.
  3. Queue-watch auto-re-dispatch after tab churn can duplicate a session
     whose sandbox ALREADY delivered — void the duplicate before it races
     the delivered branch.

## In flight (as of 06:00Z)

- W004 Company query/intelligence (A lane) — re-dispatched (quota window),
  queued server-side.
- W006 Agent Gateway/execution (C lane) — re-dispatched, queued.
- P001 Domain kernel PostgreSQL persistence (B lane) — dispatched, queued.
- CR-W003 migration packet staged for the C lane after W006 lands.

## Next actions

1. Harvest W004/W006/P001 when their sandboxes push; verify per protocol;
   merge on green CI.
2. Dispatch W007 (deps W003+W004+W005) and W009 (deps W005+W006) as their
   gates complete; CR-W003 to C after W006.
3. P002 (fabric storage) after P001 lands; P003 after W013.
4. Waves 4-6 per WORK-ITEM-DAG; P-series parallel per its own rule.

## 2026-10-13 session (resident TL, continuous watch — replay fixed)

Integration lineage extended: ... bf2ac8a (CR-W011) -> 32cf743 (TL repair) ->
1740f64 (W007) -> 5440775 (P001). All verification local (PAT dead — see
Blocked); CI verification resumes with push capability.

- REPLAY FIX (the standing order): the replayed session state carried the
  pre-rebuild lineage (W135/W136 era, banked bundle) as if current. GitHub
  authority check: no common ancestor, no such branches remotely. All
  pre-rebuild records marked as such; the GitHub repo is the sole roadmap
  guide. The banked pre-rebuild lineage is preserved locally as
  pre-rebuild-bank-256d5bb.
- TL REPAIR 32cf743: aurum-application at bf2ac8a had 1 failed test — the
  W004-redo/CR-W009 merge seam (company contract-hygiene asserted the 1-dep
  surface after CR-W009 had wired the 3-dep surface). CI never saw it (the
  workflow runs fmt/lint/typecheck/arch only — no test suites). Fixed by
  mirroring the CR-W009 precedent; 236/236 restored. CI blind spot recorded
  as an operational lesson: merges must re-run the target package suites ON
  THE MERGE COMMIT, not only on the branch tip.
- W007 Cognition + learning missions — DELIVERED + MERGED (main 1740f64).
  Worker delivery fcdc3e1 (base 32cf743) via a deadline-killed D1 (banked
  9e84fb7) + finisher chain. 26 files +4885/-5, all within
  aurum-application. 69 proofs across 7 files: application-owned six-stage
  machine, bounded-content whitelist + anti-fabrication citation gate,
  authority gate propose/recommend-only, evidence-chain reconstruction,
  resumability at every boundary, structural tripwires. TL independently
  verified all gates + regression net (application 305/305, domain 111,
  provider 57, agent 29, execution 90, marketplace 82). Honest limitations:
  in-memory MissionStore (P-series debt), process-local in-flight guard,
  scripted reasoner only, no scheduler, no UI (W010 consumes).
- P001 Domain kernel PostgreSQL persistence — DELIVERED + MERGED (main
  5440775). Worker delivery a63d74a via a NINE-dispatch chain (D1-D9) under
  repeated deadline kills — the commit-early law held throughout; the TL
  banked each kill's uncommitted state and re-dispatched continuations.
  59 files +14564/-3: the P-series machinery (WriteJournal, content-hashed
  migration runner, PGlite harness, aurum_reject_mutation DB trigger) +
  twelve migrations (34 domain tables + journal + registry) covering every
  kernel store + adapters mirroring in-memory semantics issue-for-issue +
  95 proofs across 13 files (round-trip equivalence, tenant isolation
  identical-to-missing, raw UPDATE/DELETE rejected, history rewrite
  rejected, journal keys stable, audit equivalence). Domain suite 111/111
  UNCHANGED — the type-level-only port extraction law held. CR-P001 RESOLVED
  by the TL at integration (@aurum/domain workspace link + lockfile entry +
  both interim bridges removed). Honest limitations in WORK-NOTES: the
  single-connection PGlite harness cannot prove concurrent FOR UPDATE races
  (structural); real-PostgreSQL integration remains the only close.
- OPERATIONAL LESSONS (2026-10-13, binding):
  1. The Bash shell CWD silently resets between calls — every command must
     be wrapped bash -c 'cd <repo> && ...'. A CWD-reset once pointed
     the wrong repo's remote at aurum; caught and repaired before damage.
  2. Per-package npx tsc resolves NESTED typescript 5.9 for aurum-\* packages
     and produces phantom errors against TS-6 substrate sources — always
     typecheck via the root compiler (./node_modules/.bin/tsc -b <pkgs>).
  3. Full root pnpm typecheck OOMs on the 3.9GB TL box — scoped batches
     only; CI remains the full gate.
  4. After merging a lockfile-touching CR, the main checkout needs its own
     pnpm install to materialize the new workspace links.
  5. Dispatch timeouts ("context deadline exceeded") are wait-timeouts, not
     spawn failures — the sandbox keeps executing. NEVER re-dispatch while
     processes live; poll, bank the kill's uncommitted state, then
     continue.

## Roadmap state after this session

Merged: W000-W006, W008, W009, W011, W007, P001 (+ CR-W001/W003/W009/W011,
CR-P001, the 32cf743 repair). Remaining: W010 [deps met: W001+W004+W007],
W012 [W010], W013 [deps met: W007+W008+W009], W014 [W013], W015
[W012+W013+W014], P002 [deps met: W003+P001], P003 [W013+P001+P002].

## In flight (as of 2026-10-13 ~03:30Z)

- None — the TL is dispatching the next wave now: W010 (control tower,
  paths overlap with W013 inside aurum-application — sequenced: W010 first),
  P002 (fabric storage on the P001 machinery).

## Next actions

1. Dispatch W010 + P002; harvest/verify/merge per protocol.
2. W013 after W010 lands (application-path overlap); W012 after W010;
   W014 after W013; P003 after W013+P002.
3. W015 certification last; pushes resume when the operator re-provisions
   the PAT (push queue: origin/main bf2ac8a -> 5440775).

## Blocked on operator

- GitHub PAT re-provision (the entire push queue; the banked token is
  invalid — 401 verified). Bank: git bundle of main refreshed at each
  promote under my-project/download/.

---

# 2026-10-13 (updated 20:36Z by the resident TL) — ROADMAP COMPLETE

Integration SHA: **7088b9c** (W015 certification commit; certified tree 68f2797).
Pushed to origin/main. All gates green at the certification commit: tsc 0,
fmt clean, lint 70 warnings / 0 errors (exact baseline), architecture 0
violations (full + changed), **1073 tests / 0 failures** (application 471
incl. 5 golden-journey evidence runs, domain 111, infra 166 incl. 26 PGlite
application-storage proofs, provider 57, agent 29, execution 90,
marketplace 148 incl. 66 emergence proofs).

## The frozen DAG — closed

- W000–W014: **all merged** (W012 continuity, W014 emergent roles/packages
  delivered 2026-10-13 evening — narrative-harvest recoveries after the
  platform recycled the worker pods mid-delivery; provenance + TL repair
  registers itemized in commits f52c2b8 / b8fc80d / 9821277).
- P001 + P002 + P003: **all merged** (P003 lab/application PG storage
  delivered same evening; CR-P003 executed by the TL).
- W015: **certified** — tests/evidence/w015/CERTIFICATION.md (the seven
  constitution golden journeys at the exact SHA, full fixture disclosure,
  honest open deployment-evidence leg).

## Open items (post-roadmap)

- CR-W012-desktop, CR-W012-cli, CR-W014: lockfile/bridge follow-ups as
  their filings describe (TL-owned lockfile edits when taken).
- The banked zcode-cli cross-process resume evidence script (Layer C
  runnable evidence) is recorded in the W012 WORK-NOTES limitations.
- Deployment/revision evidence: none (library monorepo, no deployment
  target) — disclosed in the W015 record.
