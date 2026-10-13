# P001 — Domain kernel PostgreSQL persistence: WORK-NOTES

Work item (spec/WORK-ITEM-CATALOG.md §P001): **PostgreSQL storage adapters
implementing the aurum-domain kernel's storage ports** — tenant-scoped schema,
ordered content-hashed migrations, append-only/immutability enforced by the
database, and a PGlite-backed test harness proving round-trip equivalence with
the in-memory semantics. Owner W-B (persistence lane). Deps W002+W005
satisfied at base 32cf743. Branch `work/p001-domain-storage`, local only (PAT
dead; the TL owns pushes). History is the commit chain: cd223e7 (domain port
types) → d4c6616/d597303 (machinery) → 7646d31 goals → 40e194c evidence →
4bf6efb memory → 44af5b3 identity+organization → c5a6959 action → 2d5acbc
epistemics → c4ccb57 process → 59e1e4b capability → c15c005 workforce →
2708b82 candidate → 324c741 public surface + CR → this notes commit.

Domain-side footprint (acceptance "the domain package itself is unchanged
semantically"): exactly three files, all type-level —
`aurum-domain/src/domain/storage/ports.ts` (the `AsyncStore<P>` structural
mapping, per-area storage ports, `DomainStoragePorts`, the
`StorageKernelMemberTwin` compile-time twin check, async resolver/lookup
types), its `contract.storage.ts` re-export, and one composed re-export line
in `aurum-domain/src/contract.ts`. Zero runtime code; domain suite 111/111
unchanged throughout.

## File map (line counts; policy-clean: maxFileLines 400)

### Machinery (P-series shared — extend, never duplicate)

| File                         | Lines | Role                                                                        |
| ---------------------------- | ----: | --------------------------------------------------------------------------- |
| `runner/migration-runner.ts` |   124 | ordered + content-hashed (sha256) + idempotent migration runner             |
| `journal/write-journal.ts`   |   158 | mutation-identity journal; `recordWrite` / `journalOnce` / `listJournal`    |
| `harness/pglite-harness.ts`  |    66 | in-process PostgreSQL over TCP socket + production `postgres` driver, max:1 |
| `pg/db.ts`                   |    94 | `Db`/`Tx` handles, unique-violation→conflict mapping, `jsonbParam` bridge   |
| `adapters/audit-store.ts`    |   127 | append-only audit trail + `appendAuditEntry(tx, …)` atomic append           |
| `contract.storage.ts`        |    65 | the area public surface (composed into `src/contract.ts`)                   |

### Area adapters (`adapters/`)

| File                      | Lines | Area (kernel store port implemented)                                 |
| ------------------------- | ----: | -------------------------------------------------------------------- |
| `goal-store.ts`           |   274 | goals — `createPgGoalLedger`                                         |
| `evidence-store.ts`       |   343 | events + observations — `createPgEventLog`, `createPgEvidenceLedger` |
| `memory-store.ts`         |   264 | organizational memory — `createPgOrganizationalMemory`               |
| `identity-store.ts`       |   365 | people + memberships — `createPgIdentityDirectory`                   |
| `organization-store.ts`   |   331 | organizations/sites/units — `createPgOrganizationDirectory`          |
| `action-store.ts`         |   348 | authority lifecycle — `createPgActionAuthority`                      |
| `epistemics-store.ts`     |   285 | claims + beliefs — `createPgEpistemicsLedger`                        |
| `epistemics-shared.ts`    |   179 | pure validation/build mirrors (400-line budget split)                |
| `hypothesis-store.ts`     |   200 | hypothesis lifecycle — `createPgInquiryLedger`                       |
| `process-store.ts`        |   302 | process directory — `createPgProcessDirectory`                       |
| `process-shared.ts`       |   240 | pure validation/build mirrors (400-line budget split)                |
| `capability-store.ts`     |   247 | capability graph — `createPgCapabilityGraph`                         |
| `capability-shared.ts`    |   283 | supply/requirement bodies + loaders (400-line budget split)          |
| `workforce-store.ts`      |   343 | workforce directory — `createPgWorkforceDirectory`                   |
| `workforce-shared.ts`     |   261 | role/capacity command bodies + helpers (400-line budget split)       |
| `insights-store.ts`       |   314 | workload insights — `createPgWorkforceInsights`                      |
| `recommendation-store.ts` |   323 | recommendations — `createPgWorkforceRecommendations`                 |
| `candidate-store.ts`      |   224 | candidate registry — `createPgCandidateRegistry`                     |

### Migrations (`../../migrations/domain/`) and proof suites (`../../test/`)

| Migration                    | Lines | Tables | Proof file                            | Proofs |
| ---------------------------- | ----: | -----: | ------------------------------------- | -----: |
| `0001-write-journal.sql`     |    40 |      1 | `write-journal.test.ts` (182L)        |      7 |
| `0002-audit.sql`             |    37 |      1 | `audit-store.test.ts` (203L)          |      7 |
| `0003-goals.sql`             |    31 |      1 | `goal-store.test.ts` (277L)           |      7 |
| `0004-evidence.sql`          |    74 |      3 | `evidence-store.test.ts` (369L)       |      9 |
| `0005-memory.sql`            |    30 |      1 | `memory-store.test.ts` (335L)         |      7 |
| `0006-identity-organization` |   116 |      6 | `identity-organization-store…` (674L) |      8 |
| `0007-action.sql`            |    35 |      1 | `action-store.test.ts` (670L)         |      7 |
| `0008-epistemics.sql`        |   162 |      8 | `epistemics-store.test.ts` (1091L)    |      7 |
| `0009-process.sql`           |    54 |      2 | `process-store.test.ts` (536L)        |      7 |
| `0010-capability.sql`        |    96 |      4 | `capability-store.test.ts` (549L)     |      7 |
| `0011-workforce.sql`         |   194 |      9 | `workforce-store.test.ts` (1053L)     |      7 |
| `0012-candidate.sql`         |    30 |      1 | `candidate-store.test.ts` (638L)      |      7 |
| —                            |       |        | `migration-runner.test.ts` (173L)     |      9 |
| —                            |       |        | `helpers.ts` (109L, shared oracle)    |      — |

34 domain tables + `domain_write_journal` + the runner's `schema_migrations`
registry. Suite total: **95 proofs / 13 files**. Every area test file drives
BOTH kernels with identical inputs (helpers mirror the domain test helpers)
and asserts `expectSameResult` — values deep-equal, errors identical in code,
message and issues.

## Design rulings

1. **Three immutable-row shapes, no UPDATE anywhere.** Every table in the
   family rejects UPDATE and DELETE through the shared `aurum_reject_mutation`
   trigger (created once in migration 0001; every later migration reuses the
   same function). The shapes:
   - _Revision history_: one immutable row per `(tenant, id, revision)` —
     goals, memory, process revisions, beliefs (`(tenant, belief, revision)`);
     current revision derived as max on read; older revisions keep their
     original payloads verbatim.
   - _Lifecycle history_: `(tenant, id, mutation_seq)` where mutation 0 is the
     opening/proposal (from-state null) and transitions append 1..n; current =
     highest mutation on read. Actions and hypotheses. Strong from/to columns
     carry the transition graph for CHECK constraints (`mutation_seq = 0 or
from_state is not null`, `from_state <> to_state`, state vocabularies) so
     an illegal move is rejected by the database, not just the adapter.
   - _Base row + appended fact_: immutable base row (person, membership,
     claim, contradiction, unknown, observation, workforce assignment,
     recommendation, …) plus a fact table keyed one-per-record by PRIMARY KEY
     (membership ends, claim retractions, contradiction/unknown resolutions,
     observation retractions, assignment ends, recommendation decisions) —
     the ended/retracted/resolved/decided record values are derived on read
     exactly like the in-memory spreads, and a second fact row is rejected by
     PK (one-way transitions).
2. **Tenant scoping is uniform and total.** Every table's primary key leads
   with `tenant_id`; every adapter query filters on it; foreign-tenant reads
   are indistinguishable from missing (identical not-found errors, verified
   per area) and the same record id is independently registrable per tenant.
   The audit trail and journal are tenant-scoped the same way.
3. **The global gap counter ruling (capability).** The in-memory gap counter
   is a closure variable that spans tenants — a per-store-instance GLOBAL.
   The PG mirror takes `max(gap_number)+1` over the whole table (not per
   tenant) inside the command transaction, with the kernel-generated
   `gap-<n>` id and a table-wide UNIQUE on gap_number enforcing the global
   discipline. Gap rows are appended by `recomputeGaps`; a recompute that
   fixes everything appends nothing.
4. **Async resolvers run on the pool BEFORE the command transaction**
   (action role resolution, epistemics evidence lookup). The
   single-connection harness cannot nest a pooled query inside an open
   transaction; the in-memory kernel resolves at this same logical point, so
   a concurrent membership/observation change between resolution and commit
   is a race the reference cannot represent either. Documented at both
   adapter sites.
5. **The JSON.stringify undefined-drop bridge (`jsonbParam`, pg/db.ts).**
   Domain records may carry `undefined`-valued optional properties (e.g. a
   lifecycle entry's absent `from` state). `jsonbParam` recursively drops
   undefined-valued properties before the `isDomainJsonValue` guard and by
   serialization — reads see the key absent, which equals `undefined` under
   the Result equality the proofs assert. Top-level `undefined` maps to SQL
   NULL. A non-JSON value fails loudly (TypeError), never corrupts storage.
6. **Candidate jsonb-record + domain-exported deep validation.** The full
   mixed-actor proposal (actors, assignments, allocations, topology,
   information flows, occupancy, environment, budget, expected outcome,
   risks, constraints, evidence) lives in one `record` jsonb row keyed
   `(tenant, candidate_id)` — a projected relational shape would add nothing
   but drift surface because the deep structural validation of the W005
   frozen vocabulary is the domain-exported pure function
   `organizationCandidateIssues` (the very function the in-memory registry
   calls on its draft — zero drift by construction; the identity-area
   `activeRolesFor` / workforce `summarizeWorkload` pattern). The schema
   deliberately has NO activation or execution path: candidates are
   proposals; activation is owned downstream by the action authority.
7. **Atomicity per command.** Every kernel command runs in ONE
   `sql.begin` transaction: the mutation row(s), its audit entry
   (`appendAuditEntry(tx, …)`, ids `audit-<n>` from the global
   `domain_audit_seq` — the in-memory counter is kernel-global, not
   per-tenant) and its journal row land or vanish together, mirroring the
   in-memory single-image semantics.
8. **Unique-violation races resolve as domain conflicts.** `mapUniqueViolation`
   translates PostgreSQL 23505 into the kernel's typed `conflict` DomainError
   with the in-memory conflict text; everything else rethrows (infrastructure
   failure, not a domain result). Adapters never reject with domain failures —
   they resolve `Result` values (the `AsyncStore` contract).
9. **Insertion order is a first-class column.** Every table carries
   `seq bigint generated always as identity unique`; list orderings use it
   (`order by recorded_at, seq` etc.) to mirror the in-memory stable sorts.
   Where collation could drift (capability `listGaps`), sorting happens in
   JavaScript (`computedAt` then `localeCompare`) — the reference's exact
   comparator. bigint arrives as string over the wire; the identity-area
   `Number()` bridge converts the ended-membership timestamp (exact for the
   domain's millisecond range).
10. **Kernel-internal helpers are mirrored, domain-exported ones are
    reused.** Validation/build logic the kernel keeps internal is mirrored in
    the `*-shared.ts` modules (epistemics, process, capability, workforce —
    also the mechanism that keeps every file under the 400-line architecture
    budget); logic the domain already exports is imported, never re-implemented
    (`organizationCandidateIssues`, `activeRolesFor`, `wouldCreateUnitCycle`,
    `createAuditRecord`, `deepFreeze`, validator utilities).
11. **The journal records mutation identities, not command identities.**
    A repeated `reviseGoal` appends a new revision in BOTH kernels — so the
    journal key is `area:operation:id[:version]` (e.g.
    `goals:append-revision:g1:2`, `actions:transition:a1:3`,
    `audit:append:<tenant>:audit-<n>`) and re-recording is a detectable
    no-op (`ON CONFLICT DO NOTHING`). Operation-level idempotency is OPT-IN
    via `journalOnce` (stores the first outcome snapshot, replays return it
    without re-running the effect — the P002 ingest shape).

## Machinery contract for P002/P003 (extend, never duplicate)

- **WriteJournal** — `journal/write-journal.ts`, table `domain_write_journal`
  (migration `0001-write-journal.sql`). `recordWrite(sql, entry)` inside your
  command transaction; `journalOnce(sql, entry, exec)` for replay-to-same-
  outcome operations (pass a transaction for atomicity — on a pool there is a
  documented replay window); `listJournal(sql, tenantId)` is the read model.
- **Migration runner** — `runner/migration-runner.ts`. `loadDomainMigrations(
directory?)` + `runDomainMigrations(sql, migrations?)`: filename-sorted
  `NNNN-<slug>.sql`, applied set must be a strict prefix of the on-disk list,
  sha256 recorded per migration and content drift is a hard error, each
  migration applies in its own transaction with its registry row.
  **Extension point (see limitations):** the registry table
  `schema_migrations` is name-keyed and single — P002/P003 migrating a SHARED
  database must extend the runner with a per-area registry (or use a separate
  database), not point it at a second directory naively.
- **PGlite harness** — `harness/pglite-harness.ts`. `createPgLiteHarness({
skipMigrations? })` boots in-process PostgreSQL over a local TCP socket and
  connects the production `postgres` driver (max: 1 — PGlite executes one
  query at a time). P002/P003 harnesses pass `skipMigrations: true` and run
  their own (extended) runner, or extend the options.
- **pg plumbing** — `pg/db.ts`: `Db`/`Tx` handle types every adapter accepts
  (pool outside, transaction inside commands), `mapUniqueViolation`,
  `isUniqueViolation`, `jsonbParam`, `asDomainError`.
- **Audit sink** — `adapters/audit-store.ts`: `appendAuditEntry(tx, …)` is
  THE atomic append every kernel command uses; `createPgAuditTrail(sql)` is
  the query surface. P002/P003 consequential writes reuse the same sink and
  the same global sequence discipline.
- **SQL-level reuse** — the `aurum_reject_mutation()` trigger function is
  defined ONCE (migration 0001); later migrations attach it, never re-create
  it. P-series migrations do the same.
- **Public surface** — everything above is exported through
  `src/domain-storage/contract.storage.ts` → `src/contract.ts` → `index.ts`
  (the only cross-module seam). One factory per kernel store; composing a
  full `DomainStoragePorts` instance is consumer-owned wiring.

## Acceptance clauses → locking proofs (95 total)

1. **"every kernel record kind round-trips with semantics identical to the
   in-memory reference"** — the `round-trips …` equivalence proof of every
   area file (13 proofs): goal revision histories incl. retention and list
   filters; events + observations incl. retraction-derived values and
   listing; memory record/revise histories incl. freshness stamps; people,
   memberships + ends, derived roles, org/site/unit snapshots incl. cycles;
   full action lifecycles (rejected + employment-impacting-with-human-decision
   journeys); claims (active/retracted/explicit freshness), multi-revision
   subject-stable beliefs, hypotheses through every legal terminal,
   contradictions + unknowns (retained + resolved); process revision
   histories (older revisions keep original steps) + metric observations
   pinned to the revision they measured incl. out-of-order recordedAt;
   capabilities/supplies/requirements/recomputed gaps incl. covered-vs-level-
   vs-capacity and fixing-a-gap-appends-nothing; workforce roles, capacities,
   assignments with ends, observations, outcomes, explanations,
   recommendations incl. approve/reject journeys and every list filter edge;
   the full candidate vocabulary (rich candidate exercising every section,
   minimal single-actor, unknown-actor-kind fallback, whitespace trims) with
   returned-record equality so a silently-failing command cannot hide behind
   notFound-equality.
2. **"tenant isolation is uniform (foreign-tenant reads indistinguishable
   from missing)"** — the tenant-isolation sweep inside every area's
   conflict/not-found discipline proof (foreign reads produce identical
   errors to missing ones; the same id is independently registrable per
   tenant; e.g. foreign not-found beats invalid measurements in process).
3. **"append-only/versioned records enforced by database constraints/
   triggers"** — every area's `database enforcement` group: raw UPDATE/DELETE
   rejected on EVERY table of the area (the tenant holds real rows at proof
   time), history-rewrite inserts rejected by PK, one-fact-per-record PKs
   (second retraction/end/decision rejected), lifecycle CHECK constraints
   (illegal from/to, illegal decision states), the global gap-number UNIQUE.
4. **"the domain package itself is unchanged semantically"** — branch diff
   touches exactly 3 domain files, all type-level (see header); the domain
   suite is 111/111 at every commit of this chain (recorded per commit).
5. **"migrations are ordered, content-hashed and idempotent to apply"** —
   `migration-runner.test.ts` (9): shipped migrations apply in filename order
   on a fresh database; a second run applies nothing (skips everything);
   sha256 recorded per migration; custom-directory discipline rejects content
   drift on an applied migration, a removal from the middle of history, an
   insertion before applied history; applies only newly appended migrations;
   a FAILING migration stays unrecorded while earlier ones stay applied
   (atomic per-migration apply); loads only `.sql` ordered by filename.

Plus the per-area equivalence complements: validation issue-for-issue proofs
(identical codes/messages/issues, incl. the shared non-array TypeError cases
where both kernels throw identically — steps, evidenceRefs), audit
equivalence proofs (identical entries on the shared global sequence;
registrations/openings/proposals carry none, matching the reference), and
journal proofs (stable keys per area, exactly the successful mutation keys).

## Migration ↔ domain-store register

| Migration | Store(s) served                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------- |
| 0001      | machinery — every store's journal writes                                                        |
| 0002      | `createPgAuditTrail` — every store's audit side-effects                                         |
| 0003      | `createPgGoalLedger`                                                                            |
| 0004      | `createPgEventLog` + `createPgEvidenceLedger`                                                   |
| 0005      | `createPgOrganizationalMemory`                                                                  |
| 0006      | `createPgIdentityDirectory` + `createPgOrganizationDirectory`                                   |
| 0007      | `createPgActionAuthority`                                                                       |
| 0008      | `createPgEpistemicsLedger` + `createPgInquiryLedger`                                            |
| 0009      | `createPgProcessDirectory`                                                                      |
| 0010      | `createPgCapabilityGraph`                                                                       |
| 0011      | `createPgWorkforceDirectory` + `createPgWorkforceInsights` + `createPgWorkforceRecommendations` |
| 0012      | `createPgCandidateRegistry`                                                                     |

## Honest limitations

1. **Concurrency is structurally unproven.** The PGlite harness caps the
   postgres pool at `max: 1` (PGlite executes one query at a time), so
   concurrent-connection races — two writers racing `FOR UPDATE` on the same
   row, or two `recomputeGaps` racing the global counter — cannot be proven
   here. The code paths exist (`mapUniqueViolation` resolves 23505 races as
   the typed conflict Result; the gap UNIQUE enforces the global counter) but
   no proof exercises them against real parallelism. Same class as prior
   waves; a real-PostgreSQL integration pass is the only honest close.
2. **The in-memory mode remains available.** The synchronous domain kernel
   (`createDomainKernel()`) is untouched and remains the semantic reference;
   the async storage boundary is its structural twin (`AsyncStore<P>` +
   `StorageKernelMemberTwin` keep the two aligned at compile time). P001
   ships no ASYNC in-memory adapter — consumers wanting deterministic no-DB
   tests use the sync kernel directly; P003's "in-memory mode behind the
   same ports" acceptance will need a thin async wrapper over the sync
   kernel (not delivered here, deliberately — nothing in P001 consumes it).
3. **CR-P001-package-wiring is OPEN** (spec/contract-requests/): `@aurum/
domain` resolves through two worker-owned interim bridges (tsconfig
   `paths` → the BUILT `dist/index.d.ts`; a vitest resolve alias →
   `src/index.ts`). Plain node ESM resolution of `@aurum/domain` from inside
   aurum-infra fails until the TL lands the workspace link
   (`pnpm install` + lockfile entry); the tsconfig bridge also means the
   typecheck requires `@aurum/domain` to be built first (the root
   `tsc -b packages/aurum-domain packages/aurum-infra` batch order does
   this). Post-CR, both bridges are to be REMOVED so a broken link can
   never be masked.
4. **Single migrations registry.** The runner records into one
   `schema_migrations` table keyed by migration NAME only. Two migration
   directories (domain + fabric, P002) on one shared database would collide
   on names and trip the prefix check. P002/P003 must extend the runner with
   a per-area registry table (or run areas on separate databases) — extend,
   never duplicate.
5. **Audit sequence granularity.** The in-memory audit counter is per
   `createDomainKernel()` instance; the PG sequence (`domain_audit_seq`) is
   per database, shared by every pool/store connected to it. Equivalent in
   the one-kernel-per-database composition every proof drives; divergent if
   several composed kernels share one database (ids interleave but stay
   unique and ordered) or one logical kernel spans databases.
6. **Resolver resolution point.** Role/evidence resolution happens on the
   pool before the command transaction (ruling 4) — a concurrent change
   between resolution and commit is invisible to the transition. The
   in-memory reference has the same blind spot; recorded here so P002/P003
   reviewers know it is intentional.
7. **`journalOnce` replay window.** On a pool handle (not a transaction)
   there is a window between the check and the effect where a concurrent
   same-key execution could double-run; documented in `write-journal.ts`.
   Atomic use passes a transaction.
8. **Proof suite runtime.** 95 proofs take ~130s wall because every test
   file boots a fresh PGlite instance and applies all 12 migrations —
   deliberate isolation (the d597303 repair: deterministic scopes leaked
   rows across tests in a shared harness). Parallelism is per-file only.
9. **No aggregate kernel factory.** P001 ships one factory per store
   (composition is consumer-owned). A convenience
   `createPgDomainStoragePorts()` wiring all sixteen stores + the resolvers
   is a P002/P003 integration follow-up, not a defect — the twin-check type
   already fixes the member set.
10. **Deep-freeze is a read-side discipline.** Records are deep-frozen by
    the domain constructor, stored as jsonb, and re-frozen on read
    (`deepFreeze`). The database cannot enforce JS immutability — it
    enforces something stronger (no UPDATE at all), but a hand-rolled
    `SELECT` sees mutable JSON.

## Gates at the tip (final verification, this commit)

- `pnpm fmt:check` — clean.
- `pnpm lint` — 70 warnings / 0 errors (the documented repo baseline).
- `pnpm architecture:check` — 0 violations (full tree AND `-- --changed`).
- `./node_modules/.bin/tsc -b packages/aurum-domain packages/aurum-infra` —
  0 errors (root compiler, batch order builds domain's dist first — see
  limitation 3).
- Suites: infra **95/95** (13 files), domain **111/111**, application
  **305/305**, provider **57/57**, agent **29/29**, execution **90/90**,
  marketplace **82/82** — 769 tests green at the tip.
