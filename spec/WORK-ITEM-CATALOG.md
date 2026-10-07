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
