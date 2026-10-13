# W015 — End-to-end certification plan (TL draft, pre-wave)

Status: DRAFT — SHAs and evidence slots fill in AFTER W012/W014/P003 merge.
Constitution anchor (spec/REBUILD-CONSTITUTION.md): "DELIVERED requires
implementation, required tests, architecture verification, security/tenant
proof, evidence and exact SHA. CERTIFIED additionally requires exact
deployment/revision evidence." Catalog §W015: exact-SHA certification of the
mandatory golden journeys with live-vs-fixture disclosure; certification
cannot be inherited by a later commit.

## Certification target

- Integrated SHA: <fill after final merge — the certification commit's parent>
- Certification commit: <the evidence record commit itself>
- Rule: every journey below is exercised AT THE EXACT SHA; no journey may be
  certified "by inheritance" from an earlier run.

## The seven mandatory journeys → evidence matrix

| #   | Journey (constitution wording)                                                                            | Surfaces exercised                                                 | Evidence channel                                                                                                                                                                         | Live vs fixture disclosure                                                              |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | provider/model swap without body replacement                                                              | provider area (W003), agent bodies, P002 binding ledger            | fabric suite proofs + a scripted swap run at the certified SHA recording body-identity invariants before/after                                                                           | fixture (PGlite harness) — disclose; no live provider keys in CI                        |
| 2   | ride -> Ride Agent -> PaySwap Agent -> payment                                                            | agent gateway/execution relay (W006/W009), substrate seams         | execution suite + scripted multi-hop relay trace replay at the SHA                                                                                                                       | fixture substrates — disclose each hop; no live network                                 |
| 3   | construction goal -> contextual Lab -> mixed organization -> ExecutionPlan -> relay -> evidence/deviation | cognition (W007), lab (W008), plans (W009), learning (W013)        | application suite end-to-end proof + scripted journey run: goal seeded -> lab search -> organization -> plan -> relay -> evidence records with deviation branch                          | fixture kernel + in-memory stores — disclose; PG-backed variant if P003 merged (PGlite) |
| 4   | human workforce optimization                                                                              | workforce allocation first-class (W005), lab mixed organizations   | domain + application workforce proofs; a journey run optimizing a mixed human/agent organization with employment-impacting recommendation shown as human-authorized ONLY                 | fixture — disclose the authorization gate                                               |
| 5   | context-conditioned organization change                                                                   | W013 conditional evidence, context classes, calibrated search      | learning suite (conditional isolation, asymmetric caps, freshness) + a journey run: context shift flips the recommended organization within its class                                    | fixture — disclose                                                                      |
| 6   | cross-platform continuity                                                                                 | W012: continuous session (desktop), replay (web/CLI), RPC envelope | continuity suite proofs (attach reference-equality, replay-never-re-runs, zero invocations) + a scripted cross-process resume run (CLI/desktop evidence artifact from the W012 delivery) | fixture ledgers/surfaces — disclose; no live Electron/window manager in CI              |
| 7   | crash/reconnect recovery                                                                                  | W012 resume semantics + W007/W009 idempotent resume                | continuity proofs (dead-id replay reconstructs; live-id unchanged) + scripted kill/resume run at the SHA                                                                                 | fixture — disclose                                                                      |

## Per-journey certification record (fill at run time)

For each journey: exact SHA, command(s) run, verbatim output tail, pass/fail,
live-vs-fixture status, timestamp, and the TL attestation. Records land in
tests/evidence/w015/ as the certification commit.

## Gate battery at the certified SHA (all must be green, exact numbers recorded)

- pnpm fmt:check — clean
- pnpm lint — baseline warnings only, 0 errors
- pnpm typecheck (root batch incl. every touched package)
- pnpm architecture:check AND -- --changed — 0 violations
- every package suite — all green, counts recorded
- node scripts/check-workspace-freshness.mjs — clean

## Disclosure rules

- Every fixture-backed journey is marked FIXTURE with the harness named
  (PGlite / in-memory / scripted substrate).
- No journey is claimed LIVE unless it exercised a real deployment revision;
  if none exists at certification time, LIVE column reads "none — library
  monorepo, no deployment target" (constitution: CERTIFIED additionally
  requires deployment evidence — record honestly what exists).
- Binary/derived artifacts regenerated at the SHA, never inherited.

## Sequencing

1. Wave merges: W012, W014, P003 (TL gate-parity + merge each).
2. CR resolution sweep (any open CRs from the wave).
3. Final integration SHA pinned → this plan's slots filled.
4. Journey runs executed + recorded (fixture harnesses).
5. Certification commit + CURRENT-STATE update + push (PAT channel live).
6. Roadmap complete → operator report.
