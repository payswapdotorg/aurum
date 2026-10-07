# Aurum Architecture

Status: FROZEN
Version: 1.1
Date: 2026-10-07

## Authority hierarchy

PostgreSQL-owned Aurum semantic state
  -> authoritative company/business truth

Aurum domain/application contracts
  -> authoritative semantic rules

ZCode runtime/platform
  -> authoritative only for retained execution substrate

UI
  -> projection only

LLM/model output
  -> bounded reasoning content only

## Planes

1. Experience
2. Interaction/Runtime
3. Aurum Control Plane
4. Provider/Agent Plane
5. Execution Fabric
6. Persistence

## Experience plane

Web, Electron Desktop, CLI/headless and future Mobile.

Management control tower:
Today, Goals, Situation, Unknowns, Missions, Risks, Opportunities, Processes, Capabilities, Workforce, Agents, Lab, Executions, Evidence, Recommendations, Approvals, Marketplace, Settings.

Chat is an interaction surface.

## Runtime plane

Retain/adapt ZCode:
RPC, HTTP/WebSocket, client, AgentRuntime, tools, browser/computer use, workflows, permissions, streaming, recovery, remote attachments, artifacts and owner/lease routing.

ZCode runtime state is never promoted into Aurum semantic authority.

## Aurum control plane

Aurum owns:
tenant, identity, company world, evidence, epistemics, memory, goals, attention, missions, cognition, processes, capabilities, workforce, opportunities, actions/policy, agents, agent teams, marketplace, ExecutionPlans, information relay, learning, outcomes and audit.

## Provider/Agent plane

Provider Fabric owns:
ProviderDefinition, ProviderAccount, ProviderProtocol, ModelCatalogEntry, ModelBinding, ProviderCapability, ProviderHealth, ProviderAvailability, ProviderEvidence and SecretRef.

Agent Body is persistent, policy-scoped and model-agnostic.

Agent Gateway:
Agent Definition -> runtime/provider adapter -> execution -> normalized result/evidence/cost/outcome.

## Execution fabric

ExecutionEnvironment is canonical.
Initial adapters:
local workspace, browser, Chromium, computer, remote workspace, sandbox and future external environments.

## Organizational Lab

The Lab consumes:
goal + context fingerprint + company state + freshness + process graph + capability graph + human workforce + existing agents + marketplace candidates + software/automation + environments + constraints.

It produces:
OrganizationCandidate + evaluation evidence + recommendation.

The Lab cannot authorize, install, activate or execute.

The mixed organization search space includes:
Human, Team, Agent, AgentTeam, Software, Automation, Supplier, Partner and ExternalService.

Optimization dimensions may maximize expected goal outcome, capability coverage, quality, continuity, verification and utilization while minimizing cost, time, overload, handoffs and operational risk.

## Workforce optimization

Workforce optimization is distinct from employee performance assessment.

Pipeline:
management goal
 -> capability demand
 -> current workforce state
 -> alternative organizations
 -> human/agent/software allocation
 -> simulation/evaluation
 -> recommendation
 -> human authorization where consequential.

## Information strategy

Execution organization and information organization are coupled.

Information plan includes:
required knowledge, source/owner, recipients, freshness requirement, minimal context, review, escalation and handoff.

## Cognition

Canonical loop:
observe
 -> evidence/memory
 -> world update
 -> epistemic evaluation
 -> goal evaluation
 -> unknown/mission evaluation
 -> knowledge acquisition
 -> model update
 -> risk/opportunity/capability analysis
 -> recommendation/ask/proposal/action
 -> outcome
 -> learning.

LLM calls cannot reorder stages, authorize actions or directly persist semantic state.

## Marketplace

Marketplace governs:
AgentPackages, ExtensionPackages, RolePackages and CapabilityPackages.

Lab proposes.
Marketplace governs publication/installability.
Action authority governs activation/execution.

## Persistence

PostgreSQL = semantic truth.
Redis = queues/cache/locks.
Object storage = large artifacts.
ZCode local/session stores = runtime projections/caches.

## Package dependency direction

~~~text
shared / rpc substrate
        |
        +--> aurum-domain
        +--> aurum-provider
        +--> aurum-execution
                  |
                  +--> aurum-agent (via provider)
                  |
                  +--> aurum-application
aurum-domain ------+
aurum-provider ----+
aurum-agent -------+
aurum-execution ---+
        |
        +--> aurum-marketplace
        +--> aurum-connectors
        +--> aurum-infra

application / marketplace / connectors
        |
        +--> Web / Desktop / CLI
        |
        +--> ZCode substrate
~~~

The domain package must not depend on provider, agent, execution, marketplace, connector or application packages.
Application orchestration is the semantic integration point.

## Tenant isolation

All semantic records are tenant scoped.
Tenant identity is independent from filesystem path.
Cross-tenant access fails closed without existence leakage.

## Review triggers

Architecture review is mandatory for:
second semantic database, second company/world model, second model router, second policy engine, Lab direct execution, UI semantic authority, provider SDK leakage, marketplace bypass, secret crossing, new global mutable authority, or a new package dependency direction.
