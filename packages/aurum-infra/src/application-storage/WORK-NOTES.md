# P003 — Lab/application PostgreSQL persistence: WORK-NOTES

Base: `main` = `c00dd2f` (W013 merge). Dependencies all in: W008 (lab core —
the evaluation records and the sync `LabEvaluationStore`), W013 (outcome
learning — the seven-dimension join records and the sync `OutcomeStore`),
P001 (domain storage — the migration runner, write journal, PGlite harness,
pg plumbing, candidate registry), P002 (fabric storage — the per-area
registry and shared-database composition precedents).

Scope: typed storage PORTS for the lab/learning application records
(`@aurum/application` `src/lab/storage/**` — types + IO-free async in-memory
doubles ONLY) and the PostgreSQL persistence layer implementing them
(`@aurum-infra` `src/application-storage/**` + `migrations/application/**`),
with PGlite proofs. The sync in-memory references (W008/W013) stay
untouched — the application suite (401 proofs) runs DB-free, unchanged.

## File map (line counts; src policy-clean: maxFileLines 400)

### Ports — application package (`packages/aurum-application/src/lab/storage/`)

| File                  | Lines | Role                                                                                                                                                                                                          |
| --------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ports.ts`            |    96 | Types ONLY, zero IO: `AsyncPort<P>` (the P001 `AsyncStore` structural mapping), `LabEvaluationStorage`, `OutcomeRecordStorage`, the two anchor retrievals, `LearningLoopRetrieval`, `ApplicationStoragePorts` |
| `errors.ts`           |    32 | `labEvaluationAppendRefusal` — the append-only typed refusal (ruling 3)                                                                                                                                       |
| `in-memory.ts`        |    65 | The async in-memory doubles: DB-free implementations of the same ports (delegation to the W008/W013 references + the append guard)                                                                            |
| `contract.storage.ts` |    39 | The area surface, composed into the package contract (`src/contract.ts` +2 export lines) — the ONLY cross-module seam                                                                                         |

### Adapters — infra package (`packages/aurum-infra/src/application-storage/`)

| File                           | Lines | Role                                                                                                                                                                          |
| ------------------------------ | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapters/evaluation-store.ts` |    96 | `createPgLabEvaluationStore` — migration 0001, append + journal in one transaction, tenant-scoped reads, JS mirror filters                                                    |
| `adapters/outcome-store.ts`    |    90 | `createPgOutcomeRecordStore` — migration 0002, byte-identical typed conflicts, the W013 filter paths                                                                          |
| `application-runner.ts`        |    77 | Per-area registry wiring (`application_schema_migrations`) through the SHARED P001 runner; `createApplicationPgLiteHarness` (domain → application)                            |
| `stores.ts`                    |    44 | Composition factories: `createPgApplicationStorage` (the ports boundary) + `createPgLearningLoopRetrieval` (anchors + evidence; candidate path = the P001 registry, composed) |
| `contract.storage.ts`          |    26 | The area surface, composed into the infra contract                                                                                                                            |

### Migrations (`migrations/application/`) — two tables, all append-only

| File                                   | Lines | Tables / machinery                                                                                                          |
| -------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------- |
| `0001-application-lab-evaluations.sql` |    44 | `lab_evaluations` — PK `(tenant_id, evaluation_id)`, `aurum_reject_mutation` trigger, goal/digest indexes, join-key columns |
| `0002-application-outcomes.sql`        |    47 | `learning_outcomes` — PK `(tenant_id, outcome_id)`, trigger, class/anchor/goal indexes, the seven-dimension jsonb           |

### Proof suites (`packages/aurum-infra/test/`)

