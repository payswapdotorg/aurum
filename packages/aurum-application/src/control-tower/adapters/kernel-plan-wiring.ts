/**
 * Kernel plan wiring (W010 adapters layer): the pieces the canonical local
 * composition needs to run the W009 plan service over the REAL domain
 * kernel — goal/candidate views with closed-failure error translation, a
 * REAL `PlanApprovalAuthority` pass-through to the kernel's action
 * authority, and an application-owned local `PlanAuditPort`.
 *
 * These adapters are behavior-free wiring mirrors of the W009 test fixtures
 * (test/plans-helpers.ts) promoted to runtime composition: no policy is
 * invented here — the kernel's `ActionAuthority` decides, the audit port
 * only records what the plan service already decided to append.
 */
import {
  createDomainKernel,
  err,
  ok,
  type ActorReference,
  type Result,
  type TenantScope,
} from "@aurum/domain";
import type { AurumDomainKernel, AuditRecord } from "@aurum/domain";
import { planNotFound, planSubjectNotFound, planUnauthorized } from "../../plans/contract.plans.js";
import type {
  PlanApprovalAuthority,
  PlanAuditPort,
  PlanCandidateViews,
  PlanGoalViews,
} from "../../plans/contract.plans.js";
import type { AuditActionKind, AuditInput } from "@aurum/domain";

/** Decision states an approval citation's action may legitimately be in. */
const CITATION_STATES = ["approved", "authorized", "executed"] as const;

function actorMatches(left: ActorReference | undefined, right: ActorReference): boolean {
  if (left === undefined) return false;
  if (left.kind !== right.kind) return false;
  if (left.kind === "person" && right.kind === "person") {
    return left.personId === right.personId;
  }
  return true;
}

/** Goal views over the kernel's `GoalLedger` (closed-failure translation). */
export function kernelGoalViews(kernel: AurumDomainKernel): PlanGoalViews {
  return {
    getGoal: (scope, goalId) => {
      const result = kernel.goals.getGoal(scope, goalId);
      if (!result.ok) {
        return result.error.code === "not-found"
          ? err(planSubjectNotFound(`goal ${goalId}`))
          : err(planNotFound(`goal ${goalId}`));
      }
      return ok(result.value);
    },
  };
}

/** Candidate views over the kernel's `OrganizationCandidateRegistry`. */
export function kernelCandidateViews(kernel: AurumDomainKernel): PlanCandidateViews {
  return {
    getCandidate: (scope, candidateId) => {
      const result = kernel.candidates.getCandidate(scope, candidateId);
      if (!result.ok) {
        return err(planNotFound(`candidate ${candidateId}`));
      }
      return ok(result.value);
    },
  };
}

/**
 * The REAL `PlanApprovalAuthority` over the kernel's action authority +
 * audit trail. Citations are asserted, never assumed: an action id must
 * exist in the tenant and sit in a decision state whose state-history entry
 * was recorded by the SAME human; an audit ref must exist and carry the
 * same human's decision. Executor authority is asserted the same way when
 * the dispatch presents a proof (empty requirements assert nothing — the
 * plan layer's own validation governs those).
 */
