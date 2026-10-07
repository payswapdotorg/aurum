/**
 * In-memory action authority store. Enforces the authority state machine,
 * human-only approval/authorization with tenant-scoped role checks, and the
 * recorded human decision for employment-impacting actions. Every
 * consequential transition lands in the audit trail.
 */
import {
  conflictError,
  forbiddenError,
  invariantError,
  notFound,
  staleError,
  validationError,
} from "../core/errors.js";
import { ok, type Result } from "../core/result.js";
import { TenantIndex } from "../core/tenantIndex.js";
import { createValidator } from "../core/validation.js";
import type { ActionId } from "../core/branding.js";
import type { TenantScope } from "../core/scope.js";
import { isKnownSubjectKind } from "../core/refs.js";
import { auditInputIssues } from "../audit/records.js";
import type { AuditSink } from "../audit/ports.js";
import { isKnownRole, type RoleName } from "../identity/records.js";
import {
  actionTransitionLegal,
  isKnownActionState,
  type ActionRecord,
  type ActionStateTransition,
} from "./records.js";
import type {
  ActionAuthority,
  ActionFilter,
  ActionTransitionInput,
  ProposeActionInput,
  RoleResolver,
} from "./ports.js";

function validateSubject(
  v: ReturnType<typeof createValidator>,
  subject: { kind?: unknown; id?: unknown } | undefined,
): void {
  if (
    !subject ||
    typeof subject.kind !== "string" ||
    !isKnownSubjectKind(subject.kind) ||
    typeof subject.id !== "string" ||
    subject.id.trim().length === 0
  ) {
    v.add("subject", "must be a typed subject reference");
  }
}

function requirePersonActor(actor: { kind?: unknown } | undefined): boolean {
  return actor?.kind === "person";
}

export function createActionAuthority(options: {
  audit: AuditSink;
  resolveRoles: RoleResolver;
}): ActionAuthority {
  const { audit, resolveRoles } = options;
  const actions = new TenantIndex<ActionRecord>();

  function proposeAction(scope: TenantScope, input: ProposeActionInput): Result<ActionRecord> {
    const v = createValidator();
    const actionId = v.requireIdFormat("actionId", input?.actionId ?? "") as ActionId;
    const title = v.requireText("title", input?.title ?? "", { max: 300 });
    if (input?.description !== undefined) {
      v.requireText("description", input.description);
    }
    validateSubject(v, input?.subject as { kind?: unknown; id?: unknown } | undefined);
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
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    if (actions.has(scope, actionId)) {
      return { ok: false, error: conflictError("action already registered in tenant") };
    }
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
    return ok(actions.put(scope, actionId, record));
  }

  function transition(
    scope: TenantScope,
    input: ActionTransitionInput,
    target: "recommended" | "approved" | "authorized" | "executed" | "rejected",
  ): Result<ActionRecord> {
    const v = createValidator();
    const actionId = v.requireIdFormat("actionId", input?.actionId ?? "");
    if (!isKnownActionState(String(input?.expectedState))) {
      v.add("expectedState", "must be a known action state");
    }
    v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
    for (const issue of auditInputIssues(input?.audit)) v.add(issue.field, issue.problem);
    if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

    const record = actions.get(scope, actionId);
    if (!record) return { ok: false, error: notFound("action") };
    if (record.state !== input.expectedState) {
      return {
        ok: false,
        error: staleError(input.expectedState, record.state),
      };
    }
    if (!actionTransitionLegal(record.state, target)) {
      return {
        ok: false,
        error: invariantError(`action cannot move from ${record.state} to ${target}`),
      };
    }

    const actor = input.audit.actor;
    if (target === "recommended") {
      // Recommendation is analysis, not authority: any actor may recommend.
    } else if (target === "approved") {
      if (!requirePersonActor(actor)) {
        return { ok: false, error: forbiddenError("only humans may approve actions") };
      }
      const actorRoles = resolveRoles(scope, actor, input.now);
      const holdsApprovalRole = record.policy.approvalRoles.some((role) =>
        actorRoles.includes(role),
      );
      if (!holdsApprovalRole) {
        return {
          ok: false,
          error: forbiddenError("actor does not hold an approval role for this action"),
        };
      }
      if (record.policy.employmentImpacting && !input.humanDecision) {
        return {
          ok: false,
          error: forbiddenError(
            "employment-impacting actions require a recorded human decision on approval",
          ),
        };
      }
    } else if (target === "authorized") {
      if (!requirePersonActor(actor)) {
        return { ok: false, error: forbiddenError("only humans may authorize actions") };
      }
      const actorRoles = resolveRoles(scope, actor, input.now);
      const holdsAuthorizationRole = record.policy.authorizationRoles.some((role) =>
        actorRoles.includes(role),
      );
      if (!holdsAuthorizationRole) {
        return {
          ok: false,
          error: forbiddenError("actor does not hold an authorization role for this action"),
        };
      }
    } else if (target === "rejected") {
      if (!requirePersonActor(actor)) {
        return { ok: false, error: forbiddenError("rejection is a human decision") };
      }
    }

    const entry: ActionStateTransition = {
      from: record.state,
      to: target,
      at: input.now,
      actor,
      reason: input.audit.reason,
    };
    const updated: ActionRecord = {
      ...record,
      state: target,
      stateHistory: Object.freeze([...record.stateHistory, entry]),
    };
    const stored = actions.put(scope, actionId, updated);
    audit.append(
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
    return ok(stored);
  }

  return {
    proposeAction,
    recommendAction: (scope, input) => transition(scope, input, "recommended"),
    approveAction: (scope, input) => transition(scope, input, "approved"),
    authorizeAction: (scope, input) => transition(scope, input, "authorized"),
    recordExecution: (scope, input) => transition(scope, input, "executed"),
    rejectAction: (scope, input) => transition(scope, input, "rejected"),
    getAction: (scope: TenantScope, actionId: string) => {
      const record = actions.get(scope, actionId);
      return record ? ok(record) : { ok: false, error: notFound("action") };
    },
    listActions: (scope: TenantScope, filter?: ActionFilter) => {
      const all = actions.list(scope);
      if (!filter?.state) return all;
      return Object.freeze(all.filter((record) => record.state === filter.state));
    },
  };
}
