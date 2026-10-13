/**
 * Shared workforce adapter pieces (P001, workforce area): the pure mirrors of
 * the domain-internal validation helpers (period covering, typed subjects,
 * evidence refs, freshness resolution — the domain keeps them internal, so
 * they are mirrored verbatim exactly like the evidence area mirrors
 * resolveFreshness) plus the registerRole / declareCapacity command bodies,
 * kept here so workforce-store.ts stays under the 400-line architecture
 * budget.
 */
import {
  conflictError,
  createValidator,
  isKnownSubjectKind,
  ok,
  provenanceIssues,
  validationError,
} from "@aurum/domain";
import type {
  CapacityDeclarationRecord,
  DomainTimestamp,
  FreshnessStamp,
  Result,
  TenantScope,
  WorkforceRoleRecord,
  WorkforceStorage,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db } from "../pg/db.js";

export type Validator = ReturnType<typeof createValidator>;

export interface TimeWindowLike {
  readonly start?: number;
  readonly end?: number;
}

/** Mirrors the domain-internal validatePeriod (workforce/shared.ts). */
export function mirrorValidatePeriod(
  v: Validator,
  field: string,
  period: TimeWindowLike | undefined,
): void {
  v.requireNonNegativeNumber(`${field}.start`, period?.start ?? Number.NaN);
  v.requireNonNegativeNumber(`${field}.end`, period?.end ?? Number.NaN);
  if (
    typeof period?.start === "number" &&
    typeof period?.end === "number" &&
    Number.isFinite(period.start) &&
    Number.isFinite(period.end) &&
    period.start > period.end
  ) {
    v.add(field, "start must not be after end");
  }
}

/** Mirrors the domain-internal coversPeriod (workforce/shared.ts). */
export function mirrorCoversPeriod(outer: TimeWindowLike, inner: TimeWindowLike): boolean {
  if (outer.start === undefined || outer.end === undefined) return false;
  if (inner.start === undefined || inner.end === undefined) return false;
  return outer.start <= inner.start && outer.end >= inner.end;
}

/** Mirrors the domain-internal validateSubject (workforce/shared.ts). */
export function mirrorValidateSubject(
  v: Validator,
  subject: { kind?: unknown; id?: unknown } | undefined,
  field: string,
): void {
  if (
    !subject ||
    typeof subject.kind !== "string" ||
    !isKnownSubjectKind(subject.kind) ||
    typeof subject.id !== "string" ||
    subject.id.trim().length === 0
  ) {
    v.add(field, "must be a typed subject reference");
  }
}

/** Mirrors the domain-internal validateEvidenceRefs (workforce/shared.ts). */
export function mirrorValidateEvidenceRefs(
  v: Validator,
  refs: readonly { kind?: unknown; id?: unknown }[] | undefined,
  field: string,
): void {
  (Array.isArray(refs) ? refs : []).forEach((ref, index) => {
    mirrorValidateSubject(v, ref, `${field}.${index}`);
  });
}

/** Mirrors the domain-internal resolveFreshness (verbatim stamps win). */
export function mirrorResolveFreshness(
  stamp: FreshnessStamp | undefined,
  fallbackAsOf: number,
): FreshnessStamp {
  if (stamp !== undefined && (stamp.asOf !== undefined || stamp.validUntil !== undefined)) {
    return stamp;
  }
  return { asOf: fallbackAsOf as DomainTimestamp };
}

