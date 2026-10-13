# P002 — Provider/Agent fabric PostgreSQL persistence: WORK-NOTES

Work item (spec/WORK-ITEM-CATALOG.md §P002): **PostgreSQL storage for provider
definitions, model catalog, health states, agent bodies and the append-only
model-binding ledger, preserving byte-for-byte body-identity-across-swap
semantics and the canonical TenantId at the storage boundary; PGlite-backed
round-trip proofs.** Owner W-B (persistence lane). Deps W003+P001 satisfied
at base 8f24706. Branch `work/p002-fabric-storage`, local only (PAT dead;
the TL owns pushes). History is the commit chain: b590e72 (machinery — the
per-area registry option + fabric migrations 0001-0004 + 9 registry proofs,
infra 104/104) → a1ce978 (D3 bank: adapters/stores/contract + provider-core
proofs draft + the interim bridges) → 3bf0eec (area 2: model catalog +
binding ledger proofs — the equivalence ruling made operational) → ccc64b5
(D4 bank: agent + observations proof drafts, UNVERIFIED) → b6c4660 (D4:
drafts verified GREEN as banked + the identity proof extended to all three
agent tables + credential opacity test-locked on the agent and observations
sides) → this notes commit.

Fabric-package footprint (the semantic reference law): **zero** changes to
`packages/aurum-provider/**`, `packages/aurum-agent/**` or
`packages/aurum-domain/**` on this branch (verified:
`git diff main..HEAD --stat --` those paths is empty). The provider (57) and
agent (29) suites are the untouched semantic reference, re-run green at the
tip. The only file outside `aurum-infra/**` + `migrations/fabric/**` +
`spec/contract-requests/` touched at all is the P001 migration runner
(`domain-storage/runner/migration-runner.ts`, +33 lines — the per-area
registry extension, backward-compatible: every existing caller and proof
runs verbatim through the default `schema_migrations` path).

## File map (line counts; src policy-clean: maxFileLines 400)

### Machinery extension (P001 machinery — extend, never duplicate)

