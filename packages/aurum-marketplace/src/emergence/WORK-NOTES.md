# W014 — Emergent roles + packages: WORK-NOTES

Work item (spec/WORK-ITEM-CATALOG.md §W014): **recurring gap detection and
governed role/package proposals.** Owner W-B. Paths
`packages/aurum-marketplace/**` role proposal and package proposal surfaces.
Deps W011 (marketplace/recruitment) + W013 (outcome learning) — both merged
at base `c00dd2f`. Branch `work/w014-emergent-roles`. History: `2de02a1`
(APPROACH first — rulings + layer plan) → layers 1-2 → `8b4c12c` (one source
repair found in self-review: the nested mirror) → proofs + CR + README →
this notes commit.

## File map (line counts, policy-clean: maxFileLines 400, contract 300)

| File                                             | Lines | Layer    | Role                                                                                                                          |
| ------------------------------------------------ | ----: | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `APPROACH.md`                                    |   208 | area     | the rulings (R1-R10) + layer plan, committed FIRST                                                                            |
| `domain/vocabulary.ts`                           |   117 | domain   | frozen signal kinds + proposal states/transitions + thresholds + rule ids + audit actions                                     |
| `domain/errors.ts`                               |   109 | domain   | `EmergenceError` namespace (7 codes incl. the dedicated `emergence-publication-refused`)                                      |
| `domain/evidence.ts`                             |   145 | domain   | the W013 STRUCTURAL MIRROR (outcome evidence + unknown signals + demand-signature parse)                                      |
| `domain/gaps.ts`                                 |  ~385 | domain   | pure `detectEmergenceGaps` — the five signals, verbatim citations, deterministic gap ids (`gap:v1` FNV-1a 16-hex)             |
| `domain/alternatives.ts`                         |   186 | domain   | mechanical alternatives over W011's own ranker (`rankCandidatePackages` + `packageSuppliesOf`) + open recruitments + fallback |
| `domain/proposals.ts`                            |  ~370 | domain   | the governed records (role \| package), MANDATORY alternatives validation, lifecycle + PERSON-only review                     |
| `domain/catalogDraft.ts`                         |   157 | domain   | the PURE catalog-draft projection (the ONLY catalog bridge; refuses non-ACCEPTED)                                             |
| `domain/ports.ts`                                |    62 | domain   | the W013 intake port + READ PICKS of W011 surfaces + own proposal store + audit                                               |
| `app/inputs.ts`                                  |    92 | app      | input types + the 5-method `EmergenceService` interface                                                                       |
| `app/emergenceService.ts`                        |  ~190 | app      | the facade: detectGaps / propose / reviewProposal / getProposal / listProposals + `mapMarketplaceError`                       |
| `adapters/in-memory-emergence-proposal-store.ts` |    55 | adapters | tenant-bucketed proposal store (terminal records refuse rewrites; uniform not-found)                                          |
| `adapters/in-memory-emergence-evidence.ts`       |    55 | adapters | the deterministic W013-shaped evidence double (CR-W014 interim)                                                               |
| `contract.emergence.ts`                          |  ~135 | contract | the area public surface; re-exported from `src/contract.ts` (the only file outside `emergence/` touched in src)               |
| `test/emergence-helpers.ts`                      |   241 | tests    | the composed W011+W014 fixture over SHARED stores + W013-shaped evidence builders                                             |
| `test/emergence-gaps.test.ts`                    |  ~290 | tests    | 22 proofs                                                                                                                     |
| `test/emergence-proposals.test.ts`               |  ~330 | tests    | 17 proofs                                                                                                                     |
| `test/emergence-publication.test.ts`             |  ~340 | tests    | 11 proofs                                                                                                                     |
| `test/emergence-tripwires.test.ts`               |  ~300 | tests    | 16 proofs                                                                                                                     |

Also touched (same package / spec, all W-B- or W014-assigned):
`src/contract.ts` (+9 lines: the composed re-export), `README.md` (area
record), `test/marketplace-tripwires.test.ts` (one law STRENGTHENED: the
module-wide no-`@aurum/application` import trip now walks the whole src
root, covering both areas — no assertion weakened, nothing else changed),
`spec/contract-requests/CR-W014-emergence-evidence-wiring.md` (filed).

## Acceptance clauses → locking tests (66 proofs, 4 files + helpers)

