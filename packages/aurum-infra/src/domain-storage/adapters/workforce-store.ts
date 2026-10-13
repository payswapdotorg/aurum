/**
 * PostgreSQL workforce directory (P001, workforce area) with semantics
 * identical to the in-memory reference — same validation issues (id formats,
 * effort bounds, period covering, provenance), same conflict/not-found
 * discipline (assignment id conflict before the capacity checks), the same
 * bounded-allocation rules (a covering capacity declaration is required and
 * both the effort bound and the concurrency bound are enforced over the
 * person's active overlapping assignments) and the same audit side-effects
 * (role-registered / capacity-declared / assignment-recorded /
 * assignment-ended on subject "workforce").
 *
 * Storage ruling (migration 0011): roles, capacities and assignment bases are
 * immutable rows; ending an assignment is an APPENDED fact in
 * domain_workforce_assignment_ends (PK = one end per assignment) and the
 * ended record value is derived on read exactly like the in-memory
 * `endAssignment` spread. The covering-capacity lookup orders by created_at
 * desc, insertion order asc — the in-memory stable
 * `sort((a, b) => b.createdAt - a.createdAt)[0]`. registerRole and
 * declareCapacity live in workforce-shared.ts.
 */
import {
  auditInputIssues,
  conflictError,
  createValidator,
  deepFreeze,
  notFound,
  ok,
  provenanceIssues,
  summarizeWorkload,
  validationError,
} from "@aurum/domain";
import type {
  ActorReference,
  AssignmentFilter,
  CapacityDeclarationRecord,
  DomainTimestamp,
  PersonId,
  TenantScope,
  TimeWindow,
  WorkAssignmentRecord,
  WorkforceRoleRecord,
  WorkforceRoleId,
  WorkforceStorage,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import {
  declareCapacityCommand,
  mirrorCoversPeriod,
  mirrorValidatePeriod,
  registerRoleCommand,
} from "./workforce-shared.js";
import type { TimeWindowLike } from "./workforce-shared.js";
import { recordWrite } from "../journal/write-journal.js";
import { jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** An assignment base row joined with its appended end fact, when present. */
interface AssignmentRow {
  readonly record: WorkAssignmentRecord;
  readonly ended_at: number | null;
  readonly ended_by: ActorReference | null;
}

/** Derives the assignment record value (base + end spread). */
function assignmentValue(row: AssignmentRow): WorkAssignmentRecord {
  if (row.ended_at === null || row.ended_by === null) {
    return deepFreeze(row.record);
  }
  const ended: WorkAssignmentRecord = {
    ...row.record,
    status: "ended",
    // bigint columns arrive as strings over the wire; the domain timestamp is a number.
    endedAt: Number(row.ended_at) as DomainTimestamp,
    endedBy: row.ended_by,
  };
  return deepFreeze(ended);
}

const ASSIGNMENT_SELECT = async (
  sql: Db | Tx,
  scope: TenantScope,
  assignmentId: string,
): Promise<readonly AssignmentRow[]> => sql`
  select a.record, e.ended_at, e.ended_by
  from domain_workforce_assignments a
  left join domain_workforce_assignment_ends e
    on e.tenant_id = a.tenant_id and e.assignment_id = a.assignment_id
  where a.tenant_id = ${scope.tenantId} and a.assignment_id = ${assignmentId}
`;

/** Loads every assignment of the tenant in insertion order, derived on read. */
async function loadAssignments(
  sql: Db | Tx,
  scope: TenantScope,
): Promise<readonly WorkAssignmentRecord[]> {
  const rows: readonly AssignmentRow[] = await sql`
    select a.record, e.ended_at, e.ended_by
    from domain_workforce_assignments a
    left join domain_workforce_assignment_ends e
      on e.tenant_id = a.tenant_id and e.assignment_id = a.assignment_id
    where a.tenant_id = ${scope.tenantId}
    order by a.seq
  `;
  return Object.freeze(rows.map(assignmentValue));
}

/** Loads one assignment of the tenant (derived), undefined when absent. */
async function loadAssignment(
  sql: Db | Tx,
  scope: TenantScope,
  assignmentId: string,
): Promise<WorkAssignmentRecord | undefined> {
  const rows: readonly AssignmentRow[] = await ASSIGNMENT_SELECT(sql, scope, assignmentId);
  const row = rows[0];
  return row ? assignmentValue(row) : undefined;
}

/**
 * The person's capacity declaration covering the period, when one exists:
 * latest createdAt wins, insertion order breaks ties — the in-memory stable
 * `sort((a, b) => b.createdAt - a.createdAt)[0]`.
 */
async function coveringCapacity(
  sql: Db | Tx,
  scope: TenantScope,
  personId: string,
  period: TimeWindowLike,
): Promise<CapacityDeclarationRecord | undefined> {
  const rows: readonly { record: CapacityDeclarationRecord }[] = await sql`
    select record from domain_workforce_capacities
    where tenant_id = ${scope.tenantId} and person_id = ${personId}
    order by created_at desc, seq asc
  `;
  return rows
    .map((row) => row.record)
    .find((record) => mirrorCoversPeriod(record.bounds.period as TimeWindowLike, period));
}

/** Creates the PostgreSQL workforce directory bound to a database handle. */
export function createPgWorkforceDirectory(sql: Db): WorkforceStorage {
  return {
    registerRole: (scope, input) => registerRoleCommand(sql, scope, input),
    listRoles: async (scope) => {
      const rows: readonly { record: WorkforceRoleRecord }[] = await sql`
        select record from domain_workforce_roles
        where tenant_id = ${scope.tenantId}
        order by seq
      `;
      return Object.freeze(rows.map((row) => deepFreeze(row.record)));
    },
    declareCapacity: (scope, input) => declareCapacityCommand(sql, scope, input),
    getCapacity: async (scope, personId: string, at: DomainTimestamp) => {
      const record = await coveringCapacity(sql, scope, personId.trim(), { start: at, end: at });
      return record ? ok(record) : { ok: false, error: notFound("capacity declaration") };
    },
    recordAssignment: async (scope, input) => {
      const v = createValidator();
      const assignmentId = v.requireIdFormat(
        "assignmentId",
        input?.assignmentId ?? "",
      ) as WorkAssignmentRecord["assignmentId"];
      v.requireIdFormat("personId", input?.personId ?? "");
      if (input?.roleId !== undefined) v.requireIdFormat("roleId", input.roleId);
      if (input?.processRef !== undefined) {
        v.requireIdFormat("processRef.processId", input.processRef?.processId ?? "");
        v.requireIdFormat("processRef.stepId", input.processRef?.stepId ?? "");
      }
      v.requireNonNegativeNumber("effortMs", input?.effortMs ?? Number.NaN);
      if ((input?.effortMs ?? 0) <= 0) v.add("effortMs", "must be greater than 0");
      mirrorValidatePeriod(v, "period", input?.period);
      for (const issue of provenanceIssues(input?.provenance)) v.add(issue.field, issue.problem);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      const personId = input.personId.trim() as PersonId;
      const period = input.period;
      return sql.begin(async (tx) => {
        // Id conflict before the capacity checks (in-memory order).
        const existing = await loadAssignment(tx, scope, assignmentId);
        if (existing) {
          return {
            ok: false,
            error: conflictError("work assignment already registered in tenant"),
          };
        }
        const covering = await coveringCapacity(tx, scope, personId, period);
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
        const all = await loadAssignments(tx, scope);
        const active = all.filter(
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
        const totalEffort =
          active.reduce((sum, record) => sum + record.effortMs, 0) + input.effortMs;
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
        await tx`
          insert into domain_workforce_assignments (tenant_id, assignment_id, person_id, record)
          values (${scope.tenantId}, ${assignmentId}, ${personId}, ${jsonbParam(tx, record)})
        `;
        await recordWrite(tx, {
          tenantId: scope.tenantId,
          journalKey: `workforce:record-assignment:${assignmentId}`,
          area: "workforce",
          operation: "record-assignment",
          recordId: assignmentId,
        });
        await appendAuditEntry(
          tx,
          scope,
          { kind: "workforce", id: assignmentId },
          "workforce.assignment-recorded",
          {
            actor: input.provenance.actor,
            at: input.now,
            reason: "human work allocation recorded",
          },
          Object.freeze({
            personId,
            effortMs: record.effortMs,
            ...(input.roleId ? { roleId: input.roleId } : {}),
          }),
        );
        return ok(record);
      });
    },
    endAssignment: async (scope, input) => {
      const v = createValidator();
      v.requireIdFormat("assignmentId", input?.assignmentId ?? "");
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      return sql.begin(async (tx) => {
        const record = await loadAssignment(tx, scope, input.assignmentId);
        if (!record) return { ok: false, error: notFound("work assignment") };
        if (record.status === "ended") {
          return { ok: false, error: conflictError("work assignment already ended") };
        }
        await tx`
          insert into domain_workforce_assignment_ends
            (tenant_id, assignment_id, ended_at, ended_by)
          values (${scope.tenantId}, ${record.assignmentId}, ${input.now},
                  ${jsonbParam(tx, input.endedBy)})
        `;
        await recordWrite(tx, {
          tenantId: scope.tenantId,
          journalKey: `workforce:end-assignment:${record.assignmentId}`,
          area: "workforce",
          operation: "end-assignment",
          recordId: record.assignmentId,
        });
        await appendAuditEntry(
          tx,
          scope,
          { kind: "workforce", id: record.assignmentId },
          "workforce.assignment-ended",
          input.audit,
          Object.freeze({ assignmentId: record.assignmentId }),
        );
        const ended: WorkAssignmentRecord = {
          ...record,
          status: "ended",
          endedAt: input.now,
          endedBy: input.endedBy,
        };
        return ok(deepFreeze(ended));
      });
    },
    listAssignments: async (scope, filter?: AssignmentFilter) => {
      const all = await loadAssignments(sql, scope);
      // The reference's truthy guard AND undefined-aware filter, mirrored
      // verbatim (an empty personId alone returns ALL).
      if (!filter?.personId && !filter?.status) return all;
      return Object.freeze(
        all.filter(
          (record) =>
            (filter?.personId === undefined || record.personId === filter.personId) &&
            (filter?.status === undefined || record.status === filter.status),
        ),
      );
    },
    workloadOf: async (scope, personId: string, period: TimeWindow) => {
      const covering = await coveringCapacity(sql, scope, personId.trim(), period);
      const assignments = await loadAssignments(sql, scope);
      // The domain-exported pure derivation (workload.ts): the summary over
      // ALL tenant assignments exactly like the in-memory call.
      const summary = summarizeWorkload(
        personId.trim() as PersonId,
        period,
        covering?.bounds,
        assignments,
      );
      return ok(summary);
    },
  };
}