| File                                          | Lines | Role                                                                                                                                                                                                                                    |
| --------------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain-storage/runner/migration-runner.ts`   |   +33 | `MigrationRunnerOptions.registryTable` (default `schema_migrations`)                                                                                                                                                                    |
| `fabric-storage/fabric-runner.ts`             |    69 | `loadFabricMigrations` / `runFabricMigrations` (registry: `fabric_schema_migrations`) + `createFabricPgLiteHarness` = the shared-database composition (domain migrations first — they define the trigger and the journal — then fabric) |
| `fabric-storage/adapters/versioned-record.ts` |   170 | the versioned-upsert core every record store rides (append + journal in ONE transaction, current-record read model, first-insertion-order list, `readVersionRows` proof helper)                                                         |

### Area adapters (`fabric-storage/adapters/`)

| File                       | Lines | Ports implemented (from @aurum/provider / @aurum/agent)                                        |
| -------------------------- | ----: | ---------------------------------------------------------------------------------------------- |
| `provider-core-store.ts`   |   198 | `ProtocolStore` / `DefinitionStore` / `AccountStore` (migration 0001)                          |
| `catalog-binding-store.ts` |   158 | `ModelCatalogStore` / `ModelBindingStore` (migration 0002)                                     |
| `observation-store.ts`     |   197 | `ProviderHealthStore` / `ProviderAvailabilityStore` / `ProviderEvidenceStore` (migration 0003) |
| `agent-store.ts`           |   186 | `AgentBodyStore` / `RoleHistoryStore` / `BodyModelBindingStore` (migration 0004)               |

### Composition + surface

| File                                 | Lines | Role                                                                                                      |
| ------------------------------------ | ----: | --------------------------------------------------------------------------------------------------------- |
| `fabric-storage/stores.ts`           |    52 | `createPgProviderFabricStore` / `createPgAgentFabricStore` — every store of one fabric on ONE `Db` handle |
| `fabric-storage/contract.storage.ts` |    60 | the area public surface (composed into infra `src/contract.ts`)                                           |

### Migrations (`migrations/fabric/`) — ten tables, all append-only

| Migration                       | Lines | Tables                                                                              |
| ------------------------------- | ----: | ----------------------------------------------------------------------------------- |
| `0001-fabric-provider-core.sql` |    86 | `fabric_protocols`, `fabric_provider_definitions`, `fabric_accounts`                |
| `0002-fabric-catalog-bindings`  |    64 | `fabric_catalog_entries`, `fabric_model_bindings`                                   |
| `0003-fabric-observations.sql`  |    74 | `fabric_health_observations`, `fabric_availability_observations`, `fabric_evidence` |
| `0004-fabric-agent.sql`         |    81 | `fabric_agent_bodies`, `fabric_role_assignments`, `fabric_body_model_bindings`      |

Plus the area's own `fabric_schema_migrations` registry. Every table leads
its primary key with `tenant_id`, carries `seq bigint generated always as
identity unique` (insertion order), attaches the SHARED
`aurum_reject_mutation()` trigger (defined once in the DOMAIN area's
migration 0001; fabric tables attach it, never re-create it) and enforces
its vocabulary through CHECK constraints (connection states, lifecycle
states, purposes, binding statuses, non-empty ids/keys, `mutation_seq >= 0`,
`position >= 0`).

### Proof suites (`test/`)

| File                                | Lines | Proofs | Area                                                                                                                                                               |
| ----------------------------------- | ----: | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fabric-test-utils.ts`              |   259 |      — | the oracle: harness boots, store pairs, service pairs, `expectSameRead` / `expectSameFailure`, `ScriptedBindingLookup`                                             |
| `fabric-migration-registry.test.ts` |   212 |      9 | machinery: per-area registry discipline (see P001 mapping, unchanged 95+9)                                                                                         |
| `fabric-provider-core.test.ts`      |   351 |      8 | area 1: protocols/definitions/accounts round-trip + isolation + DB enforcement + journal                                                                           |
| `fabric-catalog-bindings.test.ts`   |   398 |      9 | area 2: catalog + THE BINDING LEDGER (append-only at DB level) + credential opacity (accounts) + isolation + journal                                               |
| `fabric-observations.test.ts`       |   463 |      9 | area 3: health/availability/evidence + freshness + the availability PK + credential opacity + isolation + journal                                                  |
| `fabric-agent.test.ts`              |   687 |     10 | area 4: bodies/roles/attachments + THE IDENTITY LAW (byte-for-byte across swaps, raw-table level) + append-only ledgers + isolation + journal + credential opacity |

Infra suite total: **140 proofs / 18 files** (95 P001 domain + 9 registry +
45 fabric area proofs). Runtime ~160s (per-file fresh PGlite, 16 migrations
domain+fabric — the P001 deliberate-isolation discipline).

## Design rulings

1. **The equivalence-oracle ruling — what "provider/agent suites pass
   against the PG-backed stores" means operationally.** The upstream suites
   (provider 57, agent 29) construct their own in-memory fabrics internally;
   literally re-running them against PG would require patching the packages
   (forbidden — they are the semantic reference). The clause is therefore
   operationalized as: the REAL application services
   (`createProviderFabric` / `createAgentFabric`) are composed TWICE — once
   over the PG-backed stores, once over the W003 in-memory reference store —
   each with its OWN identically-scripted deterministic deps (same
   `SteppingClock` start/step, same `SequentialIdGenerator` prefix, same
   fixture transport scripts queued symmetrically through the pair helpers
   `probeSucceeds` / `probeFails` / `discoveryReturns` / `lookupActive`).
   Every proof then drives the SAME journey through BOTH instances and
   asserts: reads deep-equal (`expectSameRead` — the ports resolve records
   or null, not Results; the P001 `expectSameResult` adapted), and failures
   identical issue-for-issue (`expectSameFailure` — same error `code` AND
   message, both promise handlers attached synchronously through
   `Promise.all` so no rejection is ever briefly unhandled). The journeys
   mirror the upstream proofs' scenarios: full selection journeys
   (select/supersede-with-reason/idempotent re-select/clear), attach/swap/
   detach chains, discovery corroboration, sanitization, isolation sweeps,
   every validation/not-found failure. The ruling is recorded here and in
   the `fabric-test-utils.ts` docblock; the upstream suites re-run green at
   the tip as the untouched reference.