| File                                     | Lines | Tests | Area                                                                                                                                                                                |
| ---------------------------------------- | ----: | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `application-test-utils.ts`              |   446 |     — | Oracle CORE: trio (PG + async in-memory + retrieval on one harness), Result/tenant/timestamp utils, W008 seeding fixtures, search journeys, evaluation mirroring                    |
| `application-learning-utils.ts`          |   218 |     — | Learning-side helpers: candidate mapping/registration, outcome inputs, `recordOutcome`/`calibratedSearch` conveniences, outcome mirroring, the PG join bridge (`joinOutcomeFromPg`) |
| `application-evaluation-store.test.ts`   |   296 |     8 | Round-trip equivalence (both lab paths, join keys verbatim + column level), append-only (typed refusal, port surface, DB trigger, journal), tenant isolation                        |
| `application-outcome-store.test.ts`      |   411 |     8 | Outcome round-trip (seven join dimensions verbatim + columns), list filters, append-only (conflict/surface/trigger/journal), tenant isolation, THE END-TO-END LOOP                  |
| `application-migration-registry.test.ts` |   246 |    10 | Per-area registry: filename order, idempotence, sha256, three-area shared-DB composition, coexisting names, drift/removal/insertion rejection, append-only-new, atomic apply        |

### Wiring + contract request

`aurum-application/src/contract.ts` (+2), `aurum-infra/src/contract.ts`,
`aurum-infra/src/module.ts` (requires += `aurum-application`),
`aurum-infra/tsconfig.json` + `vitest.config.ts` (interim bridges — CR),
`spec/contract-requests/CR-P003-package-wiring.md` (132): the TL-owned
workspace link + policy-deps request (the CR-P001/P002 situation, unchanged).

## Design rulings

1. **ONE record kind for both lab production paths.** "Lab search records +
   candidate evaluations" is the W008 `LabEvaluationRecord` itself — its
   docblock: "the lab's own append-only evidence. Carries the
   outcome-learning join keys verbatim (spec P003)". Both paths
   (`searchOrganizations`, `evaluateOrganizations`) already land in ONE
   store; a separate search-record table would invent semantics the
   in-memory reference does not have.
2. **The ports are async structural twins.** `AsyncPort<P>` maps every sync
   method 1:1 (name, parameters, leading `TenantScope`) to a Promise of the
   same Result type. Any change to the sync port propagates to the storage
   boundary at compile time — the boundary cannot drift from the contract
   it persists (the P001 `AsyncStore` pattern, carried up a layer).
3. **The append-only refusal channel is the existing error vocabulary.**
   `LabErrorCode` freezes five codes and P003 does not extend another
   area's authority: a duplicate evaluation id resolves as `lab-validation`
   carrying the offending `evaluationId` (a colliding id IS invalid input
   to an append-only store). Outcomes use `learning-conflict`
   byte-identically to the W013 reference. One exported constructor
   (`labEvaluationAppendRefusal`) is shared by BOTH async modes so the two
   agree on the duplicate path too.
4. **Append-only is enforced by the DATABASE, not convention.** Both tables
   attach the shared `aurum_reject_mutation` trigger (defined once in the
   domain area — attached, never re-created) and reject duplicate ids by
   primary key; the adapters translate unique violations into the typed
   refusals. Raw `UPDATE`/`DELETE` proofs run against tables holding real
   rows.
5. **Shared-database composition, per-area registries.** Domain migrations
   run FIRST (they define the trigger + journal the application area
   reuses), then the application migrations record into their OWN registry
   (`application_schema_migrations`). The fabric area is an independent
   sibling; one proof composes all THREE areas on one database. Ordered,
   sha256-content-hashed, idempotent — the same runner, the same
   discipline, independently tracked per area (the registered P002 ruling,
   extended to three areas).
6. **Strong columns are the join-key projection; the jsonb is the
   round-trip authority.** The P003 join keys (goal, fingerprint digest,
   ranking rule; anchor ids, conditioning keys) exist as real columns for
   inspectability and indexable scoped scans; the FULL record rides one
   jsonb verbatim and is the sole read-back source (no column↔jsonb
   round-trip drift is possible).
7. **List filters mirror the in-memory reference exactly**: SQL selects the
   tenant rows in insertion order (`seq`), filters in JavaScript
   (`TenantIndex.list().filter()` mirror — the P002 first-insertion-order
   ruling), AND-combined over the reference's filter fields.
