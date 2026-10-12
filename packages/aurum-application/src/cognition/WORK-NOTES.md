# W007 — Cognition + learning missions: WORK-NOTES

Work item (spec/WORK-ITEM-CATALOG.md §W007): **explicit asynchronous/resumable
canonical intelligence loop.** Owner W-A. Paths `packages/aurum-application/**`
cognition/mission implementation. Deps W003+W004+W005 satisfied at base
32cf743. Branch `work/w007-cognition-missions`, local only (PAT dead; TL owns
pushes). History: 9e84fb7 (domain + app loop + adapters + contract) → 827e0df
(proof-pass hardening) → d985112 (69 acceptance proofs) → this notes commit.

## File map (line counts, policy-clean: maxFileLines 400, contract 300, 12 methods/port)

| File                                  | Lines | Layer    | Role                                                                                                                           |
| ------------------------------------- | ----: | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `domain/vocabulary.ts`                |   135 | domain   | frozen `MISSION_STAGES` machine, statuses, dispositions, effect kinds, proposal kinds, gap origins, `MISSION_BOUNDS` caps      |
| `domain/records.ts`                   |   218 | domain   | `MissionRecord`, charter, six discriminated stage-record types, effect manifest, outcome                                       |
| `domain/bounded.ts`                   |   338 | domain   | `ReasoningRequest` digest + `ReasonedContent` schema + pure `reasonedContentIssues` validator (anti-fabrication citation gate) |
| `domain/errors.ts`                    |   129 | domain   | `MissionError` namespace (7 codes), exhaustive `mapDomainError`                                                                |
| `domain/ports.ts`                     |   124 | domain   | read/knowledge seam picks, `MissionAuthorityGate` (propose/recommend/get ONLY), `ReasoningPort`, `MissionStore`, service deps  |
| `domain/effects.ts`                   |   149 | domain   | pure `deriveEffectManifest`, deterministic `<missionId>:<kind>-<index>` effect ids                                             |
| `app/cognitionService.ts`             |   385 | app      | 7-method service; `advance` = ONE journal-derived stage; in-flight guard; idempotent `runToCompletion` driver                  |
| `app/orient.ts`                       |   168 | app      | read-only orientation assembly (retraction filter, per-kind caps, truncation counts), bounded request projection               |
| `app/evaluate.ts`                     |   142 | app      | pure epistemic/goal/unknown evaluation; freshness-admission; honest disposition                                                |
| `app/apply.ts`                        |   355 | app      | idempotent propose/gate/record appliers (check-then-create, crash-window tolerance, provenance notes)                          |
| `app/trajectory.ts`                   |   149 | app      | `missionTrajectoryOf` — evidence-chain reconstruction from the mission record alone                                            |
| `app/serviceInputs.ts`                |    91 | app      | shared input validation + index-checked journal guards                                                                         |
| `adapters/in-memory-mission-store.ts` |    51 | adapters | tenant-bucketed reference store (uniform not-found)                                                                            |
| `adapters/scripted-reasoner.ts`       |    60 | adapters | deterministic `ReasoningPort` double (queued scripts, call recording)                                                          |
| `adapters/kernel-cognition-seams.ts`  |    49 | adapters | kernel wiring; the authority pick is propose/recommend/get                                                                     |
| `contract.cognition.ts`               |   145 | contract | public surface; re-exported from `src/contract.ts` (the only cross-module seam touched outside cognition/)                     |

## Acceptance clauses → locking tests (69 proofs, 7 files)

1. **Stage order is application-owned** — `test/cognition-stage-order.test.ts`
   (8): fixed six-stage sequence frozen (`Object.isFrozen` tripwire); journal
   walks orient→reason→evaluate→propose→gate→record one stage per `advance`,
   `stageIndex == position`; the next stage is DERIVED from journal length
   (there is no stage input anywhere on the surface); zero-content model
   output still walks all six stages (the model cannot influence the
   sequence); terminal refusal (`mission-state`); cancellation preserves the
   journal and stops the loop; `runToCompletion` is a driver over `advance`.
