# W013 — Outcome learning + conditional organizations: WORK-NOTES

Work item (spec/WORK-ITEM-CATALOG.md §W013): **join outcomes to context,
organization, actor allocation, model occupancy, information strategy,
environment and cost.** Owner W-A. Paths `packages/aurum-application/**`
learning plus outcome/calibration adapters. Deps W007+W008+W009 satisfied at
base 874faab (main = W000-W011 + W010 + P001 + P002 + CRs). Branch
`work/w013-outcome-learning`, local only (PAT dead; TL owns pushes). History:
30121ad (layers 1-3: domain join records + calibration + app service +
adapters + area contract) → f1cbcb3 (layer 4: 64 proofs + two source repairs
the proofs exposed) → this notes commit.

## File map (line counts, policy-clean: maxFileLines 400, contract 300, 12 methods/port)

| File                                  | Lines | Layer    | Role                                                                                                                                             |
| ------------------------------------- | ----: | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain/vocabulary.ts`                |    79 | domain   | frozen `OUTCOME_STATUSES` / `OUTCOME_SOURCE_KINDS` unions, failure classification, `CALIBRATION_LIMITS`, rule ids                                |
| `domain/records.ts`                   |   248 | domain   | `OutcomeObservation`, `RecordOutcomeInput`, the seven join-dimension types, `OutcomeJoinRecord`, `ConditionalEvidence`, `CalibratedSearchResult` |
| `domain/contextClass.ts`              |   135 | domain   | the CONDITIONING KEY: 4 categorical fingerprint axes + demand signature; canonical form + 16-hex digest; axis validation                         |
| `domain/shape.ts`                     |   113 | domain   | `OrganizationShape` — actor-mix histogram, oversight flag, automation class, edge histogram, information structure, env count                    |
| `domain/calibration.ts`               |   260 | domain   | pure `calibrateEvidence` (grouping, freshness at consumption time) + `applyConditionalCalibration` (same-class-only re-rank)                     |
| `domain/errors.ts`                    |    85 | domain   | `LearningError` namespace (5 codes: validation / not-found / join-refused / conflict / invariant)                                                |
| `domain/ports.ts`                     |    49 | domain   | READ-ONLY seam picks (evaluation view, candidate view, lab search) + the APPEND-ONLY `OutcomeStore` (put/get/list only)                          |
| `app/outcomeJoin.ts`                  |   317 | app      | `assembleOutcomeJoin` — join-integrity refusals + the seven verbatim dimension extractions                                                       |
| `app/learningService.ts`              |   149 | app      | 5-method facade: recordOutcome / getOutcome / listOutcomes / conditionalEvidence (anchor REQUIRED) / calibratedSearch                            |
| `adapters/in-memory-outcome-store.ts` |    43 | adapters | tenant-bucketed append-only reference store (duplicate id = typed conflict; uniform not-found)                                                   |
| `adapters/mission-outcome-source.ts`  |    40 | adapters | pure W007 `MissionRecord` → observation mapping (satisfied→achieved, gap→missed, unobserved→null)                                                |
| `adapters/plan-outcome-source.ts`     |    75 | adapters | pure W009 `ExecutionPlan`+completions → observation mapping (failed task→failed, cancelled→partial, unobserved→null)                             |
| `contract.learning.ts`                |    89 | contract | public surface; re-exported from `src/contract.ts` (the only cross-module seam touched outside learning/)                                        |

## Acceptance clauses → locking tests (64 proofs, 6 files + helpers)

1. **Lab learns conditional performance, not a universal best organization**
   — `test/learning-conditional.test.ts` (16): context class is a
   deterministic pure derivation (canonical form, capacity-excluded demand
   signature, class separation on EVERY categorical axis, typed refusal of
   malformed axes); organization shape histograms (actor mix sorted,
   oversight, automation buckets none/mixed/all, edge counts, flow structure,
   distinct environments, byte-stable shape keys); evidence groups key on
   (context class × shape) with bounded adjustments; evidence POOLS across
   strategies that compose the same shape; thin evidence scales linearly to
   the sample floor; calibrated search returns the base ranking VERBATIM when
   no evidence exists (rule + calibration-rule ids, coverage 0/N, adjustment
   0, ranks preserved); three learned failures FLIP the recommendation within
   the class (adjustment −0.5, adjusted score, independently recomputed
   expected order, calibratedRank > 1); **ISOLATION**: evidence learned under
   class A never crosses to class B (service AND pure application both
   coverage-0); the evidence query REQUIRES a context anchor (both/neither =
   typed validation refusal — there is no global evidence API); the query
   scopes to the requested class; byte-identical determinism; lab errors
   propagate through the facade verbatim.
2. **Failed outcomes become calibration evidence** —
   `test/learning-failures.test.ts` (8): failure detail (kind + detail +
   metric vs target) recorded verbatim on the join record; missed + failed
   both count as failures with their ids retained in the evidence chain;
   proven failures penalize at the asymmetric cap (−0.5) AND demote the shape
   on the calibrated search; proven successes boost at the SMALLER cap
   (+0.25 < 0.5 — asymmetric by design); mixed records adjust
   proportionally to the achieved rate; partial outcomes stay visible but
   outside the success rate; a failure detail on a non-failure status is a
   typed shape-law refusal; outcome freshness classifies with the W002
   vocabulary (pure `outcomeFreshnessOf`).
3. **Stale evidence is visible** — `test/learning-freshness.test.ts` (6):
   freshness is classified AT CONSUMPTION TIME (the same records are current
   at `now(0)` and stale at +45d, adjustment decaying −0.5 → −0.125 while
   every count stays); aging decays at the documented multipliers (0.5/0.25);
   stale groups keep sample/achieved/failed counts AND outcome ids fully
   visible (the evidence never disappears); the group freshness follows the
   MOST RECENT observation (an ancient failure stays counted in
   `staleSampleCount`); the calibrated search surfaces per-candidate
   evidence freshness + stale counts + decayed adjustment; unknown-freshness
   observations are conservative (decay 0.25, never silently fresh).

The JOIN deliver — `test/learning-join.test.ts` (17): all seven dimensions
carried verbatim (context incl. the P003 join keys — fingerprint digest +
axes, constraint set, weights, modifiers, ranking rule, rank + weighted score

- strategy at evaluation time; organization id + shape; actor allocation
  counts + effort totals; model occupancy entries/exclusivity/distinct
  bindings; information strategy flows + review + minimal context + tightest
  freshness; distinct sorted environments; cost = unit-table proxy +
  budget ceiling + observed actual); join integrity refuses with TYPED errors
  (candidate not ranked by that evaluation; fingerprint-stamp disagreement;
  uniform not-found for unknown AND foreign-tenant anchors — byte-identical
  messages); duplicate outcome id = append-only conflict; observation-shape
  validation matrix; listing filters; cross-tenant reads uniform; tenants'
  learned evidence fully separate.

Outcome sources + the full loop — `test/learning-sources.test.ts` (8):
mission source (satisfied → achieved with record-stage timestamp; knowledge
gap → MISSED with first-class failure detail; pending/cancelled → null) and
plan source (all-settled → achieved; failed settlement → FAILED carrying the
substrate failure kind/code verbatim; cancelled-without-failure → partial;
active/cancelled plan → null — **no fabricated outcomes for unobserved runs**),
all derived from REAL service-produced records; the closing journey:
lab search → candidate registered → real cognition mission over the same
kernel → observation joined to the evaluation context → conditional evidence
learned.

Contract hygiene — `test/learning-contract-hygiene.test.ts` (9):
source-scan tripwires: no `@aurum/execution` (or any execution-seam) import
anywhere in `src/learning`; the service surface is EXACTLY the five learning
methods; no execution-shaped export names; the ports are read-only picks and
the outcome store port is put/get/list ONLY (no update, no delete — the
append-only law is structural); THE CONDITIONAL LAW structural form (the
evidence query type carries the two anchor options + now; no
global-evidence/best-organization identifiers); no kernel in domain/app; the
domain layer is IO-free; `@aurum/domain` via package specifier only; no
lint-disable comments.

## Design rulings (constitution → code)

1. **The join is carried, never re-derived.** Every dimension is extracted
   verbatim from the records that chose and ran the organization (the lab
   evaluation + the W005 candidate value). The P003 join keys (fingerprint
   digest, constraint set, weights, ranking rule) survive on the outcome
   record so persistence can round-trip them byte-for-byte.
2. **Join integrity is typed refusal, never silent skip.** The candidate must
   appear in the evaluation's ranked list; a stamped candidate fingerprint
   must agree with the evaluation's digest; missing/foreign anchors are the
   uniform `learning-not-found` (no tenant existence leaks). A wrong join is
   an error, not a partial record.
3. **The conditioning key is (context class × organization shape).** The
   class reuses the W008 fingerprint axes (no second context vocabulary):
   four categorical axes verbatim + a demand SIGNATURE (sorted
   `capabilityId:level` pairs). Ruling: per-period capacity numbers are
   continuous and would fragment the evidence space into single-sample
   classes. The shape is a coarse comparable signature of the organization
   (mix/oversight/automation/edges/flows/environments); identities, effort
   numbers, capability ids, cost and deadlines are join DIMENSIONS recorded
   verbatim, not conditioning keys — conditioning on identities would never
   generalize.
4. **Evidence never crosses context classes** (the conditional-performance
   law): `applyConditionalCalibration` consumes ONLY evidence whose class
   key equals the search's own class; `conditionalEvidence` REQUIRES a
   context anchor (fingerprint or class key — exactly one); there is no API
   surface that returns a global ranking. Tripwire-locked structurally and
   behaviorally.
5. **Failures are first-class.** `missed` + `failed` count into
   `failedCount`, their ids stay in `outcomeIds`, and the asymmetric caps
   make failures bite harder than successes help (−0.5 vs +0.25). `partial`
   is visible but neither success nor failure. The store is append-only:
   recorded outcomes (including failures) are never rewritten (duplicate id =
   typed conflict; no update/delete methods exist on the port).
6. **Freshness is classified at consumption time and only DECAYS.** The W002
   `classifyFreshness` runs with the CALLER's `now` (a record current
   yesterday is stale today — nothing is frozen at record time); staleness
   shrinks the directional weight but never removes counts or ids. Repair
   ruling (found by the proofs): the decay multiplies AFTER the clamp —
   applying it before made the decay a no-op whenever the raw adjustment sat
   at/past a cap (uniform records at the sample floor, the common case), so
   aging evidence bit exactly as hard as current evidence. Clamp-first
   guarantees decay always shrinks.
7. **The base ranking rule is preserved verbatim.** `CalibratedSearchResult`
   carries the W008 `rankingRule` untouched plus its own
   `calibrationRule` id; the re-ranking is adjusted-score-desc then
   candidate-id-asc (the W008 tiebreak discipline, unchanged); `baseRank`
   stays on every entry (what was adjusted is inspectable).
8. **Learning proposes and calibrates; it never executes.** The W008 lab law
   extends unchanged: no execution-plane import anywhere in `src/learning`
   (tripwire), read-only seam picks only, and the ONLY writes are the
   learning area's own append-only outcome records. Lab errors map into the
   learning namespace with verbatim issue lists (`mapLabError`).
9. **Outcome sources are pure record mappings.** The W007 mission and W009
   plan adapters take VALUES (no service handles); cancelled/in-flight runs
   observe NOTHING (null) — fabricating outcomes for unobserved runs would
   corrupt the calibration evidence.
10. **One digest authority.** Class keys and shape keys reuse the lab's
    `fingerprintDigest` (16-hex FNV-1a over canonical serializations with
    stable field order); determinism is byte-level (JSON-identical repeated
    searches, frozen arrays, codepoint-sorted groups).
11. **Error authority stays local.** `LearningError` (5 codes) mirrors the
    LabError/MissionError house pattern; the W002 `DomainErrorCode` union is
    NOT extended (no second authority over domain error semantics).

## Seam consumption map (cross-module via public contracts only)

| Seam                                                                          | Kind           | Used by                                 | How tested                                         |
| ----------------------------------------------------------------------------- | -------------- | --------------------------------------- | -------------------------------------------------- |
| `lab/contract.lab.js` `LabEvaluationStore.getEvaluation` (Pick)               | read           | app/outcomeJoin (context join)          | join proofs: verbatim context, uniform not-found   |
| `lab/contract.lab.js` `OrganizationalLab.searchOrganizations` (Pick)          | read           | app/learningService (calibrated search) | conditional proofs: base-verbatim, flip, isolation |
| `@aurum/domain` `OrganizationCandidateRegistry.getCandidate` (Pick)           | read           | app/outcomeJoin (organization join)     | join proofs: all organization-side dimensions      |
| `@aurum/domain` `TenantIndex`                                                 | (adapter util) | in-memory outcome store                 | append-only conflict, tenant isolation proofs      |
| `@aurum/domain` `classifyFreshness` + `DEFAULT_FRESHNESS_POLICY`              | pure           | domain/calibration                      | freshness suite (current/aging/stale/unknown)      |
| `@aurum/domain` `provenanceIssues`, `costProxyOf` (via lab contract)          | pure           | app/outcomeJoin                         | cost-dimension proof (unit table + premium)        |
| `cognition/contract.cognition.js` `MissionRecord` (type only)                 | type           | mission-outcome-source                  | source suite over REAL mission records             |
| `plans/contract.plans.js` `ExecutionPlan`, `TaskCompletionRecord` (type only) | type           | plan-outcome-source                     | source suite over REAL plan records                |

No `@aurum/execution` import exists anywhere in the learning module
(tripwire-locked). The kernel is never composed inside learning; the
`OutcomeLearningDeps` are satisfied by whatever composition owns the kernel
(the test fixture wires kernel + lab + learning over SHARED stores).

## Honest limitations

1. **In-memory outcome store.** The append-only outcome records live in
   `InMemoryOutcomeStore`; PostgreSQL persistence is the P003 work item
   (which depends on THIS one) behind the same `OutcomeStore` port. The
   domain/lab records the outcomes join to are real kernel/lab records in
   tests; the outcome records themselves are process-local.
2. **The calibration estimator is deliberately simple.** Linear sample
   weight to a fixed floor, fixed caps, one decay table, achieved-rate as
   the signal — no Bayesian updating, no per-metric regression, no
   cost-vs-budget conditioning in the adjustment (cost is RECORDED as a
   join dimension for future estimators). Everything is documented and
   deterministic; a richer estimator must still flow through the same
   `ConditionalEvidence` shape and the same conditional law.
3. **Manual observations are provenance-trusted.** `recordOutcome` accepts
   any `observedBy` actor with valid provenance — recording evidence is not
   an authority action; there is no role check on observers (an honest
   simplification the catalog accepts: outcomes are evidence, never
   authorization).
4. **Harvesting is pull-based.** The mission/plan source adapters are pure
   mappings the composition must CALL; no scheduler watches plans/missions
   for completion and records outcomes automatically (deliberately —
   triggering is composition/TL-owned; W012 desktop and the P-series are the
   consumption points).
5. **`calibratedSearch` re-runs the full lab search per call** (no
   evaluation caching). Deterministic and fine in-memory; a caching layer
   is a persistence-lane concern (P003 retrieval paths).
6. **Group freshness is the most-recent stamp only.** `evidenceFreshness`
   summarizes the group by its latest observation; per-outcome freshness is
   derivable via `outcomeFreshnessOf` but the group surface carries only
   the aggregate `staleSampleCount` (documented; fine for ranking purposes).
7. **Class keys are digest-stable, not migration-stable.** A future W008
   axis change shifts every class key and severs evidence continuity (old
   outcomes simply stop matching new classes — they remain visible and
   listed, but stop conditioning searches). Accepted: classes identify
   classes of situations, not moments; no migration path is offered.
8. **maxFileLines headroom** on `app/outcomeJoin.ts` (317/400) and
   `domain/calibration.ts` (260/400) is comfortable; further dimension
   extraction should split before nearing the cap. Test files exceed 400
   lines (558/553) — the policy caps module sources, matching the existing
   test corpus (plans-service 720 on main).
9. **Tenant-isolation sweep/manifest registrations are TL-owned** (same as
   W007/W010: the rebuild has no cross-package isolation sweep yet);
   isolation is proven in-module (byte-identical foreign/missing across
   record/get/list + evidence separation).
10. **No UI/control-tower surface.** The learning service is consumed by
    composition (the tower's Lab board shows the W008 search today);
    surfacing calibrated rankings/evidence in the tower is a follow-up for
    the W014/W015 consumers, not this work item.

## Test inventory (64 proofs)

- `learning-join.test.ts` — 17 (the JOIN deliver + integrity + isolation)
- `learning-conditional.test.ts` — 16 (clause 1 + determinism)
- `learning-failures.test.ts` — 8 (clause 2)
- `learning-freshness.test.ts` — 6 (clause 3)
- `learning-sources.test.ts` — 8 (sources + the full loop)
- `learning-contract-hygiene.test.ts` — 9 (structural tripwires)
- `learning-helpers.ts` — shared fixtures (not a test file)

## Exact gate outputs (at f1cbcb3 + this notes commit)

- `./node_modules/.bin/tsc -b packages/aurum-application` → exit 0 (full
  `pnpm typecheck` OOMs on this 3.9GB box — scoped form per Task-20 law)
- `pnpm fmt:check` → "All matched files use the correct format." (3418 files)
- `pnpm lint` → "Found 70 warnings and 0 errors." (documented baseline,
  byte-identical)
- `pnpm architecture:check` → "architecture: OK / violations: 0 / baseline:
  0 / new: 0" (also with `-- --changed`: identical)
- `./node_modules/.bin/vitest run packages/aurum-application` → Test Files
  35 passed (35), Tests 401 passed (401) — 337 pre-existing + 64 learning
- Neighbors (untouched, regression net): domain 111/111, provider 57/57,
  agent 29/29, execution 90/90, marketplace 82/82, infra 140/140
