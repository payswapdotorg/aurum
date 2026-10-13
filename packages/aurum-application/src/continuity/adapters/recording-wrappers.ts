/**
 * Journaling store/seam wrappers (W012 adapters layer): the RECORDING half
 * of the continuity composition. Every wrapper delegates to the REAL
 * reference store (or kernel seam) and — only after that store CONFIRMED
 * the write — journals a copy-on-write record of exactly what was applied.
 * The ledger therefore mirrors what the composition DID, never decides what
 * it should do (APPROACH R1); replay re-applies these records through the
 * same ports of a fresh composition (R2).
 *
 * Journal failures THROW (fail-fast): a ledger refusal inside a recording
 * wrapper is a continuity bug (contiguity broken), not a caller error —
 * silently continuing would fork the ledger from the real stores.
 */
import type { ContinuityEntry } from "../domain/records.js";
import type { KernelCognitionSeams, MissionStore } from "../../cognition/contract.cognition.js";
import type {
  EscalationStore,
  HandoffRelayStore,
  PlanAuditPort,
  PlanStore,
  TaskCompletionStore,
} from "../../plans/contract.plans.js";
import type { ExecutionPlan } from "../../plans/contract.plans.js";
import type { LabEvaluationStore } from "../../lab/contract.lab.js";
import type { CompanyQueryLog } from "../../company/contract.company.js";

/** Appends one entry for the bound session; throws on ledger refusal. */
export type ContinuityJournal = (entry: ContinuityEntry) => void;

export function journalingMissionStore(
  inner: MissionStore,
  journal: ContinuityJournal,
): MissionStore {
  return {
    putMission(mission) {
      const result = inner.putMission(mission);
      if (result.ok) journal({ kind: "mission-recorded", mission: result.value });
      return result;
    },
    getMission: (scope, missionId) => inner.getMission(scope, missionId),
    listMissions: (scope, filter) => inner.listMissions(scope, filter),
  };
}

export function journalingPlanStore(inner: PlanStore, journal: ContinuityJournal): PlanStore {
  return {
    putPlan(plan) {
      const result = inner.putPlan(plan);
      if (result.ok) {
        // The plan store is structural (`ExecutionPlanLike`); the plans the
        // service creates are full `ExecutionPlan` records — the ledger
        // journals the record that was stored, verbatim.
        journal({ kind: "plan-recorded", plan: result.value as ExecutionPlan });
      }
      return result;
    },
    getPlan: (scope, planId) => inner.getPlan(scope, planId),
    listPlans: (scope) => inner.listPlans(scope),
  };
}

export function journalingHandoffRelayStore(
  inner: HandoffRelayStore,
  journal: ContinuityJournal,
): HandoffRelayStore {
  return {
    recordDelivery(payload) {
      const result = inner.recordDelivery(payload);
      if (result.ok) {
        journal({ kind: "handoff-delivered", payload, result: result.value });
      }
      return result;
    },
    deliveredFor: (planId, taskId) => inner.deliveredFor(planId, taskId),
    deliveredForPlan: (planId) => inner.deliveredForPlan(planId),
  };
}

export function journalingCompletionStore(
  inner: TaskCompletionStore,
  journal: ContinuityJournal,
): TaskCompletionStore {
  return {
    recordCompletion(completion) {
      const result = inner.recordCompletion(completion);
      if (result.ok) journal({ kind: "completion-recorded", completion: result.value });
      return result;
    },
    getCompletion: (planId, taskId) => inner.getCompletion(planId, taskId),
    listCompletions: (planId) => inner.listCompletions(planId),
  };
}

export function journalingEscalationStore(
  inner: EscalationStore,
  journal: ContinuityJournal,
): EscalationStore {
  return {
    appendEscalation(escalation) {
      const result = inner.appendEscalation(escalation);
      if (result.ok) journal({ kind: "escalation-appended", escalation: result.value });
      return result;
    },
    listEscalations: (scope, planId) => inner.listEscalations(scope, planId),
  };
}