2. **LLM supplies bounded content** — `test/cognition-bounded-content.test.ts`
   (13): whitelist schema — extra top-level fields (incl. literal `stage` and
   `authorize`) refused `mission-model-refused`; ANTI-FABRICATION: findings may
   only cite observation ids present in the bounded request (invented ids AND
   retracted observations — which never orient — both refused); caps enforced
   per collection and per string; bounded REQUEST side (12-observation cap,
   honest truncation counts, no domain records: no provenance/stateHistory/
   personId in the serialized request); port errors propagate typed and the
   reason stage re-invokes on resume.
3. **Every consequential action enters authority gate** —
   `test/cognition-authority-gate.test.ts` (6): every reasoned proposal becomes
   an `ActionRecord` via `proposeAction` → `recommendAction` and STOPS at
   `recommended`; `employmentImpacting: false` always (missions cannot supply
   the human decision approval of impacting actions would demand); the
   remaining path is human-only (role-held person approves+authorizes via the
   kernel directly; role-less person refused `forbidden`); an externally
   advanced action is observed, never re-driven; a gate refusal is typed
   `mission-authority-refused` and the mission stays resumable at gate; zero
   proposals → zero action records.
4. **Evidence chain is reconstructable** — `test/cognition-evidence-chain.test.ts`
   (9): `missionTrajectory` rebuilds stage-by-stage trajectories with effect
   target ids purely from the mission record; every chain target verified
   against the real kernel (claims: active, citing real observations, provenance
   note `mission=<id>;stage=<stage>;effect=<effectId>`; unknowns: open, audited
   `unknown.raised`; belief: first revision resting on the mission's claims;
   memory: carries the disposition, audited `memory.revised`; actions:
   `recommended`, audited `action.recommended` by `aurum-cognition`); unique
   effect ids; empty-prefix trajectory for pending missions.

Resumability law — `test/cognition-resumability.test.ts` (8): resume from EVERY
stage boundary (0..6) converges byte-identical domain footprint (claims×2,
belief×1, unknowns×0, action×1, memory×1); crash-window proofs for claims /
actions / memory (a domain write whose journal append was lost is SKIPPED on
replay — single claim/belief revision/state history/memory version); concurrent
double-advance refused (`mission-conflict`, in-flight guard); two missions
independent; uniform tenant isolation (foreign-tenant get/advance/trajectory
byte-identical to missing; foreign tenant sees no footprint).

Contract hygiene — `test/cognition-contract-hygiene.test.ts` (10): source-scan
tripwires: no `.approveAction(`/`authorizeAction`/`recordExecution`/
`rejectAction` (call OR pick syntax) anywhere in `src/cognition`; gate port =
propose/recommend/get only; no `@aurum/execution`/`@zcode/shared`/
`@aurum/provider`/`@aurum/agent`/openai/anthropic imports; cognition domain
IO-free (no `node:`, no fetch/timers); `@aurum/domain` via package specifier
only (deep imports refused); `ReasonedContent` interface carries no
control-flow field and the runtime whitelist is exactly the five bounded
fields; the service surface is exactly the seven loop operations; the public
surface exports no execution-shaped capability (name tripwire
run/submit/execute/authorize/...); no lint-disable comments; the stage
machine constant is frozen at six stages.

Service behaviors — `test/cognition-service.test.ts` (15): createMission
validation matrix (ids/subjects/question/consequence/actor/clock); duplicate
mission-id conflict; closed-failure goal linkage (unknown goal =
`mission-subject-not-found`, byte-identical for any unknown id); goal-oriented
orientation + honest `goalAddressed` (false when expected evidence points
elsewhere); orientation honesty (caps + truncation counts, subject-linked
unknown filtering, retracted evidence excluded); mixed-freshness admission
(current admitted / stale → re-verify gap, not a claim); no belief without an
admitted claim; cancel semantics (preserves journal, refuses double-cancel
`mission-conflict` and cancel-after-complete `mission-state`); `advance`
validates its clock and closed-fails on unknown missions; listing with status
filter; errors are typed `MissionError`s.

## Design rulings (constitution → code)

1. **The journal IS the resumability mechanism.** `MissionRecord.stages` is an
   append-only, discriminated-by-position journal; the next stage is always
   `MISSION_STAGES[stages.length]`. No stage argument exists on any public
   method — callers and models cannot choose order.
