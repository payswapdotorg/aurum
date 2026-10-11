# CR-W001 — rpc thin re-export of the boundary normalized result envelope

- **Work item:** W001 (packages/shared, packages/rpc)
- **Requester:** W-A
- **Owner of requested change:** TL (root pnpm-lock.yaml + dependency wiring; rpc
  path itself is W-A-owned but cannot be wired without the lockfile)
- **Status:** executed (2026-10-11, TL) — PR #2 merged 4e8b35d: workspace link + lockfile entry + type-only re-export + rpc tsconfig project-reference (the reference was required: without it typecheck dragged shared source into rpc's context). W-A's follow-up commit is unnecessary — the TL landed the re-export module in the same change.

## Requested change

Add `@zcode/shared` as a workspace dependency of `@zcode/rpc` (one line in
`packages/rpc/package.json` + the mechanically-required lockfile entry), so
that `packages/rpc/src` can host a THIN re-export of the W001 boundary's
normalized result envelope:

```ts
// packages/rpc/src/aurum-boundary-envelope.ts (proposed, W-A-owned)
export type { AurumTransportResultEnvelope, AurumTransportCostLine } from "@zcode/shared";
```

plus one export line in `packages/rpc/src/index.ts`.

## Reason

The W001 work order asked for this re-export so later packages (W006 Agent
Gateway / ExecutionEnvironment adapters) can route normalized results over
the rpc channel WITHOUT importing from `@zcode/shared` internals directly.
The boundary surface itself already ships in `@zcode/shared`
(`src/aurum-boundary/`, also exposed as the `./aurum-boundary` subpath
export), but `@zcode/rpc` currently declares NO dependency on
`@zcode/shared` (verified: no entry in package.json nor in pnpm-lock.yaml),
and rpc's tsconfig (`rootDir: "src"`, no project reference to shared) makes
a relative cross-package import a TS6059 error and an architecture
deep-import violation.

Adding the dependency is outside W001's hard laws:

1. NO NEW DEPENDENCIES: nothing may be added to any package.json except the
   vitest test script line.
2. pnpm-lock.yaml is TL-owned — a new workspace dependency without the
   lockfile entry breaks `pnpm install --frozen-lockfile` (TL verification
   and CI would go red).
3. The re-export would touch 3 existing files (rpc/package.json,
   pnpm-lock.yaml, rpc/src/index.ts) — over the work order's own "at most
   2 existing files" ceiling.

## Proposed shape (post-CR)

- TL adds `"@zcode/shared": "workspace:*"` to `packages/rpc/package.json`
  dependencies and runs one `pnpm install` to record the lockfile entry
  (mirroring how the @aurum/provider link was wired at W003 merge).
- W-A then lands the re-export module + one index.ts export line in a
  follow-up commit on the same branch (no behavioral change, type-only).

## Compatibility impact

- None at runtime; type-only re-export.
- rpc consumers see two additional type-only exports.

## Tests / migration

- W001 leakage tripwires and consumer tests stay green (they scan
  `packages/shared/src/aurum-boundary` only).
- A follow-up rpc-side test would assert the re-export resolves to the same
  structural shape as `@zcode/shared/aurum-boundary`.

## Interim consumer guidance (until resolved)

W006/W004 consumers should import the boundary from shared directly:

```ts
import type { AurumTransportResultEnvelope } from "@zcode/shared/aurum-boundary";
```

The rpc channel itself (`IChannel.call/listen`, VSBuffer serialization)
already carries arbitrary typed payloads; routing envelopes over it does
not require the rpc re-export — it is an ergonomics improvement only.
