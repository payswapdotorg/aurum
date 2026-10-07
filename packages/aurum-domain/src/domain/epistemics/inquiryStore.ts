/**
 * In-memory inquiry store: hypotheses (unresolved explanations, append-only
 * status history), contradictions (RETAINED conflicts — the kernel never
 * merges or silently resolves them) and unknowns (consequential questions
 * with explicit, audited resolution).
 */
import { conflictError, invariantError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type { ContradictionId, HypothesisId, UnknownId } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import { auditInputIssues } from "../audit/records.js";
import type { AuditSink } from "../audit/ports.js";
import {
  HYPOTHESIS_STATUSES,
  type ContradictionRecord,
  type HypothesisRecord,
  type HypothesisStatus,
  type HypothesisStatusEntry,
  type UnknownRecord,
} from "./records.js";
import type {
  InquiryLedger,
  OpenHypothesisInput,
  RaiseUnknownInput,
  RecordContradictionInput,
  RecordHypothesisStatusInput,
  ResolveContradictionInput,
  ResolveUnknownInput,
} from "./ports.js";
import {
  addProvenanceIssues,
  resolveFreshness,
  validateFreshnessStamp,
  validateSubjectRef,
} from "./internal.js";

/** Legal hypothesis status transitions (append-only lifecycle). */
export function hypothesisTransitionAllowed(from: HypothesisStatus, to: HypothesisStatus): boolean {
  if (from === to) return false;
  if (from === "open") return to === "supported" || to === "refuted" || to === "retired";
  if (from === "supported" || from === "refuted") return to === "retired";
  return false;
}

export function createInquiryLedger(audit: AuditSink): InquiryLedger {
  const hypotheses = new TenantIndex<HypothesisRecord>();
  const contradictions = new TenantIndex<ContradictionRecord>();
  const unknowns = new TenantIndex<UnknownRecord>();

  function openHypothesis(
    scope: TenantScope,
    input: OpenHypothesisInput,
  ): Result<HypothesisRecord> {
    const v = createValidator();
    const hypothesisId = v.requireIdFormat(
      "hypothesisId",
      input?.hypothesisId ?? "",
    ) as HypothesisId;
    const statement = v.requireText("statement", input?.statement ?? "");
    const explains = Array.isArray(input?.explains) ? input.explains : [];
    if (explains.length === 0) v.add("explains", "must be a non-empty array");
    explains.forEach((subject, index) =>
      validateSubjectRef(v, `explains.${index}`, subject as { kind?: unknown; id?: unknown }),
    );
    addProvenanceIssues(v, input?.provenance);
    validateFreshnessStamp(v, "freshness", input?.freshness);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (hypotheses.has(scope, hypothesisId)) {
      return { ok: false, error: conflictError("hypothesis already registered in tenant") };
    }
    const entry: HypothesisStatusEntry = {
      status: "open",
      at: input.now,
      provenance: input.provenance,
    };
    const record: HypothesisRecord = {
      scope,
      hypothesisId,
      statement,
      explains: Object.freeze([...explains]),
      status: "open",
      statusHistory: Object.freeze([entry]),
      provenance: input.provenance,
      freshness: resolveFreshness(input.freshness, input.now),
    };
    return ok(hypotheses.put(scope, hypothesisId, record));
  }

  function recordHypothesisStatus(
    scope: TenantScope,
    input: RecordHypothesisStatusInput,
  ): Result<HypothesisRecord> {
    const v = createValidator();
    const hypothesisId = v.requireIdFormat(
      "hypothesisId",
      input?.hypothesisId ?? "",
    ) as HypothesisId;
    const status = v.requireVocabulary("status", String(input?.status ?? ""), HYPOTHESIS_STATUSES);
    addProvenanceIssues(v, input?.provenance);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    const record = hypotheses.get(scope, hypothesisId);
    if (!record) return { ok: false, error: notFound("hypothesis") };
    if (!hypothesisTransitionAllowed(record.status, status)) {
      return {
        ok: false,
        error: invariantError(`hypothesis cannot move from ${record.status} to ${status}`),
      };
    }
    const entry: HypothesisStatusEntry = {
      status,
      at: input.now,
      provenance: input.provenance,
    };
    const updated: HypothesisRecord = {
      ...record,
      status,
      statusHistory: Object.freeze([...record.statusHistory, entry]),
    };
    const stored = hypotheses.put(scope, hypothesisId, updated);
    audit.append(
      scope,
      { kind: "hypothesis", id: hypothesisId },
      "hypothesis.status-changed",
      input.audit,
      Object.freeze({ from: record.status, to: status }),
    );
    return ok(stored);
  }

  function recordContradiction(
    scope: TenantScope,
    input: RecordContradictionInput,
  ): Result<ContradictionRecord> {
    const v = createValidator();
    const contradictionId = v.requireIdFormat(
      "contradictionId",
      input?.contradictionId ?? "",
    ) as ContradictionId;
    const description = v.requireText("description", input?.description ?? "");
    const between = Array.isArray(input?.between) ? input.between : [];
    if (between.length < 2) v.add("between", "must reference at least two records");
    between.forEach((subject, index) =>
      validateSubjectRef(v, `between.${index}`, subject as { kind?: unknown; id?: unknown }),
    );
    const seen = new Set(between.map((subject) => `${subject.kind}:${subject.id}`));
    if (seen.size < between.length) v.add("between", "must reference distinct records");
    addProvenanceIssues(v, input?.provenance);
    validateFreshnessStamp(v, "freshness", input?.freshness);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (contradictions.has(scope, contradictionId)) {
      return { ok: false, error: conflictError("contradiction already registered in tenant") };
    }
    const record: ContradictionRecord = {
      scope,
      contradictionId,
      between: Object.freeze([...between]),
      description,
      status: "open",
      recordedAt: input.now,
      provenance: input.provenance,
      freshness: resolveFreshness(input.freshness, input.now),
    };
    const stored = contradictions.put(scope, contradictionId, record);
    // The description is the "why" for recording a retained conflict.
    audit.append(scope, { kind: "contradiction", id: contradictionId }, "contradiction.recorded", {
      actor: input.provenance.actor,
      at: input.now,
      reason: description,
    });
    return ok(stored);
  }

  function resolveContradiction(
    scope: TenantScope,
    input: ResolveContradictionInput,
  ): Result<ContradictionRecord> {
    const v = createValidator();
    const contradictionId = v.requireIdFormat(
      "contradictionId",
      input?.contradictionId ?? "",
    ) as ContradictionId;
    const outcome = v.requireText("outcome", input?.outcome ?? "");
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    const record = contradictions.get(scope, contradictionId);
    if (!record) return { ok: false, error: notFound("contradiction") };
    if (record.status === "resolved") {
      return { ok: false, error: conflictError("contradiction already resolved") };
    }
    // Resolution is explicit and audited; the conflict record and both sides
    // are retained. The kernel offers no auto-merge path.
    const resolved: ContradictionRecord = {
      ...record,
      status: "resolved",
      resolution: Object.freeze({
        outcome,
        resolvedAt: input.now,
        resolvedBy: input.audit.actor,
      }),
    };
    const stored = contradictions.put(scope, contradictionId, resolved);
    audit.append(
      scope,
      { kind: "contradiction", id: record.contradictionId },
      "contradiction.resolved",
      input.audit,
      Object.freeze({ outcome }),
    );
    return ok(stored);
  }

  function raiseUnknown(scope: TenantScope, input: RaiseUnknownInput): Result<UnknownRecord> {
    const v = createValidator();
    const unknownId = v.requireIdFormat("unknownId", input?.unknownId ?? "") as UnknownId;
    const question = v.requireText("question", input?.question ?? "");
    const consequence = v.requireText("consequence", input?.consequence ?? "");
    const relatedSubjects = Array.isArray(input?.relatedSubjects) ? input.relatedSubjects : [];
    relatedSubjects.forEach((subject, index) =>
      validateSubjectRef(
        v,
        `relatedSubjects.${index}`,
        subject as { kind?: unknown; id?: unknown },
      ),
    );
    addProvenanceIssues(v, input?.provenance);
    validateFreshnessStamp(v, "freshness", input?.freshness);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (unknowns.has(scope, unknownId)) {
      return { ok: false, error: conflictError("unknown already registered in tenant") };
    }
    const record: UnknownRecord = {
      scope,
      unknownId,
      question,
      consequence,
      relatedSubjects: Object.freeze([...relatedSubjects]),
      status: "open",
      raisedAt: input.now,
      provenance: input.provenance,
      freshness: resolveFreshness(input.freshness, input.now),
    };
    const stored = unknowns.put(scope, unknownId, record);
    // The question is the "why" for raising an explicit unknown.
    audit.append(scope, { kind: "unknown", id: unknownId }, "unknown.raised", {
      actor: input.provenance.actor,
      at: input.now,
      reason: question,
    });
    return ok(stored);
  }

  function resolveUnknown(scope: TenantScope, input: ResolveUnknownInput): Result<UnknownRecord> {
    const v = createValidator();
    const unknownId = v.requireIdFormat("unknownId", input?.unknownId ?? "") as UnknownId;
    const outcome = v.requireText("outcome", input?.outcome ?? "");
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    const record = unknowns.get(scope, unknownId);
    if (!record) return { ok: false, error: notFound("unknown") };
    if (record.status === "resolved") {
      return { ok: false, error: conflictError("unknown already resolved") };
    }
    const resolved: UnknownRecord = {
      ...record,
      status: "resolved",
      resolution: Object.freeze({
        outcome,
        resolvedAt: input.now,
        resolvedBy: input.audit.actor,
      }),
    };
    const stored = unknowns.put(scope, unknownId, resolved);
    audit.append(
      scope,
      { kind: "unknown", id: record.unknownId },
      "unknown.resolved",
      input.audit,
      Object.freeze({ outcome }),
    );
    return ok(stored);
  }

  return {
    openHypothesis,
    recordHypothesisStatus,
    getHypothesis: (scope: TenantScope, hypothesisId: string) => {
      const record = hypotheses.get(scope, hypothesisId);
      return record ? ok(record) : { ok: false, error: notFound("hypothesis") };
    },
    recordContradiction,
    getContradiction: (scope: TenantScope, contradictionId: string) => {
      const record = contradictions.get(scope, contradictionId);
      return record ? ok(record) : { ok: false, error: notFound("contradiction") };
    },
    listOpenContradictions: (scope: TenantScope) =>
      Object.freeze(contradictions.list(scope).filter((record) => record.status === "open")),
    resolveContradiction,
    raiseUnknown,
    getUnknown: (scope: TenantScope, unknownId: string) => {
      const record = unknowns.get(scope, unknownId);
      return record ? ok(record) : { ok: false, error: notFound("unknown") };
    },
    listOpenUnknowns: (scope: TenantScope) =>
      Object.freeze(unknowns.list(scope).filter((record) => record.status === "open")),
    resolveUnknown,
  };
}
