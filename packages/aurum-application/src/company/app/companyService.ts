/**
 * The company intelligence service (W004 app layer): the read-only facade
 * over the domain kernel — who owns what, what changed, what is covered,
 * what needs attention, what is unknown. NO SECOND AUTHORITY: the service
 * queries; missing evidence is an honest answer, never an error and never a
 * fabrication. Validation failures are the only error path (never logged).
 */
import {
  classifyFreshness,
  DEFAULT_FRESHNESS_POLICY,
  err,
  isKnownActorKind,
  isKnownSubjectKind,
  ok,
  type ActorReference,
  type DomainTimestamp,
  type Result,
  type SubjectReference,
  type TenantScope,
  type ValidationIssue,
} from "@aurum/domain";
import { companyValidationError, type CompanyError } from "../domain/errors.js";
import type {
  AttentionReport,
  ChangeReport,
  CompanyAnswer,
  CompanyQueryLogRecord,
  CoverageReport,
  OwnershipAnswer,
  OwnershipEntry,
  SituationReport,
  UnknownReport,
} from "../domain/records.js";
import type { CompanyDomainViews, CompanyIntelligenceDeps } from "../domain/ports.js";
import { askAboutSubject } from "./subjectQuery.js";
import { whatChangedSince } from "./changesQuery.js";
import { reportCoverage } from "./coverageQuery.js";
import { goalAttentionQuery, situationQuery } from "./situationQuery.js";
import { reportUnknowns } from "./unknownsQuery.js";

/** The public company intelligence surface (9 methods; policy limit is 12). */
export interface CompanyIntelligence {
  askAboutSubject(
    scope: TenantScope,
    input: {
      subject: SubjectReference;
      now: DomainTimestamp;
      askedBy: ActorReference;
      reason: string;
    },
  ): Result<CompanyAnswer, CompanyError>;
  whoOwns(
    scope: TenantScope,
    input: {
      subject: SubjectReference;
      now: DomainTimestamp;
      askedBy: ActorReference;
      reason: string;
    },
  ): Result<OwnershipAnswer, CompanyError>;
  whatChangedSince(
    scope: TenantScope,
    input: {
      since: DomainTimestamp;
      until?: DomainTimestamp;
      subject?: SubjectReference;
      now: DomainTimestamp;
      askedBy: ActorReference;
      reason: string;
    },
  ): Result<ChangeReport, CompanyError>;
  reportCoverage(
    scope: TenantScope,
    input: {
      subject: SubjectReference;
      now: DomainTimestamp;
      askedBy: ActorReference;
      reason: string;
    },
  ): Result<CoverageReport, CompanyError>;
  situation(
    scope: TenantScope,
    input: { now: DomainTimestamp; askedBy: ActorReference; reason: string },
  ): Result<SituationReport, CompanyError>;
  goalAttention(
    scope: TenantScope,
    input: {
      now: DomainTimestamp;
      horizonClosingWithinMs?: number;
      askedBy: ActorReference;
      reason: string;
    },
  ): Result<AttentionReport, CompanyError>;
  reportUnknowns(
    scope: TenantScope,
    input: { now: DomainTimestamp; askedBy: ActorReference; reason: string },
  ): Result<UnknownReport, CompanyError>;
  getQueryLog(scope: TenantScope, queryId: string): Result<CompanyQueryLogRecord, CompanyError>;
  listQueryLogs(scope: TenantScope): readonly CompanyQueryLogRecord[];
}

let queryCounter = 0;
function nextQueryId(): string {
  queryCounter += 1;
  return `company-query-${queryCounter}`;
}

function subjectIssues(subject: SubjectReference | undefined): ValidationIssue[] {
  if (!subject || typeof subject !== "object")
    return [{ field: "subject", problem: "is required" }];
  if (!isKnownSubjectKind(subject.kind)) {
    return [{ field: "subject.kind", problem: "must be a known subject kind" }];
  }
  if (typeof subject.id !== "string" || subject.id.trim().length === 0) {
    return [{ field: "subject.id", problem: "must be a non-empty id" }];
  }
  return [];
}

