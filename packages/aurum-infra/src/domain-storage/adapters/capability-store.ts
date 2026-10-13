/**
 * PostgreSQL capability graph (P001, capability area) with semantics
 * identical to the in-memory reference — same validation issues (supplier
 * vocabulary, proficiency levels, requirement sources, priorities), same
 * not-found/conflict discipline (capability existence before id conflict),
 * same list-filter edge behavior (truthy guard, undefined-aware filter) and
 * the same audit side-effects (registered / supply-registered /
 * requirement-registered / gap-recomputed on subject "graph"). The supply
 * and requirement command bodies live in capability-shared.ts.
 *
 * Storage ruling (migration 0010): capabilities, supplies and requirements
 * are immutable base rows; gap records are appended by recomputeGaps with
 * kernel-generated `gap-<n>` ids backed by a GLOBAL sequential counter
 * (the in-memory counter is per store instance — across tenants), taken as
 * max(gap_number)+1 inside the command transaction. listGaps mirrors the
 * reference's computedAt + localeCompare sort in JavaScript so collation
 * cannot drift.
 */
import {
  assessCoverage,
  conflictError,
  createValidator,
  deepFreeze,
  notFound,
  ok,
  provenanceIssues,
  validationError,
} from "@aurum/domain";
import type {
  CapabilityGapRecord,
  CapabilityId,
  CapabilityRecord,
  CapabilityStorage,
  CoverageAssessment,
  RegisterCapabilityInput,
  RequirementFilter,
  SupplyFilter,
  TenantScope,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import {
  loadCapability,
  loadRequirements,
  loadSupplies,
  registerRequirementCommand,
  registerSupplyCommand,
} from "./capability-shared.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db } from "../pg/db.js";

/** Loads every gap of the tenant in insertion order. */
async function loadGaps(sql: Db, scope: TenantScope): Promise<readonly CapabilityGapRecord[]> {
  const rows: readonly { record: CapabilityGapRecord }[] = await sql`
    select record from domain_capability_gaps
    where tenant_id = ${scope.tenantId}
    order by seq
  `;
  return Object.freeze(rows.map((row) => deepFreeze(row.record)));
}

/** Creates the PostgreSQL capability graph bound to a database handle. */
export function createPgCapabilityGraph(sql: Db): CapabilityStorage {
  return {
    registerCapability: async (scope, input: RegisterCapabilityInput) => {
      const v = createValidator();
      const capabilityId = v.requireIdFormat(
        "capabilityId",
        input?.capabilityId ?? "",
      ) as CapabilityId;
      v.requireText("name", input?.name ?? "", { max: 300 });
      if (input?.description !== undefined) v.requireText("description", input.description);
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const record: CapabilityRecord = {
        scope,
        capabilityId,
        name: input.name.trim(),
        ...(input.description ? { description: input.description.trim() } : {}),
        provenance: input.provenance,
        createdAt: input.now,
      };
      try {
        return await sql.begin(async (tx) => {
          const existing = await loadCapability(tx, scope, capabilityId);
          if (existing) {
            return { ok: false, error: conflictError("capability already registered in tenant") };
          }
          await tx`
            insert into domain_capabilities (tenant_id, capability_id, record)
            values (${scope.tenantId}, ${capabilityId}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `capability:register:${capabilityId}`,
            area: "capability",
            operation: "register",
            recordId: capabilityId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "capability", id: capabilityId },
            "capability.registered",
            { actor: input.provenance.actor, at: input.now, reason: "capability registered" },
            Object.freeze({ name: record.name }),
          );
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, error: conflictError("capability already registered in tenant") };
        }
        throw error;
      }
    },
    getCapability: async (scope, capabilityId) => {
      const record = await loadCapability(sql, scope, capabilityId);
      return record ? ok(record) : { ok: false, error: notFound("capability") };
    },
    listCapabilities: async (scope) => {
      const rows: readonly { record: CapabilityRecord }[] = await sql`
        select record from domain_capabilities
        where tenant_id = ${scope.tenantId}
        order by seq
      `;
      return Object.freeze(rows.map((row) => deepFreeze(row.record)));
    },
    registerSupply: (scope, input) => registerSupplyCommand(sql, scope, input),
    listSupplies: async (scope, filter?: SupplyFilter) => {
      const all = await loadSupplies(sql, scope);
      // The reference's truthy guard: an empty capabilityId returns ALL.
      if (!filter?.capabilityId) return all;
      return Object.freeze(all.filter((supply) => supply.capabilityId === filter.capabilityId));
    },
    registerRequirement: (scope, input) => registerRequirementCommand(sql, scope, input),
    listRequirements: async (scope, filter?: RequirementFilter) => {
      const all = await loadRequirements(sql, scope);
      // The reference's truthy guard AND undefined-aware filter, mirrored
      // verbatim (an empty capabilityId alone returns ALL).
      if (!filter?.capabilityId && !filter?.sourceKind) return all;
      return Object.freeze(
        all.filter(
          (requirement) =>
            (filter?.capabilityId === undefined ||
              requirement.capabilityId === filter.capabilityId) &&
            (filter?.sourceKind === undefined || requirement.source.kind === filter.sourceKind),
        ),
      );
    },
    recomputeGaps: async (scope, input) => {
      const v = createValidator();
      if (input?.requirementId !== undefined) {
        v.requireIdFormat("requirementId", input.requirementId);
      }
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      return sql.begin(async (tx) => {
        const all = await loadRequirements(tx, scope);
        const targets = input?.requirementId
          ? all.filter((item) => item.requirementId === input.requirementId)
          : all;
        if (input?.requirementId && targets.length === 0) {
          return { ok: false, error: notFound("capability requirement") };
        }
        const supplies = await loadSupplies(tx, scope);
        // The gap counter is GLOBAL (the in-memory closure variable spans
        // tenants); max(gap_number) over the whole table is the base.
        const counterRows = await tx`select coalesce(max(gap_number), 0) as n
          from domain_capability_gaps`;
        let gapNumber = Number(counterRows[0]?.n ?? 0);
        const assessments: CoverageAssessment[] = [];
        for (const requirement of targets) {
          const related = supplies.filter(
            (supply) => supply.capabilityId === requirement.capabilityId,
          );
          const assessment = assessCoverage(requirement, related, input.now);
          assessments.push(assessment);
          if (assessment.status !== "covered") {
            gapNumber += 1;
            const gapId = `gap-${gapNumber}`;
            const gap: CapabilityGapRecord = {
              scope,
              gapId: gapId as CapabilityGapRecord["gapId"],
              requirementId: requirement.requirementId,
              capabilityId: requirement.capabilityId,
              kind: assessment.status,
              ...(assessment.levelShortfall !== undefined
                ? { levelShortfall: assessment.levelShortfall }
                : {}),
              ...(assessment.capacityShortfall !== undefined
                ? { capacityShortfall: assessment.capacityShortfall }
                : {}),
              candidateSupplyIds: assessment.candidateSupplyIds,
              computedAt: input.now,
              provenance: input.provenance,
            };
            await tx`
              insert into domain_capability_gaps
                (tenant_id, gap_id, gap_number, requirement_id, kind, computed_at, record)
              values
                (${scope.tenantId}, ${gapId}, ${gapNumber}, ${gap.requirementId},
                 ${gap.kind}, ${gap.computedAt}, ${jsonbParam(tx, gap)})
            `;
            await recordWrite(tx, {
              tenantId: scope.tenantId,
              journalKey: `capability:append-gap:${gapId}`,
              area: "capability",
              operation: "append-gap",
              recordId: gapId,
              version: gapNumber,
            });
          }
        }
        await appendAuditEntry(
          tx,
          scope,
          { kind: "capability", id: "graph" },
          "capability.gap-recomputed",
          { actor: input.provenance.actor, at: input.now, reason: "capability gaps recomputed" },
          Object.freeze({
            assessed: assessments.length,
            gaps: assessments.filter((item) => item.status !== "covered").length,
          }),
        );
        return ok(Object.freeze(assessments));
      });
    },
    listGaps: async (scope, filter) => {
      const all = [...(await loadGaps(sql, scope))].sort(
        (a, b) => a.computedAt - b.computedAt || a.gapId.localeCompare(b.gapId),
      );
      if (!filter?.requirementId && !filter?.kind) return Object.freeze(all);
      return Object.freeze(
        all.filter(
          (gap) =>
            (filter?.requirementId === undefined || gap.requirementId === filter.requirementId) &&
            (filter?.kind === undefined || gap.kind === filter.kind),
        ),
      );
    },
  };
}
