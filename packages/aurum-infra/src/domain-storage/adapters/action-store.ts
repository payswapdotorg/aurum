/**
 * PostgreSQL action authority (P001, action area): the human-gated authority
 * state machine with semantics identical to the in-memory reference — same
 * validation issues, same conflict/stale/invariant/forbidden discipline in
 * the same order (stale before legality before authority), same
 * human-only approval/authorization with role checks through the injected
 * async role resolver (identity-backed, exactly the closure the kernel
 * wires), and the same audit side-effects (`action.<target>` per transition;
 * the proposal itself carries none, mirroring the reference).
 *
 * Storage ruling: one immutable row per mutation keyed (tenant_id, action_id,
 * mutation_seq) — mutation 0 is the proposal, mutations 1..n the state
 * transitions in order; the state history IS the table and the current record
 * is the highest mutation's `record` on read.
 */
import {
  actionTransitionLegal,
  auditInputIssues,
  conflictError,
  createValidator,
  deepFreeze,
  err,
  forbiddenError,
  invariantError,
  isKnownActionState,
  isKnownRole,
  isKnownSubjectKind,
  notFound,
  ok,
  staleError,
  validationError,
} from "@aurum/domain";
import type {
  ActionFilter,
  ActionId,
  ActionRecord,
  ActionState,
  ActionStateTransition,
  ActionStorage,
  ActionTransitionInput,
  ProposeActionInput,
  RoleName,
  StorageRoleResolver,
  SubjectReference,
  TenantScope,
  Validator,
} from "@aurum/domain";
import { appendAuditEntry } from "./audit-store.js";
import { recordWrite } from "../journal/write-journal.js";
import { isUniqueViolation, jsonbParam } from "../pg/db.js";
import type { Db, Tx } from "../pg/db.js";

/** Mirrors the in-memory subject validation (action wording). */
function validateSubject(v: Validator, subject: SubjectReference | undefined): void {
  const raw = subject as { kind?: unknown; id?: unknown } | undefined;
  if (
    !raw ||
    typeof raw.kind !== "string" ||
    !isKnownSubjectKind(raw.kind) ||
    typeof raw.id !== "string" ||
    raw.id.trim().length === 0
  ) {
    v.add("subject", "must be a typed subject reference");
  }
}

/** Mirrors the in-memory person-actor check. */
function requirePersonActor(actor: { kind?: unknown } | undefined): boolean {
  return actor?.kind === "person";
}

interface ActionRow {
  readonly record: ActionRecord;
}

/** The current record of one action (the highest mutation's record). */
async function loadCurrentAction(
  sql: Tx | Db,
  scope: TenantScope,
  actionId: string,
): Promise<ActionRecord | null> {
  const rows: readonly { record: ActionRecord }[] = await sql`
    select record from domain_actions
    where tenant_id = ${scope.tenantId} and action_id = ${actionId}
    order by mutation_seq desc
    limit 1
  `;
  const row = rows[0];
  return row ? deepFreeze(row.record) : null;
}

/**
 * Loads the current record of every action in one tenant. Registration order
 * (first-seen mutation 0 row), exactly like the in-memory TenantIndex list —
 * NOT the order of the latest mutations.
 */
async function loadAllCurrentActions(
  sql: Db,
  scope: TenantScope,
): Promise<readonly ActionRecord[]> {
  const rows: readonly ActionRow[] = await sql`
    select record from domain_actions
    where tenant_id = ${scope.tenantId}
    order by seq
  `;
  const byAction = new Map<string, ActionRecord>();
  for (const row of rows) {
    const record = deepFreeze(row.record);
    const existing = byAction.get(record.actionId);
    // Later mutations overwrite earlier snapshots; first-seen order preserved.
    if (!existing || record.stateHistory.length > existing.stateHistory.length) {
      byAction.set(record.actionId, record);
    }
  }
  return Object.freeze([...byAction.values()]);
}

