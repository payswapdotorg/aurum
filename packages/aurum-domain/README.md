# aurum-domain

Owner: W-B
Authoritative Aurum semantic contracts and domain logic (work items W002

- W005, spec/WORK-ITEM-CATALOG.md).

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

W005 extends the kernel with the Operating Model semantics
(spec/DOMAIN-MAPPING.md) and the shared organizational vocabulary:

- **process reconstruction** — processes + steps (manual/automated/hybrid
  with typed performers from the shared supplier vocabulary), handoffs
  between steps/performers, named variants with declared shares,
  append-only process revisions; append-only metric observations (manual
  effort, waiting time, errors, throughput, utilization, declared
  duplication) carrying provenance and freshness; pure
  `analyzeProcess` exposure lens (bottleneck via explicit policy,
  duplication, handoffs, totals, variant coverage);
- **capability graph** — capabilities supplied by
  employee/team/agent/software/supplier/partner (`SupplierReference`,
  shared core vocabulary); requirements arising from
  goal/process/project/opportunity/manual; gap classification as a pure
  function (`assessCoverage`) distinguishing **uncovered / level /
  capacity** shortfalls; gap records appended by `recomputeGaps`
  (kernel-generated ids, history retained for calibration);
- **workforce** — roles with required capabilities; human capacity
  declarations (effort + concurrency bounds per period); work assignments
  that are **rejected unless bounded** by a covering declaration; pure
  workload summaries (utilization, observed over-capacity); workload
  observations, outcomes and alternative explanations as evidence records;
  workforce recommendations (training / reassignment / hiring /
  agent-complement / agent-replacement / automation / outsourcing) that are
  advisory by construction: employment-impacting proposals require
  non-empty evidence, inherently impacting adjustments cannot be un-flagged,
  and decisions are **human-only and immutable** (never auto-decided);
- **frozen shared organizational vocabulary** — `OrganizationCandidate`
  with mixed human/team/agent/agent-team/software/automation/supplier/
  partner/external-service actors, `ActorAssignment`, and
  `CapabilityAllocation`, execution topology (steps + delegation/review/
  escalation/handoff edges), information topology (knowledge flows with
  source/owner/recipients, freshness requirement, minimal context, review,
  escalation, handoff triggers), model occupancy (opaque model binding
  references for agent actors), environment references, budget, expected
  outcome, risks and mandatory evidence; contextual constraint shapes
  (season, window, duration, staffing, experience, workload, geography,
  budget, SLA, quality, inspection intensity, risk tolerance, environment
  capability, evidence freshness) with deep structural validation and a
  deliberately tiny registry (register/get/list — candidates are
  proposals; activation/execution are owned downstream).

## Guarantees (test-proven)

- tenant isolation at the contract boundary: a foreign-tenant reference is
  uniformly not-found — no existence leaks, identical error shape for
  foreign vs. never-existing ids (W002 and W005 stores alike);
- immutable/versioned records: revisions append-only, previously returned
  record objects are deep-frozen and never mutated;
- typed error semantics: every failure is a structured `DomainError` inside
  a `Result` — never a thrown bare string;
- human allocations have capacity bounds: assignments without a covering
  declaration, or beyond the effort/concurrency bounds, are rejected;
- employment-impacting recommendations preserve evidence and the human
  decision: evidence is mandatory at proposal, only person actors may
  decide, decisions are immutable, and no code path can auto-decide;
- no IO in the domain layer (the architecture checker enforces it).

## Not in scope (deliberate)

- persistence (PostgreSQL remains the semantic persistence authority),
- clocks (callers pass `now` explicitly; the kernel never reads time),
- id generation (ids are caller-supplied opaque strings; only audit ids
  and capability-gap ids are sequential and kernel-generated),
- outcome evaluation / goal status (W004/W013), the Organizational Lab and
  candidate search/simulation (W008), ExecutionPlan / information relay
  execution (W009), marketplace governance (W011),
- referential validation across stores for opaque references (capability
  requirement sources, workforce assignment process refs, candidate
  environment/model-binding/goal references): the domain validates shapes
  and cross-references _within_ one record; existence of referenced
  records in other stores is the application layer's responsibility.

## Usage

```ts
import { createDomainKernel, tenantScope } from "@aurum/domain";

const scope = tenantScope("acme");
const kernel = createDomainKernel();
```

Public surface: `src/contract.ts` (composed re-exports of the narrow area
contracts), re-exported by `src/index.ts` — the only import path for other
modules.
