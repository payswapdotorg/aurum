# CR-W011 — wire `@aurum/domain` + `@aurum/agent` into `@aurum/marketplace`

- **Work item:** W011 (packages/aurum-marketplace/src/\*\*)
- **Requester:** W-B (W011 dispatch)
- **Owner of requested change:** TL (root `pnpm-lock.yaml` + dependency wiring; the
  marketplace `package.json` is worker-owned but the lockfile is TL-owned per the
  W011 hard laws — the exact CR-W009 situation)
- **Status:** open (filed with the W011 delivery)

## Requested change

Add two workspace dependencies to `packages/aurum-marketplace/package.json`:

```jsonc
{
  "dependencies": {
    "@aurum/domain": "workspace:*",
    "@aurum/agent": "workspace:*",
  },
}
```

then run one `pnpm install` so the lockfile records the new
`link:../aurum-domain` and `link:../aurum-agent` entries for
`packages/aurum-marketplace` (mirroring exactly how CR-W009 requested the
execution/shared links for `@aurum/application`).

## Reason

`architecture-policy.yaml` ALREADY lists these as policy-approved deps for
the marketplace module:

```yaml
- id: aurum-marketplace
  requires: [shared, aurum-domain, aurum-agent]
```

and `packages/aurum-marketplace/src/module.ts` already declares the same
`requires` list (the tripwire suite asserts the manifest mirrors the policy
exactly). So the architecture checker will NOT flag the imports — only the
package resolution is missing.

The W011 delivery ships with NO changes to `package.json` or
`pnpm-lock.yaml` (both frozen per the hard laws; a package.json dep without
the lockfile entry would break `pnpm install --frozen-lockfile` on TL
verification, and manual symlinks would not survive a fresh install —
exactly the CR-W009 analysis).

## What the marketplace needs the deps for (post-CR)

1. **The domain-kernel registration adapter**
   (`src/marketplace/adapters/domain-kernel-registration-adapter.ts`,
   currently a documented stub — the W009 `w006-substrate-adapter`
   pattern). The real adapter composes the kernel's
   `OrganizationCandidateRegistry.registerCandidate` /
   `WorkforceDirectory.registerRole` inputs from marketplace records BY
   REFERENCE (packageRef/installationRef/activationRef as opaque
   `agentBodyRef`/`externalRef`/`evidenceRefs` — never record copies).
2. **The W002 authority adapter** — a thin pass-through to the kernel's
   `ActionAuthority` citation assertion (the marketplace's
   `MarketplaceAuthorityPort` is the structural pick, exactly like W009's
   `PlanApprovalAuthority`).
3. **Vocabulary identity assertions** — the marketplace's local mirrors
   (`MARKETPLACE_AGENT_CAPABILITIES`, `MARKETPLACE_BODY_MODEL_PURPOSES`,
   `MARKETPLACE_CANDIDATE_ACTOR_KINDS`, primitives) become
   compile-time-asserted identical to the upstream frozen sets (today the
   tripwire suite source-scans the upstream files and asserts content
   equality).

## Interim state shipped (until the CR resolves)

The W011 delivery compiles and passes ALL acceptance gates against:

- LOCAL structural port shapes + primitives
  (`src/marketplace/domain/{ports,primitives}.ts`) that mirror the kernel's
  public vocabulary (TenantScope / ActorReference / ProvenanceRecord /
  AuditInput / Result — documented per-symbol with the mirrored kernel
  file).
- A LOCAL in-process W002 authority double + W005 registration double
  (`src/marketplace/adapters/in-memory-{authority,workforce-registration}.ts`).
- The tripwire
  `test/marketplace-tripwires.test.ts` asserts the mirrored closed sets are
  EXACTLY equal (content) to `@aurum/agent`'s and `@aurum/domain`'s frozen
  sources — so a drift in either direction fails the suite today.

## Compatibility impact

- No behavioral change at runtime until the real adapters land; the doubles
  are deterministic and exported from the public surface (house pattern:
  `@aurum/agent` exports its own doubles from the public entrypoint).
- No other package imports `@aurum/marketplace` yet (W014 is the first
  consumer; W011's final report carries the consumer notes).
- `pnpm install --frozen-lockfile` stays green on this branch because
  neither `package.json` nor the lockfile changed.

## Tests / migration

- After the TL runs `pnpm install`, the W011 worker (or TL) can land the
  real adapter bodies inside the existing stub files (the composed kernel
  input shapes are documented in the stub's header comment).
- The existing 82-proof suite is adapter-agnostic (it wires the doubles);
  a follow-up proof suite against the real kernel seams can mirror the
  drafted `plans-w006-real-adapter` pattern from W009.

## Precedent

CR-W009 (rpc → shared link; execution + shared → application) established
the pattern: a worker needing a workspace dep files a CR; the TL wires the
lockfile entry at the next integration checkpoint; the worker's branch
already contains the consumer code that uses the dep (here: the documented
stub adapters + structural ports).
