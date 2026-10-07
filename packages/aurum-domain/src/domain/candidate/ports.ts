/**
 * Organization candidate registry port (W005). A tiny, deliberately narrow
 * surface: register (deeply validated), get, list. The Lab (W008) produces
 * candidates through this registry; nothing here can activate or execute.
 */
import type { Result } from "../core/result.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { ActorReference } from "../core/refs.js";
import type { TenantScope } from "../core/scope.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { ModelOccupancy } from "./actors.js";
import type { ExecutionTopology, InformationTopology } from "./topology.js";
import type { ContextualConstraints } from "./constraints.js";
import type {
  CandidateBudget,
  CandidateRisk,
  EnvironmentRef,
  OrganizationCandidate,
} from "./records.js";

/** Actor input shape: plain string references, validated then branded. */
export interface CandidateActorInput {
  readonly actorId: string;
  readonly kind: string;
  readonly personId?: string;
  readonly unitId?: string;
  readonly agentBodyRef?: string;
  readonly externalRef?: string;
  readonly displayName?: string;
}

export interface ActorAssignmentInput {
  readonly assignmentId: string;
  readonly actorId: string;
  readonly position: string;
  readonly stepRefs?: readonly string[];
  readonly effortShare: number;
  readonly period?: { readonly start: number; readonly end: number };
}

export interface CapabilityAllocationInput {
  readonly allocationId: string;
  readonly capabilityId: string;
  readonly requirementRef?: string;
  readonly actorIds: readonly string[];
  readonly level: number;
  readonly capacityPerPeriod: number;
  readonly workloadShare?: number;
}

export interface RegisterCandidateInput {
  readonly candidateId: string;
  readonly goalId?: string;
  readonly contextFingerprint?: string;
  readonly constraints?: ContextualConstraints;
  readonly actors: readonly CandidateActorInput[];
  readonly assignments: readonly ActorAssignmentInput[];
  readonly capabilityAllocations: readonly CapabilityAllocationInput[];
  readonly topology: {
    readonly execution: ExecutionTopology;
    readonly information: InformationTopology;
  };
  readonly modelOccupancy: readonly ModelOccupancy[];
  readonly environment: readonly EnvironmentRef[];
  readonly budget?: CandidateBudget;
  readonly expectedOutcome: {
    readonly goalId?: string;
    readonly metric?: string;
    readonly target: number;
    readonly confidence: number;
  };
  readonly risks: readonly CandidateRisk[];
  readonly evidenceRefs: readonly { kind: string; id: string }[];
  readonly proposedBy: ActorReference;
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

/** The shared-vocabulary registry (max 12 methods by policy; we use 3). */
export interface OrganizationCandidateRegistry {
  registerCandidate(
    scope: TenantScope,
    input: RegisterCandidateInput,
  ): Result<OrganizationCandidate>;
  getCandidate(scope: TenantScope, candidateId: string): Result<OrganizationCandidate>;
  listCandidates(scope: TenantScope): readonly OrganizationCandidate[];
}
