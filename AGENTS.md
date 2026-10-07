# Aurum Rebuild Agent Instructions

This repository is the sole implementation source of truth for the Aurum rebuild.

Read before behavior changes:
spec/REBUILD-CONSTITUTION.md
spec/ARCHITECTURE.md
spec/ZCODE-SUBSTRATE-MAP.md
spec/DOMAIN-MAPPING.md
spec/MODULE-OWNERSHIP.md
spec/WORK-ITEM-DAG.md
spec/WORKER-CONTEXT-PACKETS.md
spec/TECH-LEAD-ORCHESTRATOR.md

Never depend on conversation history.

Exactly three worker slots exist: W-A, W-B, W-C.
Workers edit only assigned paths. Shared files are TL-owned.
Cross-package API needs go under spec/contract-requests/.

PostgreSQL-owned Aurum semantic state is authoritative.
ZCode session/task storage is runtime projection/cache only.
UI state is projection-only.
LLM output is bounded reasoning content.
The Lab evaluates/recommends; it does not authorize/install/activate/execute.

Provider, account, protocol, model, capability, availability and health remain separate.
Provider SDK types never enter Aurum domain contracts.
Secrets are opaque references.
The Agent Body is persistent and model-agnostic.

Verification:

```bash
node scripts/check-workspace-freshness.mjs
pnpm fmt:check
pnpm lint
pnpm typecheck
pnpm architecture:check -- --changed
```

Run actual target tests and browser/E2E journeys where applicable.

For stateful/remote work record owner, command, persistence, idempotency, stale-result rule, replay/resume and authorization.
Do not add duplicate semantic databases, routers, policy engines or global mutable authorities.

Never blindly merge future zai-org/ZCode updates.
