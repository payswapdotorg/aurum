/**
 * Candidate actors (W005 frozen shared vocabulary). The mixed organization
 * search space from spec/ARCHITECTURE.md: Human, Team, Agent, AgentTeam,
 * Software, Automation, Supplier, Partner, ExternalService. Agent body and
 * model-binding references are opaque — the provider/agent plane (W003)
 * owns those registries; domain contracts never see provider SDK types.
 */
import type { PersonId, UnitId } from "../core/branding.js";
import type { TimeWindow } from "../core/time.js";
import type { ValidationIssue } from "../core/errors.js";

export const CANDIDATE_ACTOR_KINDS = [
  "human",
  "team",
  "agent",
  "agent-team",
  "software",
  "automation",
  "supplier",
  "partner",
  "external-service",
] as const;

export type CandidateActorKind = (typeof CANDIDATE_ACTOR_KINDS)[number];

export function isKnownCandidateActorKind(value: string): value is CandidateActorKind {
  return (CANDIDATE_ACTOR_KINDS as readonly string[]).includes(value);
}

/**
 * One actor of a candidate organization. Exactly one target field is
 * meaningful per kind: personId (human), unitId (team), agentBodyRef
 * (agent/agent-team), externalRef (software/automation/supplier/partner/
 * external-service).
 */
export interface CandidateActor {
  readonly actorId: string;
  readonly kind: CandidateActorKind;
  readonly personId?: PersonId;
  readonly unitId?: UnitId;
  readonly agentBodyRef?: string;
  readonly externalRef?: string;
  readonly displayName?: string;
}

/** Validates one actor. Returns issues, empty when valid. */
export function candidateActorIssues(
  actor: CandidateActor | undefined,
  field = "actors",
): ValidationIssue[] {
  if (!actor || typeof actor !== "object" || typeof actor.actorId !== "string") {
    return [{ field, problem: "is required (actorId must be a string)" }];
  }
  const issues: ValidationIssue[] = [];
  const actorId = actor.actorId.trim();
  if (actorId.length === 0 || actorId.length > 128) {
    issues.push({ field: `${field}.actorId`, problem: "must be 1..128 characters" });
  }
  if (!isKnownCandidateActorKind(String(actor.kind))) {
    return [...issues, { field: `${field}.kind`, problem: "must be a known candidate actor kind" }];
  }
  const externalRef =
    actor.externalRef !== undefined && typeof actor.externalRef === "string"
      ? actor.externalRef.trim()
      : "";
  switch (actor.kind) {
    case "human":
      if (!actor.personId) {
        issues.push({ field: `${field}.personId`, problem: "is required for human actors" });
      }
      break;
    case "team":
      if (!actor.unitId) {
        issues.push({ field: `${field}.unitId`, problem: "is required for team actors" });
      }
      break;
    case "agent":
    case "agent-team":
      if (!actor.agentBodyRef || actor.agentBodyRef.trim().length === 0) {
        issues.push({
          field: `${field}.agentBodyRef`,
          problem: `is required for ${actor.kind} actors`,
        });
      }
      break;
    case "software":
    case "automation":
    case "supplier":
    case "partner":
    case "external-service":
      if (externalRef.length === 0) {
        issues.push({
          field: `${field}.externalRef`,
          problem: `is required for ${actor.kind} actors`,
        });
      }
      break;
  }
  if (actor.displayName !== undefined && actor.displayName.trim().length === 0) {
    issues.push({ field: `${field}.displayName`, problem: "must be non-empty when present" });
  }
  return issues;
}

/**
 * Model occupancy: which opaque model binding an agent actor occupies for
 * which window, exclusively or shared. Model swaps preserve body identity
 * (spec/REBUILD-CONSTITUTION.md); occupancy is a candidate-level fact for
 * cost/capacity reasoning, not a provider-plane authority.
 */
export interface ModelOccupancy {
  /** Must reference an agent or agent-team actor of the same candidate. */
  readonly actorId: string;
  /** Opaque ModelBinding reference (provider fabric owns the registry). */
  readonly modelBindingRef: string;
  readonly window: TimeWindow;
  readonly exclusive: boolean;
}

/** Validates one occupancy entry against the candidate's actor set. */
export function modelOccupancyIssues(
  occupancy: ModelOccupancy | undefined,
  actorKinds: ReadonlyMap<string, CandidateActorKind>,
  field = "modelOccupancy",
): ValidationIssue[] {
  if (!occupancy || typeof occupancy !== "object") {
    return [{ field, problem: "is required" }];
  }
  const issues: ValidationIssue[] = [];
  const kind = actorKinds.get(occupancy.actorId);
  if (kind === undefined) {
    issues.push({ field: `${field}.actorId`, problem: "must reference a declared actor" });
  } else if (kind !== "agent" && kind !== "agent-team") {
    issues.push({
      field: `${field}.actorId`,
      problem: "model occupancy is only valid for agent/agent-team actors",
    });
  }
  if (
    typeof occupancy.modelBindingRef !== "string" ||
    occupancy.modelBindingRef.trim().length === 0
  ) {
    issues.push({ field: `${field}.modelBindingRef`, problem: "must be a non-empty reference" });
  }
  const window = occupancy.window;
  if (
    typeof window?.start !== "number" ||
    !Number.isFinite(window.start) ||
    window.start < 0 ||
    typeof window?.end !== "number" ||
    !Number.isFinite(window.end) ||
    window.end < 0 ||
    window.start > window.end
  ) {
    issues.push({ field: `${field}.window`, problem: "must be a valid time window" });
  }
  if (typeof occupancy.exclusive !== "boolean") {
    issues.push({ field: `${field}.exclusive`, problem: "must be a boolean" });
  }
  return issues;
}
