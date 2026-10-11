# Aurum-Boundary — the Aurum-facing transport boundary (W001)

This directory is the **single place** where Aurum-facing platform
capabilities are declared (`spec/WORK-ITEM-CATALOG.md` §W001, TL concrete
assignment). Everything here is pure TypeScript over stdlib only: no
package imports, no runtime dependencies, no ZCode substrate types, no
Aurum domain types.

## What lives here

| File             | Role                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lifecycle.ts`   | Platform lifecycle vocabulary (`pending/running/paused/settled/cancelled/failed`) + type guards                                                                       |
| `capability.ts`  | Capability classes (`local/browser/computer/workflow/remote/sandbox`, plain string unions) + descriptor shape + control surface                                       |
| `errors.ts`      | Typed error vocabulary: `AurumBoundaryErrorDetail` (plain data) and `AurumBoundaryError` (Error subclass); closed code union; `toAurumBoundaryErrorDetail` normalizer |
| `identifiers.ts` | Opaque `AurumSubmissionTicket` / `AurumCapabilityHandle` branded strings + adapter-side mint functions                                                                |
| `envelope.ts`    | The normalized result envelope (`status/result/error/cost/evidenceRef`) + structural guard                                                                            |
| `transport.ts`   | `AurumExecutionTransportPort` (submit / poll / awaitCompletion / cancel) + optional `AurumPausableTransportPort` (pause/resume)                                       |
| `seam.ts`        | `AurumSeamRegistry`: how Aurum obtains a capability handle (lookup, describe) without importing ZCode internals                                                       |
| `index.ts`       | The public surface (re-exported once by `packages/shared/src/index.ts`)                                                                                               |

Tests: `boundary-leakage.test.ts` (tripwires) and
`boundary-surface.consumer.test.ts` (structural consumer). Run from repo
root: `pnpm --filter @zcode/shared test`.

## Which substrate capabilities each port adapts

| Boundary concept              | ZCode substrate being adapted (RETAIN/ADAPT per spec/ZCODE-SUBSTRATE-MAP.md)                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilityClass: "local"`    | local workspace process execution (apps/zcode-cli runtime/tools substrate)                                                                                                |
| `capabilityClass: "browser"`  | browser-use substrate (`packages/shared/src/browser-use`, browser tooling)                                                                                                |
| `capabilityClass: "computer"` | computer-use substrate (`packages/zcode-cua` desktop/GUI driving)                                                                                                         |
| `capabilityClass: "workflow"` | dynamic workflow backend (execution substrate for Aurum ExecutionPlans, W009)                                                                                             |
| `capabilityClass: "remote"`   | remote workspace attachment (ssh / wsl / docker remotes in `packages/server/src/remote`)                                                                                  |
| `capabilityClass: "sandbox"`  | isolated/sandboxed environments                                                                                                                                           |
| `AurumExecutionTransportPort` | the RPC channel substrate (`packages/rpc`: ChannelServer/ChannelClient/IPC layers 0–6) as the transport carrying submissions and envelopes                                |
| `AurumSeamRegistry`           | the substrate-side adapter that owns the real environments and issues opaque handles; keeps environment configuration, addresses and credentials entirely behind the seam |

## Canonical flow (from spec/ZCODE-SUBSTRATE-MAP.md)

```text
Aurum command
  -> application service (Aurum control plane; W004/W007)
  -> Agent/Execution port (W003/W006: Agent Gateway, ExecutionEnvironment)
  -> ZCode adapter (implements AurumExecutionTransportPort; W006)
  -> execution (ZCode substrate: local/browser/computer/workflow/remote/sandbox)
  -> normalized result envelope (AurumTransportResultEnvelope — this directory)
  -> Aurum outcome/evidence (application resolves opaque result/evidenceRef
     into semantic records; PostgreSQL-owned state stays the only authority)
```

Usage for Aurum packages (W004/W006 consumers):

1. Obtain a capability handle from the seam registry (`lookup` — returns
   `{ ok: true, handle, descriptor } | { ok: false, error }`; never throws).
2. `submit({ capability: handle, payload, payloadMediaType, submissionKey? })`
   → `AurumTransportSubmissionAck` (idempotent per `submissionKey`).
3. `awaitCompletion(ticket)` → `AurumTransportResultEnvelope`
   (or `poll` for snapshots; `cancel` to stop; `pause`/`resume` only via
   the pausable extension when the descriptor declares support).
4. Translate the envelope into Aurum semantics on the Aurum side only.

## Explicit NON-goals

- **No semantic authority.** The boundary describes platform execution
  progress only; it never decides what an outcome means for Aurum. ZCode
  task/session/workspace state is never promoted (constitution: identity
  separation — ZCode Session ≠ Aurum Conversation, ZCode Task ≠ Aurum
  Execution/Mission Run, etc.).
- **No Aurum domain imports**, ever — locked by tripwire test
  (no `@aurum/domain|provider|agent|execution|application|marketplace|
connectors|infra` import anywhere under this directory).
- **No ZCode semantic-state export names** — locked by tripwire test (no
  exported identifier contains `task`, `session`, `workspace`,
  `agentruntime`, `workflowjournal`, `pluginregistry`, `providerconfig`,
  or `zcode`).
- **No second state.** The boundary introduces zero storage, zero
  registries of truth, zero policy. Handles/tickets are opaque references
  meaningful only to the issuing adapter; the envelope is a message, not a
  record of authority.
- **No secrets, no addresses, no configuration** cross this boundary.
  Everything environment-specific stays behind the seam.
- **No behavior change to the ZCode substrate.** This directory is
  additive-only; existing substrate code is untouched (W001 hard law).

## Hard rules for extending this directory

1. New contracts stay pure TypeScript, stdlib-only, and opaque-typed.
2. Add or extend vocabulary as plain string unions with type guards.
3. Update both tests: the tripwires must cover the new surface, and the
   consumer test must exercise the new shapes.
4. Keep `architecture-policy.yaml` module limits in spirit even though
   `shared` is `managed: false` (≤400 lines/file, no lint disables).
5. The mint functions are for adapters and test doubles only — consumer
   code receives tickets/handles, never constructs them.
