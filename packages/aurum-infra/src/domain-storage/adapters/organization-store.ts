/**
 * PostgreSQL organization directory (P001, organization area): companies,
 * sites and the unit forest, with semantics identical to the in-memory
 * reference — same validation issues, same conflict/not-found discipline
 * (conflict before existence; self-parenting reported as a cycle; foreign or
 * missing parents uniformly not-found), same cycle rejection through the
 * domain-exported pure `wouldCreateUnitCycle`, and the same audit
 * side-effects (organization.registered / site.registered /
 * unit.registered).
 *
 * Storage ruling: one immutable row per record kind, keyed
 * (tenant_id, <kind>_id); unit parents are strong columns so the forest walk
 * is queryable, while the full record is retained verbatim in `record`
 * (jsonb) so round-trips are byte-faithful.
 */
import {
  auditInputIssues,
  conflictError,
  createValidator,
  deepFreeze,
  err,
  notFound,
  ok,
  validationError,
  wouldCreateUnitCycle,
} from "@aurum/domain";
import type {
  AuditInput,
  OrganizationId,
  OrganizationRecord,
  OrganizationSnapshot,
  OrganizationStorage,
  RegisterOrganizationInput,
  RegisterSiteInput,
  RegisterUnitInput,
  SiteId,
  SiteRecord,
  TenantScope,
  UnitId,
  UnitRecord,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** Mirrors the in-memory actor validation (required, person needs personId). */
function requireActor(v: ReturnType<typeof createValidator>, field: string, actor: unknown): void {
  const reference = actor as { kind?: unknown; personId?: unknown } | null | undefined;
  if (!reference || typeof reference.kind !== "string") {
    v.add(field, "is required");
  } else if (reference.kind === "person" && !reference.personId) {
    v.add(`${field}.personId`, "is required for person actors");
  }
}

/** Mirrors the in-memory audit-input validation (absent input still issues). */
function addAuditIssues(
  v: ReturnType<typeof createValidator>,
  input: AuditInput | undefined,
): void {
  for (const issue of auditInputIssues(input ?? ({} as AuditInput))) {
    v.add(issue.field, issue.problem);
  }
}

/** Loads all units of one tenant (ordered) for the cycle walk and snapshot. */
async function loadUnits(sql: Tx | Db, scope: TenantScope): Promise<readonly UnitRecord[]> {
  const rows: readonly { record: UnitRecord }[] = await sql`
    select record from domain_units where tenant_id = ${scope.tenantId} order by seq
  `;
  return Object.freeze(rows.map((row) => deepFreeze(row.record)));
}

/** Creates the PostgreSQL organization directory bound to a database handle. */
export function createPgOrganizationDirectory(sql: Db): OrganizationStorage {
  return {
    registerOrganization: async (scope, input: RegisterOrganizationInput) => {
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

      const record: OrganizationRecord = {
        scope,
        organizationId,
        name,
        provenance: input.provenance,
        registeredAt: input.now,
      };
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_organizations
            where tenant_id = ${scope.tenantId} and organization_id = ${organizationId}
          `;
          if (existing.length > 0) {
            return err(conflictError("organization already registered in tenant"));
          }
          await tx`
            insert into domain_organizations (tenant_id, organization_id, record)
            values (${scope.tenantId}, ${organizationId}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `organization:register-organization:${organizationId}`,
            area: "organization",
            operation: "register-organization",
            recordId: organizationId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "organization", id: organizationId },
            "organization.registered",
            input.audit,
          );
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return err(conflictError("organization already registered in tenant"));
        }
        throw error;
      }
    },
    getOrganization: async (scope, organizationId) => {
      const rows: readonly { record: OrganizationRecord }[] = await sql`
        select record from domain_organizations
        where tenant_id = ${scope.tenantId} and organization_id = ${organizationId}
      `;
      if (rows.length === 0) return err(notFound("organization"));
      const row = rows[0];
      if (!row) throw new Error("organization row missing after length check");
      return ok(deepFreeze(row.record));
    },
    registerSite: async (scope, input: RegisterSiteInput) => {
      const v = createValidator();
      const siteId = v.requireIdFormat("siteId", input?.siteId ?? "") as SiteId;
      const organizationId = v.requireIdFormat("organizationId", input?.organizationId ?? "");
      const name = v.requireText("name", input?.name ?? "");
      requireActor(v, "provenance", input?.provenance);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      addAuditIssues(v, input?.audit);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const record: SiteRecord = {
        scope,
        siteId,
        organizationId: organizationId as OrganizationId,
        name,
        provenance: input.provenance,
        registeredAt: input.now,
      };
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_sites
            where tenant_id = ${scope.tenantId} and site_id = ${siteId}
          `;
          if (existing.length > 0) {
            return err(conflictError("site already registered in tenant"));
          }
          const organization = await tx`
            select 1 from domain_organizations
            where tenant_id = ${scope.tenantId} and organization_id = ${organizationId}
          `;
          if (organization.length === 0) return err(notFound("organization"));
          await tx`
            insert into domain_sites (tenant_id, site_id, organization_id, record)
            values (${scope.tenantId}, ${siteId}, ${organizationId}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `organization:register-site:${siteId}`,
            area: "organization",
            operation: "register-site",
            recordId: siteId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "site", id: siteId },
            "site.registered",
            input.audit,
            Object.freeze({ organizationId }),
          );
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return err(conflictError("site already registered in tenant"));
        }
        throw error;
      }
    },
    getSite: async (scope, siteId) => {
      const rows: readonly { record: SiteRecord }[] = await sql`
        select record from domain_sites
        where tenant_id = ${scope.tenantId} and site_id = ${siteId}
      `;
      if (rows.length === 0) return err(notFound("site"));
      const row = rows[0];
      if (!row) throw new Error("site row missing after length check");
      return ok(deepFreeze(row.record));
    },
    registerUnit: async (scope, input: RegisterUnitInput) => {
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

      const record: UnitRecord = {
        scope,
        unitId,
        organizationId: organizationId as OrganizationId,
        ...(parentUnitId !== undefined ? { parentUnitId: parentUnitId as UnitId } : {}),
        name,
        provenance: input.provenance,
        registeredAt: input.now,
      };
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_units
            where tenant_id = ${scope.tenantId} and unit_id = ${unitId}
          `;
          if (existing.length > 0) {
            return err(conflictError("unit already registered in tenant"));
          }
          const organization = await tx`
            select 1 from domain_organizations
            where tenant_id = ${scope.tenantId} and organization_id = ${organizationId}
          `;
          if (organization.length === 0) return err(notFound("organization"));
          // Self-parenting is definitionally a cycle, checked before existence
          // so it reports as a cycle rather than a missing parent.
          if (parentUnitId !== undefined && parentUnitId === unitId) {
            return err(conflictError("unit parent would create a cycle"));
          }
          if (parentUnitId !== undefined) {
            const parent = await tx`
              select 1 from domain_units
              where tenant_id = ${scope.tenantId} and unit_id = ${parentUnitId}
            `;
            if (parent.length === 0) return err(notFound("parent unit"));
            if (wouldCreateUnitCycle(unitId, parentUnitId as UnitId, await loadUnits(tx, scope))) {
              return err(conflictError("unit parent would create a cycle"));
            }
          }
          await tx`
            insert into domain_units
              (tenant_id, unit_id, organization_id, parent_unit_id, record)
            values
              (${scope.tenantId}, ${unitId}, ${organizationId}, ${parentUnitId ?? null},
               ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `organization:register-unit:${unitId}`,
            area: "organization",
            operation: "register-unit",
            recordId: unitId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "unit", id: unitId },
            "unit.registered",
            input.audit,
            Object.freeze({ organizationId, ...(parentUnitId ? { parentUnitId } : {}) }),
          );
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return err(conflictError("unit already registered in tenant"));
        }
        throw error;
      }
    },
    getUnit: async (scope, unitId) => {
      const rows: readonly { record: UnitRecord }[] = await sql`
        select record from domain_units
        where tenant_id = ${scope.tenantId} and unit_id = ${unitId}
      `;
      if (rows.length === 0) return err(notFound("unit"));
      const row = rows[0];
      if (!row) throw new Error("unit row missing after length check");
      return ok(deepFreeze(row.record));
    },
    describeOrganization: async (scope, organizationId) => {
      const organizationRows: readonly { record: OrganizationRecord }[] = await sql`
        select record from domain_organizations
        where tenant_id = ${scope.tenantId} and organization_id = ${organizationId}
      `;
      const organizationRow = organizationRows[0];
      if (!organizationRow) return err(notFound("organization"));
      const organization = deepFreeze(organizationRow.record);
      const siteRows: readonly { record: SiteRecord }[] = await sql`
        select record from domain_sites
        where tenant_id = ${scope.tenantId} and organization_id = ${organizationId}
        order by seq
      `;
      const unitRecords = await loadUnits(sql, scope);
      return ok(
        Object.freeze({
          organization,
          sites: Object.freeze(siteRows.map((row) => deepFreeze(row.record))),
          units: Object.freeze(
            unitRecords.filter((unit) => unit.organizationId === organization.organizationId),
          ),
        }) as OrganizationSnapshot,
      );
    },
  };
}
