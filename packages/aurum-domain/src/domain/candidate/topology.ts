/**
 * Candidate topology (W005 frozen shared vocabulary): execution topology
 * (how work flows through steps and actors) plus information topology (the
 * information plan from spec/ARCHITECTURE.md: required knowledge, source/
 * owner, recipients, freshness requirement, minimal context, review,
 * escalation and handoff) and the relation kinds between actors
 * (delegation, review, escalation, handoff).
 */
import type { ValidationIssue } from "../core/errors.js";

export const TOPOLOGY_EDGE_KINDS = ["delegation", "review", "escalation", "handoff"] as const;

export type TopologyEdgeKind = (typeof TOPOLOGY_EDGE_KINDS)[number];

export function isKnownTopologyEdgeKind(value: string): value is TopologyEdgeKind {
  return (TOPOLOGY_EDGE_KINDS as readonly string[]).includes(value);
}

/** A directed relation between two actors of the candidate. */
export interface TopologyEdge {
  readonly kind: TopologyEdgeKind;
  readonly fromActorId: string;
  readonly toActorId: string;
  /** Execution step the relation is attached to, when specific. */
  readonly onStepRef?: string;
  readonly note?: string;
}

/** One step of the candidate's execution plan skeleton. */
export interface ExecutionStep {
  readonly stepId: string;
  readonly name: string;
  /** Actor responsible for the step, when assigned. */
  readonly actorId?: string;
  readonly automated: boolean;
}

/** How work flows: ordered steps plus actor relations. */
export interface ExecutionTopology {
  readonly steps: readonly ExecutionStep[];
  readonly edges: readonly TopologyEdge[];
}

/**
 * One information flow of the information plan: which knowledge moves from
 * whom to whom, with which freshness requirement, review/escalation/handoff
 * duties (spec/ARCHITECTURE.md "Information strategy").
 */
export interface InformationFlow {
  readonly flowId: string;
  /** Required knowledge (what must be relayed). */
  readonly knowledge: string;
  /** Source actor (who/what holds the knowledge). */
  readonly sourceActorId?: string;
  /** Owner actor accountable for the flow's freshness. */
  readonly ownerActorId?: string;
  readonly recipientActorIds: readonly string[];
  /** Maximum age of the knowledge for the flow to stay useful, in ms. */
  readonly freshnessMaxAgeMs?: number;
  /** Relay is minimal-context (only what recipients need). */
  readonly minimalContext: boolean;
  /** A human/actor review is required before delivery. */
  readonly reviewRequired: boolean;
  /** Actor receiving escalations when the flow fails. */
  readonly escalationActorId?: string;
  /** Steps that trigger a handoff of this knowledge. */
  readonly handoffOnStepRefs?: readonly string[];
}

/** The information plan of a candidate. */
export interface InformationTopology {
  readonly flows: readonly InformationFlow[];
}

/** Validates the execution topology against the candidate's actor set. */
export function executionTopologyIssues(
  topology: ExecutionTopology | undefined,
  actorIds: ReadonlySet<string>,
  field = "topology.execution",
): ValidationIssue[] {
  if (!topology || typeof topology !== "object") {
    return [{ field, problem: "is required" }];
  }
  const issues: ValidationIssue[] = [];
  const steps = Array.isArray(topology.steps) ? topology.steps : [];
  if (steps.length === 0) {
    issues.push({ field: `${field}.steps`, problem: "must be a non-empty array" });
  }
  const stepIds = new Set<string>();
  steps.forEach((step, index) => {
    if (typeof step?.stepId !== "string" || step.stepId.trim().length === 0) {
      issues.push({
        field: `${field}.steps.${index}.stepId`,
        problem: "must be a non-empty string",
      });
    } else {
      if (stepIds.has(step.stepId)) {
        issues.push({
          field: `${field}.steps.${index}.stepId`,
          problem: `duplicate step id: ${step.stepId}`,
        });
      }
      stepIds.add(step.stepId);
    }
    if (typeof step?.name !== "string" || step.name.trim().length === 0) {
      issues.push({ field: `${field}.steps.${index}.name`, problem: "must be a non-empty string" });
    }
    if (step?.actorId !== undefined && !actorIds.has(step.actorId)) {
      issues.push({
        field: `${field}.steps.${index}.actorId`,
        problem: "must reference a declared actor",
      });
    }
    if (typeof step?.automated !== "boolean") {
      issues.push({ field: `${field}.steps.${index}.automated`, problem: "must be a boolean" });
    }
  });
  (Array.isArray(topology.edges) ? topology.edges : []).forEach((edge, index) => {
    if (!edge || !isKnownTopologyEdgeKind(String(edge.kind))) {
      issues.push({
        field: `${field}.edges.${index}.kind`,
        problem: "must be a known topology edge kind",
      });
    }
    if (!actorIds.has(edge?.fromActorId ?? "")) {
      issues.push({
        field: `${field}.edges.${index}.fromActorId`,
        problem: "must reference a declared actor",
      });
    }
    if (!actorIds.has(edge?.toActorId ?? "")) {
      issues.push({
        field: `${field}.edges.${index}.toActorId`,
        problem: "must reference a declared actor",
      });
    }
    if (edge?.onStepRef !== undefined && !stepIds.has(edge.onStepRef)) {
      issues.push({
        field: `${field}.edges.${index}.onStepRef`,
        problem: "must reference a declared execution step",
      });
    }
    if (edge?.fromActorId === edge?.toActorId && edge?.fromActorId !== undefined) {
      issues.push({
        field: `${field}.edges.${index}`,
        problem: "must relate two different actors",
      });
    }
  });
  return issues;
}

