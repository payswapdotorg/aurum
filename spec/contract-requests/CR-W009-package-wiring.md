# CR-W009 — wire `@aurum/execution` + `@zcode/shared` into `@aurum/application`

- **Work item:** W009 (packages/aurum-application/src/plans/**)
- **Requester:** W-C (W009 dispatch)
- **Owner of requested change:** TL (root `pnpm-lock.yaml` + dependency wiring; the
  application `package.json` itself is in-scope for the worker but the lockfile
  is TL-owned per W009 hard laws)
- **Status:** open (2026-10-12, W-C dispatch 1)

## Requested change

Add two workspace dependencies to `packages/aurum-application/package.json`:

```jsonc
{
  "dependencies": {
    "@aurum/domain": "workspace:*",
    "@aurum/execution": "workspace:*",   // ← new
    "@zcode/shared": "workspace:*"       // ← new
  }
}
```

then run one `pnpm install` so the lockfile records the new
`link:../aurum-execution` and `link:../shared` entries for
`packages/aurum-application` (mirroring exactly how CR-W001 wired the
`@zcode/shared` link into `@aurum/rpc` for the W006 worker).

## Reason

W009's hard law states: *"the execution-substrate adapter lives in `adapters/`
and goes through the W001/W006 public surfaces ONLY."* That adapter is
`packages/aurum-application/src/plans/adapters/w006-substrate-adapter.ts` —
it submits approved+ready plan tasks to the W006 Agent Gateway
(`@aurum/execution`'s public `createAgentGateway` / `AgentGateway` surface,
which is itself a thin composition over the W001 boundary's
`AurumSeamRegistry` + `AurumExecutionTransportPort` from
`@zcode/shared/aurum-boundary`).

`architecture-policy.yaml` already lists these as policy-approved deps for
the application module:

```yaml
- id: aurum-application
  requires: [shared, aurum-domain, aurum-provider, aurum-agent, aurum-execution]
```

and `packages/aurum-application/src/module.ts` already declares the same
`requires` list. So the architecture checker will NOT flag the imports —
only the package resolution is missing.

W009's hard law also says *"pnpm-lock.yaml: zero edits."* Adding the deps
without the lockfile entry breaks `pnpm install --frozen-lockfile` (CI red
on TL verification). Manual symlinks would not survive a fresh
`pnpm install --frozen-lockfile` either. So the wiring must be TL-owned,
exactly like CR-W001.

## Compatibility impact

- The existing `test/contract-hygiene.test.ts` (W008 lab hygiene) asserts
  `expect(pkg.dependencies).toEqual({ "@aurum/domain": "workspace:*" })`. The
  W009 dispatch lands new deps that the architecture policy already approves;
  the assertion must be relaxed to allow the new entries. The W009 worker is
  NOT touching `test/contract-hygiene.test.ts` (it is outside W009's owned
  paths). The TL must update that assertion as part of the CR — suggested
  replacement:

  ```ts
  expect(pkg.dependencies).toEqual({
    "@aurum/domain": "workspace:*",
    "@aurum/execution": "workspace:*",
    "@zcode/shared": "workspace:*",
  });
  ```

- No behavioral change at runtime until W009's substrate adapter file is
  committed. The presence of the dep declarations alone is type-only.
- `@aurum/execution` is itself already wired with `@zcode/shared` (CR-W001 +
  W006 merge `616c413`), so the transitive boundary surface is reachable
  transitively through `@aurum/execution`'s re-exports. The explicit
  `@zcode/shared` dep is declared because the substrate adapter also
  consumes the boundary's `AurumSeamRegistry` shape directly (mirroring
  `@aurum/execution`'s own pattern in `packages/aurum-execution/src/app/gateway.ts`).

## Interim consumer guidance (until resolved)

The W009 worker is shipping the W009 delivery WITHOUT this CR resolved. The
plans domain + app + adapters layers compile and pass all W009 acceptance
gates against:

- A LOCAL port shape `ExecutionSubstratePort`
  (`packages/aurum-application/src/plans/domain/ports.ts`) that is
  structurally compatible with `@aurum/execution`'s `AgentGateway` and
  `ExecutionSettlement` surfaces (verified by structural-assignability
  tests once the CR lands).
- A deterministic IN-PROCESS double
  (`packages/aurum-application/src/plans/adapters/in-process-substrate.ts`)
  that implements `ExecutionSubstratePort` without importing
  `@aurum/execution` (pure in-process simulation — proves all W009
  invariants: plan-is-truth, minimal-context, correlation/causation,
  idempotency, authorization-awareness, escalation-proposes/disposes).
- The real W006 pass-through adapter file
  (`packages/aurum-application/src/plans/adapters/w006-substrate-adapter.ts`)
  exists as a documented stub: it imports `@aurum/execution` and
  `@zcode/shared/aurum-boundary` and is a thin pass-through. Until the CR
  resolves, the file is gated behind the dep resolution and will compile
  once the lockfile entry is added.

The truth-law tripwire (no execution-session id ever appears in plan
records) scans `packages/aurum-application/src/plans/domain/**` and passes
today because the domain layer imports only `@aurum/domain`.

## Tests / migration

- After TL runs `pnpm install`, the W009 worker (or TL) can land the real
  adapter file (already drafted in this dispatch). All existing W008 lab
  tests and the new W009 tripwires stay green.
- A follow-up W009 proof test (`test/plans-w006-real-adapter.test.ts`, also
  drafted in this dispatch behind the dep gate) demonstrates the real
  substrate adapter against a real `@aurum/execution` gateway built over a
  stub transport — proving the local port shape is structurally identical
  to `@aurum/execution`'s public `AgentGateway`.

## Precedent

CR-W001 (rpc envelope re-export) established the pattern: a worker needing a
workspace dep files a CR; the TL wires the lockfile entry at the next
integration checkpoint; the worker's branch already contains the consumer
code that uses the dep.