2. **Symmetric-driving corollary.** Every service call in a proof drives
   BOTH fabrics, in the same order — a one-sided call advances one fabric's
   clock/id generator and silently de-syncs the pair for every LATER proof
   that compares fresh records (the b6c4660 repair: the banked identity
   proof drove only the PG side through its swaps, which was invisible
   until the credential proof compared a freshly created body). Proofs that
   assert only PG-side raw tables still drive the in-memory twin through
   the identical journey.
3. **Byte-for-byte is per-side; cross-fabric is deep equality.** jsonb
   normalizes object key order, so `JSON.stringify(pgRecord) ===
JSON.stringify(memRecord)` is shape noise, not semantics. The identity
   proofs pin EACH side's serialized record across the swaps (each store's
   body stays byte-identical to itself — including `updatedAt`) and assert
   cross-fabric equality through `expectSameRead` (order-insensitive).
   This is exactly the W003 reference's own `JSON.stringify(body)` proof,
   replayed per store.
4. **The versioned-upsert record shape (migrations 0001/0002/0004).** The
   fabric ports are UPSERT-by-id surfaces (the in-memory `TenantTable`:
   `put` overwrites the value, never moves the key). The mirror: one
   IMMUTABLE row per `(tenant, record_id, mutation_seq)`; every put
   allocates `coalesce(max(mutation_seq), -1) + 1` INSIDE the put
   transaction and appends; reads derive the current record (highest
   `mutation_seq`); `listByTenant` returns currents in FIRST-INSERTION
   order — the row-insertion `seq` of each record's FIRST version — so a
   record whose strong column changed between versions keeps its original
   list position (the in-memory `Map.set` semantics). List FILTERS run in
   JavaScript over the currents (`listByBody`, `findAttachedByPurpose`,
   `findByNaturalKey`, `findByModelKey`), never pre-filtered in SQL, for
   the same positional reason. The journal key is
   `area:operation:<recordId>:<mutationSeq + 1>` — the 1-based journal
   `version >= 1` discipline extended onto the 0-based table seq.
5. **The append-only observation shape (migration 0003).** Health and
   evidence observations carry their own ids: one immutable row per
   `(tenant, id)` with the computed `subject_key` (`subjectKey` /
   `evidenceSubjectKey` from @aurum/provider — exported helpers, imported,
   never re-implemented) as a strong column, so `listBySubject` is a scoped
   ordered scan. **The availability PK ruling:** availability observations
   carry NO id in the reference shape — their identity is the append
   POSITION within `(tenant, subject)`, so the primary key is
   `(tenant_id, subject_key, position)` and the position is allocated as
   `max(position)+1` inside the append transaction (journal key
   `fabric-availability:append:<subjectKey>:<position>`, version =
   position+1). Evidence `listByTenant` is the in-memory
   `SubjectLog.listAll` algorithm mirrored exactly: rows fetched in
   insertion order, grouped by subject key in FIRST-APPEARANCE order,
   within-subject append order preserved (a JavaScript mirror, not a SQL
   approximation).
6. **THE IDENTITY LAW made structural (migration 0004 + agent-store.ts).**
   Attaching, swapping or detaching a model NEVER writes the AgentBody —
   not its facets, not its `updatedAt`. The storage mirror proves it at TWO
   levels: the service level (each store's body byte-for-byte — including
   `updatedAt` — across attach/swap/swap/detach, deep-equal across stores)
   and the RAW TABLE level (stronger than the W003 reference can reach): a
   role assignment precedes the swaps, and across the whole journey the
   body's row count, `mutation_seq`s and records stay byte-identical AND
   the role-assignment ledger rows stay byte-identical — only
   `fabric_body_model_bindings` moves, and the journal holds exactly the
   two body puts of the body's own journey (`:1` create, `:2` assignRole)
   plus the binding-ledger writes.