/** Creates the PostgreSQL action authority bound to a database handle. */
export function createPgActionAuthority(
  sql: Db,
  options: { resolveRoles: StorageRoleResolver },
): ActionStorage {
  const { resolveRoles } = options;

  async function transition(
    scope: TenantScope,
    input: ActionTransitionInput,
    target: Exclude<ActionState, "proposed">,
  ) {
    const v = createValidator();
    const actionId = v.requireIdFormat("actionId", input?.actionId ?? "") as ActionId;
    if (!isKnownActionState(String(input?.expectedState))) {
      v.add("expectedState", "must be a known action state");
    }
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return err(validationError(v.issues));

    const actor = input.audit.actor;
    // Role resolution runs on the pool BEFORE the command transaction: the
    // single-connection harness cannot nest a pooled query inside an open
    // transaction, and the in-memory kernel resolves roles at this same
    // logical point (a concurrent membership change between resolution and
    // the transition is a race the reference cannot represent either).
    const needsRoles = target === "approved" || target === "authorized";
    const actorRoles =
      needsRoles && requirePersonActor(actor) ? await resolveRoles(scope, actor, input.now) : [];

    try {
      return await sql.begin(async (tx) => {
        const record = await loadCurrentAction(tx, scope, actionId);
        if (!record) return err(notFound("action"));
        if (record.state !== input.expectedState) {
          return err(staleError(input.expectedState, record.state));
        }
        if (!actionTransitionLegal(record.state, target)) {
          return err(invariantError(`action cannot move from ${record.state} to ${target}`));
        }

        if (target === "recommended") {
          // Recommendation is analysis, not authority: any actor may recommend.
        } else if (target === "approved") {
          if (!requirePersonActor(actor)) {
            return err(forbiddenError("only humans may approve actions"));
          }
          const holdsApprovalRole = record.policy.approvalRoles.some((role) =>
            actorRoles.includes(role),
          );
          if (!holdsApprovalRole) {
            return err(forbiddenError("actor does not hold an approval role for this action"));
          }
          if (record.policy.employmentImpacting && !input.humanDecision) {
            return err(
              forbiddenError(
                "employment-impacting actions require a recorded human decision on approval",
              ),
            );
          }
        } else if (target === "authorized") {
          if (!requirePersonActor(actor)) {
            return err(forbiddenError("only humans may authorize actions"));
          }
          const holdsAuthorizationRole = record.policy.authorizationRoles.some((role) =>
            actorRoles.includes(role),
          );
          if (!holdsAuthorizationRole) {
            return err(forbiddenError("actor does not hold an authorization role for this action"));
          }
        } else if (target === "rejected") {
          if (!requirePersonActor(actor)) {
            return err(forbiddenError("rejection is a human decision"));
          }
        }

        const entry: ActionStateTransition = {
          from: record.state,
          to: target,
          at: input.now,
          actor,
          reason: input.audit.reason,
        };
        const updated: ActionRecord = deepFreeze({
          ...record,
          state: target,
          stateHistory: Object.freeze([...record.stateHistory, entry]),
        });
        await tx`
          insert into domain_actions (tenant_id, action_id, mutation_seq, from_state, to_state, record)
          values
            (${scope.tenantId}, ${actionId}, ${updated.stateHistory.length - 1},
             ${record.state}, ${target}, ${jsonbParam(tx, updated)})
        `;
        await recordWrite(tx, {
          tenantId: scope.tenantId,
          journalKey: `actions:transition:${actionId}:${updated.stateHistory.length - 1}`,
          area: "actions",
          operation: `transition-${target}`,
          recordId: actionId,
          version: updated.stateHistory.length - 1,
        });
        await appendAuditEntry(
          tx,
          scope,
          { kind: "action", id: record.actionId },
          `action.${target}`,
          input.audit,
          Object.freeze({
            from: record.state,
            to: target,
            ...(target === "executed" && input.outcome ? { outcome: input.outcome } : {}),
          }),
        );
        return ok(updated);
      });
    } catch (error) {
      // Concurrent transition on real PostgreSQL: the mutation sequence is
      // taken, which means the state moved — the caller's expectation is
      // stale. Re-read and report the actual state.
      if (isUniqueViolation(error)) {
        const current = await loadCurrentAction(sql, scope, actionId);
        if (current) return err(staleError(input.expectedState, current.state));
      }
      throw error;
    }
  }

  return {
    proposeAction: async (scope, input: ProposeActionInput) => {
      const v = createValidator();
      const actionId = v.requireIdFormat("actionId", input?.actionId ?? "") as ActionId;
      const title = v.requireText("title", input?.title ?? "", { max: 300 });
      if (input?.description !== undefined) {
        v.requireText("description", input.description);
      }
      validateSubject(v, input?.subject);
      const approvalRoles = Array.isArray(input?.policy?.approvalRoles)
        ? input.policy.approvalRoles
        : [];
      const authorizationRoles = Array.isArray(input?.policy?.authorizationRoles)
        ? input.policy.authorizationRoles
        : [];
      if (approvalRoles.length === 0) v.add("policy.approvalRoles", "must be a non-empty array");
      if (authorizationRoles.length === 0) {
        v.add("policy.authorizationRoles", "must be a non-empty array");
      }
      for (const role of [...approvalRoles, ...authorizationRoles]) {
        if (typeof role !== "string" || !isKnownRole(role)) {
          v.add("policy.roles", `unknown role: ${String(role)}`);
        }
      }
      if (typeof input?.policy?.employmentImpacting !== "boolean") {
        v.add("policy.employmentImpacting", "must be a boolean");
      }
      if (!input?.createdBy || typeof input.createdBy.kind !== "string") {
        v.add("createdBy", "is required");
      }
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return err(validationError(v.issues));

      const entry: ActionStateTransition = {
        from: undefined,
        to: "proposed",
        at: input.now,
        actor: input.createdBy,
        reason: "action proposed",
      };
      const record: ActionRecord = {
        scope,
        actionId,
        title,
        ...(input.description ? { description: input.description } : {}),
        subject: input.subject,
        policy: {
          approvalRoles: Object.freeze([...approvalRoles]) as readonly RoleName[],
          authorizationRoles: Object.freeze([...authorizationRoles]) as readonly RoleName[],
          employmentImpacting: input.policy.employmentImpacting,
        },
        state: "proposed",
        stateHistory: Object.freeze([entry]),
        createdBy: input.createdBy,
        createdAt: input.now,
        ...(input.expectedEvidence ? { expectedEvidence: input.expectedEvidence } : {}),
      };
      try {
        return await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_actions
            where tenant_id = ${scope.tenantId} and action_id = ${actionId}
          `;
          if (existing.length > 0) {
            return err(conflictError("action already registered in tenant"));
          }
          await tx`
            insert into domain_actions (tenant_id, action_id, mutation_seq, from_state, to_state, record)
            values (${scope.tenantId}, ${actionId}, 0, null, 'proposed', ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `actions:propose:${actionId}`,
            area: "actions",
            operation: "propose",
            recordId: actionId,
          });
          return ok(record);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return err(conflictError("action already registered in tenant"));
        }
        throw error;
      }
    },
    recommendAction: (scope, input) => transition(scope, input, "recommended"),
    approveAction: (scope, input) => transition(scope, input, "approved"),
    authorizeAction: (scope, input) => transition(scope, input, "authorized"),
    recordExecution: (scope, input) => transition(scope, input, "executed"),
    rejectAction: (scope, input) => transition(scope, input, "rejected"),
    getAction: async (scope, actionId) => {
      const record = await loadCurrentAction(sql, scope, actionId);
      return record ? ok(record) : err(notFound("action"));
    },
    listActions: async (scope: TenantScope, filter?: ActionFilter) => {
      const all = await loadAllCurrentActions(sql, scope);
      if (!filter?.state) return all;
      return Object.freeze(all.filter((record) => record.state === filter.state));
    },
  };
}
