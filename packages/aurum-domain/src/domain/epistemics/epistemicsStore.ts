/**
 * In-memory claims + beliefs store. Belief history is append-only; claims
 * must derive from in-tenant observations; belief revisions must rest on
 * usable in-tenant claims. Retraction is an audited transition.
 */
import { conflictError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type { BeliefId, ClaimId, ObservationId } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import { auditInputIssues } from "../audit/records.js";
import type { AuditSink } from "../audit/ports.js";
import type { BeliefRecord, BeliefRevision, ClaimRecord } from "./records.js";
import type {
  EpistemicsLedger,
  EvidenceLookup,
  RegisterClaimInput,
  RetractClaimInput,
  ReviseBeliefInput,
} from "./ports.js";
import {
  addProvenanceIssues,
  resolveFreshness,
  validateFreshnessStamp,
  validateSubjectRef,
} from "./internal.js";

export function createEpistemicsLedger(options: {
  audit: AuditSink;
  evidenceLookup: EvidenceLookup;
}): EpistemicsLedger {
  const { audit, evidenceLookup } = options;
  const claims = new TenantIndex<ClaimRecord>();
  const beliefs = new TenantIndex<BeliefRecord>();

  function registerClaim(scope: TenantScope, input: RegisterClaimInput): Result<ClaimRecord> {
    const v = createValidator();
    const claimId = v.requireIdFormat("claimId", input?.claimId ?? "") as ClaimId;
    const statement = v.requireText("statement", input?.statement ?? "");
    const derivedFrom = v.requireNonEmptyUniqueList("derivedFrom", input?.derivedFrom ?? []);
    addProvenanceIssues(v, input?.provenance);
    validateFreshnessStamp(v, "freshness", input?.freshness);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    for (const observationId of derivedFrom) {
      if (!evidenceLookup.observationExists(scope, observationId)) {
        return { ok: false, error: notFound("observation") };
      }
    }
    if (claims.has(scope, claimId)) {
      return { ok: false, error: conflictError("claim already registered in tenant") };
    }
    const record: ClaimRecord = {
      scope,
      claimId,
      statement,
      derivedFrom: Object.freeze([...derivedFrom]) as readonly ObservationId[],
      provenance: input.provenance,
      freshness: resolveFreshness(input.freshness, input.provenance.recordedAt),
      status: "active",
    };
    return ok(claims.put(scope, claimId, record));
  }

  function retractClaim(
    scope: TenantScope,
    claimId: string,
    input: RetractClaimInput,
  ): Result<ClaimRecord> {
    const v = createValidator();
    v.requireIdFormat("claimId", claimId ?? "");
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    v.requireText("reason", input?.reason ?? "", { max: 2000 });
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    const record = claims.get(scope, claimId.trim());
    if (!record) return { ok: false, error: notFound("claim") };
    if (record.status !== "active") {
      return { ok: false, error: conflictError(`claim already ${record.status}`) };
    }
    const retracted: ClaimRecord = {
      ...record,
      status: "retracted",
      retractedAt: input.now,
      retractedBy: input.audit.actor,
    };
    const stored = claims.put(scope, claimId.trim(), retracted);
    audit.append(
      scope,
      { kind: "claim", id: record.claimId },
      "claim.retracted",
      input.audit,
      Object.freeze({ reason: input.reason }),
    );
    return ok(stored);
  }

  function reviseBelief(scope: TenantScope, input: ReviseBeliefInput): Result<BeliefRecord> {
    const v = createValidator();
    const beliefId = v.requireIdFormat("beliefId", input?.beliefId ?? "") as BeliefId;
    validateSubjectRef(
      v,
      "subject",
      input?.subject as { kind?: unknown; id?: unknown } | undefined,
    );
    const statement = v.requireText("statement", input?.statement ?? "");
    const supportingClaimIds = v.requireNonEmptyUniqueList(
      "supportingClaimIds",
      input?.supportingClaimIds ?? [],
    );
    addProvenanceIssues(v, input?.provenance);
    validateFreshnessStamp(v, "freshness", input?.freshness);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    for (const claimId of supportingClaimIds) {
      if (!evidenceLookup.claimIsUsable(scope, claimId)) {
        return { ok: false, error: notFound("claim") };
      }
    }
    const existing = beliefs.get(scope, beliefId);
    if (existing && existing.subject.kind !== input.subject.kind) {
      return { ok: false, error: conflictError("belief subject cannot change between revisions") };
    }
    if (existing && existing.subject.id !== input.subject.id) {
      return { ok: false, error: conflictError("belief subject cannot change between revisions") };
    }
    const revision: BeliefRevision = {
      revisionNumber: existing ? existing.revisions.length + 1 : 1,
      statement,
      supportingClaimIds: Object.freeze([...supportingClaimIds]) as readonly ClaimId[],
      provenance: input.provenance,
      freshness: resolveFreshness(input.freshness, input.now),
      createdAt: input.now,
    };
    const record: BeliefRecord = existing
      ? {
          ...existing,
          currentRevision: revision.revisionNumber,
          revisions: Object.freeze([...existing.revisions, revision]),
        }
      : {
          scope,
          beliefId,
          subject: input.subject,
          currentRevision: 1,
          revisions: Object.freeze([revision]),
        };
    const stored = beliefs.put(scope, beliefId, record);
    audit.append(
      scope,
      { kind: "belief", id: beliefId },
      "belief.revised",
      input.audit,
      Object.freeze({ revisionNumber: revision.revisionNumber }),
    );
    return ok(stored);
  }

  return {
    registerClaim,
    getClaim: (scope: TenantScope, claimId: string) => {
      const record = claims.get(scope, claimId);
      return record ? ok(record) : { ok: false, error: notFound("claim") };
    },
    retractClaim,
    reviseBelief,
    getBelief: (scope: TenantScope, beliefId: string) => {
      const record = beliefs.get(scope, beliefId);
      return record ? ok(record) : { ok: false, error: notFound("belief") };
    },
    listBeliefs: (scope: TenantScope, subject: { kind: unknown; id: unknown }) =>
      beliefs
        .list(scope)
        .filter(
          (record) => record.subject.kind === subject.kind && record.subject.id === subject.id,
        ),
  };
}