7. **Ledgers are append-only at the DATABASE level — both of them.** The
   provider binding ledger (`fabric_model_bindings`, proven at 3bf0eec):
   superseding appends the supersede as a NEW row at `mutation_seq + 1`
   with the successor pointer while the original ACTIVE row is retained
   verbatim at its own `mutation_seq`. The agent attachment ledger
   (`fabric_body_model_bindings`, proven at b6c4660): the same four DB
   disciplines — raw UPDATE/DELETE trigger-rejected on every table,
   version rewrites rejected by the primary key, vocabulary violations
   (purpose/status/lifecycle) rejected by CHECK, superseded versions
   retained verbatim with identical identity/attach fields and only the
   supersede fields moved. Bodies and role assignments carry the same
   trigger/PK/CHECK disciplines.
8. **Credential opacity is a type law + a build-time sanitizer + a
   test-locked sweep.** No fabric record type has a credential field:
   account credentials are `{ kind, secretRef, label? }` (opaque refs),
   the agent's `modelBindingRef` is an opaque binding id. Every free-text
   surface (labels, descriptions, endpoint URLs, evidence details, error
   text, body facets, attach notes) passes the provider package's
   UNANCHORED sanitizer (`sanitizeAndAssertClean`) at BUILD time — before
   any store sees the record — so the REAL services over PG store exactly
   what the in-memory reference stores: redacted text. The storage proofs
   lock all three layers: round-tripped records carry opaque secret refs
   verbatim (accounts, 3bf0eec); credential-shaped inputs (sk- key,
   password:, Bearer, URL-userinfo families) come back redacted
   identically through the real services on both stores (agent + observations,
   b6c4660); and RAW TABLE sweeps run `containsCredentialMaterial` over
   every row of every version of all six record tables + all three
   observation logs, both tenants — the tables are provably clean.
9. **Tenant isolation is uniform and total** (the P001 ruling carried
   over): every table's PK leads with `tenant_id`, every adapter query
   filters on it, foreign-tenant reads are indistinguishable from missing
   (identical null/empty at the store level, identical not-found errors at
   the service level — `expectSameFailure`), and the same record/subject
   ids are independently registrable per tenant (proven with fixed-id
   store-level records for the agent side, full service journeys for the
   provider side). Availability positions are per `(tenant, subject)` —
   tenant B's first observation is position 0 even where tenant A already
   used it.
10. **Adapter failure discipline.** The fabric ports throw typed
    `ProviderFabricError` / `AgentFabricError` values (no `Result`
    contract), so adapters never translate SQL errors into domain
    failures: a unique violation (e.g. a duplicate observation id, or a
    version-rewrite race on real PostgreSQL) surfaces as an infrastructure
    error, never a silent history rewrite. The in-memory evidence double's
    overwrite-by-id path is unreachable through any service and is
    deliberately NOT mirrored (documented at the adapter).
11. **Machinery reuse record (the P-series rule).** Migration runner:
    extended with `registryTable` (the P001 WORK-NOTES single-registry
    extension point — the ONLY machinery change on this branch; default
    path byte-identical for every existing caller). Write journal:
    `recordWrite` inside every put/append transaction (fabric areas
    `fabric-protocols`/`-definitions`/`-accounts`/`-catalog`/
    `-model-bindings`/`-health`/`-availability`/`-evidence`/`-bodies`/
    `-role-history`/`-body-model-bindings`). PGlite harness:
    `skipMigrations: true` + the fabric runner (shared-database
    composition). pg plumbing: `Db`/`Tx`, `jsonbParam` (the
    undefined-drop bridge). `deepFreeze` re-freezes every read (the P001
    read-side discipline). Exported pure helpers imported, never
    re-implemented (`subjectKey`, `availabilitySubjectKey`,
    `evidenceSubjectKey`, `buildAgentBody`, `buildRoleAssignment`,
    `buildBodyModelBinding`, …). Test doubles ARE re-implemented against
    the EXPORTED ports (`ScriptedBindingLookup`) — cross-package test
    helpers are not importable and the ruling-10 discipline does not apply
    to test doubles.
