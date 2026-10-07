# Worker Context Packets

## W-A
W001: ZCode platform boundary hardening; own shared/rpc/client/server/ui/web seams assigned by TL.
W004: company query/coverage/situation/attention.
W007: cognition and learning-mission orchestration.
W010: control tower and conversation shell.
W013: outcome learning and conditional organization calibration.

## W-B
W002: packages/aurum-domain/**; tenant-scoped contracts/domain logic, no IO.
W005: process intelligence, capability graph, workforce capacity/workload, mixed-resource allocation, and OrganizationCandidate/ActorAssignment/CapabilityAllocation contracts.
W008: Organizational Lab core; context fingerprints, mixed organization search, constrained allocation, simulation/evaluation/ranking. Never execute.
W011: marketplace/recruitment governance.
W014: emergent roles/package proposals.

## W-C
W003: packages/aurum-provider/** and packages/aurum-agent/**; Provider Fabric, ModelBinding, Agent Body, secret references.
W006: packages/aurum-execution/**; adapt ZCode runtime/browser/computer/workflow/remote substrate.
W009: ExecutionPlan, dependency ordering, relay, handoff, escalation, recovery.
W012: Web/Desktop/CLI/future-Mobile continuity and remote attachments.

Universal checks:
~~~bash
node scripts/check-workspace-freshness.mjs
pnpm fmt:check
pnpm lint
pnpm typecheck
pnpm architecture:check -- --changed
~~~

Run actual tests present in the target package and E2E/browser journeys where applicable.
