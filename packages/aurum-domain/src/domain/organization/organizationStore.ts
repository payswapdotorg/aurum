/**
 * In-memory organization directory. Unit registration validates in-tenant
 * parent existence (foreign-tenant parent: uniform not-found) and rejects
 * cycles in the unit forest.
 */
import { conflictError, notFound, validationError } from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type { OrganizationId, SiteId, UnitId } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import { auditInputIssues, type AuditInput } from "../audit/records.js";
import type { AuditSink } from "../audit/ports.js";
import {
  wouldCreateUnitCycle,
  type OrganizationRecord,
  type OrganizationSnapshot,
  type SiteRecord,
  type UnitRecord,
} from "./records.js";
import type {
  OrganizationDirectory,
  RegisterOrganizationInput,
  RegisterSiteInput,
  RegisterUnitInput,
} from "./ports.js";

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

function addAuditIssues(
  validator: ReturnType<typeof createValidator>,
  input: AuditInput | undefined,
): void {
  for (const issue of auditInputIssues(input ?? ({} as AuditInput))) {
    validator.add(issue.field, issue.problem);
  }
}

export function createOrganizationDirectory(audit: AuditSink): OrganizationDirectory {
  const organizations = new TenantIndex<OrganizationRecord>();
  const sites = new TenantIndex<SiteRecord>();
  const units = new TenantIndex<UnitRecord>();

  function registerOrganization(
    scope: TenantScope,
    input: RegisterOrganizationInput,
  ): Result<OrganizationRecord> {
    const v = createValidator();
    const organizationId = v.requireIdFormat(
      "organizationId",
      input?.organizationId ?? "",
    ) as OrganizationId;
    const name = v.requireText("name", input?.name ?? "");
    requireActor(v, "provenance", input?.provenance);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    addAuditIssues(v, input?.audit);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (organizations.has(scope, organizationId)) {
      return { ok: false, error: conflictError("organization already registered in tenant") };
    }
    const record: OrganizationRecord = {
      scope,
      organizationId,
      name,
      provenance: input.provenance,
      registeredAt: input.now,
    };
    const stored = organizations.put(scope, organizationId, record);
    audit.append(
      scope,
      { kind: "organization", id: organizationId },
      "organization.registered",
      input.audit,
    );
    return ok(stored);
  }

  function registerSite(scope: TenantScope, input: RegisterSiteInput): Result<SiteRecord> {
    const v = createValidator();
    const siteId = v.requireIdFormat("siteId", input?.siteId ?? "") as SiteId;
    const organizationId = v.requireIdFormat("organizationId", input?.organizationId ?? "");
    const name = v.requireText("name", input?.name ?? "");
    requireActor(v, "provenance", input?.provenance);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    addAuditIssues(v, input?.audit);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (sites.has(scope, siteId)) {
      return { ok: false, error: conflictError("site already registered in tenant") };
    }
    if (!organizations.has(scope, organizationId)) {
      return { ok: false, error: notFound("organization") };
    }
    const record: SiteRecord = {
      scope,
      siteId,
      organizationId: organizationId as OrganizationId,
      name,
      provenance: input.provenance,
      registeredAt: input.now,
    };
    const stored = sites.put(scope, siteId, record);
    audit.append(
      scope,
      { kind: "site", id: siteId },
      "site.registered",
      input.audit,
      Object.freeze({ organizationId }),
    );
    return ok(stored);
  }

  function registerUnit(scope: TenantScope, input: RegisterUnitInput): Result<UnitRecord> {
    const v = createValidator();
    const unitId = v.requireIdFormat("unitId", input?.unitId ?? "") as UnitId;
    const organizationId = v.requireIdFormat("organizationId", input?.organizationId ?? "");
    const parentUnitId =
      input?.parentUnitId !== undefined && String(input.parentUnitId).trim().length > 0
        ? v.requireIdFormat("parentUnitId", input.parentUnitId)
        : undefined;
    const name = v.requireText("name", input?.name ?? "");
    requireActor(v, "provenance", input?.provenance);
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    addAuditIssues(v, input?.audit);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (units.has(scope, unitId)) {
      return { ok: false, error: conflictError("unit already registered in tenant") };
    }
    if (!organizations.has(scope, organizationId)) {
      return { ok: false, error: notFound("organization") };
    }
    // Self-parenting is definitionally a cycle, checked before existence so
    // it reports as a cycle rather than a missing parent.
    if (parentUnitId !== undefined && parentUnitId === unitId) {
      return { ok: false, error: conflictError("unit parent would create a cycle") };
    }
    if (parentUnitId !== undefined && !units.has(scope, parentUnitId)) {
      return { ok: false, error: notFound("parent unit") };
    }
    if (
      parentUnitId !== undefined &&
      wouldCreateUnitCycle(unitId, parentUnitId as UnitId, units.list(scope))
    ) {
      return { ok: false, error: conflictError("unit parent would create a cycle") };
    }
    const record: UnitRecord = {
      scope,
      unitId,
      organizationId: organizationId as OrganizationId,
      ...(parentUnitId !== undefined ? { parentUnitId: parentUnitId as UnitId } : {}),
      name,
      provenance: input.provenance,
      registeredAt: input.now,
    };
    const stored = units.put(scope, unitId, record);
    audit.append(
      scope,
      { kind: "unit", id: unitId },
      "unit.registered",
      input.audit,
      Object.freeze({ organizationId, ...(parentUnitId ? { parentUnitId } : {}) }),
    );
    return ok(stored);
  }

  function describeOrganization(
    scope: TenantScope,
    organizationId: string,
  ): Result<OrganizationSnapshot> {
    const organization = organizations.get(scope, organizationId);
    if (!organization) return { ok: false, error: notFound("organization") };
    return ok(
      Object.freeze({
        organization,
        sites: Object.freeze(
          sites.list(scope).filter((site) => site.organizationId === organization.organizationId),
        ),
        units: Object.freeze(
          units.list(scope).filter((unit) => unit.organizationId === organization.organizationId),
        ),
      }),
    );
  }

  return {
    registerOrganization,
    getOrganization: (scope: TenantScope, organizationId: string) => {
      const record = organizations.get(scope, organizationId);
      return record ? ok(record) : { ok: false, error: notFound("organization") };
    },
    registerSite,
    getSite: (scope: TenantScope, siteId: string) => {
      const record = sites.get(scope, siteId);
      return record ? ok(record) : { ok: false, error: notFound("site") };
    },
    registerUnit,
    getUnit: (scope: TenantScope, unitId: string) => {
      const record = units.get(scope, unitId);
      return record ? ok(record) : { ok: false, error: notFound("unit") };
    },
    describeOrganization,
  };
}