function queryIssues(input: {
  now?: unknown;
  askedBy?: unknown;
  reason?: unknown;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof input?.now !== "number" || !Number.isFinite(input.now) || input.now < 0) {
    issues.push({ field: "now", problem: "must be finite epoch ms >= 0" });
  }
  const actor = input?.askedBy as ActorReference | undefined;
  if (!actor || !isKnownActorKind(actor.kind)) {
    issues.push({ field: "askedBy", problem: "must be a known actor" });
  } else if (actor.kind === "person" && !actor.personId) {
    issues.push({ field: "askedBy.personId", problem: "is required for person actors" });
  }
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  if (reason.length === 0 || reason.length > 2000) {
    issues.push({ field: "reason", problem: "must be 1..2000 characters" });
  }
  return issues;
}

export function createCompanyIntelligenceService(
  deps: CompanyIntelligenceDeps,
): CompanyIntelligence {
  const views: CompanyDomainViews = deps.views;
  const queryLog = deps.queryLog;

  function logged(
    scope: TenantScope,
    record: Omit<CompanyQueryLogRecord, "scope" | "queryId">,
  ): Result<CompanyQueryLogRecord, CompanyError> {
    return queryLog.appendQueryLog(scope, { scope, queryId: nextQueryId(), ...record });
  }

  function unknownOwnership(subject: SubjectReference, basis: string): OwnershipAnswer {
    return {
      subject,
      classification: "unknown",
      classificationBasis: basis,
      owners: [],
      blindSpots: [],
    };
  }

  function ownerFromGoal(
    scope: TenantScope,
    goalId: string,
    now: DomainTimestamp,
  ): OwnershipAnswer {
    const goal = views.goals.getGoal(scope, goalId);
    if (!goal.ok) {
      return unknownOwnership(
        { kind: "goal", id: goalId },
        "goal not found in the requesting tenant; no ownership basis",
      );
    }
    const current = goal.value.revisions[goal.value.currentRevision - 1];
    if (current === undefined) {
      return unknownOwnership(
        { kind: "goal", id: goalId },
        "goal has no current revision; no ownership basis",
      );
    }
    const owner: OwnershipEntry = {
      personId: current.owner.personId,
      labels: current.owner.labels,
      basis: "goal-revision",
      basisRecordId: `${goalId}@${current.revisionNumber}`,
      detail: `owner of goal ${goalId} per revision ${current.revisionNumber}`,
      recordedAt: current.createdAt,
      actor: current.provenance.actor,
      freshness: classifyFreshness({ asOf: current.createdAt }, now, DEFAULT_FRESHNESS_POLICY),
    };
    return {
      subject: { kind: "goal", id: goalId },
      classification: "evidenced",
      classificationBasis: `owner recorded in goal revision ${current.revisionNumber} (objective: ${current.objective})`,
      owners: Object.freeze([owner]),
      blindSpots: [],
    };
  }

  function ownersFromMemberships(
    scope: TenantScope,
    subject: SubjectReference,
    now: DomainTimestamp,
  ): OwnershipAnswer {
    const owners: OwnershipEntry[] = [];
    for (const membership of views.identity.listMemberships(scope)) {
      if (membership.status !== "active") continue;
      if (!membership.roles.includes("owner")) continue;
      const matches =
        subject.kind === "organization"
          ? membership.organizationId === subject.id
          : membership.unitId === subject.id;
      if (!matches) continue;
      const person = views.identity.getPerson(scope, membership.personId);
      owners.push({
        personId: membership.personId,
        labels: person.ok ? person.value.labels : [],
        basis: "active-membership",
        basisRecordId: membership.membershipId,
        detail: `owner role via membership ${membership.membershipId} (active)`,
        recordedAt: membership.grantedAt,
        actor: membership.grantedBy,
        freshness: classifyFreshness({ asOf: membership.grantedAt }, now, DEFAULT_FRESHNESS_POLICY),
      });
    }
    return {
      subject,
      classification: owners.length >= 1 ? "evidenced" : "unknown",
      classificationBasis:
        owners.length >= 1
          ? `${owners.length} active owner-membership(s) record this subject's ownership`
          : "no active owner-membership records this subject's ownership",
      owners: Object.freeze(
        owners.sort((left, right) => left.basisRecordId.localeCompare(right.basisRecordId)),
      ),
      blindSpots: [],
    };
  }

  return {
    askAboutSubject(scope, input) {
      const issues = [...subjectIssues(input?.subject), ...queryIssues(input)];
      if (issues.length > 0) return err(companyValidationError(issues));
      const answer = askAboutSubject(views, scope, input.subject, input.now);
      const stored = logged(scope, {
        kind: "ask-about-subject",
        subject: input.subject,
        askedBy: input.askedBy,
        at: input.now,
        reason: input.reason.trim(),
        classification: answer.classification,
      });
      if (!stored.ok) return err(stored.error);
      return ok(answer);
    },

    whoOwns(scope, input) {
      const issues = [...subjectIssues(input?.subject), ...queryIssues(input)];
      if (issues.length > 0) return err(companyValidationError(issues));
      const kind = input.subject.kind;
      if (kind !== "goal" && kind !== "organization" && kind !== "unit") {
        return err(
          companyValidationError([
            {
              field: "subject",
              problem: "ownership is defined for goal, organization and unit subjects",
            },
          ]),
        );
      }
      const answer =
        input.subject.kind === "goal"
          ? ownerFromGoal(scope, input.subject.id, input.now)
          : ownersFromMemberships(scope, input.subject, input.now);
      const stored = logged(scope, {
        kind: "who-owns",
        subject: input.subject,
        askedBy: input.askedBy,
        at: input.now,
        reason: input.reason.trim(),
      });
      if (!stored.ok) return err(stored.error);
      return ok(answer);
    },

    whatChangedSince(scope, input) {
      const issues = [...queryIssues(input)];
      if (typeof input?.since !== "number" || !Number.isFinite(input.since) || input.since < 0) {
        issues.push({ field: "since", problem: "must be finite epoch ms >= 0" });
      }
      if (input?.subject !== undefined) issues.push(...subjectIssues(input.subject));
      // `until` defaults to `now`; either way it must bound the window.
      const until = input?.until ?? input?.now;
      if (
        typeof until !== "number" ||
        !Number.isFinite(until) ||
        until < 0 ||
        (typeof input?.since === "number" && input.since >= 0 && until < input.since)
      ) {
        issues.push({ field: "until", problem: "must be >= since and finite epoch ms >= 0" });
      }
      if (issues.length > 0) return err(companyValidationError(issues));
      const report = whatChangedSince(views, scope, {
        since: input.since,
        until,
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
      });
      const stored = logged(scope, {
        kind: "what-changed-since",
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        since: input.since,
        askedBy: input.askedBy,
        at: input.now,
        reason: input.reason.trim(),
      });
      if (!stored.ok) return err(stored.error);
      return ok(report);
    },

    reportCoverage(scope, input) {
      const issues = [...subjectIssues(input?.subject), ...queryIssues(input)];
      if (issues.length > 0) return err(companyValidationError(issues));
      const report = reportCoverage(views, scope, input.subject, input.now);
      const stored = logged(scope, {
        kind: "report-coverage",
        subject: input.subject,
        askedBy: input.askedBy,
        at: input.now,
        reason: input.reason.trim(),
      });
      if (!stored.ok) return err(stored.error);
      return ok(report);
    },

    situation(scope, input) {
      const issues = queryIssues(input);
      if (issues.length > 0) return err(companyValidationError(issues));
      const report = situationQuery(views, scope, input.now);
      const stored = logged(scope, {
        kind: "situation",
        askedBy: input.askedBy,
        at: input.now,
        reason: input.reason.trim(),
      });
      if (!stored.ok) return err(stored.error);
      return ok(report);
    },

    goalAttention(scope, input) {
      const issues = queryIssues(input);
      const closing = input?.horizonClosingWithinMs;
      if (closing !== undefined && (!Number.isFinite(closing) || closing < 0)) {
        issues.push({ field: "horizonClosingWithinMs", problem: "must be finite ms >= 0" });
      }
      if (issues.length > 0) return err(companyValidationError(issues));
      const report = goalAttentionQuery(
        views,
        scope,
        input.now,
        input.horizonClosingWithinMs ?? 14 * 24 * 60 * 60 * 1000,
      );
      const stored = logged(scope, {
        kind: "goal-attention",
        askedBy: input.askedBy,
        at: input.now,
        reason: input.reason.trim(),
      });
      if (!stored.ok) return err(stored.error);
      return ok(report);
    },

    reportUnknowns(scope, input) {
      const issues = queryIssues(input);
      if (issues.length > 0) return err(companyValidationError(issues));
      const report = reportUnknowns(views, scope, input.now);
      const stored = logged(scope, {
        kind: "report-unknowns",
        askedBy: input.askedBy,
        at: input.now,
        reason: input.reason.trim(),
      });
      if (!stored.ok) return err(stored.error);
      return ok(report);
    },

    getQueryLog(scope, queryId) {
      return queryLog.getQueryLog(scope, queryId);
    },

    listQueryLogs(scope) {
      return queryLog.listQueryLogs(scope);
    },
  };
}
