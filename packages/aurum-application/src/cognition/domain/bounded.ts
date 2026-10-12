/**
 * The bounded reasoning boundary (W007 domain layer, catalog clause 2:
 * "LLM supplies bounded content"). The model — through the `ReasoningPort`
 * — receives a bounded ORIENTATION DIGEST (never raw domain records) and
 * returns ONLY the `ReasonedContent` shape below. There are no stage,
 * control-flow, authorization or persistence fields: the model cannot
 * reorder stages, authorize actions or persist semantic state
 * (spec/REBUILD-CONSTITUTION.md). Validation is a pure function so the
 * service can enforce it defensively regardless of which adapter sits
 * behind the port; provider SDK types never enter (port-local types only).
 */
import {
  isKnownSubjectKind,
  type DomainTimestamp,
  type FreshnessStamp,
  type SubjectReference,
  type ValidationIssue,
} from "@aurum/domain";
import { MISSION_BOUNDS } from "./vocabulary.js";
import type { ProposalKind } from "./vocabulary.js";

// ---------------------------------------------------------------------------
// Request side (the bounded orientation digest handed TO the model).
// ---------------------------------------------------------------------------

export interface OrientationObservation {
  readonly observationId: string;
  readonly subject: SubjectReference;
  readonly content: string;
  readonly observedAt: DomainTimestamp;
  readonly freshness: FreshnessStamp;
}

export interface OrientationBelief {
  readonly beliefId: string;
  readonly subject: SubjectReference;
  readonly statement: string;
  readonly revisionCount: number;
}

export interface OrientationMemory {
  readonly memoryId: string;
  readonly subject: SubjectReference;
  readonly content: string;
}

export interface OrientationUnknown {
  readonly unknownId: string;
  readonly question: string;
  readonly consequence: string;
}

export interface OrientationContradiction {
  readonly contradictionId: string;
  readonly description: string;
}

export interface OrientationGoal {
  readonly goalId: string;
  readonly objective: string;
  readonly priority: string;
  readonly horizonStart: DomainTimestamp;
  readonly horizonEnd: DomainTimestamp;
  /** Subjects the goal's expected evidence points at (goal evaluation). */
  readonly expectedEvidenceSubjects: readonly SubjectReference[];
}

/** How many entries of each kind were dropped by the caps (honesty). */
export interface OrientationTruncation {
  readonly observations: number;
  readonly beliefs: number;
  readonly memory: number;
  readonly unknowns: number;
  readonly contradictions: number;
}

/** The persisted orientation snapshot (stage `orient` output). */
export interface MissionOrientation {
  readonly subject: SubjectReference;
  readonly question: string;
  readonly consequence: string;
  readonly goal?: OrientationGoal;
  readonly observations: readonly OrientationObservation[];
  readonly beliefs: readonly OrientationBelief[];
  readonly memory: readonly OrientationMemory[];
  readonly openUnknowns: readonly OrientationUnknown[];
  readonly openContradictions: readonly OrientationContradiction[];
  readonly truncation: OrientationTruncation;
}

/** The request the reasoning port receives. Bounded data only. */
export interface ReasoningRequest {
  readonly missionId: string;
  readonly subject: SubjectReference;
  readonly question: string;
  readonly consequence: string;
  readonly goal?: OrientationGoal;
  readonly observations: readonly OrientationObservation[];
  readonly beliefs: readonly OrientationBelief[];
  readonly memory: readonly OrientationMemory[];
  readonly openUnknowns: readonly OrientationUnknown[];
  readonly openContradictions: readonly OrientationContradiction[];
  readonly truncated: OrientationTruncation;
}

// ---------------------------------------------------------------------------
// Response side (the ONLY shape accepted FROM the model).
// ---------------------------------------------------------------------------

export interface ReasonedFinding {
  readonly statement: string;
  /** Observation ids the finding is derived from (must exist in the request). */
  readonly basedOn: readonly string[];
}

export interface ReasonedGap {
  readonly question: string;
  readonly consequence: string;
}

export interface ReasonedHypothesis {
  readonly statement: string;
  readonly explains: readonly SubjectReference[];
}

