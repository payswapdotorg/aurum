# W014 — Emergent roles + packages: APPROACH (continuation contract)

Status: LIVE WORK NOTE — written at dispatch start, committed BEFORE any layer
(house APPROACH-first law). If this worker is killed, the next continuation
starts here: read this file, then `git log --oneline main..HEAD` for the
delivered layers.

Work item (spec/WORK-ITEM-CATALOG.md §W014): **recurring gap detection and
governed role/package proposals.** Owner W-B. Deps W011 (marketplace/
recruitment) + W013 (outcome learning) — both merged at base `c00dd2f`.
Acceptance: **(a) proposal has evidence, demand and alternatives; (b)
publication remains governed; (c) Lab cannot self-publish.**

## 0. What exists (explored at dispatch start)

- `packages/aurum-marketplace/**` (W011, owner W-B = me): the four package
  kinds + four separate governance machines (publication / installation /
  activation / execution-approval citation ledger) + the recruitment
  lifecycle. Area layout `src/marketplace/{domain,app,adapters}` +
  `contract.marketplace.ts` re-exported by `src/contract.ts` → `src/index.ts`.
  Its tripwires (test/marketplace-tripwires.test.ts) lock: no fused
  primitives, no execution-shaped exports, **no `@aurum/application` import
  anywhere in `src/marketplace`** ("the plan surface … never a dependency"),
  domain purity, mirror exactness against @aurum/agent/@aurum-domain source,
  no lint-disables, `module.ts` requires == policy.
- `packages/aurum-application/src/learning/**` (W013, owner W-A): the
  `OutcomeJoinRecord` (outcome joined to the seven dimensions, carrying
  `contextClass` {axes, demandSignature, canonical, classKey}, `shape`
  {…, shapeKey}, `allocation` {totalEffortShare, human/automated/external
  counts…}, `observation` {status, source{kind,ref}, observedAt, failure
  {kind,detail}, metric {metric,observed,target}}), the append-only
  `OutcomeStore`, the 5-method `OutcomeLearning` facade, hygiene tripwires.
  NOT mine to edit (MODULE-OWNERSHIP: aurum-application → W-A).
- The architecture policy pins `aurum-marketplace` requires =
  `[shared, aurum-domain, aurum-agent]` — the marketplace module CANNOT
  import `@aurum/application` (module-dependency rule + W011 tripwire), and
  the policy file is TL-owned.

## 1. Rulings (the design law for this item)

**R1 — the area lands in MY owned package, as a sibling area:
`packages/aurum-marketplace/src/emergence/**`.** The catalog assigns W014
paths `packages/aurum-marketplace/**`; MODULE-OWNERSHIP gives
`packages/aurum-application/**`to W-A. The task's "suggested`packages/aurum-application/src/emergence/\*\*`" is overridden by the ownership
map (it says so itself: "if the ownership map says so" — it does not).
Layout mirrors the W011 area exactly: `src/emergence/{domain,app,adapters}`+`contract.emergence.ts`re-exported from`src/contract.ts` (the W013
composed-contract pattern, in the package I own). W014's catalog line
("marketplace role proposal and package proposal surfaces") is satisfied
literally: the proposal surfaces live here.

