/**
 * W014 test helpers: fixtures and Result narrowing utilities for the
 * emergence module. Mirrors the W011 helpers pattern: the marketplace +
 * emergence surfaces are imported from the PUBLIC contract
 * (../src/index.js) — the same boundary other modules use.
 *
 * The fixture composes the REAL W011 marketplace fixture (catalog +
 * governance stores + audit ledger + authority/registration doubles) with
 * the emergence service over the in-memory evidence double (W013-shaped
 * records) and the in-memory proposal store — SHARED stores, so the
 * end-to-end governed journey (proposal -> catalog draft -> publication)
 * runs against the same tenant state the marketplace commands mutate.
 */
import { expect } from "vitest";
import {
  createEmergenceService,
  createInMemoryEmergenceEvidenceDouble,
  createInMemoryEmergenceProposalStore,
  marketplacePersonActor,
  marketplaceSystemActor,
  marketplaceTenantScope,
  type EmergenceError,
  type EmergenceOutcomeEvidence,
  type EmergenceProposal,
  type EmergenceService,
  type EmergenceUnknownSignal,
  type InMemoryEmergenceEvidenceDouble,
  type InMemoryEmergenceProposalStore,
  type MarketplaceActorReference,
  type Result,
} from "../src/index.js";
import {
  marketplaceFixture,
  type MarketplaceFixture,
  type MarketplaceTenantScope,
} from "./helpers.js";

const T0 = 1_700_000_000_000;

export const PROMOTER = marketplacePersonActor("person-promoter-1");
export const REVIEWER = marketplacePersonActor("person-reviewer-1");
export const LAB_SYSTEM = marketplaceSystemActor("aurum-lab");
export const LAB_AGENT: MarketplaceActorReference = {
  kind: "agent",
  name: "agent-body-lab-1",
};
export const EXTERNAL_AUDITOR: MarketplaceActorReference = {
  kind: "external",
  name: "external-auditor-1",
};

export function scopeOf(name: string): MarketplaceTenantScope {
  const result = marketplaceTenantScope(name);
  if (!result.ok) throw new Error(`test setup: invalid tenant name ${name}`);
  return result.value;
}

