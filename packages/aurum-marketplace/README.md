# aurum-marketplace

Owner: W-B
Package governance and recruitment (W011).

## What lives here

The four package kinds (`AgentPackage` / `ExtensionPackage` /
`RolePackage` / `CapabilityPackage`) and the four SEPARATE governance
machines:

1. **PUBLICATION** — the tenant catalog gate (draft → submitted →
   published | rejected; review is human-governed; published versions are
   deep-frozen and immutable).
2. **INSTALLATION** — a tenant installs a PUBLISHED version → per-tenant
   `installed` record with a configuration surface (append-only revision
   history); installed → uninstalled is terminal; the installed version is
   pinned.
3. **ACTIVATION** — an installed package is activated for specific
   actors/scopes with a DECLARED grant list (what the package may touch);
   activated → deactivated is terminal.
4. **EXECUTION APPROVAL** — the citation ledger: consumers request
   execution use (PROPOSE) and cite the W002 action-authority seam's
   approval (DISPOSE). The marketplace NEVER executes anything — the `cited`
   record is the input the W009 plan/execution planes consume through their
   own approval seams.

Plus the **recruitment lifecycle**: request (need + constraints + evidence
requirements) → deterministic ranked candidate packages (inspectable
criteria + weights) → sequenced installation + activation of the chosen
one → registration into the W005 candidate/workforce seams BY REFERENCE →
eligible for plan allocation.

## Layout (house layering)

```
src/marketplace/
  domain/       pure records + the four machines + recruitment + ports
  app/          command orchestration + the service factory
  adapters/     in-memory stores, authority/registration doubles,
                deterministic catalog double, domain-kernel registration
                adapter (documented stub — post CR-W011)
  contract.marketplace.ts   the area public surface (re-exported by
                            src/contract.ts → src/index.ts)
```

## Recorded debt

- **P-series persistence debt**: all stores are in-memory (catalog,
  governance, audit ledger) per the house pattern; PostgreSQL storage is
  the TL-tracked P-series lane. The storage ports
  (`MarketplaceCatalogStore` / `MarketplaceGovernanceStore` /
  `MarketplaceAuditPort`) are the seams a P-worker implements.
- **CR-W011-package-wiring** (spec/contract-requests/): the
  `@aurum/domain` + `@aurum/agent` workspace links are TL-owned lockfile
  changes; the local structural mirrors + doubles are the interim state.
- The real domain-kernel registration/authority adapters are documented
  stubs until that CR resolves (W009 precedent).

## Gates

```bash
npx tsc -b packages/aurum-marketplace
pnpm --filter @aurum/marketplace test
```
