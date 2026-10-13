/**
 * Shared mirrors, row loaders and command bodies for the P001 capability
 * area adapter. The loaders take a pool or transaction handle; the two
 * registration commands open their own transaction exactly like the store
 * methods they back — keeping every file under the architecture line budget
 * without duplicating the domain-internal semantics they mirror.
 */
import {
  PROFICIENCY_MAX,
  PROFICIENCY_MIN,
  conflictError,
  createValidator,
  deepFreeze,
  isKnownGoalPriority,
  isKnownRequirementSource,
  notFound,
  ok,
  provenanceIssues,
  supplierIssues,
  validationError,
} from "@aurum/domain";
import type {
  CapabilityRecord,
  CapabilityRequirementId,
  CapabilityRequirementRecord,
  CapabilitySupplyId,
  CapabilitySupplyRecord,
  DomainTimestamp,
  FreshnessStamp,
  RegisterRequirementInput,
  RegisterSupplyInput,
  Result,
  SupplierReference,
  TenantScope,
  Validator,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** Mirrors the domain-internal level validation (1..5 proficiency scale). */
export function validateLevel(v: Validator, field: string, value: number): void {
  v.requireMinInt(field, value, PROFICIENCY_MIN);
  if (Number.isInteger(value) && value > PROFICIENCY_MAX) {
    v.add(field, `must be at most ${PROFICIENCY_MAX}`);
  }
}

/** Mirrors the domain-internal resolveFreshness (verbatim stamps win). */
export function resolveFreshness(
  stamp: FreshnessStamp | undefined,
  fallbackAsOf: number,
): FreshnessStamp {
  if (stamp !== undefined && (stamp.asOf !== undefined || stamp.validUntil !== undefined)) {
    return stamp;
  }
  return { asOf: fallbackAsOf as DomainTimestamp };
}

/** Loads one capability row or null when absent in the tenant. */
export async function loadCapability(
  sql: Tx | Db,
  scope: TenantScope,
  capabilityId: string,
): Promise<CapabilityRecord | null> {
  const rows: readonly { record: CapabilityRecord }[] = await sql`
    select record from domain_capabilities
    where tenant_id = ${scope.tenantId} and capability_id = ${capabilityId}
  `;
  const row = rows[0];
  return row ? deepFreeze(row.record) : null;
}

/** Loads every supply of the tenant in insertion order. */
export async function loadSupplies(
  sql: Tx | Db,
  scope: TenantScope,
): Promise<readonly CapabilitySupplyRecord[]> {
  const rows: readonly { record: CapabilitySupplyRecord }[] = await sql`
    select record from domain_capability_supplies
    where tenant_id = ${scope.tenantId}
    order by seq
  `;
  return Object.freeze(rows.map((row) => deepFreeze(row.record)));
}

/** Loads every requirement of the tenant in insertion order. */
export async function loadRequirements(
  sql: Tx | Db,
  scope: TenantScope,
): Promise<readonly CapabilityRequirementRecord[]> {
  const rows: readonly { record: CapabilityRequirementRecord }[] = await sql`
    select record from domain_capability_requirements
    where tenant_id = ${scope.tenantId}
    order by seq
  `;
  return Object.freeze(rows.map((row) => deepFreeze(row.record)));
}

/** The registerSupply command body (validation + transaction). */
export async function registerSupplyCommand(
  sql: Db,
  scope: TenantScope,
  input: RegisterSupplyInput,
): Promise<Result<CapabilitySupplyRecord>> {
  const v = createValidator();
  const supplyId = v.requireIdFormat("supplyId", input?.supplyId ?? "") as CapabilitySupplyId;
  v.requireIdFormat("capabilityId", input?.capabilityId ?? "");
  for (const issue of supplierIssues(input?.supplier)) v.add(issue.field, issue.problem);
  validateLevel(v, "level", input?.level ?? Number.NaN);
  if (input?.capacityPerPeriod !== undefined) {
    v.requireNonNegativeNumber("capacityPerPeriod", input.capacityPerPeriod);
  }
  if (input?.availableFrom !== undefined) {
    v.requireNonNegativeNumber("availableFrom", input.availableFrom);
  }
  if (input?.availableUntil !== undefined) {
    v.requireNonNegativeNumber("availableUntil", input.availableUntil);
  }
  for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
  v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
  if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

  try {
    return await sql.begin(async (tx) => {
      const capability = await loadCapability(tx, scope, input.capabilityId ?? "");
      if (!capability) return { ok: false, error: notFound("capability") };
      const existing = await tx`
        select 1 from domain_capability_supplies
        where tenant_id = ${scope.tenantId} and supply_id = ${supplyId}
      `;
      if (existing.length > 0) {
        return { ok: false, error: conflictError("capability supply already registered in tenant") };
      }
      const record: CapabilitySupplyRecord = {
        scope,
        supplyId,
        capabilityId: capability.capabilityId,
        supplier: input.supplier as SupplierReference,
        level: input.level,
        ...(input.capacityPerPeriod !== undefined
          ? { capacityPerPeriod: input.capacityPerPeriod }
          : {}),
        ...(input.availableFrom !== undefined ? { availableFrom: input.availableFrom } : {}),
        ...(input.availableUntil !== undefined ? { availableUntil: input.availableUntil } : {}),
        provenance: input.provenance,
        freshness: resolveFreshness(input.freshness, input.now),
        createdAt: input.now,
      };
      await tx`
        insert into domain_capability_supplies (tenant_id, supply_id, capability_id, record)
        values (${scope.tenantId}, ${supplyId}, ${record.capabilityId}, ${jsonbParam(tx, record)})
      `;
      await recordWrite(tx, {
        tenantId: scope.tenantId,
        journalKey: `capability:register-supply:${supplyId}`,
        area: "capability",
        operation: "register-supply",
        recordId: supplyId,
      });
      await appendAuditEntry(
        tx,
        scope,
        { kind: "capability", id: capability.capabilityId },
        "capability.supply-registered",
        { actor: input.provenance.actor, at: input.now, reason: "capability supply registered" },
        Object.freeze({ supplyId, supplierKind: record.supplier.kind, level: record.level }),
      );
      return ok(record);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: conflictError("capability supply already registered in tenant") };
    }
    throw error;
  }
}

/** The registerRequirement command body (validation + transaction). */
export async function registerRequirementCommand(
  sql: Db,
  scope: TenantScope,
  input: RegisterRequirementInput,
): Promise<Result<CapabilityRequirementRecord>> {
  const v = createValidator();
  const requirementId = v.requireIdFormat(
    "requirementId",
    input?.requirementId ?? "",
  ) as CapabilityRequirementId;
  v.requireIdFormat("capabilityId", input?.capabilityId ?? "");
  const sourceKind = v.requireVocabulary("source.kind", String(input?.source?.kind ?? ""), [
    "goal",
    "process",
    "project",
    "opportunity",
    "manual",
  ]);
  v.requireIdFormat("source.ref", input?.source?.ref ?? "");
  validateLevel(v, "requiredLevel", input?.requiredLevel ?? Number.NaN);
  if (input?.requiredCapacityPerPeriod !== undefined) {
    v.requireNonNegativeNumber("requiredCapacityPerPeriod", input.requiredCapacityPerPeriod);
  }
  if (input?.priority !== undefined) {
    v.requireVocabulary("priority", String(input.priority), ["critical", "high", "medium", "low"]);
  }
  for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
  v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
  if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

  try {
    return await sql.begin(async (tx) => {
      const capability = await loadCapability(tx, scope, input.capabilityId ?? "");
      if (!capability) return { ok: false, error: notFound("capability") };
      const existing = await tx`
        select 1 from domain_capability_requirements
        where tenant_id = ${scope.tenantId} and requirement_id = ${requirementId}
      `;
      if (existing.length > 0) {
        return {
          ok: false,
          error: conflictError("capability requirement already registered in tenant"),
        };
      }
      const record: CapabilityRequirementRecord = {
        scope,
        requirementId,
        capabilityId: capability.capabilityId,
        source: {
          kind: isKnownRequirementSource(sourceKind) ? sourceKind : "manual",
          ref: input.source.ref.trim(),
        },
        requiredLevel: input.requiredLevel,
        ...(input.requiredCapacityPerPeriod !== undefined
          ? { requiredCapacityPerPeriod: input.requiredCapacityPerPeriod }
          : {}),
        ...(input.priority !== undefined && isKnownGoalPriority(String(input.priority))
          ? { priority: input.priority as CapabilityRequirementRecord["priority"] }
          : {}),
        provenance: input.provenance,
        createdAt: input.now,
      };
      await tx`
        insert into domain_capability_requirements
          (tenant_id, requirement_id, capability_id, source_kind, record)
        values
          (${scope.tenantId}, ${requirementId}, ${record.capabilityId},
           ${record.source.kind}, ${jsonbParam(tx, record)})
      `;
      await recordWrite(tx, {
        tenantId: scope.tenantId,
        journalKey: `capability:register-requirement:${requirementId}`,
        area: "capability",
        operation: "register-requirement",
        recordId: requirementId,
      });
      await appendAuditEntry(
        tx,
        scope,
        { kind: "capability", id: capability.capabilityId },
        "capability.requirement-registered",
        {
          actor: input.provenance.actor,
          at: input.now,
          reason: "capability requirement registered",
        },
        Object.freeze({ requirementId, sourceKind: record.source.kind }),
      );
      return ok(record);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        error: conflictError("capability requirement already registered in tenant"),
      };
    }
    throw error;
  }
}