12. **Composition is consumer-owned, with two whole-fabric conveniences.**
    One factory per store stays exported; `createPgProviderFabricStore` /
    `createPgAgentFabricStore` additionally wire every store of one fabric
    onto ONE `Db` handle — the shape the services and proofs drive. A
    single database serving BOTH fabrics is the caller composing both
    factories over the same handle (P003's starting point).

## Acceptance clauses → locking proofs (45 fabric-area proofs)

1. **"provider/agent suites pass against the PG-backed stores"** — the
   equivalence ruling (above), made operational by
   `makeProviderServicePair` / `makeAgentServicePair`: the REAL
   `createProviderFabric` / `createAgentFabric` services over the PG-backed
   stores, driven through the same journeys the upstream suites drive, in
   lockstep with identically-dep'd instances over the in-memory reference —
   reads deep-equal, failures identical issue-for-issue. Provider side:
   catalog+binding selection journeys, discovery corroboration, manual-row
   protection (fabric-catalog-bindings, 9); observation journeys with
   freshness semantics and the explicit unknown (fabric-observations, 9).
   Agent side: body lifecycle, attach/swap/detach chains, idempotent
   re-attach, purposes independent, retired-body and closed-purpose
   failures (fabric-agent, 10). Store-level round-trips with the W003
   upsert/builtin-dedup edge cases (fabric-provider-core, 8). Upstream
   suites re-run green, untouched: provider 57/57, agent 29/29.
2. **"the binding ledger stays append-only at the database level"** —
   fabric-catalog-bindings (the superseded ACTIVE version retained verbatim
   at mutation_seq 0 with the supersede appended at seq 1; raw UPDATE/DELETE
   rejected on both tables; version rewrites rejected by PK;
   status/modelKey CHECK violations rejected) AND fabric-agent (the same
   four disciplines for `fabric_body_model_bindings`, `fabric_agent_bodies`
   and `fabric_role_assignments`; superseded attachments retained verbatim
   at their own mutation_seq with successor links and identical
   identity/attach fields).
3. **"body identity across model swaps survives storage round-trips"** —
   THE IDENTITY LAW proof (fabric-agent): service-level byte-for-byte per
   side including `updatedAt` (the W003 reference proof replayed against
   PG-backed storage) + raw-table freezing of the body rows AND the
   role-assignment ledger rows across attach/swap/swap/detach + exactly the
   two body journal keys, with only the binding ledger moving + the
   idempotent re-attach returning the SAME attachment id (no row, no
   audit spam).
4. **"credential material never enters storage (secret references stay
   opaque)"** — accounts round-trip opaque secret refs verbatim + the raw
   account-table scan (3bf0eec); agent + observations credential-opacity
   proofs (b6c4660): credential-shaped free text redacted identically
   through the REAL services on both stores, and `containsCredentialMaterial`
   false for EVERY row of the three agent ledgers and the three observation
   logs (both tenants, every version).

Plus the machinery clause (implied by the P-series rule): the per-area
registry proofs (fabric-migration-registry, 9 — filename order after the
domain area, both registries holding exactly their own sets, idempotency,
sha256, same-named domain+fabric migrations coexisting, drift/removal/
insertion/failure disciplines) and the P001 suite (95) green through the
default-registry path throughout.

## Migration ↔ store register

| Migration | Store(s) served                                                                         |
| --------- | --------------------------------------------------------------------------------------- |
| 0001      | `createPgProtocolStore` + `createPgDefinitionStore` + `createPgAccountStore`            |
| 0002      | `createPgCatalogStore` + `createPgModelBindingStore`                                    |
| 0003      | `createPgHealthStore` + `createPgAvailabilityStore` + `createPgEvidenceStore`           |
| 0004      | `createPgAgentBodyStore` + `createPgRoleHistoryStore` + `createPgBodyModelBindingStore` |

## Honest limitations

