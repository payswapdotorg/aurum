/**
 * In-memory workforce directory (W005). Human work allocations are bounded:
 * `recordAssignment` requires a covering capacity declaration and rejects
 * effort/concurrency overruns. Every consequential transition lands in the
 * shared audit trail.
 */
import { conflictError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type {
  CapabilityId,
  CapacityDeclarationId,
  DomainTimestamp,
  PersonId,
  WorkAssignmentId,
  WorkforceRoleId,
} from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import type { TimeWindow } from "../core/time.js";
import type { AuditSink } from "../audit/ports.js";
import { auditInputIssues } from "../audit/records.js";
import { provenanceIssues } from "../evidence/provenance.js";
import {
  type CapacityBounds,
  type CapacityDeclarationRecord,
  type WorkAssignmentRecord,
  type WorkforceRoleRecord,
} from "./records.js";
import { summarizeWorkload } from "./workload.js";
import { coversPeriod, validatePeriod, type TimeWindowLike } from "./shared.js";
import type {
  AssignmentFilter,
  DeclareCapacityInput,
  EndAssignmentInput,
  RecordAssignmentInput,
  RegisterRoleInput,
  WorkforceDirectory,
} from "./ports.js";

export function createWorkforceDirectory(audit: AuditSink): WorkforceDirectory {
  const roles = new TenantIndex<WorkforceRoleRecord>();
  const capacities = new TenantIndex<CapacityDeclarationRecord>();
  const assignments = new TenantIndex<WorkAssignmentRecord>();

  function registerRole(scope: TenantScope, input: RegisterRoleInput): Result<WorkforceRoleRecord> {
    const v = createValidator();
    const roleId = v.requireIdFormat("roleId", input?.roleId ?? "") as WorkforceRoleId;
    v.requireText("title", input?.title ?? "", { max: 300 });
    if (input?.description !== undefined) v.requireText("description", input.description);
    const required = Array.isArray(input?.requiredCapabilities) ? input.requiredCapabilities : [];
    for (const [index, capability] of required.entries()) {
      v.requireIdFormat(`requiredCapabilities.${index}`, String(capability ?? ""));
    }
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    if (roles.has(scope, roleId)) {
      return { ok: false, error: conflictError("workforce role already registered in tenant") };
    }
    const record: WorkforceRoleRecord = {
      scope,
      roleId,
      title: input.title.trim(),
      ...(input.description ? { description: input.description.trim() } : {}),
      requiredCapabilities: Object.freeze(
        required.map((capability) => String(capability).trim() as CapabilityId),
      ),
      provenance: input.provenance,
      createdAt: input.now,
    };
    const stored = roles.put(scope, roleId, record);
    audit.append(
      scope,
      { kind: "workforce", id: roleId },
      "workforce.role-registered",
      { actor: input.provenance.actor, at: input.now, reason: "workforce role registered" },
      Object.freeze({ title: record.title }),
    );
    return ok(stored);
  }

  function declareCapacity(
    scope: TenantScope,
    input: DeclareCapacityInput,
  ): Result<CapacityDeclarationRecord> {
    const v = createValidator();
    const capacityId = v.requireIdFormat(
      "capacityId",
      input?.capacityId ?? "",
    ) as CapacityDeclarationId;
    v.requireIdFormat("personId", input?.personId ?? "");
    validatePeriod(v, "bounds.period", input?.bounds?.period);
    v.requireNonNegativeNumber("bounds.maxEffortMs", input?.bounds?.maxEffortMs ?? Number.NaN);
    if ((input?.bounds?.maxEffortMs ?? 0) <= 0)
      v.add("bounds.maxEffortMs", "must be greater than 0");
    v.requireMinInt(
      "bounds.maxConcurrentAssignments",
      input?.bounds?.maxConcurrentAssignments ?? Number.NaN,
      1,
    );
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    if (capacities.has(scope, capacityId)) {
      return {
        ok: false,
        error: conflictError("capacity declaration already registered in tenant"),
      };
    }
    const bounds: CapacityBounds = {
      period: input.bounds.period,
      maxEffortMs: input.bounds.maxEffortMs,
      maxConcurrentAssignments: input.bounds.maxConcurrentAssignments,
    };
    const record: CapacityDeclarationRecord = {
      scope,
      capacityId,
      personId: input.personId.trim() as PersonId,
      bounds,
      provenance: input.provenance,
      createdAt: input.now,
    };
    const stored = capacities.put(scope, capacityId, record);
    audit.append(
      scope,
      { kind: "workforce", id: capacityId },
      "workforce.capacity-declared",
      { actor: input.provenance.actor, at: input.now, reason: "human capacity bounds declared" },
      Object.freeze({
        personId: record.personId,
        maxEffortMs: bounds.maxEffortMs,
        maxConcurrentAssignments: bounds.maxConcurrentAssignments,
      }),
    );
    return ok(stored);
  }

  function coveringCapacity(
    scope: TenantScope,
    personId: string,
    period: TimeWindowLike,
  ): CapacityDeclarationRecord | undefined {
    return capacities
      .list(scope)
      .filter(
        (record) =>
          record.personId === personId &&
          coversPeriod(record.bounds.period as TimeWindowLike, period),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  function recordAssignment(
    scope: TenantScope,
    input: RecordAssignmentInput,
  ): Result<WorkAssignmentRecord> {
    const v = createValidator();
    const assignmentId = v.requireIdFormat(
      "assignmentId",
      input?.assignmentId ?? "",
    ) as WorkAssignmentId;
    v.requireIdFormat("personId", input?.personId ?? "");
    if (input?.roleId !== undefined) v.requireIdFormat("roleId", input.roleId);
    if (input?.processRef !== undefined) {
      v.requireIdFormat("processRef.processId", input.processRef?.processId ?? "");
      v.requireIdFormat("processRef.stepId", input.processRef?.stepId ?? "");
    }
    v.requireNonNegativeNumber("effortMs", input?.effortMs ?? Number.NaN);
    if ((input?.effortMs ?? 0) <= 0) v.add("effortMs", "must be greater than 0");
    validatePeriod(v, "period", input?.period);
    for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    if (assignments.has(scope, assignmentId)) {
      return { ok: false, error: conflictError("work assignment already registered in tenant") };
    }
    const personId = input.personId.trim() as PersonId;
    const period = input.period;
    const covering = coveringCapacity(scope, personId, period);
    if (!covering) {
      return {
        ok: false,
        error: validationError([
          {
            field: "personId",
            problem:
              "person has no capacity bounds covering the assignment period; declare capacity first",
          },
        ]),
      };
    }
    const active = assignments
      .list(scope)
      .filter(
        (record) =>
          record.personId === personId &&
          record.status === "active" &&
          record.period.start < period.end &&
          record.period.end > period.start,
      );
    if (active.length + 1 > covering.bounds.maxConcurrentAssignments) {
      return {
        ok: false,
        error: validationError([
          {
            field: "assignmentId",
            problem: `assignment exceeds maxConcurrentAssignments ${covering.bounds.maxConcurrentAssignments}`,
          },
        ]),
      };
    }
    const totalEffort = active.reduce((sum, record) => sum + record.effortMs, 0) + input.effortMs;
    if (totalEffort > covering.bounds.maxEffortMs) {
      return {
        ok: false,
        error: validationError([
          {
            field: "effortMs",
            problem: `assignment exceeds capacity bounds: declared maxEffortMs ${covering.bounds.maxEffortMs}, would total ${totalEffort}`,
          },
        ]),
      };
    }
    const record: WorkAssignmentRecord = {
      scope,
      assignmentId,
      personId,
      ...(input.roleId ? { roleId: input.roleId.trim() as WorkforceRoleId } : {}),
      ...(input.processRef ? { processRef: input.processRef } : {}),
      effortMs: input.effortMs,
      period,
      status: "active",
      provenance: input.provenance,
      createdAt: input.now,
    };
    const stored = assignments.put(scope, assignmentId, record);
    audit.append(
      scope,
      { kind: "workforce", id: assignmentId },
      "workforce.assignment-recorded",
      { actor: input.provenance.actor, at: input.now, reason: "human work allocation recorded" },
      Object.freeze({
        personId,
        effortMs: record.effortMs,
        ...(input.roleId ? { roleId: input.roleId } : {}),
      }),
    );
    return ok(stored);
  }

  function endAssignment(
    scope: TenantScope,
    input: EndAssignmentInput,
  ): Result<WorkAssignmentRecord> {
    const v = createValidator();
    v.requireIdFormat("assignmentId", input?.assignmentId ?? "");
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };
    const record = assignments.get(scope, input.assignmentId);
    if (!record) return { ok: false, error: notFound("work assignment") };
    if (record.status === "ended") {
      return { ok: false, error: conflictError("work assignment already ended") };
    }
    const updated: WorkAssignmentRecord = {
      ...record,
      status: "ended",
      endedAt: input.now,
      endedBy: input.endedBy,
    };
    const stored = assignments.put(scope, record.assignmentId, updated);
    audit.append(
      scope,
      { kind: "workforce", id: record.assignmentId },
      "workforce.assignment-ended",
      input.audit,
      Object.freeze({ assignmentId: record.assignmentId }),
    );
    return ok(stored);
  }

  return {
    registerRole,
    listRoles: (scope: TenantScope) => roles.list(scope),
    declareCapacity,
    getCapacity: (scope: TenantScope, personId: string, at: DomainTimestamp) => {
      const record = coveringCapacity(scope, personId.trim(), { start: at, end: at });
      return record ? ok(record) : { ok: false, error: notFound("capacity declaration") };
    },
    recordAssignment,
    endAssignment,
    listAssignments: (scope: TenantScope, filter?: AssignmentFilter) => {
      const all = assignments.list(scope);
      if (!filter?.personId && !filter?.status) return all;
      return Object.freeze(
        all.filter(
          (record) =>
            (filter?.personId === undefined || record.personId === filter.personId) &&
            (filter?.status === undefined || record.status === filter.status),
        ),
      );
    },
    workloadOf: (scope: TenantScope, personId: string, period: TimeWindow) => {
      const covering = coveringCapacity(scope, personId.trim(), period);
      const summary = summarizeWorkload(
        personId.trim() as PersonId,
        period,
        covering?.bounds,
        assignments.list(scope),
      );
      return ok(summary);
    },
  };
}
