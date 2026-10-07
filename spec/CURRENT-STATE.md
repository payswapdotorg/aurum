# Aurum Rebuild Current State

Date: 2026-10-07 (updated ~06:15Z by the resident TL)

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