export interface ReasonedProposal {
  readonly kind: ProposalKind;
  readonly title: string;
  readonly description?: string;
  readonly subject?: SubjectReference;
  readonly rationale: string;
}

/** The bounded model response. No other fields are accepted. */
export interface ReasonedContent {
  readonly summary: string;
  readonly findings: readonly ReasonedFinding[];
  readonly gaps: readonly ReasonedGap[];
  readonly hypotheses: readonly ReasonedHypothesis[];
  readonly proposals: readonly ReasonedProposal[];
}

const CONTENT_FIELDS = ["summary", "findings", "gaps", "hypotheses", "proposals"] as const;

function subjectRefIssues(subject: SubjectReference | undefined, field: string): ValidationIssue[] {
  if (!subject || typeof subject !== "object") {
    return [{ field, problem: "must be a typed subject reference" }];
  }
  if (!isKnownSubjectKind(String(subject.kind))) {
    return [{ field: `${field}.kind`, problem: "must be a known subject kind" }];
  }
  if (typeof subject.id !== "string" || subject.id.trim().length === 0) {
    return [{ field: `${field}.id`, problem: "must be a non-empty id" }];
  }
  return [];
}

function boundedText(value: unknown, field: string, maxLength: number): ValidationIssue[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [{ field, problem: "must be a non-empty string" }];
  }
  if (value.length > maxLength) {
    return [{ field, problem: `must be at most ${maxLength} characters` }];
  }
  return [];
}

/**
 * Validates model response content against the bounded schema. The
 * `citedObservationIds` are the observation ids the request actually
 * carried — a finding citing anything else is FABRICATION and is refused
 * (the anti-fabrication gate).
 */
