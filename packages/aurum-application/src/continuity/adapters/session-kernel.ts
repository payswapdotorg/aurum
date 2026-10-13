/**
 * The continuity session kernel (W012 adapters layer): the TWO NAMED
 * compositions over the SAME canonical `createLocalControlTowerRuntime`
 * (APPROACH R3):
 *
 * - `createContinuousTowerSession` — the CONTINUOUS (desktop) composition:
 *   a recording runtime whose live kernel + stores outlive any renderer
 *   reload; `attachSession` returns the SAME live runtime (the service's
 *   live registry holds the reference).
 * - `createTowerReplayer` (behind the service's `resumeSession`, the REPLAY
 *   path): composes a FRESH recording runtime and re-applies the recorded
 *   records through its REAL stores/seams — NEVER through the reasoning
 *   port or the execution substrate (R2: this file holds no reference to
 *   either; the replayer's fold provably performs zero model invocations
 *   and zero substrate submissions — test/continuity-replay.test.ts).
 *
 * Both compositions journal through the same ledger + session id, so a
 * replayed session CONTINUES recording after reconstruction.
 */
import { err, ok, type Result, type TenantScope } from "@aurum/domain";
import { createDomainKernel, type AurumDomainKernel } from "@aurum/domain";
import { createKernelCognitionSeams } from "../../cognition/contract.cognition.js";
import type { MissionProposalPolicy, ReasoningPort } from "../../cognition/contract.cognition.js";
import {
  createInMemoryEscalationStore,
  createInMemoryHandoffRelayStore,
  createInMemoryPlanStore,
  createInMemoryTaskCompletionStore,
  createInProcessExecutionSubstrate,
  type ExecutionSubstratePort,
} from "../../plans/contract.plans.js";
import { createInMemoryEvaluationStore } from "../../lab/contract.lab.js";
import { createInMemoryQueryLog } from "../../company/contract.company.js";
import {
  createLocalControlTowerRuntime,
  createLocalPlanAuditPort,
  type LocalTowerStoreInjection,
} from "../../control-tower/contract.control-tower.js";
import { createInMemoryMissionStore } from "../../cognition/contract.cognition.js";
import { replayIssues, replaySummaryOf } from "../domain/replay.js";
import { continuityInvariant, type ContinuityError } from "../domain/errors.js";
import type { ContinuityRecord, ReplayReport } from "../domain/records.js";
import type {
  ComposedTowerSession,
  ContinuityLedger,
  TowerReplayTargets,
  TowerReplayer,
  TowerRuntimeComposer,
  TowerSessionBinding,
} from "../domain/ports.js";
import {
  journalingCognitionSeams,
  journalingCompletionStore,
  journalingEscalationStore,
  journalingEvaluationStore,
  journalingHandoffRelayStore,
  journalingMissionStore,
  journalingPlanAuditPort,
  journalingPlanStore,
  journalingQueryLog,
  type ContinuityJournal,
} from "./recording-wrappers.js";

/** Options both compositions share (the mount's honest wiring). */
export interface TowerSessionKernelOptions {
  /** The append-only ledger both the composition and the service journal to. */
  readonly ledger: ContinuityLedger;
  /** The bounded reasoning port; defaults to the unwired refuser. */
  readonly reasoning?: ReasoningPort;
  /** The execution substrate; defaults to the W009 in-process reference. */
  readonly substrate?: ExecutionSubstratePort;
  /** Mission proposal policy (authority roles for gated actions). */
  readonly proposalPolicy?: MissionProposalPolicy;
  /**
   * Kernel-plane pre-seed hook (harness/desktop bootstrap). Runs BEFORE any
   * session action on a FRESH kernel; its writes are NOT journaled (they
   * are kernel-plane state created OUTSIDE the session composition — goals,
   * candidates, memberships). The replayer applies the SAME hook so the
   * reconstructed kernel carries the same plane; reconstructing this state
   * from records is P-series kernel persistence, not session continuity.
   */
  readonly seedKernel?: (kernel: AurumDomainKernel, scope: TenantScope) => void;
}

/**
 * The CONTINUOUS composition (desktop): composes a fresh RECORDING runtime
 * bound to one session — journaling store/seam wrappers around the real
 * kernel + reference stores, injected through the W010 composition's
 * injection points. The returned `replayTargets` carry the RAW (unwrapped)
 * stores/seams the replay fold re-applies historical records to.
 */
