/**
 * In-memory identity directory implementation. All lookups are tenant-scoped
 * through the shared TenantIndex; person ids are unique per tenant (the same
 * id may exist independently in two tenants).
 */
import { conflictError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import type { MembershipId, PersonId } from "../core/branding.js";
import { auditInputIssues, type AuditInput } from "../audit/records.js";
import type { AuditSink } from "../audit/ports.js";
import {
  activeRolesFor,
  isKnownIdentityLabel,
  isKnownRole,
  type IdentityLabel,
  type MembershipRecord,
  type PersonRecord,
  type RoleName,
} from "./records.js";
import type {
  EndMembershipInput,
  GrantMembershipInput,
  IdentityDirectory,
  RegisterPersonInput,
} from "./ports.js";

function addAuditIssues(
  validator: ReturnType<typeof createValidator>,
  input: AuditInput | undefined,
): void {
  for (const issue of auditInputIssues(input ?? ({} as AuditInput))) {
    validator.add(issue.field, issue.problem);
  }
}

function requireActor(
  validator: ReturnType<typeof createValidator>,
  field: string,
  actor: unknown,
): void {
  const reference = actor as { kind?: unknown; personId?: unknown } | null | undefined;
  if (!reference || typeof reference.kind !== "string") {
    validator.add(field, "is required");
  } else if (reference.kind === "person" && !reference.personId) {
    validator.add(`${field}.personId`, "is required for person actors");
  }
}

export function createIdentityDirectory(audit: AuditSink): IdentityDirectory {
  const people = new TenantIndex<PersonRecord>();
  const memberships = new TenantIndex<MembershipRecord>();

  function registerPerson(scope: TenantScope, input: RegisterPersonInput): Result<PersonRecord> {
    const v = createValidator();
    const personId = v.requireIdFormat("personId", input?.personId ?? "") as PersonId;
    const displayName = v.requireText("displayName", input?.displayName ?? "");
    if (input?.externalRef !== undefined) v.requireIdFormat("externalRef", input.externalRef);
    const rawLabels = Array.isArray(input?.labels) ? input.labels : [];
    if (rawLabels.length === 0) {
      v.add("labels", "must be a non-empty array");
    }
    const labels: IdentityLabel[] = [];
    const seen = new Set<string>();
    for (const label of rawLabels) {
      if (typeof label === "string" && isKnownIdentityLabel(label) && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
      } else {
        v.add("labels", `unknown label: ${String(label)}`);
      }
    }
    requireActor(v, "provenance", input?.provenance);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (people.has(scope, personId)) {
      return { ok: false, error: conflictError("person already registered in tenant") };
    }
    const record: PersonRecord = {
      scope,
      personId,
      displayName,
      labels: Object.freeze(labels),
      ...(input.externalRef !== undefined && input.externalRef.trim().length > 0
        ? { externalRef: input.externalRef.trim() }
        : {}),
      provenance: input.provenance,
      registeredAt: input.now,
    };
    return ok(people.put(scope, personId, record));
  }

  function grantMembership(
    scope: TenantScope,
    input: GrantMembershipInput,
  ): Result<MembershipRecord> {
    const v = createValidator();
    const membershipId = v.requireIdFormat(
      "membershipId",
      input?.membershipId ?? "",
    ) as MembershipId;
    const personId = v.requireIdFormat("personId", input?.personId ?? "") as PersonId;
    const organizationId = v.requireIdFormat("organizationId", input?.organizationId ?? "");
    if (input?.unitId !== undefined) v.requireIdFormat("unitId", input.unitId);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    const rawRoles = Array.isArray(input?.roles) ? input.roles : [];
    if (rawRoles.length === 0) {
      v.add("roles", "must be a non-empty array");
    }
    const roles: RoleName[] = [];
    const seenRoles = new Set<string>();
    for (const role of rawRoles) {
      if (typeof role === "string" && isKnownRole(role) && !seenRoles.has(role)) {
        seenRoles.add(role);
        roles.push(role);
      } else {
        v.add("roles", `unknown role: ${String(role)}`);
      }
    }
    requireActor(v, "grantedBy", input?.grantedBy);
    addAuditIssues(v, input?.audit);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (memberships.has(scope, membershipId)) {
      return { ok: false, error: conflictError("membership already registered in tenant") };
    }
    if (!people.has(scope, personId)) return { ok: false, error: notFound("person") };

    const record: MembershipRecord = {
      scope,
      membershipId,
      personId,
      organizationId,
      ...(input.unitId !== undefined && input.unitId.trim().length > 0
        ? { unitId: input.unitId.trim() }
        : {}),
      roles: Object.freeze(roles),
      status: "active",
      grantedAt: input.now,
      grantedBy: input.grantedBy,
    };
    const stored = memberships.put(scope, membershipId, record);
    audit.append(
      scope,
      { kind: "person", id: personId },
      "membership.granted",
      input.audit,
      Object.freeze({ membershipId, roles: Object.freeze([...roles]) }),
    );
    return ok(stored);
  }

  function endMembership(scope: TenantScope, input: EndMembershipInput): Result<MembershipRecord> {
    const v = createValidator();
    const membershipId = v.requireIdFormat(
      "membershipId",
      input?.membershipId ?? "",
    ) as MembershipId;
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    requireActor(v, "endedBy", input?.endedBy);
    addAuditIssues(v, input?.audit);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    const record = memberships.get(scope, membershipId);
    if (!record) return { ok: false, error: notFound("membership") };
    if (record.status === "ended") {
      return { ok: false, error: conflictError("membership already ended") };
    }
    const ended: MembershipRecord = {
      ...record,
      status: "ended",
      endedAt: input.now,
      endedBy: input.endedBy,
    };
    const stored = memberships.put(scope, membershipId, ended);
    audit.append(
      scope,
      { kind: "person", id: record.personId },
      "membership.ended",
      input.audit,
      Object.freeze({ membershipId }),
    );
    return ok(stored);
  }

  return {
    registerPerson,
    getPerson: (scope: TenantScope, personId: string) => {
      const record = people.get(scope, personId);
      return record ? ok(record) : { ok: false, error: notFound("person") };
    },
    listPeople: (scope: TenantScope) => people.list(scope),
    grantMembership,
    endMembership,
    listMemberships: (scope: TenantScope) => memberships.list(scope),
    rolesOf: (scope: TenantScope, personId: string, at: DomainTimestamp) =>
      activeRolesFor(personId as PersonId, memberships.list(scope), at),
  };
}
