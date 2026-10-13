/**
 * The canonical LOCAL control-tower runtime (W010 adapters layer): ONE
 * composition of the real domain kernel + the four public area services +
 * the tower service. This is the composition the WEB variant mounts
 * in-process today and the server transport variant (W012) replaces with
 * RPC over the SAME client surface — the tower service interface does not
 * change between variants (Web and Desktop stay projection VARIANTS of one
 * semantic projection).
 *
 * HONEST COMPOSITION BOUNDS (recorded in WORK-NOTES too):
 * - in-memory kernel (PostgreSQL authority lands with the P-series; the
 *   in-browser kernel is a session-scoped projection variant, never a
 *   second persistent truth);
 * - the default reasoning port REFUSES (no model is wired in-process):
 *   advancing through the reason stage returns the typed
 *   `mission-model-refused` and the mission stays resumable at that
 *   boundary — nothing is fabricated. A wired reasoner returning no
 *   admissible content is what completes with `knowledge-gap-remains`;
 *   inject a real `ReasoningPort` adapter when one exists;
 * - the execution substrate is the W009 reference in-process double (the
 *   W006 Agent Gateway pass-through lands with the transport wiring);
 * - the plan audit port is application-owned local state.
 */
import { createDomainKernel, err, type Result } from "@aurum/domain";
import type { AurumDomainKernel } from "@aurum/domain";
import {
  createCompanyIntelligenceService,
  createInMemoryQueryLog,
} from "../../company/contract.company.js";
import type { CompanyIntelligence, CompanyQueryLog } from "../../company/contract.company.js";
import { createInMemoryEvaluationStore, createOrganizationalLab } from "../../lab/contract.lab.js";
import type { LabEvaluationStore, OrganizationalLab } from "../../lab/contract.lab.js";
import {
  createInMemoryEscalationStore,
  createInMemoryHandoffRelayStore,
  createInMemoryPlanStore,
  createInMemoryTaskCompletionStore,
  createInProcessExecutionSubstrate,
  createPlanService,
} from "../../plans/contract.plans.js";
import type {
  EscalationStore,
  ExecutionSubstratePort,
  HandoffRelayStore,
  PlanAuditPort,
  PlanService,
  PlanServiceDeps,
  PlanStore,
  TaskCompletionStore,
} from "../../plans/contract.plans.js";
import {
  createCognitionService,
  createInMemoryMissionStore,
  createKernelCognitionSeams,
  missionModelRefused,
} from "../../cognition/contract.cognition.js";
import type {
  CognitionService,
  KernelCognitionSeams,
  MissionError,
  MissionProposalPolicy,
  MissionStore,
  ReasonedContent,
  ReasoningPort,
} from "../../cognition/contract.cognition.js";
import { createControlTowerService } from "../app/towerService.js";
import type { ControlTowerService } from "../domain/ports.js";
import {
  createLocalPlanAuditPort,
  kernelApprovalAuthority,
  kernelCandidateViews,
  kernelGoalViews,
} from "./kernel-plan-wiring.js";

/** The composed local runtime surface (every service + the tower). */
export interface LocalControlTowerRuntime {
  readonly kernel: AurumDomainKernel;
  readonly company: CompanyIntelligence;
  readonly lab: OrganizationalLab;
  readonly plans: PlanService;
  readonly cognition: CognitionService;
  readonly tower: ControlTowerService;
}

/**
 * Store injection points for composition variants (W012 continuity): the
 * recording composition wraps each reference store with a journaling
 * wrapper and injects it here, so every service keeps consuming the SAME
 * ports while the continuity ledger journals the writes. Every slot is
 * optional; the defaults are the same reference in-memory stores as before.
 */
export interface LocalTowerStoreInjection {
  /** The mission store (cognition area, W007). */
  readonly missions?: MissionStore;
  /** The plan store (plans area, W009). */
  readonly plans?: PlanStore;
  /** The handoff relay store (plans area, W009). */
  readonly handoffs?: HandoffRelayStore;
  /** The task completion store (plans area, W009). */
  readonly completions?: TaskCompletionStore;
  /** The escalation store (plans area, W009). */
  readonly escalations?: EscalationStore;
  /** The lab evaluation store (lab area, W008). */
  readonly evaluations?: LabEvaluationStore;
  /** The company query log (company area, W004). */
  readonly queryLog?: CompanyQueryLog;
  /** The plan audit port (application-owned local state, W009/W010). */
  readonly planAudit?: PlanAuditPort;
}

