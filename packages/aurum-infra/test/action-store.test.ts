/**
 * P001 action area proof: the PG action authority round-trips with semantics
 * identical to the in-memory reference — the full propose → recommend →
 * approve → authorize → execute journey and every rejection path, with role
 * resolution through the PG identity directory on the storage side (the same
 * closure the kernel wires in memory), stale-before-legality-before-authority
 * error order, audit side-effects per transition (the proposal carries none)
 * — and the lifecycle table is append-only by database trigger.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ActionTransitionInput,
  ProposeActionInput,
  RegisterPersonInput,
} from "@aurum/domain";
import { createPgActionAuthority } from "../src/domain-storage/adapters/action-store.js";
import { createPgIdentityDirectory } from "../src/domain-storage/adapters/identity-store.js";
import { createPgAuditTrail } from "../src/domain-storage/adapters/audit-store.js";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import {
  auditInput,
  errOf,
  expectSameResult,
  memoryKernel,
  now,
  okOf,
  pgHarness,
  personActor,
  scope,
  systemActor,
} from "./helpers.js";
import type { PgLiteHarness } from "../src/domain-storage/harness/pglite-harness.js";

let harness: PgLiteHarness;

beforeAll(async () => {
  harness = await pgHarness();
});

afterAll(async () => {
  await harness.close();
});

function proposeInput(overrides: Record<string, unknown> = {}): ProposeActionInput {
  return {
    actionId: "a-1",
    title: "rotate credentials",
    description: "quarterly rotation",
    subject: { kind: "topic", id: "credentials" },
    policy: {
      approvalRoles: ["approver"],
      authorizationRoles: ["authorizer"],
      employmentImpacting: false,
    },
    createdBy: systemActor("planner"),
    expectedEvidence: "rotation report",
    now: now(0),
    ...overrides,
  } as ProposeActionInput;
}

function transitionInput(overrides: Record<string, unknown> = {}): ActionTransitionInput {
  return {
    actionId: "a-1",
    expectedState: "proposed",
    now: now(1),
    audit: auditInput(personActor("p-1"), "advance", 1),
    ...overrides,
  } as ActionTransitionInput;
}

/** Seeds the same identity world on both kernels (roles for p-1 only). */
async function seedIdentities(
  pgIdentity: ReturnType<typeof createPgIdentityDirectory>,
  memory: ReturnType<typeof memoryKernel>,
  s: ReturnType<typeof scope>,
): Promise<void> {
  const people: readonly RegisterPersonInput[] = [
    {
      personId: "p-1",
      displayName: "Ada",
      labels: ["employee"],
      provenance: systemActor("seed"),
      now: now(0),
    },
    {
      personId: "p-2",
      displayName: "Ben",
      labels: ["contractor"],
      provenance: systemActor("seed"),
      now: now(0),
    },
  ];
  for (const command of people) {
    okOf(await pgIdentity.registerPerson(s, command));
    okOf(memory.identity.registerPerson(s, command));
  }
  const grant = {
    membershipId: "ms-1",
    personId: "p-1",
    organizationId: "org-1",
    roles: ["approver", "authorizer"],
    grantedBy: personActor("p-1"),
    now: now(0),
    audit: auditInput(personActor("p-1"), "grant"),
  };
  okOf(await pgIdentity.grantMembership(s, grant));
  okOf(memory.identity.grantMembership(s, grant));
}