1. **Proposal has evidence, demand and alternatives**
   — `test/emergence-proposals.test.ts` (17): the proposal embeds the
   derived gap VERBATIM (gapId + outcomeIds + signalKind + detectionQuery
   byte-equal); the demand block is mechanical from the gap (recurrence,
   affected goals/missions, demanded capabilities parsed from the W013
   demand signature, effort sum, metric name); the role/package draft
   shapes carried per kind; alternatives are MANDATORY at the pure level
   (empty list = typed validation refusal listing `alternatives`) and
   ALWAYS present at the service level; catalog alternatives carry
   MECHANICAL shortfalls (uncovered capability lists at required levels +
   capabilityMatch; a fully-covering package gets the
   "covers-the-demanded-profile" shortfall with capabilityMatch 1);
   overlapping OPEN recruitments are alternatives (resolved ones are not);
   the typed `none-available` fallback records the empty scan when both
   surfaces are empty; NO FABRICATION: an invented gap id is a typed
   not-found refusal with nothing stored and nothing audited, and a gap
   whose evidence no longer derives refuses (re-detection at proposal
   time); full validation matrix (role shape, package bundle, malformed
   query, duplicate proposalId = typed conflict); tenant isolation
   (foreign evidence never feeds a proposal; getProposal uniform for
   foreign/never-existing ids byte-identically; listProposals scoped).
2. **Publication remains governed**
   — `test/emergence-publication.test.ts` (11): THE JOURNEY — W013-shaped
   evidence → derived gap → proposal (Lab actor) → PERSON review (accept)
   → the PURE `catalogDraftOfProposal` projection (the promoter supplies
   publisher/provenance/now — the emergence area never authors a
   publisher) → the REAL W011 machine (draftPackage → submitPackageVersion
   → reviewPublication by a person) → PUBLISHED, with the published ROLE
   contents equal to the proposal's roleShape and the capability draft
   carrying the bundle's supplies (process/workforce requirements cited in
   the changelog — the four-kind catalog cannot express them first-class);
   the projection's evidence refs are mechanical (one provenance-statement
   for the proposal + one usage-telemetry per cited outcome id, sorted);
   audit completeness: exactly one entry per transition with the citation
   chain in the details; accepted/declined terminal (typed lifecycle
   refusals; the store refuses re-proposing over a terminal record).
3. **Lab cannot self-publish**
   — `test/emergence-publication.test.ts` (refusal block) +
   `test/emergence-tripwires.test.ts` (structural): THREE LOCKS.
   (a) TYPED: the Lab (system), agent and external actors cannot review a
   proposal (`emergence-unauthorized`, "the Lab proposes, never disposes",
   proposal untouched, NO audit entry); the catalog-draft projection
   refuses PROPOSED and DECLINED proposals with the dedicated
   `emergence-publication-refused` code; even post-acceptance the COMPOSED
   marketplace refuses a Lab reviewer at W011's own publication gate
   (`marketplace-unauthorized`, the version stays `submitted`).
   (b) SURFACE: the `EmergenceService` is EXACTLY the five documented
   methods (source-scan); the emergence contract exports no
   execution/publication-shaped name (run/submit/publish/execute/install/
   activate/authorize/deploy/...).
   (c) REACH: no file under `src/emergence` references ANY
   publication/installation/activation mutation identifier (16 identifiers
   scanned: the W011 domain transitions, the app handlers, the service
   methods, the store puts); the deps ports are READ PICKS
   (`Pick<MarketplaceCatalogStore, "listVersions">` +
   `Pick<MarketplaceGovernanceStore, "listRecruitments">`, mutation-pick
   scan); the emergence proposal store is the area's OWN record store
   (putProposal/getProposal/listProposals only).

