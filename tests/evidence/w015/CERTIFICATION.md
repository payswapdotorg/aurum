# W015 — End-to-end certification record

Certified SHA: **`68f2797`** (main, pushed — the tree this record's parent
commit certifies; the journey evidence + this record land as the
certification commit ON TOP, per "certification cannot be inherited by a
later commit": every journey below was executed AT `68f2797`'s tree).

Certifying authority: TL (work-item owner per spec/WORK-ITEM-CATALOG.md §W015).
Date: 2026-10-13 (Africa/Accra). Deadline context: operator order, midnight.

## Gate battery at the certified tree (all re-run by the TL at `68f2797`)

| Gate                                         | Result                                           |
| -------------------------------------------- | ------------------------------------------------ |
| `tsc -b` (application + infra + marketplace) | 0 errors                                         |
| `pnpm fmt:check`                             | clean (3492 files)                               |
| `pnpm lint`                                  | 70 warnings / 0 errors (exact repo baseline)     |
| `pnpm architecture:check`                    | baseline 0 / new 0                               |
| `pnpm architecture:check -- --changed`       | baseline 0 / new 0                               |
| application suite                            | **471/471** (43 files: 466 + 5 journey-evidence) |
| domain suite                                 | 111/111                                          |
| infra suite                                  | 166/166 (140 + 26 PGlite application-storage)    |
| provider suite                               | 57/57                                            |
| agent suite                                  | 29/29                                            |
| execution suite                              | 90/90                                            |
| marketplace suite                            | 148/148 (82 + 66 emergence)                      |
| **TOTAL**                                    | **1073 tests, 0 failures**                       |

## The seven mandatory journeys (constitution §Mandatory journeys)

Scripted journey runs: `packages/aurum-application/test/w015-journey-evidence.test.ts`
(placement: the catalog's "unless integration requires shared wiring"
exception — the journeys compose the application package's real seams and
test fixtures; the record lives here).

| #   | Journey                                                                                              | Evidence at the certified SHA                                                                                                                                                                                                                                                | Live vs fixture                                                                  |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | provider/model swap without body replacement                                                         | provider `model-binding.test.ts` + `model-catalog.test.ts`; infra `fabric-storage` round-trip proofs (body identity across swaps survives storage) — 57/57 + 166/166 green at the SHA                                                                                        | **FIXTURE** (PGlite harness + in-memory catalogs; no live provider keys in CI)   |
| 2   | ride → Ride Agent → PaySwap Agent → payment                                                          | `w015-journey-evidence.test.ts` J2: two missions complete through the real cognition service; the W009 relay handoff built + delivered idempotently (`delivered-first` then `delivered-duplicate`); tenant correlation asserted                                              | **FIXTURE** (scripted reasoner, in-memory mission store)                         |
| 3   | construction goal → contextual Lab → mixed organization → ExecutionPlan → relay → evidence/deviation | J3: real fingerprintSituation → searchOrganizations → registerCandidate (mixed org) → plan handoff → MISSED outcome recorded as calibration evidence; conditionalEvidence ≥ 1                                                                                                | **FIXTURE** (in-memory kernel/stores)                                            |
| 4   | human workforce optimization                                                                         | J4: person + roles first-class in the kernel identity registry; the employment-impacting gate (human approval/authorization roles) proven by `cognition-authority-gate.test.ts` at the SHA                                                                                   | **FIXTURE**; the human-authorization clause is gate-enforced, never auto-applied |
| 5   | context-conditioned organization change                                                              | J5: three failures recorded against the class winner → calibratedSearch re-ranks WITHIN the class; evidence visible with coverage; W013 suites (conditional/failures/freshness) green in the 471-file run                                                                    | **FIXTURE**                                                                      |
| 6   | cross-platform continuity                                                                            | `continuity-*.test.ts` (7 files: replay-never-re-runs with zero counted invocations, attach-returns-same-reference, live-id resume unchanged, dead-id replay reconstructs, attachment history, RPC envelope refusals) + J6: continuous session + revive over the same ledger | **FIXTURE** (in-memory ledger + counting substrate)                              |
| 7   | crash/reconnect recovery                                                                             | J7 (same run as J6): fresh service over the ledger resumes by REPLAY with `substrate.submissions === 0` — recovery never re-executes; W007/W009 resumability suites green                                                                                                    | **FIXTURE**                                                                      |

## Live-vs-fixture disclosure (constitution: CERTIFIED requires deployment evidence)

- Every journey above runs on **fixture harnesses** (scripted reasoner,
  in-memory stores, PGlite, counting substrate). No journey is claimed LIVE.
- Deployment/revision evidence: **none exists at certification time** — the
  deliverable is a library monorepo with no deployment target. Per the
  constitution's DELIVERED/CERTIFIED distinction, this record certifies the
  golden journeys at the exact SHA with full fixture disclosure; the
  deployment-evidence leg remains open for whenever a deployment target
  exists (honest disclosure, not a claim).

## Roadmap completeness at certification

Merged and gate-verified at this lineage: W000–W014 (all work items of the
frozen DAG) + P001 + P002 + P003 (persistence lane) + CR resolutions
(CR-W010, CR-W011, CR-P003 executed by the TL; CR-W012-desktop +
CR-W012-cli + CR-W014 open for the lockfile/bridge follow-ups they
describe). W015 is this record.

## TL attestation

I re-ran every gate personally at the certified tree and recorded the
numbers above verbatim. The journey evidence file was authored by the TL
(W015's owner) composing the workers' delivered, gate-verified seams — no
new semantic authority, no new stores, no substrate edits. The W012/W014/
P003 deliveries were recovered from their session narratives after the
platform recycled their pods mid-delivery; the recovery provenance and the
TL-side completion repairs are itemized in the merge commits (f52c2b8,
b8fc80d, 9821277) per the WIP-recovery law.