export function reasonedContentIssues(
  content: ReasonedContent | undefined,
  citedObservationIds: readonly string[],
): ValidationIssue[] {
  if (!content || typeof content !== "object") {
    return [{ field: "content", problem: "must be an object" }];
  }
  const issues: ValidationIssue[] = [];
  const keys = Object.keys(content);
  const unknownKeys = keys.filter((key) => !(CONTENT_FIELDS as readonly string[]).includes(key));
  for (const key of unknownKeys) {
    issues.push({ field: key, problem: "is not a bounded content field" });
  }
  issues.push(...boundedText(content.summary, "summary", MISSION_BOUNDS.summaryMaxLength));

  const findings = Array.isArray(content.findings) ? content.findings : [];
  if (findings.length > MISSION_BOUNDS.findingsMax) {
    issues.push({
      field: "findings",
      problem: `must contain at most ${MISSION_BOUNDS.findingsMax} findings`,
    });
  }
  findings.forEach((finding, index) => {
    const field = `findings.${index}`;
    if (!finding || typeof finding !== "object") {
      issues.push({ field, problem: "must be an object" });
      return;
    }
    issues.push(
      ...boundedText(finding.statement, `${field}.statement`, MISSION_BOUNDS.statementMaxLength),
    );
    const basedOn = Array.isArray(finding.basedOn) ? finding.basedOn : [];
    if (basedOn.length === 0) {
      issues.push({ field: `${field}.basedOn`, problem: "must cite at least one observation" });
    }
    if (basedOn.length > MISSION_BOUNDS.findingCitationsMax) {
      issues.push({
        field: `${field}.basedOn`,
        problem: `must cite at most ${MISSION_BOUNDS.findingCitationsMax} observations`,
      });
    }
    if (new Set(basedOn.map(String)).size !== basedOn.length) {
      issues.push({ field: `${field}.basedOn`, problem: "must not cite an observation twice" });
    }
    for (const cited of basedOn) {
      if (typeof cited !== "string" || !citedObservationIds.includes(cited)) {
        issues.push({
          field: `${field}.basedOn`,
          problem: `cites observation not present in the orientation: ${String(cited)}`,
        });
      }
    }
    const findingKeys = Object.keys(finding);
    for (const key of findingKeys) {
      if (key !== "statement" && key !== "basedOn") {
        issues.push({ field: `${field}.${key}`, problem: "is not a bounded finding field" });
      }
    }
  });

  const gaps = Array.isArray(content.gaps) ? content.gaps : [];
  if (gaps.length > MISSION_BOUNDS.gapsMax) {
    issues.push({ field: "gaps", problem: `must contain at most ${MISSION_BOUNDS.gapsMax} gaps` });
  }
  gaps.forEach((gap, index) => {
    const field = `gaps.${index}`;
    if (!gap || typeof gap !== "object") {
      issues.push({ field, problem: "must be an object" });
      return;
    }
    issues.push(
      ...boundedText(gap.question, `${field}.question`, MISSION_BOUNDS.questionMaxLength),
    );
    issues.push(
      ...boundedText(gap.consequence, `${field}.consequence`, MISSION_BOUNDS.consequenceMaxLength),
    );
    const gapKeys = Object.keys(gap);
    for (const key of gapKeys) {
      if (key !== "question" && key !== "consequence") {
        issues.push({ field: `${field}.${key}`, problem: "is not a bounded gap field" });
      }
    }
  });

  const hypotheses = Array.isArray(content.hypotheses) ? content.hypotheses : [];
  if (hypotheses.length > MISSION_BOUNDS.hypothesesMax) {
    issues.push({
      field: "hypotheses",
      problem: `must contain at most ${MISSION_BOUNDS.hypothesesMax} hypotheses`,
    });
  }
  hypotheses.forEach((hypothesis, index) => {
    const field = `hypotheses.${index}`;
    if (!hypothesis || typeof hypothesis !== "object") {
      issues.push({ field, problem: "must be an object" });
      return;
    }
    issues.push(
      ...boundedText(hypothesis.statement, `${field}.statement`, MISSION_BOUNDS.statementMaxLength),
    );
    const explains = Array.isArray(hypothesis.explains) ? hypothesis.explains : [];
    if (explains.length === 0) {
      issues.push({ field: `${field}.explains`, problem: "must reference at least one subject" });
    }
    explains.forEach((subject: SubjectReference, subIndex: number) =>
      issues.push(...subjectRefIssues(subject, `${field}.explains.${subIndex}`)),
    );
    const hypothesisKeys = Object.keys(hypothesis);
    for (const key of hypothesisKeys) {
      if (key !== "statement" && key !== "explains") {
        issues.push({ field: `${field}.${key}`, problem: "is not a bounded hypothesis field" });
      }
    }
  });

  const proposals = Array.isArray(content.proposals) ? content.proposals : [];
  if (proposals.length > MISSION_BOUNDS.proposalsMax) {
    issues.push({
      field: "proposals",
      problem: `must contain at most ${MISSION_BOUNDS.proposalsMax} proposals`,
    });
  }
  proposals.forEach((proposal, index) => {
    const field = `proposals.${index}`;
    if (!proposal || typeof proposal !== "object") {
      issues.push({ field, problem: "must be an object" });
      return;
    }
    const PROPOSAL_FIELD_ISSUE: ValidationIssue = {
      field,
      problem: "kind must be one of: recommendation, ask, proposal",
    };
    if (
      proposal.kind !== "recommendation" &&
      proposal.kind !== "ask" &&
      proposal.kind !== "proposal"
    ) {
      issues.push(PROPOSAL_FIELD_ISSUE);
    }
    issues.push(...boundedText(proposal.title, `${field}.title`, MISSION_BOUNDS.titleMaxLength));
    issues.push(
      ...boundedText(proposal.rationale, `${field}.rationale`, MISSION_BOUNDS.rationaleMaxLength),
    );
    if (proposal.description !== undefined) {
      issues.push(
        ...boundedText(
          proposal.description,
          `${field}.description`,
          MISSION_BOUNDS.descriptionMaxLength,
        ),
      );
    }
    if (proposal.subject !== undefined) {
      issues.push(...subjectRefIssues(proposal.subject, `${field}.subject`));
    }
    const proposalKeys = Object.keys(proposal);
    for (const key of proposalKeys) {
      if (!["kind", "title", "description", "subject", "rationale"].includes(key)) {
        issues.push({ field: `${field}.${key}`, problem: "is not a bounded proposal field" });
      }
    }
  });

  return issues;
}
