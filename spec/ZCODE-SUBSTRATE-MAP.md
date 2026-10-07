# ZCode Substrate Map

Baseline: zai-org/ZCode@29628c9acdb81b703bbd4080c207a0e7ce5e276e

shared/rpc/client/server = RETAIN/ADAPT transport/platform substrate
ui/web/desktop = RETAIN/ADAPT primitives + new product hierarchy
apps/zcode-cli = ADAPT runtime/tools/browser/workflows/permissions
provider/provider-node = ADAPT low-level provider adapters
task/session services = ADAPT/REPLACE runtime projections/recovery
local SQLite = ADAPT execution projection only
plugin system = ADAPT execution substrate; Marketplace is authoritative
dynamic workflow = ADAPT execution backend for ExecutionPlan
browser/computer/remote host = RETAIN/ADAPT ExecutionEnvironment
ZCode model selection = REPLACE semantically; Aurum ModelBinding is authoritative
ZCode task/navigation UI = REPLACE product-wise

Never promote ZCode task index, provider config, catalog, UI store, AgentRuntime memory, workflow journal, plugin registry or workspace path into Aurum semantic authority.

Canonical flow:
Aurum command -> application service -> Agent/Execution port -> ZCode adapter -> execution -> normalized result -> Aurum outcome/evidence.