/** The registerRole command body (validation, conflict, insert, journal, audit). */
export async function registerRoleCommand(
  sql: Db,
  scope: TenantScope,
  input: Parameters<WorkforceStorage["registerRole"]>[1],
): Promise<Result<WorkforceRoleRecord>> {
  const v = createValidator();
  const roleId = v.requireIdFormat("roleId", input?.roleId ?? "") as WorkforceRoleRecord["roleId"];
  v.requireText("title", input?.title ?? "", { max: 300 });
  if (input?.description !== undefined) v.requireText("description", input.description);
  const required = Array.isArray(input?.requiredCapabilities) ? input.requiredCapabilities : [];
  for (const [index, capability] of required.entries()) {
    v.requireIdFormat(`requiredCapabilities.${index}`, String(capability ?? ""));
  }
  for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
  v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
  if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

  const record: WorkforceRoleRecord = {
    scope,
    roleId,
    title: input.title.trim(),
    ...(input.description ? { description: input.description.trim() } : {}),
    requiredCapabilities: Object.freeze(
      required.map(
        (capability) =>
          String(capability).trim() as WorkforceRoleRecord["requiredCapabilities"][number],
      ),
    ),
    provenance: input.provenance,
    createdAt: input.now,
  };
  try {
    return await sql.begin(async (tx) => {
      const existing = await tx`
        select 1 from domain_workforce_roles
        where tenant_id = ${scope.tenantId} and role_id = ${roleId}
      `;
      if (existing.length > 0) {
        return { ok: false, error: conflictError("workforce role already registered in tenant") };
      }
      await tx`
        insert into domain_workforce_roles (tenant_id, role_id, record)
        values (${scope.tenantId}, ${roleId}, ${jsonbParam(tx, record)})
      `;
      await recordWrite(tx, {
        tenantId: scope.tenantId,
        journalKey: `workforce:register-role:${roleId}`,
        area: "workforce",
        operation: "register-role",
        recordId: roleId,
      });
      await appendAuditEntry(
        tx,
        scope,
        { kind: "workforce", id: roleId },
        "workforce.role-registered",
        { actor: input.provenance.actor, at: input.now, reason: "workforce role registered" },
        Object.freeze({ title: record.title }),
      );
      return ok(record);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: conflictError("workforce role already registered in tenant") };
    }
    throw error;
  }
}

/** The declareCapacity command body (validation, conflict, insert, journal, audit). */
export async function declareCapacityCommand(
  sql: Db,
  scope: TenantScope,
  input: Parameters<WorkforceStorage["declareCapacity"]>[1],
): Promise<Result<CapacityDeclarationRecord>> {
  const v = createValidator();
  const capacityId = v.requireIdFormat(
    "capacityId",
    input?.capacityId ?? "",
  ) as CapacityDeclarationRecord["capacityId"];
  v.requireIdFormat("personId", input?.personId ?? "");
  mirrorValidatePeriod(v, "bounds.period", input?.bounds?.period);
  v.requireNonNegativeNumber("bounds.maxEffortMs", input?.bounds?.maxEffortMs ?? Number.NaN);
  if ((input?.bounds?.maxEffortMs ?? 0) <= 0) {
    v.add("bounds.maxEffortMs", "must be greater than 0");
  }
  v.requireMinInt(
    "bounds.maxConcurrentAssignments",
    input?.bounds?.maxConcurrentAssignments ?? Number.NaN,
    1,
  );
  for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
  v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
  if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

  const record: CapacityDeclarationRecord = {
    scope,
    capacityId,
    personId: input.personId.trim() as CapacityDeclarationRecord["personId"],
    bounds: {
      period: input.bounds.period,
      maxEffortMs: input.bounds.maxEffortMs,
      maxConcurrentAssignments: input.bounds.maxConcurrentAssignments,
    },
    provenance: input.provenance,
    createdAt: input.now,
  };
  try {
    return await sql.begin(async (tx) => {
      const existing = await tx`
        select 1 from domain_workforce_capacities
        where tenant_id = ${scope.tenantId} and capacity_id = ${capacityId}
      `;
      if (existing.length > 0) {
        return {
          ok: false,
          error: conflictError("capacity declaration already registered in tenant"),
        };
      }
      await tx`
        insert into domain_workforce_capacities
          (tenant_id, capacity_id, person_id, created_at, record)
        values
          (${scope.tenantId}, ${capacityId}, ${record.personId}, ${input.now},
           ${jsonbParam(tx, record)})
      `;
      await recordWrite(tx, {
        tenantId: scope.tenantId,
        journalKey: `workforce:declare-capacity:${capacityId}`,
        area: "workforce",
        operation: "declare-capacity",
        recordId: capacityId,
      });
      await appendAuditEntry(
        tx,
        scope,
        { kind: "workforce", id: capacityId },
        "workforce.capacity-declared",
        { actor: input.provenance.actor, at: input.now, reason: "human capacity bounds declared" },
        Object.freeze({
          personId: record.personId,
          maxEffortMs: record.bounds.maxEffortMs,
          maxConcurrentAssignments: record.bounds.maxConcurrentAssignments,
        }),
      );
      return ok(record);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        error: conflictError("capacity declaration already registered in tenant"),
      };
    }
    throw error;
  }
}