8. **The equivalence oracle is adapted to the sync/async seam.** The lab
   and learning SERVICES are synchronous and take the sync stores — so the
   REAL services drive their in-memory references (the semantic authority,
   composed exactly like the untouched suites), and every record they
   produce is carried into BOTH async stores (PG + async in-memory); the
   proofs then assert all three agree on every read path (values
   deep-equal, typed errors identical in code/message/issues). The
   end-to-end loop drives the REAL pure functions (`assembleOutcomeJoin`,
   `calibrateEvidence`, `applyConditionalCalibration`) over PG-hydrated
   anchors and PG-listed evidence — nothing is re-implemented.
9. **Byte-for-byte is per side; cross-store is deep equality** (the P002
   ruling, applied here): jsonb normalizes object key order, so the
   verbatim join-key proofs assert deep equality across stores PLUS each
   store's record serializing byte-identically to itself across reads.
   (This delivery initially wrote cross-store STRING comparisons — the
   proofs themselves exposed the shape noise, exactly as P002's did.)
10. **The retrieval path composes P001, never duplicates it.** The
    organization-join anchor is the P001 PG candidate registry
    (`createPgCandidateRegistry`) behind the async view port; the join
    seam is hydrated from the retrieval paths and fed to the REAL
    `assembleOutcomeJoin`.
11. **Memory mode preserved, twice over.** The W008/W013 sync in-memory
    references are untouched (application suite 401/401, DB-free) AND the
    async ports ship their own async in-memory doubles so async
    compositions can run DB-free behind the same boundary.
12. **The max-lines law applies to helpers too.** The initial 641-line
    `application-test-utils.ts` tripped `max-lines` (400, non-test files);
    the helpers split along the natural seam (oracle core vs learning-side
    helpers) — no test file exceeded the exemption the `.test.ts` override
    already grants.

## Acceptance clauses → locking proofs (26 P003 proofs)

| Catalog P003 acceptance                                                                  | Locked by (file > test)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed storage port in the application package, zero IO in domain code                    | `ports.ts` types only; `architecture:check` 0 violations (full + `--changed`); the storage dir sits in the application package's unlayered `src/lab/storage/**` — adapters never enter it                                                                                                                                                                                                                                                                                                       |
| Reuse P001 mechanisms: WriteJournal, migration runner, PGlite harness                    | `application-runner.ts` (shared runner, per-area registry — zero duplicated machinery); journal rows in-transaction (`recordWrite` in both adapters); `createApplicationPgLiteHarness` extends the P001 harness with `skipMigrations`                                                                                                                                                                                                                                                           |
| Migrations: same runner, ordered, content-hashed, idempotent, per-area registry          | `application-migration-registry.test.ts` (10 proofs: filename order after domain, idempotence + domain registry untouched, sha256 recording, three-area shared-DB composition, coexisting names, content-drift rejection, middle-removal rejection, earlier-insertion rejection, append-only-new, atomic failing apply)                                                                                                                                                                         |
| Join keys round-trip verbatim (fingerprintDigest, constraint set, weights, ranking rule) | `application-evaluation-store.test.ts` (search + evaluateOrganizations paths: deep-equal + per-side byte-stable + STRONG-COLUMN equality; list filters mirror)                                                                                                                                                                                                                                                                                                                                  |
| Outcome join records: seven dimensions verbatim                                          | `application-outcome-store.test.ts` (context/organization/allocation/occupancy/informationStrategy/environments/cost deep-equal + per-side byte-stable + conditioning-key columns)                                                                                                                                                                                                                                                                                                              |
| Append-only at the DB level; duplicates are typed conflicts, no update/delete surface    | both store suites: duplicate id → typed refusal (identical on both async modes), raw re-insert → `duplicate key`, raw UPDATE/DELETE → trigger `append-only` rejection, port surface = put/get/list ONLY                                                                                                                                                                                                                                                                                         |
| Tenant scoping at the storage boundary (CR-W003)                                         | both suites: foreign-tenant read ≡ missing (identical typed error bytes, no existence leak), same id independently registrable per tenant, per-tenant lists, per-tenant journal rows                                                                                                                                                                                                                                                                                                            |
| End-to-end learning loop over PG-backed stores                                           | `application-outcome-store.test.ts` (end-to-end): seeded lab search → evaluation mirrored to PG → join assembled by the REAL `assembleOutcomeJoin` over PG-hydrated anchors (≡ the reference service's record) → appended to PG → conditional evidence via the REAL `calibrateEvidence` over PG-listed outcomes (≡ the service's anchored answer, the loop's own outcome in the chain) → calibrated search via the REAL `applyConditionalCalibration` over PG evidence (≡ the service's result) |
| Anchor-required law carries through (no global evidence API)                             | the storage ports expose NO global surface (port-surface proofs); evidence retrieval is the W013 anchored `listOutcomes` + class-key filters; the e2e evidence assertion is filtered to the search's own context class                                                                                                                                                                                                                                                                          |
| Memory mode preserved; existing suites run DB-free, unchanged                            | application suite 401/401 green (untouched); the async in-memory doubles behind the same ports (used as the twin oracle in every equivalence proof)                                                                                                                                                                                                                                                                                                                                             |

## Migration ↔ store register

| Migration | Table               | Adapter                      | Journal area        | Append-only enforcement                   |
| --------- | ------------------- | ---------------------------- | ------------------- | ----------------------------------------- |
| 0001      | `lab_evaluations`   | `createPgLabEvaluationStore` | `lab-evaluations`   | PK `(tenant_id, evaluation_id)` + trigger |
| 0002      | `learning_outcomes` | `createPgOutcomeRecordStore` | `learning-outcomes` | PK `(tenant_id, outcome_id)` + trigger    |

## Honest limitations

- **PGlite is the proof target, not a real PostgreSQL server** (the
  P-series precedent — a real-PG run is TL infrastructure). The adapters
  use plain, PGlite-compatible SQL only.
- **The W008 sync reference has an overwrite-by-id path** (upsert) that the
  storage-port law deliberately does NOT have: it is unreachable through
  the lab service (ids are allocated fresh per record) and the divergence
  closes loudly on both async modes (typed refusal, never a silent
  rewrite). Documented here rather than papered over.
- **Interim bridges until CR-P003-package-wiring resolves**: the infra
  `tsconfig.json` `paths` entry and the `vitest.config.ts` resolve alias
  stand in for the workspace link. Both point at the same public
  entrypoint the link will provide; the CR carries the removal checklist.
  Plain node ESM imports of `@aurum/application` from infra fail until the
  link exists — nothing on this branch does that outside the two bridges.
- **List filtering happens in JavaScript** over the tenant's full row set
  (the reference mirror). Correct and order-faithful; SQL-side filtering
  would be a scale optimization that must preserve first-insertion order
  semantics first.
- **The async in-memory doubles delegate to the sync references** (with the
  evaluation append guard) — they are doubles of the reference, not a
  second semantic implementation; the sync references remain the sole
  semantic authority.
- **The end-to-end loop drives the reference service for the oracle side**
  (the services are synchronous and cannot take async stores — ruling 8);
  the PG side composes the REAL pure functions over PG-backed reads, which
  is the strongest async-seam statement available without a service-layer
  rewrite (out of P003 scope).
- **The architecture checker cannot see package-specifier imports**; the
  policy `requires` list (the human-approved dependency truth) is TL-owned
  and carried by the CR — the module manifest on this branch already
  declares the dependency, so a future checker extension will find them in
  agreement.
- **No tower/CLI/HTTP surface** — consumption is via the package contracts
  only (per the P-series boundary); wiring a runtime host is TL-owned
  follow-up work.

## Gates at the tip (final verification, this commit)

| Gate (from repo root)                                              | Result                                      |
| ------------------------------------------------------------------ | ------------------------------------------- |
| `pnpm exec tsc -b packages/aurum-application packages/aurum-infra` | exit 0                                      |
| `pnpm fmt:check`                                                   | clean (3434 files)                          |
| `pnpm lint`                                                        | 70 warnings / 0 errors (baseline unchanged) |
| `pnpm architecture:check` / `--changed`                            | violations 0 / 0 (baseline 0, new 0)        |
| `packages/aurum-infra` vitest                                      | 166/166 (140 P001/P002 + 26 P003)           |
| `packages/aurum-application` vitest                                | 401/401 (DB-free, no regression)            |
| `packages/aurum-domain` vitest (insurance)                         | 111/111                                     |
| `packages/aurum-execution` vitest (insurance)                      | 90/90                                       |
