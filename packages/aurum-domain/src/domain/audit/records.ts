/**
 * Audit references: who / what / when / why for every consequential
 * transition. Audit entries are append-only and tenant-scoped.
 */
import type { ValidationIssue } from "../core/errors.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { ActorReference, SubjectReference } from "../core/refs.js";
import type { DomainJsonValue } from "../core/value.js";
import type { TenantScope, TenantScopedRecord } from "../core/scope.js";

/** Typed vocabulary of audited transitions. */
export const AUDIT_ACTIONS = [
  "membership.granted",
  "membership.ended",
  "organization.registered",
  "site.registered",
  "unit.registered",
  "observation.retracted",
  "claim.retracted",
  "belief.revised",
  "hypothesis.status-changed",
  "contradiction.recorded",
  "contradiction.resolved",
  "unknown.raised",
  "unknown.resolved",
  "goal.created",
  "goal.revised",
  "memory.revised",
  "action.recommended",
  "action.approved",
  "action.authorized",
  "action.rejected",
  "action.executed",
] as const;

export type AuditActionKind = (typeof AUDIT_ACTIONS)[number];

export function isKnownAuditAction(value: string): value is AuditActionKind {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/** Who/when/why input required by every consequential transition command. */
export interface AuditInput {
  readonly actor: ActorReference;
  readonly at: DomainTimestamp;
  /** Why the transition happened (non-empty). */
  readonly reason: string;
}

/** One immutable, tenant-scoped audit entry. */
export interface AuditRecord extends TenantScopedRecord {
  readonly auditId: string;
  /** what */
  readonly subject: SubjectReference;
  /** what */
  readonly action: AuditActionKind;
  /** who */
  readonly actor: ActorReference;
  /** when */
  readonly at: DomainTimestamp;
  /** why */
  readonly reason: string;
  readonly details?: DomainJsonValue;
}

/** Validates an audit input in isolation. Returns issues, empty when valid. */
export function auditInputIssues(input: AuditInput, fieldPrefix = "audit"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!input || typeof input !== "object") {
    return [{ field: fieldPrefix, problem: "is required" }];
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length === 0) {
    issues.push({ field: `${fieldPrefix}.reason`, problem: "must be a non-empty string" });
  }
  if (!input.actor || typeof input.actor.kind !== "string") {
    issues.push({ field: `${fieldPrefix}.actor`, problem: "is required" });
  } else if (input.actor.kind === "person" && !input.actor.personId) {
    issues.push({
      field: `${fieldPrefix}.actor.personId`,
      problem: "is required for person actors",
    });
  }
  if (typeof input.at !== "number" || !Number.isFinite(input.at) || input.at < 0) {
    issues.push({ field: `${fieldPrefix}.at`, problem: "must be finite epoch milliseconds >= 0" });
  }
  return issues;
}

/** Builds an audit record from validated input. */
export function createAuditRecord(
  scope: TenantScope,
  subject: SubjectReference,
  action: AuditActionKind,
  input: AuditInput,
  auditId: string,
  details?: DomainJsonValue,
): AuditRecord {
  const record: AuditRecord = {
    scope,
    auditId,
    subject,
    action,
    actor: input.actor,
    at: input.at,
    reason: input.reason.trim(),
  };
  return details === undefined ? record : { ...record, details };
}