describe("PG action authority equivalence with the in-memory reference", () => {
  it("round-trips the full lifecycle with identical records and histories", async () => {
    const local = await pgHarness();
    try {
      const pgIdentity = createPgIdentityDirectory(local.sql);
      const pgActions = createPgActionAuthority(local.sql, {
        resolveRoles: (scope, actor, at) =>
          actor.kind === "person" && actor.personId
            ? pgIdentity.rolesOf(scope, actor.personId, at)
            : Promise.resolve([]),
      });
      const memory = memoryKernel();
      const s = scope("action-equivalence");
      await seedIdentities(pgIdentity, memory, s);

      // Journey 1: propose → recommend (system) → approve (p-1) →
      // authorize (p-1) → execute (system) with an outcome.
      const propose = proposeInput();
      expectSameResult(
        await pgActions.proposeAction(s, propose),
        memory.actions.proposeAction(s, propose),
      );
      const recommend = transitionInput({
        expectedState: "proposed",
        audit: auditInput(systemActor("lab"), "analysis", 1),
      });
      const approve = transitionInput({
        expectedState: "recommended",
        now: now(2),
        audit: auditInput(personActor("p-1"), "approve", 2),
      });
      const authorize = transitionInput({
        expectedState: "approved",
        now: now(3),
        audit: auditInput(personActor("p-1"), "authorize", 3),
      });
      const execute = transitionInput({
        expectedState: "authorized",
        now: now(4),
        audit: auditInput(systemActor("executor"), "execution", 4),
        outcome: "rotated without incident",
      });
      expectSameResult(
        await pgActions.recommendAction(s, recommend),
        memory.actions.recommendAction(s, recommend),
      );
      expectSameResult(
        await pgActions.approveAction(s, approve),
        memory.actions.approveAction(s, approve),
      );
      expectSameResult(
        await pgActions.authorizeAction(s, authorize),
        memory.actions.authorizeAction(s, authorize),
      );
      expectSameResult(
        await pgActions.recordExecution(s, execute),
        memory.actions.recordExecution(s, execute),
      );
      expectSameResult(await pgActions.getAction(s, "a-1"), memory.actions.getAction(s, "a-1"));

      // Journey 2: a rejected action (person decision, from proposed).
      const propose2 = proposeInput({ actionId: "a-2" });
      expectSameResult(
        await pgActions.proposeAction(s, propose2),
        memory.actions.proposeAction(s, propose2),
      );
      const reject = transitionInput({
        actionId: "a-2",
        expectedState: "proposed",
        now: now(5),
        audit: auditInput(personActor("p-1"), "reject", 5),
      });
      expectSameResult(
        await pgActions.rejectAction(s, reject),
        memory.actions.rejectAction(s, reject),
      );

      // Journey 3: employment-impacting action with a recorded human decision.
      const propose3 = proposeInput({
        actionId: "a-3",
        policy: {
          approvalRoles: ["approver"],
          authorizationRoles: ["authorizer"],
          employmentImpacting: true,
        },
      });
      expectSameResult(
        await pgActions.proposeAction(s, propose3),
        memory.actions.proposeAction(s, propose3),
      );
      const humanDecision = {
        decidedBy: "p-1" as const,
        decidedAt: now(6),
      };
      const approve3 = transitionInput({
        actionId: "a-3",
        expectedState: "proposed",
        now: now(7),
        audit: auditInput(personActor("p-1"), "approve", 7),
      });
      // proposed -> approved is illegal; recommend first on both kernels.
      const recommend3 = {
        ...approve3,
        actionId: "a-3",
        audit: auditInput(systemActor("lab"), "analysis", 6),
      };
      expectSameResult(
        await pgActions.recommendAction(s, recommend3),
        memory.actions.recommendAction(s, recommend3),
      );
      const approveWithDecision = {
        ...approve3,
        expectedState: "recommended",
        humanDecision,
      };
      expectSameResult(
        await pgActions.approveAction(s, approveWithDecision),
        memory.actions.approveAction(s, approveWithDecision),
      );

      for (const actionId of ["a-1", "a-2", "a-3", "missing"]) {
        expectSameResult(
          await pgActions.getAction(s, actionId),
          memory.actions.getAction(s, actionId),
        );
      }
      for (const filter of [
        undefined,
        { state: "executed" },
        { state: "rejected" },
        { state: "approved" },
        { state: "proposed" },
      ] as const) {
        expect(await pgActions.listActions(s, filter)).toEqual(
          memory.actions.listActions(s, filter),
        );
      }
    } finally {
      await local.close();
    }
  });

  it("mirrors validation failures issue-for-issue", async () => {
    const local = await pgHarness();
    try {
      const pgIdentity = createPgIdentityDirectory(local.sql);
      const pgActions = createPgActionAuthority(local.sql, {
        resolveRoles: (scope, actor, at) =>
          actor.kind === "person" && actor.personId
            ? pgIdentity.rolesOf(scope, actor.personId, at)
            : Promise.resolve([]),
      });
      const memory = memoryKernel();
      const s = scope("action-validation");

      const badProposals: readonly Record<string, unknown>[] = [
        { title: "  " },
        { title: "x".repeat(301) },
        { description: "   " },
        { subject: { kind: "warp", id: "x" } },
        { policy: { approvalRoles: [], authorizationRoles: ["authorizer"], employmentImpacting: false } },
        { policy: { approvalRoles: ["approver"], authorizationRoles: [], employmentImpacting: false } },
        { policy: { approvalRoles: ["wizard"], authorizationRoles: ["authorizer"], employmentImpacting: false } },
        { policy: { approvalRoles: ["approver"], authorizationRoles: ["authorizer"] } },
        { createdBy: undefined },
        { createdBy: { kind: "person" } },
        { now: -1 },
      ];
      for (const overrides of badProposals) {
        const input = proposeInput(overrides);
        expectSameResult(
          await pgActions.proposeAction(s, input),
          memory.actions.proposeAction(s, input),
        );
      }
      const badId = proposeInput({ actionId: "a 1x" });
      expectSameResult(
        await pgActions.proposeAction(s, badId),
        memory.actions.proposeAction(s, badId),
      );

      const badTransitions: readonly Record<string, unknown>[] = [
        { expectedState: "sideways" },
        { expectedState: undefined },
        { now: -1 },
        { audit: { ...auditInput(personActor("p-1"), "why"), reason: "  " } },
        { actionId: "a 1x" },
      ];
      for (const overrides of badTransitions) {
        const input = transitionInput(overrides);
        expectSameResult(
          await pgActions.approveAction(s, input),
          memory.actions.approveAction(s, input),
        );
      }
      // Nothing may have been written by a failed command. Note the
      // reference accepts `{ kind: "person" }` without a personId as
      // createdBy (only the kind must be a string) — that case writes "a-1";
      // "a 1x" is the other legal opaque id.
      expect(await pgActions.listActions(s)).toEqual(memory.actions.listActions(s));
      expect(
        (await listJournal(local.sql, s.tenantId))
          .filter((row) => row.area === "actions")
          .map((row) => row.journalKey),
      ).toEqual(["actions:propose:a-1", "actions:propose:a 1x"]);
    } finally {
      await local.close();
    }
  });

  it("mirrors conflict/stale/invariant/forbidden discipline and tenant isolation", async () => {
    const local = await pgHarness();
    try {
      const pgIdentity = createPgIdentityDirectory(local.sql);
      const pgActions = createPgActionAuthority(local.sql, {
        resolveRoles: (scope, actor, at) =>
          actor.kind === "person" && actor.personId
            ? pgIdentity.rolesOf(scope, actor.personId, at)
            : Promise.resolve([]),
      });
      const memory = memoryKernel();
      const s = scope("action-discipline");
      const foreign = scope("action-foreign");
      await seedIdentities(pgIdentity, memory, s);

      const propose = proposeInput();
      okOf(await pgActions.proposeAction(s, propose));
      okOf(memory.actions.proposeAction(s, propose));
      expectSameResult(
        await pgActions.proposeAction(s, proposeInput()),
        memory.actions.proposeAction(s, proposeInput()),
      );
      expectSameResult(
        await pgActions.approveAction(s, transitionInput({ actionId: "nope" })),
        memory.actions.approveAction(s, transitionInput({ actionId: "nope" })),
      );

      // Stale before legality: expected approved while still proposed.
      const stale = transitionInput({ expectedState: "approved" });
      expectSameResult(
        await pgActions.approveAction(s, stale),
        memory.actions.approveAction(s, stale),
      );
      // Legality before authority: proposed -> approved is illegal even for
      // a system actor (invariant, not forbidden).
      const illegal = transitionInput({
        expectedState: "proposed",
        audit: auditInput(systemActor("lab"), "skip", 1),
      });
      expectSameResult(
        await pgActions.approveAction(s, illegal),
        memory.actions.approveAction(s, illegal),
      );
      // Recommend first, then authority checks.
      const recommend = transitionInput({
        expectedState: "proposed",
        audit: auditInput(systemActor("lab"), "analysis", 1),
      });
      okOf(await pgActions.recommendAction(s, recommend));
      okOf(memory.actions.recommendAction(s, recommend));
      // Non-person cannot approve.
      const systemApprove = transitionInput({
        expectedState: "recommended",
        audit: auditInput(systemActor("lab"), "approve", 2),
      });
      expectSameResult(
        await pgActions.approveAction(s, systemApprove),
        memory.actions.approveAction(s, systemApprove),
      );
      // Person without an approval role cannot approve.
      const outsiderApprove = transitionInput({
        expectedState: "recommended",
        now: now(2),
        audit: auditInput(personActor("p-2"), "approve", 2),
      });
      expectSameResult(
        await pgActions.approveAction(s, outsiderApprove),
        memory.actions.approveAction(s, outsiderApprove),
      );
      // Approved person, employment-impacting without a human decision.
      const impacting = proposeInput({
        actionId: "a-2",
        policy: {
          approvalRoles: ["approver"],
          authorizationRoles: ["authorizer"],
          employmentImpacting: true,
        },
      });
      okOf(await pgActions.proposeAction(s, impacting));
      okOf(memory.actions.proposeAction(s, impacting));
      okOf(
        await pgActions.recommendAction(
          s,
          transitionInput({ actionId: "a-2", audit: auditInput(systemActor("lab"), "analysis", 3) }),
        ),
      );
      okOf(
        memory.actions.recommendAction(
          s,
          transitionInput({ actionId: "a-2", audit: auditInput(systemActor("lab"), "analysis", 3) }),
        ),
      );
      const missingDecision = transitionInput({
        actionId: "a-2",
        expectedState: "recommended",
        now: now(4),
        audit: auditInput(personActor("p-1"), "approve", 4),
      });
      expectSameResult(
        await pgActions.approveAction(s, missingDecision),
        memory.actions.approveAction(s, missingDecision),
      );
      // Non-person cannot reject; terminal states cannot move.
      const systemReject = transitionInput({
        expectedState: "recommended",
        now: now(5),
        audit: auditInput(systemActor("lab"), "reject", 5),
      });
      expectSameResult(
        await pgActions.rejectAction(s, systemReject),
        memory.actions.rejectAction(s, systemReject),
      );
      okOf(
        await pgActions.rejectAction(
          s,
          transitionInput({
            actionId: "a-2",
            expectedState: "recommended",
            now: now(6),
            audit: auditInput(personActor("p-2"), "reject", 6),
          }),
        ),
      );
      okOf(
        memory.actions.rejectAction(
          s,
          transitionInput({
            actionId: "a-2",
            expectedState: "recommended",
            now: now(6),
            audit: auditInput(personActor("p-2"), "reject", 6),
          }),
        ),
      );
      const terminal = transitionInput({
        actionId: "a-2",
        expectedState: "rejected",
        now: now(7),
        audit: auditInput(personActor("p-1"), "again", 7),
      });
      expectSameResult(
        await pgActions.approveAction(s, terminal),
        memory.actions.approveAction(s, terminal),
      );
      expectSameResult(
        await pgActions.recordExecution(s, terminal),
        memory.actions.recordExecution(s, terminal),
      );

      // Foreign-tenant reads are indistinguishable from missing.
      const foreignRead = errOf(await pgActions.getAction(foreign, "a-1"));
      const missingRead = errOf(await pgActions.getAction(s, "missing"));
      expect(foreignRead.message).toBe(missingRead.message);
      expect(foreignRead.message).toBe("action not found");
      expect(await pgActions.listActions(foreign)).toEqual([]);
      // The same action id may exist independently in another tenant.
      const foreignSeed = await seedForeignAction(local.sql, foreign);
      expect(foreignSeed.state).toBe("proposed");

      // The original record survived the duplicate proposal untouched.
      expectSameResult(await pgActions.getAction(s, "a-1"), memory.actions.getAction(s, "a-1"));
    } finally {
      await local.close();
    }
  });

  it("appends matching audit entries per transition (proposal carries none)", async () => {
    const local = await pgHarness();
    try {
      const pgIdentity = createPgIdentityDirectory(local.sql);
      const pgActions = createPgActionAuthority(local.sql, {
        resolveRoles: (scope, actor, at) =>
          actor.kind === "person" && actor.personId
            ? pgIdentity.rolesOf(scope, actor.personId, at)
            : Promise.resolve([]),
      });
      const pgAudit = createPgAuditTrail(local.sql);
      const memory = memoryKernel();
      const s = scope("action-audit");
      await seedIdentities(pgIdentity, memory, s);

      okOf(await pgActions.proposeAction(s, proposeInput()));
      okOf(memory.actions.proposeAction(s, proposeInput()));
      // No audit entry for the proposal itself: both trails still contain
      // only the seeded membership.granted entry.
      expect(await pgAudit.queryAudit(s, {})).toEqual(memory.audit.queryAudit(s, {}));
      expect(
        (await pgAudit.queryAudit(s, { subject: { kind: "action", id: "a-1" } })).length,
      ).toBe(0);

      okOf(
        await pgActions.recommendAction(
          s,
          transitionInput({ audit: auditInput(systemActor("lab"), "analysis", 1) }),
        ),
      );
      okOf(
        memory.actions.recommendAction(
          s,
          transitionInput({ audit: auditInput(systemActor("lab"), "analysis", 1) }),
        ),
      );
      okOf(
        await pgActions.approveAction(
          s,
          transitionInput({ expectedState: "recommended", now: now(2), audit: auditInput(personActor("p-1"), "approve", 2) }),
        ),
      );
      okOf(
        memory.actions.approveAction(
          s,
          transitionInput({ expectedState: "recommended", now: now(2), audit: auditInput(personActor("p-1"), "approve", 2) }),
        ),
      );
      // action.recommended (audit-1), action.approved (audit-2) — identical.
      expect(await pgAudit.queryAudit(s, {})).toEqual(memory.audit.queryAudit(s, {}));
    } finally {
      await local.close();
    }
  });
});