export function journalingEvaluationStore(
  inner: LabEvaluationStore,
  journal: ContinuityJournal,
): LabEvaluationStore {
  return {
    putEvaluation(scope, record) {
      const result = inner.putEvaluation(scope, record);
      if (result.ok) journal({ kind: "evaluation-recorded", evaluation: result.value });
      return result;
    },
    getEvaluation: (scope, evaluationId) => inner.getEvaluation(scope, evaluationId),
    listEvaluations: (scope, filter) => inner.listEvaluations(scope, filter),
  };
}

export function journalingQueryLog(
  inner: CompanyQueryLog,
  journal: ContinuityJournal,
): CompanyQueryLog {
  return {
    appendQueryLog(scope, record) {
      const result = inner.appendQueryLog(scope, record);
      if (result.ok) journal({ kind: "query-logged", entry: result.value });
      return result;
    },
    getQueryLog: (scope, queryId) => inner.getQueryLog(scope, queryId),
    listQueryLogs: (scope) => inner.listQueryLogs(scope),
  };
}

export function journalingPlanAuditPort(
  inner: PlanAuditPort,
  journal: ContinuityJournal,
): PlanAuditPort {
  return {
    append(scope, subject, action, input) {
      const result = inner.append(scope, subject, action, input);
      if (result.ok) {
        // Read the appended record back through the port (the port owns its
        // record shape — the ledger never fabricates an audit record).
        const stored = inner.getAudit(scope, result.value.auditRef);
        if (!stored.ok) {
          throw new Error(
            `continuity journal: plan audit ${result.value.auditRef} vanished after append`,
          );
        }
        journal({ kind: "plan-audit-appended", record: stored.value });
      }
      return result;
    },
    getAudit: (scope, auditId) => inner.getAudit(scope, auditId),
  };
}

/**
 * Journaling cognition seams: the kernel effect-writes (claims, beliefs,
 * unknowns, memory, proposed + recommended actions) journal their INPUTS
 * after the kernel confirms the write; every read passes through unwrapped.
 */
export function journalingCognitionSeams(
  inner: KernelCognitionSeams,
  journal: ContinuityJournal,
): KernelCognitionSeams {
  return {
    reads: inner.reads,
    knowledge: {
      epistemics: {
        registerClaim: (...args: Parameters<typeof inner.knowledge.epistemics.registerClaim>) => {
          const result = inner.knowledge.epistemics.registerClaim(...args);
          if (result.ok) journal({ kind: "claim-registered", scope: args[0], input: args[1] });
          return result;
        },
        getClaim: (...args) => inner.knowledge.epistemics.getClaim(...args),
        reviseBelief: (...args: Parameters<typeof inner.knowledge.epistemics.reviseBelief>) => {
          const result = inner.knowledge.epistemics.reviseBelief(...args);
          if (result.ok) journal({ kind: "belief-revised", scope: args[0], input: args[1] });
          return result;
        },
        getBelief: (...args) => inner.knowledge.epistemics.getBelief(...args),
      },
      inquiry: {
        raiseUnknown: (...args: Parameters<typeof inner.knowledge.inquiry.raiseUnknown>) => {
          const result = inner.knowledge.inquiry.raiseUnknown(...args);
          if (result.ok) journal({ kind: "unknown-raised", scope: args[0], input: args[1] });
          return result;
        },
        getUnknown: (...args) => inner.knowledge.inquiry.getUnknown(...args),
      },
      memory: {
        recordMemory: (...args: Parameters<typeof inner.knowledge.memory.recordMemory>) => {
          const result = inner.knowledge.memory.recordMemory(...args);
          if (result.ok) journal({ kind: "memory-recorded", scope: args[0], input: args[1] });
          return result;
        },
        getMemory: (...args) => inner.knowledge.memory.getMemory(...args),
      },
    },
    gate: {
      proposeAction: (...args: Parameters<typeof inner.gate.proposeAction>) => {
        const result = inner.gate.proposeAction(...args);
        if (result.ok) journal({ kind: "action-proposed", scope: args[0], input: args[1] });
        return result;
      },
      recommendAction: (...args: Parameters<typeof inner.gate.recommendAction>) => {
        const result = inner.gate.recommendAction(...args);
        if (result.ok) journal({ kind: "action-recommended", scope: args[0], input: args[1] });
        return result;
      },
      getAction: (...args) => inner.gate.getAction(...args),
    },
  };
}