/** Options for the local composition (all defaults are honest refusals). */
export interface LocalControlTowerRuntimeOptions {
  /** The bounded reasoning port; defaults to the unwired refuser. */
  readonly reasoning?: ReasoningPort;
  /** The execution substrate; defaults to the W009 in-process reference. */
  readonly substrate?: ExecutionSubstratePort;
  /** Mission proposal policy (authority roles for gated actions). */
  readonly proposalPolicy?: MissionProposalPolicy;
  /**
   * Compose over an EXISTING kernel instead of a fresh one (W012: the
   * recording/replay compositions own the kernel so their seam wrappers and
   * the runtime share one kernel instance). Defaults to a fresh kernel.
   */
  readonly kernel?: AurumDomainKernel;
  /**
   * Injected cognition seams (W012: journaling wrappers over the kernel
   * seams — every kernel effect-write the cognition loop performs gets
   * journaled). Defaults to `createKernelCognitionSeams(kernel)`.
   */
  readonly cognitionSeams?: KernelCognitionSeams;
  /** Injected stores (W012: journaling wrappers; see the interface above). */
  readonly stores?: LocalTowerStoreInjection;
}

/**
 * The unwired reasoning port: the DEFAULT model boundary for compositions
 * without a provider-plane adapter. It refuses every request with a typed
 * `missionModelRefused` — the honest answer: advancing through the reason
 * stage fails typed and the mission stays resumable at that boundary; no
 * mission ever completes through this port (a wired reasoner returning no
 * admissible content is what completes with `knowledge-gap-remains`). It
 * never returns content, so no composition can accidentally fabricate
 * reasoning.
 */
export function createUnwiredReasoner(): ReasoningPort {
  return {
    name: "unwired-reasoner",
    async requestReasoning(): Promise<Result<ReasonedContent, MissionError>> {
      return err(missionModelRefused("no reasoning adapter is wired in this composition", []));
    },
  };
}

const DEFAULT_PROPOSAL_POLICY: MissionProposalPolicy = {
  approvalRoles: ["owner"],
  authorizationRoles: ["owner"],
};

export function createLocalControlTowerRuntime(
  options: LocalControlTowerRuntimeOptions = {},
): LocalControlTowerRuntime {
  const kernel = options.kernel ?? createDomainKernel();

  const company = createCompanyIntelligenceService({
    views: {
      evidence: kernel.evidence,
      epistemics: kernel.epistemics,
      inquiry: kernel.inquiry,
      goals: kernel.goals,
      memory: kernel.memory,
      identity: kernel.identity,
      audit: kernel.audit,
    },
    queryLog: options.stores?.queryLog ?? createInMemoryQueryLog(),
  });

  const lab = createOrganizationalLab({
    views: {
      goals: kernel.goals,
      capabilities: kernel.capabilities,
      workforce: kernel.workforce,
      inquiry: kernel.inquiry,
    },
    evaluations: options.stores?.evaluations ?? createInMemoryEvaluationStore(),
  });

  const planDeps: PlanServiceDeps = {
    goals: kernelGoalViews(kernel),
    candidates: kernelCandidateViews(kernel),
    approval: kernelApprovalAuthority(kernel),
    audit: options.stores?.planAudit ?? createLocalPlanAuditPort(),
    substrate: options.substrate ?? createInProcessExecutionSubstrate(),
    plans: options.stores?.plans ?? createInMemoryPlanStore(),
    handoffs: options.stores?.handoffs ?? createInMemoryHandoffRelayStore(),
    completions: options.stores?.completions ?? createInMemoryTaskCompletionStore(),
    escalations: options.stores?.escalations ?? createInMemoryEscalationStore(),
  };
  const plans = createPlanService(planDeps);

  const seams = options.cognitionSeams ?? createKernelCognitionSeams(kernel);
  const cognition = createCognitionService({
    reads: seams.reads,
    knowledge: seams.knowledge,
    gate: seams.gate,
    model: options.reasoning ?? createUnwiredReasoner(),
    missions: options.stores?.missions ?? createInMemoryMissionStore(),
    proposalPolicy: options.proposalPolicy ?? DEFAULT_PROPOSAL_POLICY,
  });

  const tower = createControlTowerService({ company, lab, plans, cognition });

  return { kernel, company, lab, plans, cognition, tower };
}