export function okOf<T>(result: Result<T, EmergenceError>): T {
  expect(result.ok, `expected ok, got error: ${result.ok ? "" : result.error.message}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

export function errOf(result: Result<unknown, EmergenceError>): EmergenceError {
  expect(result.ok, `expected err, got value: ${result.ok ? String(result.value) : ""}`).toBe(
    false,
  );
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

/** The composed W011 + W014 fixture over SHARED stores. */
export interface EmergenceFixture {
  readonly marketplace: MarketplaceFixture;
  readonly evidence: InMemoryEmergenceEvidenceDouble;
  readonly proposals: InMemoryEmergenceProposalStore;
  readonly emergence: EmergenceService;
}

export function emergenceFixture(): EmergenceFixture {
  const marketplace = marketplaceFixture();
  const evidence = createInMemoryEmergenceEvidenceDouble();
  const proposals = createInMemoryEmergenceProposalStore();
  const emergence = createEmergenceService({
    evidence,
    proposals,
    catalog: marketplace.catalogStore,
    recruitments: marketplace.governanceStore,
    audit: marketplace.auditLedger,
  });
  return { marketplace, evidence, proposals, emergence };
}

/**
 * Builds W013-shaped outcome-join evidence (the structural intake shape:
 * nested conditioning keys exactly where OutcomeJoinRecord carries them).
 * Deterministic defaults; every field overridable.
 */
export function outcomeEvidence(
  scope: MarketplaceTenantScope,
  overrides: Partial<EmergenceOutcomeEvidence> = {},
): EmergenceOutcomeEvidence {
  return {
    scope,
    outcomeId: "out-1",
    evaluationId: "eval-1",
    candidateId: "cand-1",
    goalId: "goal-1",
    contextClass: {
      classKey: "class-a0000001",
      demandSignature: "cap-analysis:3,cap-communication:2",
    },
    shape: { shapeKey: "shape-b0000002" },
    observation: {
      status: "failed",
      source: { kind: "mission", ref: "mission-1" },
      observedAt: T0,
      failure: { kind: "capability-missing", detail: "no supply for cap-analysis at level 3" },
      metric: { metric: "time-to-resolution", observed: 40, target: 24 },
    },
    allocation: {
      actorCount: 4,
      humanLikeActorCount: 1,
      automatedActorCount: 3,
      totalEffortShare: 0.95,
    },
    recordedAt: T0,
    ...overrides,
  };
}

/** Builds a cognition unknown signal (the intake shape). */
export function unknownSignal(
  scope: MarketplaceTenantScope,
  overrides: Partial<EmergenceUnknownSignal> = {},
): EmergenceUnknownSignal {
  return {
    scope,
    unknownId: "unk-1",
    question: "which supplier certifies payload integrity?",
    consequence: "payment proposals stall at the verification step",
    missionRef: "mission-1",
    goalId: "goal-1",
    observedAt: T0,
    ...overrides,
  };
}

/** Seeds `count` recurring failed outcomes in one class/failure kind. */
export function seedRecurringFailures(
  fixture: EmergenceFixture,
  scope: MarketplaceTenantScope,
  count: number,
  overrides: Partial<EmergenceOutcomeEvidence> = {},
): readonly string[] {
  const ids: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const outcomeId = overrides.outcomeId ?? `out-${index}`;
    ids.push(outcomeId);
    fixture.evidence.putOutcomeEvidence(
      outcomeEvidence(scope, {
        ...overrides,
        outcomeId,
        observation: {
          status: "failed",
          source: { kind: "mission", ref: `mission-${index}` },
          observedAt: T0 + index,
          failure: { kind: "capability-missing", detail: "recurring shortfall" },
          metric: { metric: "time-to-resolution", observed: 40, target: 24 },
        },
      }),
    );
  }
  return ids;
}

export { T0 };

/** The standard role shape used by proposal proofs. */
export function standardRoleShape(): {
  roleDefinition: {
    title: string;
    description: string;
    responsibilities: readonly string[];
    skills: readonly string[];
    authorityRequirements: readonly string[];
  };
  requiredCapabilities: readonly string[];
} {
  return {
    roleDefinition: {
      title: "Verification Analyst",
      description: "emergent role for recurring verification shortfalls",
      responsibilities: ["certify-payload-integrity", "clear-verification-queue"],
      skills: ["verification", "supplier-management"],
      authorityRequirements: ["read-payment-proposals"],
    },
    requiredCapabilities: ["cap-analysis", "cap-communication"],
  };
}

/** The standard package bundle used by proposal proofs. */
export function standardBundle(): {
  capabilitySupplies: readonly {
    supplyKind: "tool" | "connector" | "software";
    capabilityId: string;
    level: number;
    capacityPerPeriod: number;
  }[];
  processRequirements: readonly string[];
  workforceRequirements: readonly string[];
} {
  return {
    capabilitySupplies: [
      { supplyKind: "tool", capabilityId: "cap-verification", level: 4, capacityPerPeriod: 8 },
    ],
    processRequirements: ["two-person-review-before-payout"],
    workforceRequirements: ["one-verification-analyst-on-shift"],
  };
}

/** Proposes a role backed by `gapId` with the standard shape (helper). */
export function proposeStandardRole(
  fixture: EmergenceFixture,
  scope: MarketplaceTenantScope,
  gapId: string,
  proposalId = "prop-1",
  now = T0 + 1000,
): Result<EmergenceProposal, EmergenceError> {
  return fixture.emergence.propose(scope, {
    kind: "role",
    proposalId,
    gapId,
    query: { now },
    roleShape: standardRoleShape(),
    proposedBy: LAB_SYSTEM,
    provenance: { actor: LAB_SYSTEM, source: "system-captured", recordedAt: now },
    now,
  });
}