2. **One stage per `advance`.** Each call executes exactly one stage and
   appends exactly one record; `runToCompletion` is a driver loop (and is
   idempotent: terminal missions return as-is — a caller crash after the last
   advance re-runs it without error or re-write).
3. **Deterministic effect ids** (`<missionId>:<kind>-<index>`) derived purely
   from (missionId, kind, index). Re-execution regenerates identical ids;
   appliers are check-then-create, so replay converges without duplicate
   semantic writes. A `conflict` on create is the crash window: re-`get`
   confirms and skips.
4. **The model boundary is one narrow port.** `ReasoningPort` receives a
   bounded digest (never domain records) and returns only `ReasonedContent`;
   validation is a pure function applied defensively regardless of adapter;
   the reason record persists request + content + adapter name (which model
   produced what). No provider SDK type anywhere; the scripted reasoner is
   the deterministic double; a real adapter later lives in the adapters layer
   and keeps SDK types private.
5. **Cognition proposes; humans dispose.** The authority gate pick is
   `proposeAction | recommendAction | getAction` — structurally absent:
   approve/authorize/recordExecution/reject. Recommendation is analysis-grade
   (any actor may recommend, per the kernel); approval/authorization stay
   kernel-enforced human-only role decisions.
6. **Honesty rulings in evaluation:** only current/aging-backed findings are
   admitted as claims; stale/unknown-backed findings become explicit
   re-verification gaps; pre-existing unknowns are carried as gaps but never
   re-raised; no belief without at least one admitted claim; disposition is
   `knowledge-gap-remains` when any gap remains OR nothing was admitted.
7. **Employment-impacting is always false** on mission-proposed actions — the
   mission cannot supply the recorded human decision such approval demands.
8. **Mission writes are all CREATES with deterministic ids** (claim / unknown /
   first-revision belief / first-version memory) — the idempotency contract.
   Externally advanced actions are observed (`finalState` journaled), never
   pulled back or re-driven.
9. **Error authority:** the cognition namespace is local (`MissionError`, 7
   codes); the W002 `DomainErrorCode` union is NOT extended; `mapDomainError`
   is an exhaustive no-default switch (a new kernel code fails compilation
   here) with `MissionError` passthrough (no double-wrap). Foreign-tenant and
   missing records are byte-identical `mission-not-found`.
10. **IO discipline:** domain layer pure (tripwire-locked); the service takes
    `now` as an input (deterministic clocks); stores and reasoning are ports
    with in-memory/scripted reference adapters. PostgreSQL mission storage is
    P-series debt behind `MissionStore`.

## Kernel seam consumption map (all via `@aurum/domain` public entrypoint)

| Seam                                                          | Used by                                              | How tested                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `GoalLedger.getGoal`                                          | orient (goal summary), createMission (linkage check) | service tests: goal linkage, goalAddressed honesty                        |
| `EvidenceLedger.getObservation`/`listObservations`            | orient (active observations)                         | orientation caps/truncation, retraction exclusion, anti-fabrication       |
| `EpistemicsLedger.listBeliefs`                                | orient (current beliefs)                             | bounded request shape test                                                |
| `EpistemicsLedger.registerClaim`/`getClaim`                   | propose (claims)                                     | resumability footprint + crash-window skip                                |
| `EpistemicsLedger.reviseBelief`/`getBelief`                   | propose (first-revision belief)                      | belief verifiability, no-belief-without-claims                            |
| `InquiryLedger.listOpenUnknowns`/`listOpenContradictions`     | orient (subject-linked open items)                   | linkage filter test, pre-existing-unknown handling                        |
| `InquiryLedger.raiseUnknown`/`getUnknown`                     | propose (new unknowns)                               | unknown verifiability + audit trail                                       |
| `OrganizationalMemory.listMemory`                             | orient (current memory)                              | bounded request shape test                                                |
| `OrganizationalMemory.recordMemory`/`getMemory`               | record (learning memory)                             | memory verifiability + crash-window single version                        |
| `ActionAuthority.proposeAction`/`recommendAction`/`getAction` | gate                                                 | authority-gate suite (stops at recommended), evidence-chain action proofs |
| `AuditTrail.queryAudit`                                       | tests only (inspector reconstruction)                | evidence-chain audit assertions                                           |

