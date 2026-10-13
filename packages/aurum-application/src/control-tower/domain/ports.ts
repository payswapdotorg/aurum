/**
 * Control-tower ports (W010 domain layer): the seams the tower consumes —
 * STRUCTURAL PICKS of the four PUBLIC area services (company W004,
 * cognition W007, lab W008, plans W009), exactly as those areas pick the
 * kernel's interfaces. There is NO `@aurum/domain` kernel import anywhere
 * in the tower: the composed kernel reaches the tower only THROUGH the
 * area services (the public contract), which is the W010 acceptance law
 * ("every semantic action goes through public contract" — and every read
 * likewise). Source-scan tripwire: test/control-tower-contract-hygiene.test.ts.
 *
 * THE DELEGATION LAW (catalog W010 clause 2): the tower's action methods
 * are 1:1 pass-throughs of the picked service methods below. The tower
 * adds zero semantic authority — it cannot, structurally: it holds no
 * kernel handle at all, and every pick is an existing public method.
 */
import type { ActorReference, DomainTimestamp, Result, TenantScope } from "@aurum/domain";
import type { CompanyIntelligence } from "../../company/contract.company.js";
import type { OrganizationalLab } from "../../lab/contract.lab.js";
import type { CognitionService, CreateMissionInput } from "../../cognition/contract.cognition.js";
import type {
  CreatePlanInput,
  DispatchTaskInput,
  PlanApprovalInput,
  PlanLifecycleInput,
  PlanService,
} from "../../plans/contract.plans.js";
import type { ControlTowerError } from "./errors.js";
import type { ControlTowerOverview, ConversationTopic, ConversationViewModel } from "./records.js";

/** The read + action seams the tower consumes (all public-contract picks). */
export interface ControlTowerDeps {
  /** Company intelligence reads (W004) — logged queries, no mutation. */
  readonly company: Pick<CompanyIntelligence, "situation" | "goalAttention" | "reportUnknowns">;
  /** Lab reads (W008) — the Lab panel summarizes evaluation records. */
  readonly lab: Pick<OrganizationalLab, "listEvaluations">;
  /** Plans (W009): reads for cards; actions delegated 1:1. */
  readonly plans: Pick<
    PlanService,
    | "listPlans"
    | "getPlan"
    | "readyTasks"
    | "listEscalations"
    | "submitForApproval"
    | "approvePlan"
    | "rejectPlan"
    | "activatePlan"
    | "dispatchTask"
  >;
  /** Cognition (W007): reads for cards; actions delegated 1:1. */
  readonly cognition: Pick<
    CognitionService,
    | "listMissions"
    | "getMission"
    | "createMission"
    | "advance"
    | "runToCompletion"
    | "cancelMission"
  >;
}

/** Input of the tower's two read methods (a logged company query shape). */
export interface TowerReadInput {
  readonly now: DomainTimestamp;
  readonly askedBy: ActorReference;
  readonly reason: string;
}

/**
 * The public control-tower service surface (11 methods; policy limit is 12).
 *
 * Reads (2): `overview` (the Today board view model) and `conversation`
 * (a thread over one mission/plan record). Both are pure projections.
 *
 * Actions (9): EXACTLY the underlying services' methods, re-exposed with
 * their original signatures (indexed-access types keep them 1:1 — the
 * compiler enforces the delegation). The tower performs no translation,
 * no retry, no policy of its own on these paths.
 */
export interface ControlTowerService {
  overview(
    scope: TenantScope,
    input: TowerReadInput,
  ): Result<ControlTowerOverview, ControlTowerError>;
  conversation(
    scope: TenantScope,
    topic: ConversationTopic,
  ): Result<ConversationViewModel, ControlTowerError>;

  // --- cognition delegation (W007 public contract, unchanged) ---
  readonly createMission: CognitionService["createMission"];
  readonly advanceMission: CognitionService["advance"];
  readonly runMissionToCompletion: CognitionService["runToCompletion"];
  readonly cancelMission: CognitionService["cancelMission"];

  // --- plans delegation (W009 public contract, unchanged) ---
  readonly submitPlanForApproval: PlanService["submitForApproval"];
  readonly approvePlan: PlanService["approvePlan"];
  readonly rejectPlan: PlanService["rejectPlan"];
  readonly activatePlan: PlanService["activatePlan"];
  readonly dispatchTask: PlanService["dispatchTask"];
}

// --- input type re-exports for adapter/consumer ergonomics (one import point) ---
export type {
  CreateMissionInput,
  CreatePlanInput,
  DispatchTaskInput,
  PlanApprovalInput,
  PlanLifecycleInput,
};