/** Proposes one action in a foreign tenant (isolation fixture). */
async function seedForeignAction(
  sql: PgLiteHarness["sql"],
  foreign: ReturnType<typeof scope>,
): Promise<{ state: string }> {
  const pgIdentity = createPgIdentityDirectory(sql);
  const pgActions = createPgActionAuthority(sql, {
    resolveRoles: (scope, actor, at) =>
      actor.kind === "person" && actor.personId
        ? pgIdentity.rolesOf(scope, actor.personId, at)
        : Promise.resolve([]),
  });
  const proposed = okOf(await pgActions.proposeAction(foreign, proposeInput()));
  return { state: proposed.state };
}

describe("PG action authority database enforcement", () => {
  it("rejects UPDATE and DELETE on action rows (append-only)", async () => {
    const pgIdentity = createPgIdentityDirectory(harness.sql);
    const pgActions = createPgActionAuthority(harness.sql, {
      resolveRoles: (scope, actor, at) =>
        actor.kind === "person" && actor.personId
          ? pgIdentity.rolesOf(scope, actor.personId, at)
          : Promise.resolve([]),
    });
    const s = scope("action-immutable");
    const created = okOf(await pgActions.proposeAction(s, proposeInput()));
    await expect(
      harness.sql`update domain_actions set record = record where tenant_id = ${s.tenantId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.sql`delete from domain_actions where tenant_id = ${s.tenantId}`,
    ).rejects.toThrow(/append-only/);
    const after = okOf(await pgActions.getAction(s, "a-1"));
    expect(after).toEqual(created);
  });

  it("journeys every mutation through the write journal with stable keys", async () => {
    const pgIdentity = createPgIdentityDirectory(harness.sql);
    const pgActions = createPgActionAuthority(harness.sql, {
      resolveRoles: (scope, actor, at) =>
        actor.kind === "person" && actor.personId
          ? pgIdentity.rolesOf(scope, actor.personId, at)
          : Promise.resolve([]),
    });
    const s = scope("action-journal");
    await seedIdentities(pgIdentity, memoryKernel(), s);
    okOf(await pgActions.proposeAction(s, proposeInput()));
    okOf(
      await pgActions.recommendAction(
        s,
        transitionInput({ audit: auditInput(systemActor("lab"), "analysis", 1) }),
      ),
    );
    okOf(
      await pgActions.approveAction(
        s,
        transitionInput({ expectedState: "recommended", now: now(2), audit: auditInput(personActor("p-1"), "approve", 2) }),
      ),
    );
    const rows = await listJournal(harness.sql, s.tenantId);
    expect(rows.filter((row) => row.area === "actions").map((row) => row.journalKey)).toEqual([
      "actions:propose:a-1",
      "actions:transition:a-1:1",
      "actions:transition:a-1:2",
    ]);
  });

  it("rejects mutations that would rewrite the lifecycle (database constraint)", async () => {
    const pgIdentity = createPgIdentityDirectory(harness.sql);
    const pgActions = createPgActionAuthority(harness.sql, {
      resolveRoles: (scope, actor, at) =>
        actor.kind === "person" && actor.personId
          ? pgIdentity.rolesOf(scope, actor.personId, at)
          : Promise.resolve([]),
    });
    const s = scope("action-constraint");
    await seedIdentities(pgIdentity, memoryKernel(), s);
    okOf(await pgActions.proposeAction(s, proposeInput()));
    okOf(
      await pgActions.recommendAction(
        s,
        transitionInput({ audit: auditInput(systemActor("lab"), "analysis", 1) }),
      ),
    );
    await expect(
      harness.sql`
        insert into domain_actions (tenant_id, action_id, mutation_seq, from_state, to_state, record)
        values (${s.tenantId}, 'a-1', 1, 'proposed', 'rejected', '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    const record = okOf(await pgActions.getAction(s, "a-1"));
    expect(record.stateHistory).toHaveLength(2);
    expect(record.state).toBe("recommended");
  });
});
