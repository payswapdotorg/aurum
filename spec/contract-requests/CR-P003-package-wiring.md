# CR-P003 — wire `@aurum/application` into `@aurum/infra`

- **Work item:** P003 (packages/aurum-infra/src/application-storage/** +
  packages/aurum-infra/migrations/application/** + lab storage ports in
  packages/aurum-application/src/lab/storage/\*\*)
- **Requester:** persistence lane (P003 dispatch)
- **Owner of requested change:** TL (root `pnpm-lock.yaml` + the
  `architecture-policy.yaml` requires list; the infra `package.json`
  dependency block, `src/module.ts` and the interim alias/paths below are
  worker-owned — the exact CR-P001/P002 situation)
- **Status:** OPEN (filed at P003 delivery)

## Requested change

Add one workspace dependency to `packages/aurum-infra/package.json`:

```jsonc
{
  "dependencies": {
    "@aurum/application": "workspace:*",
  },
}
```

then run one `pnpm install` so the lockfile records the
`link:../aurum-application` entry under the `packages/aurum-infra` importer
(mirroring exactly how CR-P001 wired `@aurum/domain`, CR-P002 wired
`@aurum/provider` + `@aurum/agent`, CR-W009 wired execution+shared into
application).

And extend the `aurum-infra` module's policy dependency list in
`architecture-policy.yaml` (TL-owned file) to match the already-updated
`packages/aurum-infra/src/module.ts`:

```yaml
- id: aurum-infra
  requires: [shared, aurum-domain, aurum-provider, aurum-agent, aurum-application]
```

## Reason

The P003 delivery implements the application storage ports defined in
`@aurum/application` (`src/lab/storage/**` — the async twins of the W008
`LabEvaluationStore` and the W013 `OutcomeStore`) as PostgreSQL adapters:

- the adapter modules import the port/record TYPES and reuse the exported
  reference error constructors at runtime (`labNotFound`,
  `labEvaluationAppendRefusal`, `learningConflict`, `learningNotFound`) so
  the PG-backed stores resolve byte-identical typed errors to the
  in-memory references (the P001 ruling-10 discipline: exported helpers are
  imported, never re-implemented);
- the proof suites drive the REAL application services
  (`createOrganizationalLab`, `createOutcomeLearning`), the real
  `assembleOutcomeJoin` / `calibrateEvidence` / `applyConditionalCalibration`
  join/calibration functions and the async in-memory doubles over the
  PG-backed stores plus the in-memory references for the equivalence
  oracle (the P002 equivalence ruling, adapted to the sync/async seam —
  see application-storage/WORK-NOTES.md).

`architecture-policy.yaml` does NOT yet list the dep for aurum-infra. The
architecture checker resolves only relative imports (package-specifier
imports are invisible to it), so the gates stay green on the branch — but
the policy list is the human-approved dependency truth, which is why its
update belongs in this CR rather than silently on the worker branch
(the CR-P002 rationale, unchanged).

Those imports resolve today through two worker-owned interim bridges, not
through a real dependency link:

1. `packages/aurum-infra/tsconfig.json` — `"paths"` mapping
   `@aurum/application` → `../aurum-application/dist/index.d.ts`
   (root-compiler typecheck; the gate batch `tsc -b packages/aurum-application
packages/aurum-infra` builds the application dist first);
2. `packages/aurum-infra/vitest.config.ts` — a resolve alias pointing the
   specifier at the package's public entry SOURCE (the proof suites).

Neither bridge survives consumer-side resolution: plain node ESM imports of
`@aurum/application` from inside `packages/aurum-infra` fail with
`ERR_MODULE_NOT_FOUND` until the link exists, and `pnpm install
--frozen-lockfile` on a fresh clone would not create any link for later
consumers to inherit.

## Post-CR cleanup (worker-owned, at TL integration)

Once the TL has run `pnpm install` and the link exists, the interim bridges
should be REMOVED so a broken link can never be masked:

- drop the `paths` entry from `packages/aurum-infra/tsconfig.json`;
- drop the resolve alias from `packages/aurum-infra/vitest.config.ts`.

Both bridges point at the same public entrypoint the real link provides, so
behavior is identical before and after.

## Why the delivery does not ship the dep itself

The P-series hard laws freeze `package.json` + `pnpm-lock.yaml` on worker
branches (a package.json dep without the lockfile entry breaks
`pnpm install --frozen-lockfile` on TL verification, and manual symlinks do
not survive a fresh install — the CR-P001/P002 analysis, unchanged).

## Compatibility impact

- No behavioral change at runtime: the bridges and the eventual link
  resolve the identical public entrypoint.
- The dependency direction is one-way (infra → application); the
  application package never imports infra (its storage ports are
  IO-free types + async in-memory doubles only), so no cycle is created.
- `@aurum/application` is imported from infra for runtime helpers as well
  as types (the four error constructors) — it becomes a real link.
- The application package's own hygiene suite pins ITS package.json
  dependencies exactly (workspace-only: domain/execution/shared) — the CR
  does not touch that package's manifest.
- `pnpm install --frozen-lockfile` stays green on this branch because
  neither `package.json` nor the lockfile changed here.

## Tests / migration

- The application-storage proof suites are bridge-agnostic (they run under
  the alias today and under the link after the CR — the same specifier
  either way).
- After the CR resolves, the removal of the two interim bridges is itself
  verified by the full gate battery (scoped root-compiler typecheck + infra
  suite) on the integration branch.

## Precedent

CR-P001 (domain → infra), CR-P002 (provider + agent → infra), CR-W009
(execution + shared → application) and CR-W011 (domain + agent →
marketplace): a worker needing a workspace dep files a CR; the TL wires the
lockfile entry at the next integration checkpoint; the worker's branch
already contains the consumer code that uses the dep (here: the
application-storage layer).
