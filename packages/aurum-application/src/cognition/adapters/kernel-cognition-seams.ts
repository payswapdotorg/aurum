/**
 * Kernel cognition seams (W007 adapters layer): composes the domain kernel
 * into the cognition ports. The seams are structural picks, so this is a
 * thin, behavior-free wiring — plus the documented authority boundary: the
 * gate is picked as `proposeAction | recommendAction | getAction` ONLY.
 *
 * The kernel's `DomainError`s cross these seams unchanged; the cognition
 * service translates them into the `MissionError` namespace (one command
 * path, one error authority per layer).
 */
import type { AurumDomainKernel } from "@aurum/domain";
import type {
  CognitionKnowledgeSeams,
  CognitionReadSeams,
  MissionAuthorityGate,
} from "../domain/ports.js";

export interface KernelCognitionSeams {
  readonly reads: CognitionReadSeams;
  readonly knowledge: CognitionKnowledgeSeams;
  /**
   * The authority gate. THE AUTHORITY LAW: cognition proposes and (as
   * analysis) recommends — approve/authorize/execute/reject are NOT picked
   * and therefore unreachable through this wiring. Humans decide.
   */
  readonly gate: MissionAuthorityGate;
}

export function createKernelCognitionSeams(kernel: AurumDomainKernel): KernelCognitionSeams {
  return {
    reads: {
      goals: kernel.goals,
      evidence: kernel.evidence,
      epistemics: kernel.epistemics,
      inquiry: kernel.inquiry,
      memory: kernel.memory,
    },
    knowledge: {
      epistemics: kernel.epistemics,
      inquiry: kernel.inquiry,
      memory: kernel.memory,
    },
    gate: {
      proposeAction: (scope, input) => kernel.actions.proposeAction(scope, input),
      recommendAction: (scope, input) => kernel.actions.recommendAction(scope, input),
      getAction: (scope, actionId) => kernel.actions.getAction(scope, actionId),
    },
  };
}
