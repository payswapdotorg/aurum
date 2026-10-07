/**
 * ACCEPTANCE PROOF — tenant isolation at the contract boundary.
 *
 * Two tenants share one kernel. Every read/write through the public contract
 * is scoped: a foreign-tenant reference behaves exactly like a never-existing
 * id (same code, same message shape — no existence leaks), and per-tenant
 * listings never include the other tenant's records.
 */
import { describe, expect, it } from "vitest";
import type { DomainError } from "../src/index.js";
import {
  auditInput,
  errOf,
  kernel,
  now,
  okOf,
  personActor,
  provenance,
  scope,
  systemActor,
} from "./helpers.js";

describe("tenant isolation at the contract boundary", () => {
  it("foreign-tenant reads are uniformly not-found (identical error, no leak)", () => {
    const k = kernel();
    const acme = scope("acme");
    const globex = scope("globex");

    // Rich state exists in acme only.
    okOf(
      k.identity.registerPerson(acme, {
        personId: "p-1",
        displayName: "Alice",
        labels: ["employee"],
        provenance: systemActor("seed"),
        now: now(),
      }),
    );
    okOf(
      k.goals.createGoal(acme, {
        goalId: "g-1",
        objective: "o",
        desiredState: "d",
        horizonStart: now(),
        horizonEnd: now(1000),
        ownerId: "p-1",
        ownerLabels: ["employee"],
        priority: "high",
        provenance: provenance(systemActor("seed")),
        now: now(),
        audit: auditInput(personActor("p-1"), "create"),
      }),
    );
    okOf(
      k.evidence.recordObservation(acme, {
        observationId: "o-1",
        subject: { kind: "topic", id: "t" },
        content: "observed",
        observedAt: now(),
        provenance: provenance(systemActor("seed")),
      }),
    );

    const cases: Array<{ label: string; run: () => DomainError }> = [
      { label: "person", run: () => errOf(k.identity.getPerson(globex, "p-1")) },
      { label: "goal", run: () => errOf(k.goals.getGoal(globex, "g-1")) },
      { label: "observation", run: () => errOf(k.evidence.getObservation(globex, "o-1")) },
      { label: "belief", run: () => errOf(k.epistemics.getBelief(globex, "b-1")) },
      { label: "contradiction", run: () => errOf(k.inquiry.getContradiction(globex, "c-1")) },
      { label: "unknown", run: () => errOf(k.inquiry.getUnknown(globex, "u-1")) },
      { label: "action", run: () => errOf(k.actions.getAction(globex, "a-1")) },
      { label: "organization", run: () => errOf(k.organization.getOrganization(globex, "org-1")) },
      {
        label: "membership-end",
        run: () =>
          errOf(
            k.identity.endMembership(globex, {
              membershipId: "m-1",
              endedBy: personActor("p-1"),
              now: now(),
              audit: auditInput(personActor("p-1"), "end"),
            }),
          ),
      },
      {
        label: "goal-revision",
        run: () =>
          errOf(
            k.goals.reviseGoal(globex, {
              goalId: "g-1",
              objective: "o2",
              desiredState: "d2",
              horizonStart: now(),
              horizonEnd: now(2000),
              ownerId: "p-1",
              ownerLabels: ["employee"],
              priority: "low",
              provenance: provenance(systemActor("seed")),
              now: now(),
              audit: auditInput(personActor("p-1"), "revise"),
            }),
          ),
      },
      { label: "audit-get", run: () => errOf(k.audit.getAudit(globex, "audit-1")) },
    ];

    for (const { label, run } of cases) {
      const foreign = run();
      expect(foreign.code, label).toBe("not-found");
      // No existence leak: identical message to a never-existing id.
      expect(foreign.message).not.toMatch(/acme|globex|tenant/i);
    }

    // The exact same operations against never-existing ids produce byte-identical errors.
    const missing = errOf(k.identity.getPerson(globex, "p-1"));
    const never = errOf(k.identity.getPerson(globex, "no-such-person"));
    expect(missing.message).toBe(never.message);
    expect(missing.code).toBe(never.code);
  });

  it("listings are tenant-scoped: the other tenant sees nothing", () => {
    const k = kernel();
    const acme = scope("acme");
    const globex = scope("globex");

    okOf(
      k.identity.registerPerson(acme, {
        personId: "p-1",
        displayName: "Alice",
        labels: ["employee"],
        provenance: systemActor("seed"),
        now: now(),
      }),
    );
    okOf(
      k.goals.createGoal(acme, {
        goalId: "g-1",
        objective: "o",
        desiredState: "d",
        horizonStart: now(),
        horizonEnd: now(1000),
        ownerId: "p-1",
        ownerLabels: ["employee"],
        priority: "high",
        provenance: provenance(systemActor("seed")),
        now: now(),
        audit: auditInput(personActor("p-1"), "create"),
      }),
    );
    okOf(
      k.inquiry.raiseUnknown(acme, {
        unknownId: "u-1",
        question: "q",
        consequence: "c",
        provenance: provenance(systemActor("seed")),
        now: now(),
      }),
    );

    expect(k.identity.listPeople(globex)).toHaveLength(0);
    expect(k.goals.listGoals(globex)).toHaveLength(0);
    expect(k.inquiry.listOpenUnknowns(globex)).toHaveLength(0);
    expect(k.inquiry.listOpenContradictions(globex)).toHaveLength(0);
    expect(k.audit.queryAudit(globex, {})).toHaveLength(0);
    expect(k.identity.listPeople(acme)).toHaveLength(1);
  });

  it("audit trail is tenant-scoped: globex's consequential transitions are invisible to acme", () => {
    const k = kernel();
    const acme = scope("acme");
    const globex = scope("globex");
    okOf(
      k.identity.registerPerson(acme, {
        personId: "p-1",
        displayName: "Alice",
        labels: ["employee"],
        provenance: systemActor("seed"),
        now: now(),
      }),
    );
    okOf(
      k.identity.registerPerson(globex, {
        personId: "p-1",
        displayName: "Bob (same id, other tenant)",
        labels: ["employee"],
        provenance: systemActor("seed"),
        now: now(),
      }),
    );
    // membership grant in globex only
    okOf(
      k.identity.grantMembership(globex, {
        membershipId: "m-1",
        personId: "p-1",
        organizationId: "org-1",
        roles: ["approver"],
        grantedBy: personActor("p-1"),
        now: now(),
        audit: auditInput(personActor("p-1"), "grant"),
      }),
    );

    expect(k.audit.queryAudit(globex, {})).toHaveLength(1);
    expect(k.audit.queryAudit(acme, {})).toHaveLength(0);
  });

  it("the same record id may exist independently in two tenants (no clobber)", () => {
    const k = kernel();
    const acme = scope("acme");
    const globex = scope("globex");
    for (const tenant of [acme, globex]) {
      okOf(
        k.identity.registerPerson(tenant, {
          personId: "shared-id",
          displayName: `person of ${tenant.tenantId}`,
          labels: ["employee"],
          provenance: systemActor("seed"),
          now: now(),
        }),
      );
    }
    const fromAcme = okOf(k.identity.getPerson(acme, "shared-id"));
    const fromGlobex = okOf(k.identity.getPerson(globex, "shared-id"));
    expect(fromAcme.displayName).toBe("person of acme");
    expect(fromGlobex.displayName).toBe("person of globex");
  });

  it("claims cannot borrow another tenant's observations (evidence chain is in-tenant)", () => {
    const k = kernel();
    const acme = scope("acme");
    const globex = scope("globex");
    okOf(
      k.evidence.recordObservation(acme, {
        observationId: "o-1",
        subject: { kind: "topic", id: "t" },
        content: "acme evidence",
        observedAt: now(),
        provenance: provenance(systemActor("seed")),
      }),
    );
    const result = k.epistemics.registerClaim(globex, {
      claimId: "c-1",
      statement: "derived from acme evidence",
      derivedFrom: ["o-1"],
      provenance: provenance(systemActor("seed")),
    });
    expect(errOf(result).code).toBe("not-found");
  });

  it("roles are tenant-scoped: an approver in globex cannot approve in acme", () => {
    const k = kernel();
    const acme = scope("acme");
    const globex = scope("globex");
    for (const tenant of [acme, globex]) {
      okOf(
        k.identity.registerPerson(tenant, {
          personId: "boss",
          displayName: "Boss",
          labels: ["manager"],
          provenance: systemActor("seed"),
          now: now(),
        }),
      );
    }
    okOf(
      k.identity.grantMembership(globex, {
        membershipId: "m-1",
        personId: "boss",
        organizationId: "org-1",
        roles: ["approver"],
        grantedBy: personActor("boss"),
        now: now(),
        audit: auditInput(personActor("boss"), "grant"),
      }),
    );
    okOf(
      k.actions.proposeAction(acme, {
        actionId: "a-1",
        title: "hire",
        subject: { kind: "topic", id: "t" },
        policy: {
          approvalRoles: ["approver"],
          authorizationRoles: ["authorizer"],
          employmentImpacting: true,
        },
        createdBy: systemActor("lab"),
        now: now(),
      }),
    );
    okOf(
      k.actions.recommendAction(acme, {
        actionId: "a-1",
        expectedState: "proposed",
        now: now(),
        audit: auditInput(systemActor("lab"), "recommendation ready"),
      }),
    );
    const approval = k.actions.approveAction(acme, {
      actionId: "a-1",
      expectedState: "recommended",
      now: now(),
      audit: auditInput(personActor("boss"), "approving"),
      humanDecision: { decidedBy: "boss" as never, decidedAt: now() },
    });
    expect(errOf(approval).code).toBe("forbidden");
  });
});
