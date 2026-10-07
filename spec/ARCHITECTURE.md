# Aurum Architecture

Status: FROZEN
Version: 1.0

Planes:
Experience -> Interaction/Runtime -> Aurum Control Plane -> Provider/Agent Plane -> Execution Fabric -> Persistence.

Experience:
Web, Electron Desktop, CLI/headless, future Mobile.
Control tower: Today, Goals, Situation, Unknowns, Missions, Risks, Opportunities, Processes, Capabilities, Workforce, Agents, Lab, Executions, Evidence, Recommendations, Approvals, Marketplace, Settings.
Chat is an interaction surface.

Runtime:
Retain/adapt ZCode RPC, HTTP/WebSocket, client, AgentRuntime, tools, browser/computer, workflows, permissions, streaming, recovery, remote attachments, artifacts and owner/lease routing.

Control plane:
tenant, identity, company world, evidence, epistemics, memory, goals, attention, missions, cognition, processes, capabilities, workforce, opportunities, actions/policy, agents, marketplace, ExecutionPlans, learning, outcomes and audit.

Provider/Agent:
ProviderDefinition, ProviderAccount, ProviderProtocol, ModelCatalogEntry, ModelBinding, capabilities/health/availability/evidence, SecretRef.
Agent Body is persistent/model-agnostic.
Agent Gateway maps Agent Definition -> adapter -> execution -> normalized result.

Execution:
ExecutionEnvironment abstraction for local, browser, Chromium, computer, remote workspace, sandbox and future environments.

Lab:
Input = goal + context + company state + freshness + process/capability graph + workforce + agents + candidates + software/automation + environments + constraints.
Output = OrganizationCandidate + evidence + recommendation.
Lab never executes.
