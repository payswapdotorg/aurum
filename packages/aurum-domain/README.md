# aurum-domain

Owner: W-B
Authoritative Aurum semantic contracts and domain logic (work item W002,
spec/WORK-ITEM-CATALOG.md).

## What this module is

The Aurum **domain kernel**: tenant-scoped contracts plus pure, in-memory
reference logic for the Foundation + Intelligence vocabulary
(spec/DOMAIN-MAPPING.md):

- **tenant + identity** — `TenantScope` carried by every record and every
  contract operation; people references (opaque ids + typed labels);
  memberships and the roles vocabulary;
- **organization world model** — organization (company) entities, sites,
  units (forest with cycle prevention);
- **events + evidence** — event records and Observations (evidence
  encountered), each retaining provenance, freshness and status;
- **epistemics** — Claim (evidence-derived proposition), Belief (versioned
  current understanding, append-only revisions), Hypothesis (unresolved
  explanation with append-only status history), **Contradiction (retained
  conflict — never auto-merged)**, Unknown (consequential question plus
  consequence), Freshness (explicit temporal-validity classification with an
  explicit `unknown` class);
- **goals** — objective, desired state, metrics/thresholds, horizon, owner,
  priority, expected evidence, success criteria; immutable goal revisions
  (append-only history);
- **organizational memory foundations** — versioned knowledge records with
  provenance (organizational knowledge, _not_ model runtime memory);
- **action authority vocabulary** — proposed → recommended → approved →
  authorized → executed (+ rejected), policy descriptors, human-only
  approval/authorization with tenant-scoped role checks, recorded human
  decision for employment-impacting actions;
- **audit references** — who/what/when/why for every consequential
  transition, append-only and tenant-scoped.

## Guarantees (test-proven)

- tenant isolation at the contract boundary: a foreign-tenant reference is
  uniformly not-found — no existence leaks, identical error shape for
  foreign vs. never-existing ids;
- immutable/versioned records: revisions append-only, previously returned
  record objects are deep-frozen and never mutated;
- typed error semantics: every failure is a structured `DomainError` inside
  a `Result` — never a thrown bare string;
- no IO in the domain layer (the architecture checker enforces it).

## Not in scope (deliberate)

- persistence (PostgreSQL remains the semantic persistence authority),
- clocks (callers pass `now` explicitly; the kernel never reads time),
- id generation (ids are caller-supplied opaque strings; only audit ids are
  sequential and kernel-generated),
- outcome evaluation / goal status (W004/W013), process/capability/
  workforce contracts (W005), Lab (W008).

## Usage

```ts
import { createDomainKernel, tenantScope } from "@aurum/domain";

const scope = tenantScope("acme");
const kernel = createDomainKernel();
```

Public surface: `src/contract.ts` (composed re-exports of the narrow area
contracts), re-exported by `src/index.ts` — the only import path for other
modules.