Structural picks only — the composed kernel satisfies the seams directly
(`adapters/kernel-cognition-seams.ts`); no behavior is re-implemented.

## Honest limitations

1. **In-memory mission store.** The mission record (charter + journal +
   status) lives in `InMemoryMissionStore`; PostgreSQL persistence is P-series
   debt behind the same `MissionStore` port. Domain-side effects (claims,
   unknowns, beliefs, actions, memory) ARE real kernel records.
2. **In-flight guard is process-local.** The concurrent-advance guard is a
   `Set` in the service instance — cross-process concurrency needs the store/
   lock layer (P-series). The crash-window proofs cover the
   write-landed-journal-lost case; the journal-landed-write-lost case cannot
   happen (journal append follows the writes within one `advance`).
3. **Scripted reasoner is the only reasoning adapter.** Real provider-plane
   adapters (W003 fabric) land with the provider wiring; the port contract,
   bounded schema and refusal semantics are final. `modelName` on the reason
   record is the adapter-declared name.
4. **No scheduler/queue.** "Asynchronous" here means explicitly resumable —
   each `advance` is a unit of work a caller/queue may drive; no timer,
   poller or background loop exists in this module (deliberately — the app
   composition/TL owns triggering).
5. **Evaluate does not re-read the domain.** The evaluation is a pure function
   of the journaled orientation + content + `now` (deterministic replay). A
   domain state change between orient and evaluate is NOT seen — by design
   (journal-derived determinism); a new mission is the refresh path.
6. **No mission listing beyond status filter** (`MissionFilter.status` only);
   richer queries are composition-owned projections.
7. **Goal removal mid-mission is not re-validated** after createMission (the
   goal was validated at creation; orient re-reads it and closed-fails if it
   disappears — covered by the not-found mapping, but no dedicated proof).
8. **maxFileLines headroom is thin** on `cognitionService.ts` (385/400) and
   `apply.ts` (355/400); further growth should split before hitting the cap.
9. **Tenant-isolation sweep/manifest registrations are TL-owned** (the
   in-repo manifest/sweep infra of the prior lineage does not exist in this
   rebuild yet); isolation is proven in-module (byte-identical foreign/missing
   across get/advance/trajectory/list + no kernel footprint).
10. **No UI/control-tower surface.** W010 (control tower + conversation)
    consumes this service; nothing here renders or exposes HTTP.

## Test inventory (69 proofs)

- `cognition-stage-order.test.ts` — 8 (clause 1)
- `cognition-bounded-content.test.ts` — 13 (clause 2)
- `cognition-authority-gate.test.ts` — 6 (clause 3)
- `cognition-evidence-chain.test.ts` — 9 (clause 4)
- `cognition-resumability.test.ts` — 8 (resumability law)
- `cognition-contract-hygiene.test.ts` — 10 (structural tripwires)
- `cognition-service.test.ts` — 15 (service behaviors)
- `cognition-helpers.ts` — shared fixtures (not a test file)

## Exact gate outputs (at d985112 + notes commit)

- `./node_modules/.bin/tsc -b packages/aurum-application` → exit 0 (`TYPECHECK_OK`; full `pnpm typecheck` OOMs on this 3.9GB box — scoped form per Task-20 law)
- `pnpm fmt:check` → "All matched files use the correct format." (3311 files)
- `pnpm lint` → "Found 70 warnings and 0 errors." (documented baseline, byte-identical)
- `pnpm architecture:check` → "architecture: OK / violations: 0 / baseline: 0 / new: 0" (also with `-- --changed`: identical)
- `cd packages/aurum-application && npx vitest run` → Test Files 25 passed (25), Tests 305 passed (305) — 236 pre-existing + 69 cognition
- Neighbors (untouched, regression net): domain 111/111 (17 files), provider 57/57 (8), agent 29/29 (6), execution 90/90 (9), marketplace 82/82 (7)