export function kernelApprovalAuthority(kernel: AurumDomainKernel): PlanApprovalAuthority {
  return {
    assertApprovalCitation(
      scope,
      citation,
    ): Result<{ actionId?: string; auditRef?: string }, ReturnType<typeof planUnauthorized>> {
      const proofs: { actionId?: string; auditRef?: string } = {};
      if (citation.actionId !== undefined && citation.actionId !== "") {
        const action = kernel.actions.getAction(scope, citation.actionId);
        if (!action.ok) return err(planUnauthorized(`action ${citation.actionId} not found`));
        if (!(CITATION_STATES as readonly string[]).includes(action.value.state)) {
          return err(
            planUnauthorized(
              `action ${citation.actionId} is ${action.value.state}, not a decision state`,
            ),
          );
        }
        const decision = action.value.stateHistory.find((entry) =>
          (CITATION_STATES as readonly string[]).includes(entry.to),
        );
        if (!actorMatches(decision?.actor, citation.approvedBy)) {
          return err(
            planUnauthorized(`action ${citation.actionId} was not decided by this approver`),
          );
        }
        proofs.actionId = citation.actionId;
      }
      if (citation.auditRef !== undefined && citation.auditRef !== "") {
        const audit = kernel.audit.getAudit(scope, citation.auditRef);
        if (!audit.ok) return err(planUnauthorized(`audit ${citation.auditRef} not found`));
        if (!actorMatches(audit.value.actor, citation.approvedBy)) {
          return err(planUnauthorized(`audit ${citation.auditRef} records a different decider`));
        }
        proofs.auditRef = citation.auditRef;
      }
      if (proofs.actionId === undefined && proofs.auditRef === undefined) {
        return err(planUnauthorized("citation requires an action id or an audit ref"));
      }
      return ok(proofs);
    },
    assertExecutorAuthority(
      scope,
      requirement,
    ): Result<{ actionId?: string; auditRef?: string }, ReturnType<typeof planUnauthorized>> {
      if (requirement.actionId !== undefined && requirement.actionId !== "") {
        const action = kernel.actions.getAction(scope, requirement.actionId);
        if (!action.ok) return err(planUnauthorized(`action ${requirement.actionId} not found`));
        if (!(CITATION_STATES as readonly string[]).includes(action.value.state)) {
          return err(
            planUnauthorized(
              `action ${requirement.actionId} is ${action.value.state}; executor authority not granted`,
            ),
          );
        }
        return ok({ actionId: requirement.actionId });
      }
      if (requirement.auditRef !== undefined && requirement.auditRef !== "") {
        const audit = kernel.audit.getAudit(scope, requirement.auditRef);
        if (!audit.ok) return err(planUnauthorized(`audit ${requirement.auditRef} not found`));
        return ok({ auditRef: requirement.auditRef });
      }
      return ok({});
    },
  };
}

/**
 * The application-owned local `PlanAuditPort`: an append-only audit log for
 * plan transitions in THIS composition. The kernel's audit trail has no
 * public append seam (stores write it internally), and PostgreSQL-owned
 * audit lands with the P-series persistence — this port is the documented
 * local stand-in, mirroring the W009 fixture behavior at runtime.
 */
export function createLocalPlanAuditPort(): PlanAuditPort & {
  readonly entries: readonly AuditRecord[];
} {
  const entries: AuditRecord[] = [];
  let counter = 0;
  return {
    get entries(): readonly AuditRecord[] {
      return Object.freeze([...entries]);
    },
    append(
      scope: TenantScope,
      subject: { kind: string; id: string },
      action: AuditActionKind,
      input: AuditInput,
    ): Result<{ auditRef: string }, ReturnType<typeof planNotFound>> {
      counter += 1;
      const auditRef = `plan-audit-${counter}`;
      const record: AuditRecord = {
        scope,
        auditId: auditRef,
        subject: subject as AuditRecord["subject"],
        action,
        actor: input.actor,
        at: input.at,
        reason: input.reason,
      };
      entries.push(record);
      return ok({ auditRef });
    },
    getAudit(
      scope: TenantScope,
      auditId: string,
    ): Result<AuditRecord, ReturnType<typeof planNotFound>> {
      const found = entries.find(
        (entry) => entry.scope.tenantId === scope.tenantId && entry.auditId === auditId,
      );
      if (!found) return err(planNotFound(`audit ${auditId}`));
      return ok(found);
    },
  };
}

/** Test/runtime helper: a fresh kernel + the three wirings above. */
export function kernelPlanWiring(kernel = createDomainKernel()): {
  kernel: AurumDomainKernel;
  goals: PlanGoalViews;
  candidates: PlanCandidateViews;
  approval: PlanApprovalAuthority;
  audit: ReturnType<typeof createLocalPlanAuditPort>;
} {
  return {
    kernel,
    goals: kernelGoalViews(kernel),
    candidates: kernelCandidateViews(kernel),
    approval: kernelApprovalAuthority(kernel),
    audit: createLocalPlanAuditPort(),
  };
}