The DERIVATION deliver — `test/emergence-gaps.test.ts` (22): all five
signal kinds derive with verbatim record-id citations (capability
shortfall groups by context class × failure kind; metric shortfall by
metric name; shape underperformance by (class × shape) cohort at the
sample floor with failure rate ≥ threshold — W013's conditional-evidence
grouping consumed read-only; effort strain by allocation strain ≥ 0.9 on
failed outcomes; knowledge gap by unknown question across DISTINCT
missions); thresholds gate every signal (below → nothing; caller-
overridable, minRecurrence mirrors W013's sample floor of 3); failures
are first-class (missed + failed) and achieved/partial NEVER feed the
failure signals; STATUS IS THE AUTHORITY ruling (emergence never
re-interprets metric polarity — failed outcomes with the metric met still
count, achieved outcomes with the metric missed never do); grouping never
pools across any dimension; determinism (byte-identical repeats, gapId
ascending, pure == service derivation); every cited id exists verbatim
among the seeded records; empty evidence → ok([]); malformed queries are
typed validation refusals (now + all four threshold fields); tenant
isolation at both levels.

Contract hygiene — `test/emergence-tripwires.test.ts` (16): no
`@aurum/execution` / execution-seam / `@aurum/application` / any foreign
package import anywhere in `src/emergence`; the three Lab-cannot-self-
publish locks above; the domain layer imports ONLY local emergence files

- the W011 AREA CONTRACT (allowlist — the W013 cross-area law); domain
  IO-free; no kernel in domain/app; THE W013 MIRROR IS EXACT against the
  upstream learning/cognition SOURCE FILES by content scan
  (EmergenceOutcomeEvidence fields ⊆ OutcomeJoinRecord members incl. the
  NESTED contextClass.classKey/demandSignature + shape.shapeKey;
  observation/allocation picks cover only real upstream fields;
  EMERGENCE_OUTCOME_STATUSES === OUTCOME_STATUSES member-equal; the
  unknown-signal mirror covers UnknownEffect's unknownId/question/
  consequence); no lint-disables; 400/300 line caps hold; no third-party
  dependency added.

## Design rulings (constitution → code; full register in APPROACH.md)

1. **R1 — the area lands in `aurum-marketplace/src/emergence/**`\*\* (the
   owned package; MODULE-OWNERSHIP gives aurum-application to W-A — the
   task's application-package suggestion is overridden by the ownership
   map, exactly as the task's own fallback rule requires).
2. **R2 — W013 evidence enters through a STRUCTURAL INTAKE PORT**: the
   marketplace module cannot import `@aurum/application` (policy requires
   - W011 tripwire), so the intake shapes are structural picks a REAL
     `OutcomeJoinRecord` satisfies with zero mapping code (kernel
     TenantScope/ActorReference/ProvenanceRecord ≡ the W011 local mirrors);
     mirror exactness is content-scan-locked against the upstream source.
     One source repair came out of this ruling (self-review): the first
     draft FLATTENED the conditioning keys (`contextClassKey` at the top
     level) — structurally wrong, real records carry them NESTED
     (`contextClass.classKey`); fixed before the proofs and now tripwire-
     locked nested.
3. **R3 — no second evidence system**: keys, signatures, effort totals and
   failure details are CARRIED verbatim; grouping reuses W013's own key
   spaces (class × shape, class × failure kind).
4. **R4 — gaps are pure derivations, never stored**: every gap cites its
   record ids verbatim; proposals re-detect their gap at build time
   (fabricated/stale gap ids refuse typed). Gap ids are their OWN id space
   (`gap:v1` digest), deliberately not the W013 class/shape key space.
5. **R5 — alternatives are MANDATORY typed records, mechanically
   derived** (W011's own ranker + open recruitments + the typed
   none-available fallback); validation refuses an empty list.
6. **R6 — propose, never publish**: zero catalog writes from the
   emergence area; the only bridge is the PURE catalog-draft projection
   (DraftPackageInput-shaped value) over an ACCEPTED proposal; the W011
   governance path runs unchanged afterwards.
7. **R7 — Lab cannot self-publish is three locks**: typed refusals
   (person-only review with `emergence-unauthorized`; projection refusal
   with `emergence-publication-refused`; W011's own gate refusing the lab
   reviewer composed) + surface exactness + zero mutation reach.
8. **R8 — error authority local** (`EmergenceError`, 7 codes; W011's
   MarketplaceErrorCode not extended; marketplace seam errors mapped
   verbatim via `mapMarketplaceError`); read-pick deps only.
9. **R9 — audit + lifecycle discipline**: one audit entry per transition
   (`marketplace.emergence-proposed/-accepted/-declined`); proposed →
   accepted | declined terminal; closed-failure tenant semantics.
10. **R10 — determinism everywhere**: caller-supplied `now`, no clock/
    randomness/environment reads; gapId ascending; byte-identical repeats.
11. **(from the proofs) STATUS IS THE AUTHORITY**: emergence never
    re-interprets metric polarity — the W013 outcome status is the failure
    judgment; metric signals group failures by metric NAME. A polarity
    check was removed when its own proof exposed the second-judgment-layer
    smell.

## Seam consumption map (cross-area via the W011 area contract only)

| Seam                                                                   | Kind       | Used by                        | How tested                                    |
| ---------------------------------------------------------------------- | ---------- | ------------------------------ | --------------------------------------------- |
| `marketplace/contract.marketplace.js` `rankCandidatePackages`          | pure       | domain/alternatives            | mechanical-shortfall + coverage proofs        |
| `marketplace/contract.marketplace.js` `packageSuppliesOf`              | pure       | domain/alternatives            | uncovered-capability-list proofs              |
| `marketplace/contract.marketplace.js` `DEFAULT_RECRUITMENT_WEIGHTS`    | const      | domain/alternatives            | ranking determinism (W011 ranker, unchanged)  |
| `MarketplaceCatalogStore.listVersions` (Pick)                          | read       | app/emergenceService           | alternatives-from-catalog proofs              |
| `MarketplaceGovernanceStore.listRecruitments` (Pick)                   | read       | app/emergenceService           | open-recruitment alternative proofs           |
| `MarketplaceAuditPort.append`                                          | append     | app/emergenceService           | audit-completeness proofs                     |
| `domain/primitives` mirrors (scope/actors/provenance/freeze/Result)    | local      | all emergence layers           | W011 tripwires (unchanged) + mirror-exactness |
| W013 `OutcomeJoinRecord` / `ContextClass` / `OrganizationShape` shapes | structural | domain/evidence (the mirror)   | content-scan equality vs upstream source      |
| W007 `UnknownEffect` fields                                            | structural | domain/evidence (unknown pick) | content-scan equality vs upstream source      |

No `@aurum/application` import exists anywhere in the marketplace module
(module-wide tripwire, strengthened in this delivery to walk the whole src
root). The production evidence adapter is CR-W014's subject
(composition-owned; the in-memory double is the interim state).

## Honest limitations

1. **The evidence intake runs on the reference double.** Until CR-W014
   resolves, gap detection consumes the in-memory double seeded with
   W013-SHAPED records, not the real learning outcome store. The mirror
   is content-scan-locked against the upstream source (field names +
   nested keys + the frozen status set), and the shapes are structural
   picks a real record satisfies — but the end-to-end
   real-learning-store → detectGaps journey lands with the CR's wiring
   (the W015 certification is the natural checkpoint).
2. **The catalog draft cannot express the full package bundle.** Process
   requirements and workforce requirements ride in the promoted draft's
   changelog (and remain first-class on the proposal record); the frozen
   four-kind catalog has no first-class field for them. A future W-item or
   CR would extend the package kinds — deliberately NOT done here (W011's
   vocabulary is frozen and not mine to extend in this item).
3. **Alternatives are capped at the top 3 ranked catalog candidates**
   (`TOP_ALTERNATIVES_LIMIT`), plus all overlapping open recruitments,
   plus the fallback. A richer alternatives surface (e.g. installed
   packages, workforce roles by title) is a follow-up; the typed record
   shapes leave room (`catalog-package` | `open-recruitment` |
   `none-available` is the frozen set today).
4. **Knowledge-gap grouping is exact-question-text.** Unknown signals
   group by verbatim question strings across distinct missions; question
   normalization/semantic clustering is deliberately out (determinism
   first). Two phrasings of one question are two groups.
5. **Effort strain is a single tenant-wide signal** (group key "tenant")
   over strained failed outcomes; it does not yet bucket by class/shape
   cohort (the other signals do). Documented; a cohort variant is a
   one-block extension if demand appears.
6. **Gap detection is pull-based, per call.** No scheduler watches the
   learning store for new outcomes (deliberately — triggering is
   composition-owned, the W013 pull-based harvesting ruling extended).
7. **`propose` re-runs the full detection per call** (no gap caching) —
   deterministic, fine in-memory; caching is a persistence-lane concern
   (the W013 `calibratedSearch` ruling, verbatim).
8. **maxFileLines headroom** on `domain/gaps.ts` (~385/400) and
   `domain/proposals.ts` (~370/400) is tighter than I'd like; a sixth
   signal or more validation should split before nearing the cap.
9. **No tower/UI surface.** The emergence service is consumed by
   composition; surfacing gaps/proposals in the control tower is a
   follow-up for the tower's owner (W-A), not this item.
10. **Tenant-isolation sweep/manifest registrations remain TL-owned** (the
    standing rebuild-wide state); isolation is proven in-module (pure +
    service levels, byte-identical foreign/missing).

## Test inventory (66 proofs)

- `emergence-gaps.test.ts` — 22 (the derivation deliver + isolation)
- `emergence-proposals.test.ts` — 17 (clause a + no-fabrication + isolation)
- `emergence-publication.test.ts` — 11 (clauses b + c + the journey + audit)
- `emergence-tripwires.test.ts` — 16 (structural locks incl. mirror exactness)
- `emergence-helpers.ts` — shared fixtures (not a test file)

## Exact gate outputs (at this notes commit)

- `./node_modules/.bin/tsc -b packages/aurum-marketplace` → exit 0
- `pnpm fmt:check` → "All matched files use the correct format." (3439 files)
- `pnpm lint` → "Found 70 warnings and 0 errors." (baseline, unchanged)
- `pnpm architecture:check` → architecture: OK / violations: 0 / baseline: 0 /
  new: 0 (also with `-- --changed`: identical)
- `cd packages/aurum-marketplace && npx vitest run` → 11 files, 148/148
  (82 pre-existing + 66 emergence)
- Neighbors (untouched, regression net): application 401/401, domain
  111/111
