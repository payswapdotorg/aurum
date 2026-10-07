/**
 * The Aurum domain kernel: one in-memory, tenant-scoped composition of the
 * area stores. It is a pure reference implementation of the contract — no IO,
 * no clock, no ids generated except deterministic sequential audit ids. The
 * persistence authority (PostgreSQL) lives outside the domain; application
 * adapters drive this kernel or mirror its semantics in SQL.
 *
 * Wiring decisions:
 * - one shared AuditTrailStore receives audit entries from every store;
 * - the epistemics ledger verifies claims/beliefs against the evidence
 *   ledger (same tenant);
 * - the action authority resolves approval/authorization roles through the
 *   identity directory (tenant-scoped memberships).
 */
import { createAuditTrailStore } from "../audit/auditStore.js";
import type { AuditTrail } from "../audit/ports.js";
import { createIdentityDirectory } from "../identity/identityStore.js";
import type { IdentityDirectory } from "../identity/ports.js";
import { createOrganizationDirectory } from "../organization/organizationStore.js";
import type { OrganizationDirectory } from "../organization/ports.js";
import { createEventLog, createEvidenceLedger } from "../evidence/evidenceStore.js";
import type { EvidenceLedger, EventLog } from "../evidence/ports.js";
import { createEpistemicsLedger } from "../epistemics/epistemicsStore.js";
import { createInquiryLedger } from "../epistemics/inquiryStore.js";
import type { EpistemicsLedger, InquiryLedger } from "../epistemics/ports.js";
import { createGoalLedger } from "../goals/goalStore.js";
import type { GoalLedger } from "../goals/ports.js";
import { createOrganizationalMemory } from "../memory/memoryStore.js";
import type { OrganizationalMemory } from "../memory/ports.js";
import { createActionAuthority } from "../action/actionStore.js";
import type { ActionAuthority } from "../action/ports.js";
import { createProcessDirectory } from "../process/processStore.js";
import type { ProcessDirectory } from "../process/ports.js";
import { createCapabilityGraph } from "../capability/capabilityStore.js";
import type { CapabilityGraph } from "../capability/ports.js";
import { createWorkforceDirectory } from "../workforce/workforceStore.js";
import { createWorkforceInsights } from "../workforce/insightsStore.js";
import { createWorkforceRecommendations } from "../workforce/recommendationStore.js";
import type {
  WorkforceDirectory,
  WorkforceInsights,
  WorkforceRecommendations,
} from "../workforce/ports.js";
import { createCandidateRegistry } from "../candidate/candidateStore.js";
import type { OrganizationCandidateRegistry } from "../candidate/ports.js";

/** The composed public kernel surface. */
export interface AurumDomainKernel {
  readonly identity: IdentityDirectory;
  readonly organization: OrganizationDirectory;
  readonly events: EventLog;
  readonly evidence: EvidenceLedger;
  readonly epistemics: EpistemicsLedger;
  readonly inquiry: InquiryLedger;
  readonly goals: GoalLedger;
  readonly memory: OrganizationalMemory;
  readonly actions: ActionAuthority;
  readonly audit: AuditTrail;
  readonly processes: ProcessDirectory;
  readonly capabilities: CapabilityGraph;
  readonly workforce: WorkforceDirectory;
  readonly workforceInsights: WorkforceInsights;
  readonly workforceRecommendations: WorkforceRecommendations;
  readonly candidates: OrganizationCandidateRegistry;
}

export function createDomainKernel(): AurumDomainKernel {
  const auditTrail = createAuditTrailStore();
  const evidence = createEvidenceLedger(auditTrail);
  const identity = createIdentityDirectory(auditTrail);
  // The claim-usable lookup refers back to the epistemics ledger. The
  // closure only runs during later store operations, after assignment.
  const epistemics = createEpistemicsLedger({
    audit: auditTrail,
    evidenceLookup: {
      observationExists: (scope, observationId) =>
        evidence.getObservation(scope, observationId).ok === true,
      claimIsUsable: (scope, claimId) => {
        const claim = epistemics.getClaim(scope, claimId);
        return claim.ok === true && claim.value.status === "active";
      },
    },
  });
  return {
    identity,
    organization: createOrganizationDirectory(auditTrail),
    events: createEventLog(),
    evidence,
    epistemics,
    inquiry: createInquiryLedger(auditTrail),
    goals: createGoalLedger(auditTrail),
    memory: createOrganizationalMemory(auditTrail),
    actions: createActionAuthority({
      audit: auditTrail,
      resolveRoles: (scope, actor, at) =>
        actor.kind === "person" && actor.personId
          ? identity.rolesOf(scope, actor.personId, at)
          : [],
    }),
    audit: auditTrail,
    processes: createProcessDirectory(auditTrail),
    capabilities: createCapabilityGraph(auditTrail),
    workforce: createWorkforceDirectory(auditTrail),
    workforceInsights: createWorkforceInsights(auditTrail),
    workforceRecommendations: createWorkforceRecommendations(auditTrail),
    candidates: createCandidateRegistry(auditTrail),
  };
}
