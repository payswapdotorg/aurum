/**
 * PostgreSQL process directory (P001, process area) with semantics identical
 * to the in-memory reference — the same validation issues (steps, handoffs,
 * variants, measurements, share sums), the same not-found-before-measurement
 * order in recordProcessMetrics, the same conflict discipline, and the same
 * audit side-effects (process.registered / process.revised carrying the
 * revision number; process.metrics-recorded carrying the observation id and
 * the revision it measured). Validation/build mirrors live in
 * process-shared.ts.
 *
 * Storage ruling (migration 0009): process revisions are one immutable row
 * per (tenant, process, revision_number) with the current revision derived
 * as the max on read; metric observations are immutable base rows with
 * strong process_id/recorded_at columns (the in-memory stable sort by
 * recordedAt becomes order by recorded_at, seq).
 */
import {
  conflictError,
  createValidator,
  deepFreeze,
  invariantError,
  notFound,
  ok,
  provenanceIssues,
  validationError,
} from "@aurum/domain";
import type {
  ProcessId,
  ProcessMetricsObservation,
  ProcessMetricsFilter,
  ProcessRecord,
  ProcessRevision,
  ProcessStorage,
  RegisterProcessInput,
  Result,
  ReviseProcessInput,
  TenantScope,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import {
  buildRevisionContent,
  nextRevisionNumber,
  resolveFreshness,
  validateMeasurement,
  validateRevisionContent,
} from "./process-shared.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** Loads one process's revision rows (ordered) or null when absent. */
async function loadProcessRows(
  sql: Tx | Db,
  scope: TenantScope,
  processId: string,
): Promise<readonly ProcessRevision[] | null> {
  const rows: readonly { record: ProcessRevision }[] = await sql`
    select record from domain_process_revisions
    where tenant_id = ${scope.tenantId} and process_id = ${processId}
    order by revision_number
  `;
  if (rows.length === 0) return null;
  return Object.freeze(rows.map((row) => deepFreeze(row.record)));
}

/** Assembles the ProcessRecord the read paths return (current = highest). */
function assembleProcess(
  scope: TenantScope,
  processId: string,
  revisions: readonly ProcessRevision[],
): ProcessRecord {
  const last = revisions[revisions.length - 1];
  return deepFreeze({
    scope,
    processId: processId as ProcessId,
    currentRevision: last ? last.revisionNumber : 0,
    revisions,
  });
}

/** Creates the PostgreSQL process directory bound to a database handle. */
export function createPgProcessDirectory(sql: Db): ProcessStorage {
  async function revise(
    scope: TenantScope,
    input: RegisterProcessInput | ReviseProcessInput,
    mode: "create" | "revise",
  ): Promise<Result<ProcessRecord>> {
    const v = createValidator();
    const processId = v.requireIdFormat("processId", input?.processId ?? "") as ProcessId;
    validateRevisionContent(v, input);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    try {
      return await sql.begin(async (tx) => {
        const existing = await loadProcessRows(tx, scope, processId);
        if (mode === "create" && existing) {
          return { ok: false, error: conflictError("process already registered in tenant") };
        }
        if (mode === "revise" && !existing) {
          return { ok: false, error: notFound("process") };
        }
        const built = buildRevisionContent(input);
        const revision: ProcessRevision = {
          revisionNumber: nextRevisionNumber(existing),
          name: input.name.trim(),
          ...(input.description ? { description: input.description.trim() } : {}),
          steps: built.steps,
          handoffs: built.handoffs,
          variants: built.variants,
          provenance: input.provenance,
          createdAt: input.now,
        };
        await tx`
          insert into domain_process_revisions
            (tenant_id, process_id, revision_number, created_at, record)
          values
            (${scope.tenantId}, ${processId}, ${revision.revisionNumber},
             ${revision.createdAt}, ${jsonbParam(tx, revision)})
        `;
        await recordWrite(tx, {
          tenantId: scope.tenantId,
          journalKey: `process:append-revision:${processId}:${revision.revisionNumber}`,
          area: "process",
          operation: "append-revision",
          recordId: processId,
          version: revision.revisionNumber,
        });
        await appendAuditEntry(
          tx,
          scope,
          { kind: "process", id: processId },
          mode === "create" ? "process.registered" : "process.revised",
          {
            actor: input.provenance.actor,
            at: input.now,
            reason: mode === "create" ? "process registered" : "process revised",
          },
          Object.freeze({ revisionNumber: revision.revisionNumber }),
        );
        const stored = await loadProcessRows(tx, scope, processId);
        return ok(assembleProcess(scope, processId, stored ?? [revision]));
      });
    } catch (error) {
      // Concurrent create on real PostgreSQL: the unique violation resolves
      // as the same conflict Result the in-memory reference produces.
      if (isUniqueViolation(error)) {
        return { ok: false, error: conflictError("process already registered in tenant") };
      }
      throw error;
    }
  }

  return {
    registerProcess: (scope, input) => revise(scope, input, "create"),
    reviseProcess: (scope, input) => revise(scope, input, "revise"),
    getProcess: async (scope, processId) => {
      const revisions = await loadProcessRows(sql, scope, processId);
      return revisions
        ? ok(assembleProcess(scope, processId, revisions))
        : { ok: false, error: notFound("process") };
    },
    listProcesses: async (scope) => {
      const rows: readonly { process_id: string; record: ProcessRevision }[] = await sql`
        select process_id, record from domain_process_revisions
        where tenant_id = ${scope.tenantId}
        order by seq
      `;
      const byProcess = new Map<string, ProcessRevision[]>();
      for (const row of rows) {
        const bucket = byProcess.get(row.process_id) ?? [];
        bucket.push(deepFreeze(row.record));
        byProcess.set(row.process_id, bucket);
      }
      return Object.freeze(
        [...byProcess.entries()].map(([processId, revisions]) =>
          assembleProcess(scope, processId, Object.freeze(revisions)),
        ),
      );
    },
    recordProcessMetrics: async (scope, input) => {
      const v = createValidator();
      const observationId = v.requireIdFormat("observationId", input?.observationId ?? "");
      v.requireIdFormat("processId", input?.processId ?? "");
      const measurements = Array.isArray(input?.measurements) ? input.measurements : [];
      if (measurements.length === 0) v.add("measurements", "must be a non-empty array");
      v.requireNonNegativeNumber("period.start", input?.period?.start ?? Number.NaN);
      v.requireNonNegativeNumber("period.end", input?.period?.end ?? Number.NaN);
      if (
        typeof input?.period?.start === "number" &&
        typeof input?.period?.end === "number" &&
        Number.isFinite(input.period.start) &&
        Number.isFinite(input.period.end) &&
        input.period.start > input.period.end
      ) {
        v.add("period", "start must not be after end");
      }
      // The process lookup happens BEFORE the measurement validation in the
      // in-memory reference (not-found wins over measurement issues).
      const revisions = await loadProcessRows(sql, scope, input?.processId ?? "");
      if (!revisions) return { ok: false, error: notFound("process") };
      const record = assembleProcess(scope, input.processId, revisions);
      const current = record.revisions[record.currentRevision - 1];
      if (!current) {
        return {
          ok: false,
          error: invariantError("corrupt process record: missing current revision"),
        };
      }
      const stepIds = new Set(current.steps.map((step) => step.stepId));
      measurements.forEach((measurement, index) => {
        validateMeasurement(v, measurement, index, stepIds);
      });
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const observation: ProcessMetricsObservation = {
        scope,
        observationId,
        processId: record.processId,
        revisionNumber: current.revisionNumber,
        period: input.period,
        measurements: Object.freeze(
          measurements.map((measurement) => ({
            ...measurement,
            duplicates: Object.freeze([...(measurement.duplicates ?? [])]),
          })),
        ),
        provenance: input.provenance,
        freshness: resolveFreshness(input.freshness, input.now),
        recordedAt: input.now,
      };
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_process_metric_observations
            where tenant_id = ${scope.tenantId} and observation_id = ${observationId}
          `;
          if (existing.length > 0) {
            return {
              ok: false,
              error: conflictError("process metrics observation already recorded in tenant"),
            };
          }
          await tx`
            insert into domain_process_metric_observations
              (tenant_id, observation_id, process_id, recorded_at, record)
            values
              (${scope.tenantId}, ${observationId}, ${observation.processId},
               ${observation.recordedAt}, ${jsonbParam(tx, observation)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `process:record-metrics:${observationId}`,
            area: "process",
            operation: "record-metrics",
            recordId: observationId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "process", id: record.processId },
            "process.metrics-recorded",
            {
              actor: input.provenance.actor,
              at: input.now,
              reason: "process metrics observed",
            },
            Object.freeze({ observationId, revisionNumber: current.revisionNumber }),
          );
          return ok(observation);
        });
      } catch (error) {
        // Concurrent observation on real PostgreSQL: the unique violation
        // resolves as the same conflict Result the reference produces.
        if (isUniqueViolation(error)) {
          return {
            ok: false,
            error: conflictError("process metrics observation already recorded in tenant"),
          };
        }
        throw error;
      }
    },
    listProcessMetrics: async (scope, processId, filter?: ProcessMetricsFilter) => {
      const rows: readonly { record: ProcessMetricsObservation }[] = await sql`
        select record from domain_process_metric_observations
        where tenant_id = ${scope.tenantId} and process_id = ${processId}
        order by recorded_at asc, seq asc
      `;
      const all = Object.freeze(rows.map((row) => deepFreeze(row.record)));
      if (!filter) return all;
      return Object.freeze(
        all.filter(
          (item) =>
            (filter.since === undefined || item.recordedAt >= filter.since) &&
            (filter.until === undefined || item.recordedAt <= filter.until),
        ),
      );
    },
  };
}