/** Validates the information topology against actor and step sets. */
export function informationTopologyIssues(
  topology: InformationTopology | undefined,
  actorIds: ReadonlySet<string>,
  stepIds: ReadonlySet<string>,
  field = "topology.information",
): ValidationIssue[] {
  if (!topology || typeof topology !== "object") {
    return [{ field, problem: "is required" }];
  }
  const issues: ValidationIssue[] = [];
  const flows = Array.isArray(topology.flows) ? topology.flows : [];
  if (flows.length === 0) {
    issues.push({ field: `${field}.flows`, problem: "must be a non-empty array" });
  }
  flows.forEach((flow, index) => {
    const prefix = `${field}.flows.${index}`;
    if (typeof flow?.flowId !== "string" || flow.flowId.trim().length === 0) {
      issues.push({ field: `${prefix}.flowId`, problem: "must be a non-empty string" });
    }
    if (typeof flow?.knowledge !== "string" || flow.knowledge.trim().length === 0) {
      issues.push({ field: `${prefix}.knowledge`, problem: "must be a non-empty string" });
    }
    if (flow?.sourceActorId !== undefined && !actorIds.has(flow.sourceActorId)) {
      issues.push({ field: `${prefix}.sourceActorId`, problem: "must reference a declared actor" });
    }
    if (flow?.ownerActorId !== undefined && !actorIds.has(flow.ownerActorId)) {
      issues.push({ field: `${prefix}.ownerActorId`, problem: "must reference a declared actor" });
    }
    const recipients = Array.isArray(flow?.recipientActorIds) ? flow.recipientActorIds : [];
    if (recipients.length === 0) {
      issues.push({ field: `${prefix}.recipientActorIds`, problem: "must be a non-empty array" });
    }
    for (const recipient of recipients) {
      if (!actorIds.has(recipient)) {
        issues.push({
          field: `${prefix}.recipientActorIds`,
          problem: `must reference a declared actor: ${String(recipient)}`,
        });
      }
    }
    if (flow?.freshnessMaxAgeMs !== undefined) {
      if (
        typeof flow.freshnessMaxAgeMs !== "number" ||
        !Number.isFinite(flow.freshnessMaxAgeMs) ||
        flow.freshnessMaxAgeMs <= 0
      ) {
        issues.push({ field: `${prefix}.freshnessMaxAgeMs`, problem: "must be a positive number" });
      }
    }
    if (typeof flow?.minimalContext !== "boolean") {
      issues.push({ field: `${prefix}.minimalContext`, problem: "must be a boolean" });
    }
    if (typeof flow?.reviewRequired !== "boolean") {
      issues.push({ field: `${prefix}.reviewRequired`, problem: "must be a boolean" });
    }
    if (flow?.escalationActorId !== undefined && !actorIds.has(flow.escalationActorId)) {
      issues.push({
        field: `${prefix}.escalationActorId`,
        problem: "must reference a declared actor",
      });
    }
    for (const stepRef of flow?.handoffOnStepRefs ?? []) {
      if (!stepIds.has(stepRef)) {
        issues.push({
          field: `${prefix}.handoffOnStepRefs`,
          problem: `must reference a declared execution step: ${String(stepRef)}`,
        });
      }
    }
  });
  return issues;
}
