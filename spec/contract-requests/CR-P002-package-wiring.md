# CR-P002 — wire `@aurum/provider` + `@aurum/agent` into `@aurum/infra`

- **Work item:** P002 (packages/aurum-infra/src/fabric-storage/** +
  packages/aurum-infra/migrations/fabric/**)
- **Requester:** W-B (P002 dispatch, persistence lane)
- **Owner of requested change:** TL (root `pnpm-lock.yaml` + the
  `architecture-policy.yaml` requires list; the infra `package.json`
  dependency block, `src/module.ts` and the interim alias/paths below are
  worker-owned — the exact CR-P001/W009/W011 situation)
- **Status:** RESOLVED (2026-10-13, TL — executed at integration on main 2a8c6ab:
  @aurum/provider + @aurum/agent workspace:\* added to packages/aurum-infra
  package.json; one pnpm install recorded both link entries; the TL-owned
  architecture-policy.yaml requires list extended to [shared, aurum-domain,
  aurum-provider, aurum-agent] (matching the worker-owned module.ts
  declaration); ALL interim bridges removed — the infra tsconfig paths and
  every vitest alias (incl. the re-added domain alias); re-verified through
  the real links: root tsc -b domain+provider+agent+infra 0 err, infra
  140/140, fmt clean 3398 files, lint 70w/0e, arch 0 viol full+changed.
  Original filing preserved below.)

## Delivery status (D4, updated at the branch tip)

The P002 delivery this CR unblocks is COMPLETE on
`work/p002-fabric-storage` (see
`packages/aurum-infra/src/fabric-storage/WORK-NOTES.md`): 4 fabric
migrations + 8 PG adapters + 45 area proofs (infra 140/140 at the tip),
all gates green. Both interim bridges are in place and verified
(tsconfig `paths` → built dists; vitest aliases → public entry sources);
the imports they carry are exactly the two specifiers this CR wires.
After the TL runs the `pnpm install` + `architecture-policy.yaml` update,
the worker-owned cleanup (dropping both bridges) is a two-file diff
re-verified by the standard gate battery.

## Requested change

Add two workspace dependencies to `packages/aurum-infra/package.json`:

```jsonc
{
  "dependencies": {
    "@aurum/provider": "workspace:*",
    "@aurum/agent": "workspace:*",
  },
}
```

then run one `pnpm install` so the lockfile records the `link:../aurum-provider`
and `link:../aurum-agent` entries under the `packages/aurum-infra` importer
(mirroring exactly how CR-P001 wired `@aurum/domain` into infra, CR-W011
wired domain+agent into marketplace, and CR-W009 wired execution+shared into
application).

And extend the `aurum-infra` module's policy dependency list in
`architecture-policy.yaml` (TL-owned file) to match the already-updated
`packages/aurum-infra/src/module.ts`:

```yaml
- id: aurum-infra
  requires: [shared, aurum-domain, aurum-provider, aurum-agent]
```

## Reason

The P002 delivery implements the W003 fabric store ports
(`ProviderFabricStore` from @aurum/provider, `AgentFabricStore` from
@aurum/agent) as PostgreSQL adapters:

- the adapter modules import the port/record TYPES from both packages and
  reuse their exported pure helpers at runtime (`subjectKey`,
  `availabilitySubjectKey`, `evidenceSubjectKey`, `builtinProtocolTemplates`,
  `materializeProtocol` — the P001 ruling-10 discipline: domain-exported
  helpers are imported, never re-implemented);
- the proof suites drive the REAL application services
  (`createProviderFabric`, `createAgentFabric`) and their deterministic
  doubles over the PG-backed stores, plus the in-memory reference stores for
  the equivalence oracle.

`architecture-policy.yaml` does NOT yet list the two deps for aurum-infra
(unlike the CR-P001 case, where `aurum-domain` was already listed). The
architecture checker does not flag package-specifier imports (it resolves
only relative imports), so the gates stay green on the branch — but the
policy list is the human-approved dependency truth, which is why its update
belongs in this CR rather than silently on the worker branch.

Those imports resolve today through two worker-owned interim bridges, not
through real dependency links:

1. `packages/aurum-infra/tsconfig.json` — `"paths"` mapping
   `@aurum/provider` → `../aurum-provider/dist/index.d.ts` and
   `@aurum/agent` → `../aurum-agent/dist/index.d.ts` (root-compiler
   typecheck; the batch `tsc -b packages/aurum-domain
packages/aurum-provider packages/aurum-agent packages/aurum-infra`
   builds both dists first);
2. `packages/aurum-infra/vitest.config.ts` — resolve aliases pointing the
   two specifiers at the packages' public entry SOURCES (the proof suites).

Neither bridge survives consumer-side resolution: plain node ESM imports of
`@aurum/provider` from inside `packages/aurum-infra` fail with
`ERR_MODULE_NOT_FOUND` until the link exists, and `pnpm install
--frozen-lockfile` on a fresh clone would not create any link for P003
consumers to inherit.

## Post-CR cleanup (worker-owned, at TL integration)

Once the TL has run `pnpm install` and the links exist, the interim bridges
should be REMOVED so a broken link can never be masked:

- drop the two `paths` entries from `packages/aurum-infra/tsconfig.json`;
- drop the two resolve aliases from `packages/aurum-infra/vitest.config.ts`
  (vitest then resolves through node_modules exactly like consumers).

Both bridges point at the same public entrypoints real links provide, so
behavior is identical before and after.

## Why the delivery does not ship the deps itself

The P-series hard laws freeze `package.json` + `pnpm-lock.yaml` on worker
branches (a package.json dep without the lockfile entry breaks
`pnpm install --frozen-lockfile` on TL verification, and manual symlinks do
not survive a fresh install — the CR-W009/P001 analysis, unchanged).

## Compatibility impact

- No behavioral change at runtime: the bridges and the eventual links
  resolve the identical public entrypoints.
- `@aurum/agent` is imported type-only from infra src (its store port
  interfaces); `@aurum/provider` is imported for runtime helpers as well —
  both become real links.
- No other package imports `@aurum/infra` yet (P003 is the next consumer).
- `pnpm install --frozen-lockfile` stays green on this branch because
  neither `package.json` nor the lockfile changed here.

## Tests / migration

- The fabric-storage proof suites are bridge-agnostic (they run under the
  aliases today and under the links after the CR — the same specifiers
  either way).
- After the CR resolves, the removal of the two interim bridges is itself
  verified by the full gate battery (scoped root-compiler typecheck + infra
  suite) on the integration branch.

## Precedent

CR-P001 (domain → infra), CR-W009 (execution + shared → application) and
CR-W011 (domain + agent → marketplace): a worker needing a workspace dep
files a CR; the TL wires the lockfile entry at the next integration
checkpoint; the worker's branch already contains the consumer code that
uses the dep (here: the fabric-storage layer).
