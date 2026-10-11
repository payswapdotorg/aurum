# Aurum Rebuild Work-Item Catalog

Status: FROZEN FOR EXECUTION
Version: 1.0

Every work item has one worker, one owned path set, explicit dependencies, acceptance criteria and forbidden behavior.

## W001 — ZCode substrate hardening

Owner: W-A
Paths:
packages/shared/**, packages/rpc/**, packages/client/**, packages/server/** and assigned platform adapter seams.
Depends: W000.

Deliver:

- explicit Aurum-facing transport boundary;
- no semantic authority leakage from ZCode task/session/workspace state;
- stable platform contract seams for later Aurum packages.

Acceptance:

- ZCode baseline runtime remains operational;
- changed modules pass architecture/type/lint tests;
- platform contracts expose enough transport capability without importing Aurum domain internals.

## W002 — Aurum domain kernel

Owner: W-B
Path:
packages/aurum-domain/\*\*.
Depends: W000.

Deliver:
tenant, identity, people, organization/world, events, observations/evidence, epistemics, freshness, goals, memory foundations, action authority vocabulary and audit references.

Acceptance:

- tenant isolation at contract boundary;
- immutable/versioned records where required;
- explicit validation/error semantics;
- no IO in domain layer;
- public contract for every managed module.

## W003 — Provider + Agent Body fabric

Owner: W-C
Paths:
packages/aurum-provider/**, packages/aurum-agent/**.
Depends: W000.

Deliver:
provider/account/protocol/model/catalog/binding contracts, capability/health/availability, secret references, persistent model-agnostic Agent Body.

Acceptance:

- connect/disconnect without credential leakage;
- manual and discovered model entries;
- model swap preserves Agent Body identity;
- provider SDKs remain adapter-private;
- explicit unavailable/unknown states.

## W004 — Company query/intelligence

Owner: W-A
Path:
packages/aurum-application/**/company/** and explicitly assigned read-model adapters.
Depends: W001, W002.

Deliver:
authorized company query, coverage/provenance/freshness, situation, goal attention and unknown reporting.

Acceptance:

- answer identifies source/evidence/freshness;
- blind spots are explicit;
- insufficient evidence produces Unknown/LearningMission rather than fabricated certainty.

## W005 — Process/capability/workforce + organization contracts

Owner: W-B
Paths:
packages/aurum-domain/\*\* process/capability/workforce contracts plus worker-owned implementation in packages/aurum-application only when explicitly assigned by TL.
Depends: W002.

Deliver:
process reconstruction, capability graph, workforce workload/capacity, alternatives and shared OrganizationCandidate/ActorAssignment/CapabilityAllocation vocabulary.

Acceptance:

- employee/team/agent/software/supplier/partner supplies represented;
- gaps distinguish uncovered/level/capacity;
- human allocations have capacity bounds;
- employment-impacting recommendations preserve evidence and human decision.

## W006 — Agent Gateway + ExecutionEnvironment

Owner: W-C
Paths:
packages/aurum-execution/\*\* plus ZCode adapter seams assigned by TL.
Depends: W001, W003.

Deliver:
Agent Gateway and ExecutionEnvironment adapters for local/browser/computer/workflow/remote/sandbox.

Acceptance:

- pause/resume/cancel/recovery;
- normalized result/evidence/cost;
- runtime failures cannot rewrite semantic state;
- execution environment can be replaced behind the port.

## W007 — Cognition + learning missions

Owner: W-A
Paths:
packages/aurum-application/\*\* cognition/mission implementation.
Depends: W003, W004, W005.

Deliver:
explicit asynchronous/resumable canonical intelligence loop.

Acceptance:

- stage order is application-owned;
- LLM supplies bounded content;
- every consequential action enters authority gate;
- evidence chain is reconstructable.

## W008 — Organizational Lab

Owner: W-B
Paths:
packages/aurum-application/\*\* lab or explicitly worker-owned lab package.
Depends: W003, W005.

Deliver:
context fingerprint, mixed organization search, constrained allocation, simulation/evaluation, ranking.

Acceptance:

- same subject can yield different organizations under different context;
- humans + agents + software are jointly considered;
- optimization constraints are inspectable;
- Lab cannot execute.

## W009 — Execution Plan + information relay

Owner: W-C
Paths:
packages/aurum-application/\*\* execution planning/relay plus assigned execution contracts.
Depends: W005, W006.

Deliver:
ExecutionPlan, task dependency graph, information handoff, escalation, recovery and approval integration.

Acceptance:

- relay is minimal-context and authorization-aware;
- correlation/causation retained;
- duplicate delivery is idempotent;
- plan remains Aurum truth while ZCode workflow is execution substrate.

## W010 — Control tower + conversation

Owner: W-A
Paths:
packages/ui/**, packages/web/** and applicable Aurum application projection code.
Depends: W001, W004, W007.

Deliver:
Aurum management control tower and conversation experience.

Acceptance:

- no coding-centric primary information architecture;
- every semantic action goes through public contract;
- UI never becomes company truth;
- Web and Desktop presentation remain projection variants.

## W011 — Marketplace + recruitment

Owner: W-B
Paths:
packages/aurum-marketplace/\*\* plus assigned domain contract requests.
Depends: W003, W009.

Deliver:
AgentPackage/ExtensionPackage/RolePackage/CapabilityPackage governance and recruitment lifecycle.

Acceptance:

- publication is separate from installation;
- installation separate from activation;
- approval is separate from execution;
- tenant scope is enforced.

## W012 — Cross-platform continuity

Owner: W-C
Paths:
packages/desktop/**, apps/zcode-cli/** and assigned shared/server seams.
Depends: W001, W009, W010.

Deliver:
Web/Desktop/CLI/future-Mobile continuity, remote attachments and runtime resume.

Acceptance:

- one semantic authority;
- no second Agent Body;
- desktop continuous and web/mobile replayable semantics remain explicit;
- remote recovery does not duplicate runs.

## W013 — Outcome learning + conditional organizations

Owner: W-A
Paths:
packages/aurum-application/\*\* learning plus outcome/calibration adapters.
Depends: W007, W008, W009.

Deliver:
join outcomes to context, organization, actor allocation, model occupancy, information strategy, environment and cost.

Acceptance:

- Lab learns conditional performance, not a universal best organization;
- failed outcomes become calibration evidence;
- stale evidence is visible.

## W014 — Emergent roles + packages

Owner: W-B
Paths:
packages/aurum-marketplace/\*\* role proposal and package proposal surfaces.
Depends: W011, W013.

Deliver:
recurring gap detection and governed role/package proposals.

Acceptance:

- proposal has evidence, demand and alternatives;
- publication remains governed;
- Lab cannot self-publish.

## W015 — End-to-end certification

Owner: TL
Paths: tests/evidence/spec only unless integration requires shared wiring.
Depends: W012, W013, W014.

Deliver:
exact-SHA certification of mandatory golden journeys with live-vs-fixture disclosure.

Certification cannot be inherited by a later commit.

## P001 — Domain kernel PostgreSQL persistence

Owner: W-B (persistence lane).
Paths:
packages/aurum-infra/src/domain-storage/\*\* + packages/aurum-infra/migrations/domain/\*\*; type-level port extraction in packages/aurum-domain/\*\* (zero behavior change; no IO enters the domain package).
Depends: W002, W005.

Deliver:
PostgreSQL storage adapters implementing the aurum-domain kernel's storage ports (goals, evidence, epistemics, identity/organization, memory, action, process/capability/workforce/candidate stores): tenant-scoped schema, ordered content-hashed migrations, append-only/immutability enforced by the database, and a PGlite-backed test harness proving round-trip equivalence with the in-memory semantics.

Acceptance:

- every kernel record kind round-trips through storage with semantics identical to the in-memory reference;
- tenant isolation is uniform at the storage layer (foreign-tenant reads are indistinguishable from missing);
- append-only/versioned records are enforced by database constraints/triggers, not just runtime discipline;
- the domain package itself is unchanged semantically;
- migrations are ordered, content-hashed and idempotent to apply.

## P002 — Provider/Agent fabric PostgreSQL persistence

Owner: persistence lane.
Paths:
packages/aurum-infra/src/fabric-storage/\*\* + packages/aurum-infra/migrations/fabric/\*\*.
Depends: W003, P001.

Deliver:
PostgreSQL storage for provider definitions, model catalog, health states, agent bodies and the append-only model-binding ledger, preserving byte-for-byte body-identity-across-swap semantics and the canonical TenantId at the storage boundary; PGlite-backed round-trip proofs.

Acceptance:

- provider/agent suites pass against the PG-backed stores;
- the binding ledger stays append-only at the database level;
- body identity across model swaps survives storage round-trips;
- credential material never enters storage (secret references stay opaque).

## P003 — Lab/application PostgreSQL persistence

Owner: persistence lane.
Paths:
packages/aurum-infra/src/application-storage/\*\* + packages/aurum-infra/migrations/application/\*\* + lab storage ports in packages/aurum-application/src/lab/storage/\*\*.
Depends: W008, W013, P001, P002.

Deliver:
Storage ports for lab search records and candidate evaluations (append-only evidence carrying the outcome-learning join keys), PostgreSQL adapters, and the retrieval paths the outcome-learning loop consumes.

Acceptance:

- lab suites pass against the PG-backed stores;
- evaluations are append-only and per-tenant;
- join keys (fingerprintDigest, constraint set, weights, ranking rule) survive round-trips verbatim;
- the in-memory mode remains available (deterministic tests, no DB required) behind the same ports.

Persistence-lane rule (P-series): PostgreSQL semantic authority is constitution-primary; the P-series must not trail the in-memory semantics it persists by more than one integrated wave. P-workers reuse the P001 machinery (WriteJournal, migration runner, PGlite harness) — extend, never duplicate.
