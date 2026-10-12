/**
 * PostgreSQL identity directory (P001, identity area): people, memberships
 * and the derived role resolution, with semantics identical to the in-memory
 * reference — same validation issues (label/role vocabulary, actor shape),
 * same conflict/not-found discipline (membership conflict checked before
 * person existence, exactly like the reference), same audit side-effects
 * (membership.granted / membership.ended; person registration carries none).
 *
 * Storage ruling: people and membership bases are immutable rows; ending a
 * membership is an APPENDED fact in domain_membership_ends (PK = one end per
 * membership) and the ended record value is derived on read exactly like the
 * in-memory `endMembership` spread. rolesOf reuses the domain-exported pure
 * `activeRolesFor` over the assembled membership records, so the derivation
 * can never drift from the kernel.
 */
import {
  activeRolesFor,
  auditInputIssues,
  conflictError,
  createValidator,
  deepFreeze,
  isKnownIdentityLabel,
  isKnownRole,
  err,
  notFound,
  ok,
  validationError,
} from "@aurum/domain";
import type {
  ActorReference,
  AuditInput,
  DomainTimestamp,
  EndMembershipInput,
  GrantMembershipInput,
  IdentityLabel,
  IdentityStorage,
  MembershipId,
  MembershipRecord,
  MembershipStatus,
  PersonId,
  PersonRecord,
  RegisterPersonInput,
  RoleName,
  TenantScope,
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

/** Mirrors the in-memory label validation (non-empty, known, deduplicated). */
function validateLabels(
  v: ReturnType<typeof createValidator>,
  raw: readonly unknown[],
): {
  ok: boolean;
  labels: IdentityLabel[];
} {
  if (raw.length === 0) {
    v.add("labels", "must be a non-empty array");
  }
  const labels: IdentityLabel[] = [];
  const seen = new Set<string>();
  for (const label of raw) {
    if (typeof label === "string" && isKnownIdentityLabel(label) && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    } else {
      v.add("labels", `unknown label: ${String(label)}`);
    }
  }
  return { ok: v.issues.length === 0, labels };
}

/** Mirrors the in-memory role validation (non-empty, known, deduplicated). */
function validateRoles(v: ReturnType<typeof createValidator>, raw: readonly unknown[]): RoleName[] {
  if (raw.length === 0) {
    v.add("roles", "must be a non-empty array");
  }
  const roles: RoleName[] = [];
  const seen = new Set<string>();
  for (const role of raw) {
    if (typeof role === "string" && isKnownRole(role) && !seen.has(role)) {
      seen.add(role);
      roles.push(role);
    } else {
      v.add("roles", `unknown role: ${String(role)}`);
    }
  }
  return roles;
}

interface MembershipRow {
  readonly record: MembershipRecord;
  readonly ended_at: number | null;
  readonly ended_by: ActorReference | null;
}

/** Derives the membership record value (base + end spread). */
function membershipValue(row: MembershipRow): MembershipRecord {
  if (row.ended_at === null || row.ended_by === null) {
    return deepFreeze(row.record);
  }
  const ended: MembershipRecord = {
    ...row.record,
    status: "ended" as MembershipStatus,
    // bigint columns arrive as strings over the wire; the domain timestamp is a number.
    endedAt: Number(row.ended_at) as DomainTimestamp,
    endedBy: row.ended_by,
  };
  return deepFreeze(ended);
}

const MEMBERSHIP_SELECT = async (
  sql: Tx | Db,
  scope: TenantScope,
  membershipId: string,
): Promise<readonly MembershipRow[]> => sql`
  select m.record, e.ended_at, e.ended_by
  from domain_memberships m
  left join domain_membership_ends e
    on e.tenant_id = m.tenant_id and e.membership_id = m.membership_id
  where m.tenant_id = ${scope.tenantId} and m.membership_id = ${membershipId}
`;

/** Creates the PostgreSQL identity directory bound to a database handle. */
export function createPgIdentityDirectory(sql: Db): IdentityStorage {
  return {
    registerPerson: async (scope, input: RegisterPersonInput) => {
      const v = createValidator();
      const personId = v.requireIdFormat("personId", input?.personId ?? "") as PersonId;
      const displayName = v.requireText("displayName", input?.displayName ?? "");
      if (input?.externalRef !== undefined) v.requireIdFormat("externalRef", input.externalRef);
      const rawLabels = Array.isArray(input?.labels) ? input.labels : [];
      const { labels } = validateLabels(v, rawLabels);
      requireActor(v, "provenance", input?.provenance);
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

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
      try {
        const registered = await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_people where tenant_id = ${scope.tenantId} and person_id = ${personId}
          `;
          if (existing.length > 0) {
            return err(conflictError("person already registered in tenant"));
          }
          await tx`
            insert into domain_people (tenant_id, person_id, record)
            values (${scope.tenantId}, ${personId}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `identity:register-person:${personId}`,
            area: "identity",
            operation: "register-person",
            recordId: personId,
          });
          return ok(record);
        });
        return registered;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return err(conflictError("person already registered in tenant"));
        }
        throw error;
      }
    },
    getPerson: async (scope, personId) => {
      const rows: readonly { record: PersonRecord }[] = await sql`
        select record from domain_people
        where tenant_id = ${scope.tenantId} and person_id = ${personId}
      `;
      if (rows.length === 0) return err(notFound("person"));
      const row = rows[0];
      if (!row) throw new Error("person row missing after length check");
      return ok(deepFreeze(row.record));
    },
    listPeople: async (scope) => {
      const rows: readonly { record: PersonRecord }[] = await sql`
        select record from domain_people where tenant_id = ${scope.tenantId} order by seq
      `;
      return Object.freeze(rows.map((row) => deepFreeze(row.record)));
    },
    grantMembership: async (scope, input: GrantMembershipInput) => {
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
      const roles = validateRoles(v, rawRoles);
      requireActor(v, "grantedBy", input?.grantedBy);
      addAuditIssues(v, input?.audit);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

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
      try {
        const granted = await sql.begin(async (tx) => {
          const existing = await tx`
            select 1 from domain_memberships
            where tenant_id = ${scope.tenantId} and membership_id = ${membershipId}
          `;
          if (existing.length > 0) {
            return err(conflictError("membership already registered in tenant"));
          }
          // Person existence is checked AFTER the conflict check (in-memory order).
          const person = await tx`
            select 1 from domain_people
            where tenant_id = ${scope.tenantId} and person_id = ${personId}
          `;
          if (person.length === 0) return err(notFound("person"));
          await tx`
            insert into domain_memberships
              (tenant_id, membership_id, person_id, organization_id, granted_at, record)
            values
              (${scope.tenantId}, ${membershipId}, ${personId}, ${organizationId},
               ${input.now}, ${jsonbParam(tx, record)})
          `;
          await recordWrite(tx, {
            tenantId: scope.tenantId,
            journalKey: `identity:grant-membership:${membershipId}`,
            area: "identity",
            operation: "grant-membership",
            recordId: membershipId,
          });
          await appendAuditEntry(
            tx,
            scope,
            { kind: "person", id: personId },
            "membership.granted",
            input.audit,
            Object.freeze({ membershipId, roles: Object.freeze([...roles]) }),
          );
          return ok(record);
        });
        return granted;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return err(conflictError("membership already registered in tenant"));
        }
        throw error;
      }
    },
    endMembership: async (scope, input: EndMembershipInput) => {
      const v = createValidator();
      const membershipId = v.requireIdFormat(
        "membershipId",
        input?.membershipId ?? "",
      ) as MembershipId;
      v.requireNonNegativeNumber("now", input?.now ?? Number.NaN);
      requireActor(v, "endedBy", input?.endedBy);
      addAuditIssues(v, input?.audit);
      if (v.issues.length > 0) return { ok: false, error: validationError(v.issues) };

      return sql.begin(async (tx) => {
        const rows: readonly MembershipRow[] = await MEMBERSHIP_SELECT(tx, scope, membershipId);
        const row = rows[0];
        if (!row) return err(notFound("membership"));
        if (row.ended_at !== null) {
          return err(conflictError("membership already ended"));
        }
        const base = row.record;
        await tx`
          insert into domain_membership_ends (tenant_id, membership_id, ended_at, ended_by)
          values (${scope.tenantId}, ${base.membershipId}, ${input.now}, ${jsonbParam(tx, input.endedBy)})
        `;
        await recordWrite(tx, {
          tenantId: scope.tenantId,
          journalKey: `identity:end-membership:${base.membershipId}`,
          area: "identity",
          operation: "end-membership",
          recordId: base.membershipId,
        });
        await appendAuditEntry(
          tx,
          scope,
          { kind: "person", id: base.personId },
          "membership.ended",
          input.audit,
          Object.freeze({ membershipId: base.membershipId }),
        );
        const ended: MembershipRecord = {
          ...base,
          status: "ended",
          endedAt: input.now,
          endedBy: input.endedBy,
        };
        return ok(deepFreeze(ended));
      });
    },
    listMemberships: async (scope) => {
      const rows: readonly MembershipRow[] = await sql`
        select m.record, e.ended_at, e.ended_by
        from domain_memberships m
        left join domain_membership_ends e
          on e.tenant_id = m.tenant_id and e.membership_id = m.membership_id
        where m.tenant_id = ${scope.tenantId}
        order by m.seq
      `;
      return Object.freeze(rows.map(membershipValue));
    },
    rolesOf: async (scope, personId: string, at: DomainTimestamp) => {
      const rows: readonly MembershipRow[] = await sql`
        select m.record, e.ended_at, e.ended_by
        from domain_memberships m
        left join domain_membership_ends e
          on e.tenant_id = m.tenant_id and e.membership_id = m.membership_id
        where m.tenant_id = ${scope.tenantId}
        order by m.seq
      `;
      const memberships = rows.map(membershipValue);
      // The domain-exported pure derivation: active roles as of `at` from the
      // assembled (possibly ended) membership records.
      return activeRolesFor(personId as PersonId, memberships, at);
    },
  };
}
