/**
 * Role history: append-only ledger of the roles a body has held.
 *
 * The body carries its CURRENT role; every assignment (including the
 * supersession of the previous one) is recorded here, giving a complete
 * role history without mutating history rows.
 */
import {
  asAgentRoleAssignmentId,
  type AgentBodyId,
  type AgentRoleAssignmentId,
  type TenantId,
} from "./ids.js";
import { sanitizeAndAssertClean } from "@aurum/provider";
import { validationFailed } from "./errors.js";
import type { AgentRole } from "./agent-body.js";
import type { TenantScoped } from "./ports.js";

export interface AgentRoleAssignment extends TenantScoped {
  readonly id: AgentRoleAssignmentId;
  readonly bodyId: AgentBodyId;
  readonly role: AgentRole;
  readonly assignedAt: string;
  readonly supersededAt: string | null;
  readonly supersededBy: AgentRoleAssignmentId | null;
}

export function buildRoleAssignment(
  tenantId: TenantId,
  bodyId: AgentBodyId,
  role: AgentRole,
  deps: { id: string; now: string },
): AgentRoleAssignment {
  const title = sanitizeAndAssertClean(role.title.trim());
  if (title.length === 0 || title.length > 120) {
    throw validationFailed("role title must be 1..120 characters");
  }
  return {
    id: asAgentRoleAssignmentId(deps.id),
    tenantId,
    bodyId,
    role: {
      title,
      description: role.description === null ? null : sanitizeAndAssertClean(role.description),
    },
    assignedAt: deps.now,
    supersededAt: null,
    supersededBy: null,
  };
}

export function supersedeRoleAssignment(
  assignment: AgentRoleAssignment,
  successor: AgentRoleAssignmentId | null,
  at: string,
): AgentRoleAssignment {
  if (assignment.supersededAt !== null) {
    throw validationFailed("role assignment already superseded");
  }
  return { ...assignment, supersededAt: at, supersededBy: successor };
}

/** Role history for a body, oldest first. */
export function roleHistoryOf(
  assignments: readonly AgentRoleAssignment[],
): readonly AgentRoleAssignment[] {
  return [...assignments].sort((a, b) =>
    `${a.assignedAt}${a.id}`.localeCompare(`${b.assignedAt}${b.id}`),
  );
}