**R2 — W013 evidence enters through a STRUCTURAL INTAKE PORT, never an
import.** `aurum-marketplace` cannot import `@aurum/application` (R1), so the
emergence domain declares `EmergenceOutcomeEvidence` / `EmergenceUnknownSignal`
as STRUCTURAL PICKS of the W013 record shapes — same field names, subset
fields, local primitive mirrors already proven identical to the kernel's
(W011's `primitives.ts` law). A REAL `OutcomeJoinRecord` is assignable to the
intake shape without mapping code (kernel `TenantScope`/`ActorReference`/
`ProvenanceRecord` are structurally identical to the marketplace mirrors; the
W013 nested records have MORE fields than the picks — structural subtyping).
The port (`EmergenceEvidencePort`, read-only, tenant-scoped) is implemented
post-CR by whatever composition owns the learning service (CR-W014 filed);
tests use a deterministic in-memory double seeded with W013-shaped records.
Mirror exactness is tripwire-locked against the upstream W013 SOURCE FILES
by content scan (the W011 vocabulary-equality precedent — no import needed).

**R3 — no second evidence system.** Gap detection consumes ONLY the W013
intake shapes (outcome joins +, where relevant, cognition unknown signals
mirroring the W007 unknown effect). No parallel evidence store, no evidence
re-derivation: the context-class key, shape key, demand signature, effort
totals and failure details are CARRIED VERBATIM from the intake records.
Recurring grouping keys reuse W013's own conditioning discipline
(contextClassKey × shapeKey; contextClassKey × failure kind) — the same key
space, read-only.

**R4 — gaps are pure derivations with verbatim citations, never stored
fabrication.** `detectEmergenceGaps(evidence, query)` is a pure function:
every `EmergenceGap` cites the exact record ids it derives from
(`outcomeIds` / `unknownIds` verbatim, `affectedGoalIds`, affected mission
refs) plus a deterministic `gapId` (16-hex FNV-1a over a `gap:v1` canonical
form — an EMERGENCE record-id space, deliberately NOT the W013 context/shape
key space; those are carried, never re-derived). Signal kinds (frozen):
`capability-shortfall` (recurring failed/missed outcomes grouped by context
class × failure kind), `metric-shortfall` (recurring metric misses by metric
name), `shape-underperformance` ((context class × shape) groups at the sample
floor with failure rate ≥ threshold — W013's conditional-evidence grouping
consumed read-only), `effort-strain` (recurring failed/missed outcomes with
allocation strain ≥ threshold), `knowledge-gap` (recurring cognition unknowns
across distinct missions). Gaps are NOT persisted: a proposal re-detects its
gap at build time (typed refusal when the gap is not among the CURRENT
derivations — no stale or fabricated gap can back a proposal).

**R5 — proposals carry evidence, demand and alternatives as MANDATORY typed
fields.** `EmergenceProposal` (role | package, discriminated):

- `evidence` — the derived gap EMBEDDED VERBATIM + the detection query
  (thresholds + now) for reproducibility + the verbatim outcome ids;
- `demand` — recurrence count, affected goals, affected missions,
  demanded capabilities (parsed from the gap's demand signature), effort /
  metric signals — all mechanical fields;
- `alternatives` — MANDATORY non-empty array of TYPED records (never a
  free-text blob): ranked marketplace catalog packages with MECHANICAL
  shortfall reasons (derived with W011's own `rankCandidatePackages` +
  `packageSuppliesOf` — uncovered-capability lists, capabilityMatch), open
  recruitment requests overlapping the demand, and — only when both scans
  are empty — the typed `none-available` fallback recording the empty scan
  itself. Validation refuses a proposal with no alternatives.

**R6 — the emergence area PROPOSES, never publishes; publication authority
stays where W011 put it.** The emergence service performs ZERO catalog
writes: not `draftPackage`, not `submitPackageVersion`, not
`reviewPublication`, no `putVersion`/`putPackage`. Its ONLY output toward the
catalog is `catalogDraftOfProposal(acceptedProposal, {publisher, provenance,
now})` — a PURE projection returning a W011 `DraftPackageInput`-shaped value
(machine 1's ENTRY state: a draft, still fully governed). The actual
draft/submit/publish sequence runs through the marketplace governance
surface by an authorized publisher + human reviewer (W011 law, unchanged).
Role proposals project onto `RolePackageContents`; package proposals carry a
bundle {capabilitySupplies, processRequirements, workforceRequirements} and
project onto `CapabilityPackageContents` (the four-kind catalog cannot yet
express process/workforce requirements first-class — the proposal record
remains their semantic home; recorded as a limitation, CR-worthy).

**R7 — Lab cannot self-publish is STRUCTURAL + typed.** Three locks:
(1) surface-exactness tripwire: the `EmergenceService` has exactly the five
documented methods — no publish/submit/draft-shaped method exists;
(2) source tripwire: no file under `src/emergence` references any
publication/installation/activation mutation identifier
(`submitForPublication`, `reviewPublication`, `handleDraftPackage`,
`handleSubmitPackageVersion`, `handleReviewPublication`,
`installPublishedVersion`, `activateInstallation`, `.putVersion`,
`.putPackage`, `.putInstallation`, `.putActivation`, `.draftPackage`,
`.submitPackageVersion`, `.reviewPublication`, `.installPackage`,
`.activatePackage`);
(3) typed refusals: proposal review (accept/decline) is PERSON-ONLY
(`emergence-unauthorized` fail-closed for system/agent/external actors —
the Lab proposes, humans dispose; employment-impacting recommendations stay
human-authorized per the constitution), and the catalog-draft projection
refuses anything but an ACCEPTED proposal with the dedicated
`emergence-publication-refused` code. Even post-acceptance, the projected
draft STILL has to clear W011's human-governed publication machine — the
composed proof demonstrates the lab actor being refused at that gate too.

**R8 — error authority is local; reads are picks.** `EmergenceError` (6
codes: validation / not-found / conflict / lifecycle / unauthorized /
publication-refused) mirrors the LearningError house pattern — W011's
`MarketplaceErrorCode` union is NOT extended. Marketplace errors surfaced
through the read seams map into the emergence namespace verbatim
(`mapMarketplaceError`). The emergence deps are READ PICKS of the W011
surfaces (`catalog: Pick<MarketplaceCatalogStore, "listVersions"|"getVersion">`,
`recruitments: Pick<MarketplaceGovernanceStore, "listRecruitments">`) + its
OWN proposal store + the shared append-only audit port. Cross-area
consumption goes through the W011 AREA CONTRACT
(`../marketplace/contract.marketplace.js`) — the W013 learning→lab precedent.

**R9 — audit + lifecycle discipline.** Every emergence transition appends
one audit entry (`marketplace.emergence-proposed` / `-accepted` /
`-declined`, the W011 audit port, tenant-scoped). Proposal lifecycle:
`proposed → accepted | declined` (terminal; typed lifecycle refusals
otherwise). Proposals are tenant-scoped with closed-failure semantics
(foreign-tenant ≡ missing, byte-identical messages).

**R10 — determinism everywhere.** No clock reads, no randomness, no
environment reads: `now` is always a caller input. Gap ordering by gapId
ascending (codepoint); alternatives ordered by the W011 ranking rule then
packageId; repeated identical queries produce byte-identical derivations
(proof-locked, the W011 ranking discipline).

## 2. Incremental delivery plan (each layer independently committable)

1. **Layer 1 — domain**: `vocabulary.ts` (signal kinds, states, thresholds,
   rule ids, audit actions), `errors.ts`, `evidence.ts` (the W013 structural
   mirror + validation), `gaps.ts` (pure detection + gap ids), `alternatives.ts`
   (mechanical derivation over W011 pure rankers), `proposals.ts` (records,
   validation, lifecycle, person-governance), `catalogDraft.ts` (pure
   projection), `ports.ts`.
2. **Layer 2 — app + adapters + contract**: `app/emergenceService.ts`
   (5-method facade), `adapters/in-memory-emergence-proposal-store.ts`,
   `adapters/in-memory-emergence-evidence.ts` (W013-shaped double),
   `contract.emergence.ts` wired into `src/contract.ts`.
3. **Layer 3 — proofs** (`test/emergence-*.test.ts`, mirror
   learning-contract-hygiene style): gap derivation correctness over seeded
   W013-shaped evidence (every signal kind, thresholds, verbatim ids, pure
   determinism); proposal completeness (evidence+demand+alternatives
   mandatory, ids verbatim, validation matrix); refusal proofs (wrong
   authority fails closed, projection refuses unaccepted, the composed
   marketplace still refuses lab reviewers); tenant isolation (foreign
   evidence never feeds a proposal — pure + service levels); the
   end-to-end governed journey (evidence → gap → proposal → person review →
   projection → W011 draft/submit/review → published); hygiene tripwires
   (no execution-seam imports, no @aurum/application, no kernel in domain,
   IO-free domain, no lint-disables, surface exactness, W013 mirror
   exactness against upstream source, no publication-mutation identifiers).
4. **Layer 4 — WORK-NOTES + gates.** CR-W014-emergence-evidence-wiring filed
   for the TL-owned composition seam (host maps the W013 outcome store into
   the intake port).

## 3. Kill-recovery notes

- Typecheck: `./node_modules/.bin/tsc -b packages/aurum-marketplace` (exit 0).
- Tests: `cd packages/aurum-marketplace && npx vitest run` (baseline 82/82),
  neighbors: application 401/401, domain 111/111.
- Gates: `pnpm fmt:check`, `pnpm lint` (70w/0e baseline — add nothing),
  `pnpm architecture:check` (+ `-- --changed`) → 0 violations.
- Format BEFORE gates: `pnpm fmt` (oxfmt).
- NEVER touch `packages/aurum-application/**` (W-A's), `main`, or TL-owned
  files (architecture-policy.yaml, root package.json, lockfile). Commit
  early, small commits. Push only `work/w014-emergent-roles`.
