/**
 * Organization shape (W013 domain layer): the ORGANIZATION-SIDE conditioning
 * key of outcome learning — a coarse, comparable signature of HOW a
 * candidate organization is composed. Catalog acceptance clause 1 requires
 * the lab to learn CONDITIONAL performance (context class x organization
 * shape), never a universal best organization: two candidates of the same
 * shape under the same context class pool their outcome evidence, and the
 * same shape under a different context class learns independently.
 *
 * What the shape captures (all derived, never invented — pure function of
 * the W005 `OrganizationCandidate` value):
 * - actorMix       : the kind histogram of actors (sorted by kind) — the
 *                    human/agent/software/external composition;
 * - humanOversight : any in-house human/team actor participates;
 * - automationClass: none/mixed/all automated execution steps;
 * - edgeCounts     : execution-topology relation histogram by kind
 *                    (delegation/review/escalation/handoff);
 * - information    : flow count + review-required + minimal-context flows
 *                    (the information strategy's structural signature);
 * - environment    : distinct execution environment references.
 *
 * Deliberately EXCLUDED from the key (recorded verbatim on the join record
 * instead): identity of individual actors, effort numbers, capability ids,
 * cost, deadlines — those are join DIMENSIONS for evidence, not conditioning
 * keys (ruling: conditioning on identities would never generalize; the
 * shape is what "kind of organization" means for conditional performance).
 */
import type { OrganizationCandidate } from "@aurum/domain";
import { fingerprintDigest } from "../../lab/contract.lab.js";

/** Automation degree of the execution topology (bucketed, documented). */
export const AUTOMATION_CLASSES = ["none", "mixed", "all"] as const;

export type AutomationClass = (typeof AUTOMATION_CLASSES)[number];

/** The organization shape value (canonical form + digest + components). */
export interface OrganizationShape {
  /** Histogram of actors by kind, sorted by kind (codepoint order). */
  readonly actorMix: readonly { readonly kind: string; readonly count: number }[];
  /** True when any in-house human/team actor participates. */
  readonly humanOversight: boolean;
  readonly automationClass: AutomationClass;
  /** Execution-topology edge histogram by kind, sorted by kind. */
  readonly edgeCounts: readonly { readonly kind: string; readonly count: number }[];
  readonly informationFlowCount: number;
  readonly reviewRequiredFlows: number;
  readonly minimalContextFlows: number;
  /** Distinct execution environment references. */
  readonly environmentCount: number;
  /** Human-readable canonical serialization (stable field order). */
  readonly canonical: string;
  /** 16-hex deterministic digest of the canonical form. */
  readonly shapeKey: string;
}

const HUMAN_LIKE = new Set(["human", "team"]);

function histogram(
  values: readonly string[],
): readonly { readonly kind: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([kind, count]) => ({ kind, count }));
}

function automationClassOf(steps: readonly { automated: boolean }[]): AutomationClass {
  if (steps.length === 0) return "none";
  const automated = steps.filter((step) => step.automated).length;
  if (automated === 0) return "none";
  if (automated === steps.length) return "all";
  return "mixed";
}

/**
 * Derives the organization shape from a candidate value. Pure and
 * deterministic: the same candidate always produces the identical shape
 * (byte-identical canonical form and shape key).
 */
export function organizationShapeOf(candidate: OrganizationCandidate): OrganizationShape {
  const actorMix = histogram(candidate.actors.map((actor) => actor.kind));
  const humanOversight = candidate.actors.some((actor) => HUMAN_LIKE.has(actor.kind));
  const automationClass = automationClassOf(candidate.topology.execution.steps);
  const edgeCounts = histogram(candidate.topology.execution.edges.map((edge) => edge.kind));
  const flows = candidate.topology.information.flows;
  const environments = new Set(candidate.environment.map((entry) => entry.environmentRef));
  const mixText = actorMix.map((entry) => `${entry.kind}:${entry.count}`).join(",");
  const edgeText = edgeCounts.map((entry) => `${entry.kind}:${entry.count}`).join(",");
  const canonical = [
    "shape:v1",
    `mix=${mixText}`,
    `oversight=${humanOversight ? 1 : 0}`,
    `auto=${automationClass}`,
    `edges=${edgeText}`,
    `flows=${flows.length}`,
    `review=${flows.filter((flow) => flow.reviewRequired).length}`,
    `minctx=${flows.filter((flow) => flow.minimalContext).length}`,
    `env=${environments.size}`,
  ].join("|");
  return {
    actorMix,
    humanOversight,
    automationClass,
    edgeCounts,
    informationFlowCount: flows.length,
    reviewRequiredFlows: flows.filter((flow) => flow.reviewRequired).length,
    minimalContextFlows: flows.filter((flow) => flow.minimalContext).length,
    environmentCount: environments.size,
    canonical,
    shapeKey: fingerprintDigest(canonical),
  };
}