export function createContinuousTowerSession(
  options: TowerSessionKernelOptions,
): TowerRuntimeComposer {
  return (binding: TowerSessionBinding): ComposedTowerSession => {
    const journal: ContinuityJournal = (entry) => {
      const appended = options.ledger.append(binding.sessionId, entry);
      if (!appended.ok) {
        throw new Error(
          `continuity journal refused for session ${binding.sessionId}: ${appended.error.message}`,
        );
      }
    };

    const kernel = createDomainKernel();
    options.seedKernel?.(kernel, binding.scope);

    const missions = createInMemoryMissionStore();
    const plans = createInMemoryPlanStore();
    const handoffs = createInMemoryHandoffRelayStore();
    const completions = createInMemoryTaskCompletionStore();
    const escalations = createInMemoryEscalationStore();
    const evaluations = createInMemoryEvaluationStore();
    const queryLog = createInMemoryQueryLog();
    const planAudit = createLocalPlanAuditPort();

    const injected: LocalTowerStoreInjection = {
      missions: journalingMissionStore(missions, journal),
      plans: journalingPlanStore(plans, journal),
      handoffs: journalingHandoffRelayStore(handoffs, journal),
      completions: journalingCompletionStore(completions, journal),
      escalations: journalingEscalationStore(escalations, journal),
      evaluations: journalingEvaluationStore(evaluations, journal),
      queryLog: journalingQueryLog(queryLog, journal),
      planAudit: journalingPlanAuditPort(planAudit, journal),
    };

    const runtime = createLocalControlTowerRuntime({
      kernel,
      reasoning: options.reasoning,
      substrate: options.substrate ?? createInProcessExecutionSubstrate(),
      proposalPolicy: options.proposalPolicy,
      cognitionSeams: journalingCognitionSeams(createKernelCognitionSeams(kernel), journal),
      stores: injected,
    });

    const replayTargets: TowerReplayTargets = {
      missions,
      plans,
      handoffs,
      completions,
      escalations,
      evaluations,
      queryLog,
      planAudit,
      kernel: {
        epistemics: kernel.epistemics,
        inquiry: kernel.inquiry,
        memory: kernel.memory,
        gate: kernel.actions,
      },
    };

    return { runtime, replayTargets };
  };
}

/**
 * The REPLAY fold (behind `resumeSession`): applies one recorded entry to
 * the fresh composition's REAL stores/seams. Lifecycle + attachment records
 * are history (skipped — attachments are NEVER re-materialized, R5); every
 * store write + kernel effect-write is re-applied verbatim. A failing
 * re-application is the typed `continuity-invariant` (a ledger that does
 * not fold is corrupt, not a caller error).
 */
function foldEntry(
  targets: TowerReplayTargets,
  record: ContinuityRecord,
): Result<void, ContinuityError> {
  const entry = record.entry;
  const applied = (() => {
    switch (entry.kind) {
      case "session-opened":
      case "session-resumed":
      case "attachment-opened":
      case "attachment-closed":
        return ok(undefined); // runtime-plane history: observed, not re-applied
      case "mission-recorded":
        return targets.missions.putMission(entry.mission);
      case "plan-recorded":
        return targets.plans.putPlan(entry.plan);
      case "handoff-delivered":
        return targets.handoffs.recordDelivery(entry.payload);
      case "completion-recorded":
        return targets.completions.recordCompletion(entry.completion);
      case "escalation-appended":
        return targets.escalations.appendEscalation(entry.escalation);
      case "evaluation-recorded":
        return targets.evaluations.putEvaluation(entry.evaluation.scope, entry.evaluation);
      case "query-logged":
        return targets.queryLog.appendQueryLog(entry.entry.scope, entry.entry);
      case "plan-audit-appended":
        return targets.planAudit.append(
          entry.record.scope,
          entry.record.subject,
          entry.record.action,
          {
            actor: entry.record.actor,
            at: entry.record.at,
            reason: entry.record.reason,
          },
        );
      case "claim-registered":
        return targets.kernel.epistemics.registerClaim(entry.scope, entry.input);
      case "belief-revised":
        return targets.kernel.epistemics.reviseBelief(entry.scope, entry.input);
      case "unknown-raised":
        return targets.kernel.inquiry.raiseUnknown(entry.scope, entry.input);
      case "memory-recorded":
        return targets.kernel.memory.recordMemory(entry.scope, entry.input);
      case "action-proposed":
        return targets.kernel.gate.proposeAction(entry.scope, entry.input);
      case "action-recommended":
        return targets.kernel.gate.recommendAction(entry.scope, entry.input);
      default: {
        const unreachable: never = entry;
        void unreachable;
        return err(continuityInvariant("unreachable continuity entry kind"));
      }
    }
  })();
  if (!applied.ok) {
    return err(
      continuityInvariant(
        `replay of ${record.recordId} (${entry.kind}) failed: ${String(applied.error)}`,
      ),
    );
  }
  return ok(undefined);
}

/**
 * The REPLAY composition (web/mobile/CLI resume): validates the record
 * sequence (the layer-1 contract), composes a FRESH recording runtime via
 * the SAME continuous composition, and folds the records through its real
 * stores/seams. The report mirrors the domain summary (records applied by
 * kind); the fold NEVER touches a reasoning port or a substrate.
 */
export function createTowerReplayer(options: TowerSessionKernelOptions): TowerReplayer {
  return (records, binding) => {
    const issues = replayIssues(records, binding.sessionId);
    if (!issues.ok) return issues;
    const composed = createContinuousTowerSession(options)(binding);
    for (const record of records) {
      const folded = foldEntry(composed.replayTargets, record);
      if (!folded.ok) return err(folded.error);
    }
    const report: ReplayReport = replaySummaryOf(binding.sessionId, records);
    return ok({ composed, report });
  };
}
