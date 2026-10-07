# Module and Path Ownership

Workers edit only paths assigned to their active work item.

TL-owned shared paths:
architecture-policy.yaml
root package.json
pnpm-workspace.yaml
.github/\*\*
AGENTS.md
governance specs
cross-package public contracts
migration manifests
release/deployment configuration.

| Path                            | Owner       |
| ------------------------------- | ----------- |
| packages/aurum-domain/\*\*      | W-B         |
| packages/aurum-provider/\*\*    | W-C         |
| packages/aurum-agent/\*\*       | W-C         |
| packages/aurum-execution/\*\*   | W-C         |
| packages/aurum-application/\*\* | W-A         |
| packages/aurum-marketplace/\*\* | W-B         |
| packages/aurum-connectors/\*\*  | W-A         |
| packages/aurum-infra/\*\*       | TL/assigned |
| packages/shared/\*\*            | W-A         |
| packages/rpc/\*\*               | W-A         |
| packages/client/\*\*            | W-A         |
| packages/server/\*\*            | W-A         |
| packages/ui/\*\*                | W-A         |
| packages/web/\*\*               | W-A         |
| packages/desktop/\*\*           | W-C         |
| apps/zcode-cli/\*\*             | W-C         |

A worker needing a foreign API creates spec/contract-requests/CR-<work-item>-<name>.md and does not edit the foreign package.
