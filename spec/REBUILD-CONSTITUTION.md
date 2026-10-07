# Aurum Rebuild Constitution

Status: FROZEN
Version: 1.0
Date: 2026-10-07

Canonical repository: payswapdotorg/aurum
Upstream baseline: zai-org/ZCode@29628c9acdb81b703bbd4080c207a0e7ce5e276e (v3.14.3)
feat/ui-plugin is non-canonical until separately evaluated.

PostgreSQL-owned Aurum semantic state is authoritative.
ZCode runtime/session/task stores are projections/caches.
UI state is projection-only.
LLM calls are bounded reasoning content.

This is a rebuild: do not port old Aurum implementation wholesale. Recreate approved semantics as contracts here.

Identity separation:
ZCode Session != Aurum Conversation
ZCode Task != Aurum Execution/Mission Run
ZCode Model != Aurum ModelBinding
ZCode Provider != Aurum ProviderDefinition/Account
ZCode AgentRuntime != Aurum AgentBody
ZCode Workflow != Aurum ExecutionPlan
ZCode Plugin != Aurum Marketplace package

Every mutable fact has one owner, one command path, one persistence authority, and explicit replay/idempotency/stale-result rules.

Provider/account/protocol/model/capability/availability/health/evidence/credentials remain separate. Provider SDK types never enter domain contracts. Secrets are opaque references.

Agent Body is persistent and model-agnostic. Model swaps preserve body identity, memory, goals, evidence and permissions.

Lab may simulate, evaluate, compare, recommend, learn and propose roles. It may not authorize, install, activate or execute.
Lab optimizes mixed organizations of humans, teams, agents, software, automation, suppliers, partners and external services.
Human workforce allocation is first-class.

Aurum jointly optimizes execution organization and information organization.
Employment-impacting recommendations remain human-authorized.
Clients project shared authorities and do not create a second semantic brain.

DELIVERED requires implementation, required tests, architecture verification, security/tenant proof, evidence and exact SHA.
CERTIFIED additionally requires exact deployment/revision evidence.

Mandatory journeys:
provider/model swap without body replacement;
ride -> Ride Agent -> PaySwap Agent -> payment;
construction goal -> contextual Lab -> mixed organization -> ExecutionPlan -> relay -> evidence/deviation;
human workforce optimization;
context-conditioned organization change;
cross-platform continuity;
crash/reconnect recovery.

Architecture review is mandatory for a second semantic DB/model/policy router, direct Lab execution, UI semantic authority, provider SDK leakage, marketplace bypass, secret crossing, or a new global mutable authority.
