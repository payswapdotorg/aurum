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
import type { CompanyIntelligence } from "../../company/contract.company.js";
import { createInMemoryEvaluationStore, createOrganizationalLab } from "../../lab/contract.lab.js";
import type { OrganizationalLab } from "../../lab/contract.lab.js";
import {
  createInMemoryEscalationStore,
  createInMemoryHandoffRelayStore,
  createInMemoryPlanStore,
  createInMemoryTaskCompletionStore,
  createInProcessExecutionSubstrate,
  createPlanService,
} from "../../plans/contract.plans.js";
import type {
  ExecutionSubstratePort,
  PlanService,
  PlanServiceDeps,
} from "../../plans/contract.plans.js";
import {
  createCognitionService,
  createInMemoryMissionStore,
  createKernelCognitionSeams,
  missionModelRefused,
} from "../../cognition/contract.cognition.js";
import type {
  CognitionService,
  MissionError,
  MissionProposalPolicy,
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

/** Options for the local composition (all defaults are honest refusals). */
export interface LocalControlTowerRuntimeOptions {
  /** The bounded reasoning port; defaults to the unwired refuser. */
  readonly reasoning?: ReasoningPort;
  /** The execution substrate; defaults to the W009 in-process reference. */
  readonly substrate?: ExecutionSubstratePort;
  /** Mission proposal policy (authority roles for gated actions). */
  readonly proposalPolicy?: MissionProposalPolicy;
}

/**
 * The unwired reasoning port: the DEFAULT model boundary for compositions
 * without a provider-plane adapter. It refuses every request with a typed
 * `missionModelRefused` — the honest answer (a mission driven to completion
 * through it ends `knowledge-gap-remains`). It never returns content, so
 * no composition can accidentally fabricate reasoning.
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
  const kernel = createDomainKernel();

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
    queryLog: createInMemoryQueryLog(),
  });

  const lab = createOrganizationalLab({
    views: {
      goals: kernel.goals,
      capabilities: kernel.capabilities,
      workforce: kernel.workforce,
      inquiry: kernel.inquiry,
    },
    evaluations: createInMemoryEvaluationStore(),
  });

  const planDeps: PlanServiceDeps = {
    goals: kernelGoalViews(kernel),
    candidates: kernelCandidateViews(kernel),
    approval: kernelApprovalAuthority(kernel),
    audit: createLocalPlanAuditPort(),
    substrate: options.substrate ?? createInProcessExecutionSubstrate(),
    plans: createInMemoryPlanStore(),
    handoffs: createInMemoryHandoffRelayStore(),
    completions: createInMemoryTaskCompletionStore(),
    escalations: createInMemoryEscalationStore(),
  };
  const plans = createPlanService(planDeps);

  const seams = createKernelCognitionSeams(kernel);
  const cognition = createCognitionService({
    reads: seams.reads,
    knowledge: seams.knowledge,
    gate: seams.gate,
    model: options.reasoning ?? createUnwiredReasoner(),
    missions: createInMemoryMissionStore(),
    proposalPolicy: options.proposalPolicy ?? DEFAULT_PROPOSAL_POLICY,
  });

  const tower = createControlTowerService({ company, lab, plans, cognition });

  return { kernel, company, lab, plans, cognition, tower };
}