1. **Concurrency is structurally unproven** (the P001 limitation, carried
   over verbatim in scope): the PGlite harness caps the postgres pool at
   `max: 1`, so two writers racing the `max(mutation_seq)+1` /
   `max(position)+1` allocations, or racing `FOR UPDATE` on the same row,
   cannot be proven here. On real PostgreSQL the `(tenant, record,
mutation_seq)` / `(tenant, subject, position)` primary keys REJECT a
   race's colliding insert — but the fabric adapters deliberately do not
   translate that 23505 into a domain result (the ports throw; the
   in-memory doubles are single-threaded and have no comparable race to
   mirror), so a raced put surfaces as an infrastructure error. A
   real-PostgreSQL integration pass (and, if retry semantics are wanted, a
   `mapUniqueViolation`-style policy decision per port) is the only honest
   close.
2. **The equivalence oracle is journey-equivalence, not suite-replay.** The
   clause is operationalized via lockstep service pairs over the real
   services rather than literally executing the upstream 57+29 suites
   against PG — the upstream suites build their own in-memory fabrics
   internally and cannot be re-pointed without patching the packages (the
   semantic-reference law forbids it). The proof journeys mirror the
   upstream scenarios; coverage is claim-by-claim, not line-by-line.
3. **CR-P002-package-wiring is OPEN** (spec/contract-requests/): the
   adapter/test imports of `@aurum/provider` / `@aurum/agent` resolve
   through two worker-owned interim bridges (tsconfig `paths` → the BUILT
   `dist/index.d.ts` files; a vitest resolve alias → the packages' public
   entry SOURCES). Plain node ESM resolution from inside aurum-infra fails
   until the TL lands the workspace links; `architecture-policy.yaml`'s
   requires-list for aurum-infra needs the two entries (the checker itself
   only resolves relative imports, so the gates stay green either way).
   Post-CR, both bridges are to be REMOVED (the CR-P001 precedent).
4. **ScriptedBindingLookup is a port-shaped double, not the upstream
   helper.** The agent package's own binding-lookup double is not
   importable cross-package, so the pair re-implements it against the
   EXPORTED `ProviderBindingLookupPort`. Drift risk is bounded by the port
   type (snapshot shape); the same holds for the fixture transport doubles
   re-wrapped by the pair helpers.
5. **No availability TTL/GC path exists** — by design: the observation logs
   are append-only and freshness is a READ-time evaluation
   (`availabilityOf` with `freshnessMs`), so "stale" is derived, never
   mutated. Long-running tenants accumulate observation rows forever;
   archival/compaction is a deployment concern outside the port contract.
6. **Deep-freeze is a read-side discipline** (the P001 limitation, same
   scope): the database cannot enforce JS immutability — it enforces
   something stronger (no UPDATE at all) — but a hand-rolled `SELECT` sees
   mutable JSON.
7. **The evidence overwrite-by-id path is closed, not mirrored.** The
   in-memory double can overwrite evidence by id (unreachable through any
   service); the PG table makes the same id a duplicate-key infrastructure
   error. Equivalence holds on every service-reachable path; the
   unreachable path deliberately diverges (loudly, never silently).
8. **Suite runtime**: infra 140 proofs ≈ 160s wall (every file boots a
   fresh PGlite and applies 16 migrations — deliberate isolation, the
   P001 d597303 repair discipline).
9. **No cross-fabric aggregate factory** — composing both fabrics onto one
   database handle is two factory calls (consumer-owned); nothing in P002
   consumes such an aggregate, so none is shipped (the P001 ruling 9
   shape).

## Gates at the tip (final verification, this commit)

- `pnpm fmt:check` — clean.
- `pnpm lint` — 70 warnings / 0 errors (the documented repo baseline).
- `pnpm architecture:check` — 0 violations (full tree AND `-- --changed`).
- `./node_modules/.bin/tsc -b packages/aurum-domain packages/aurum-provider
packages/aurum-agent packages/aurum-infra` — 0 errors (root compiler,
  batch order builds the dists the tsconfig bridge reads first).
- Suites: infra **140/140** (18 files: 95 P001 + 9 registry + 8 provider-core
  - 9 catalog-bindings + 9 observations + 10 agent), domain **111/111**,
    application **305/305**, provider **57/57**, agent **29/29**, execution
    **90/90**, marketplace **82/82** — 814 tests green at the tip.
