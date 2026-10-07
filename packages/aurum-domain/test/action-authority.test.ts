/**
 * ACCEPTANCE PROOF — action authority: the proposed → recommended →
 * approved → authorized → executed (+ rejected) state machine, human-only
 * approval/authorization with tenant role checks, employment-impacting
 * human decisions, stale optimistic-concurrency, and audit on every
 * consequential transition.
 */
import { describe, expect, it } from "vitest";
import {
  auditInput,
  errOf,
  kernel,
  now,
  okOf,
  personActor,
  scope,
  systemActor,
} from "./helpers.js";

function setupTenantedAction(employmentImpacting = false) {
  const k = kernel();
  const s = scope("acme");
  okOf(
    k.identity.registerPerson(s, {
      personId: "boss",
      displayName: "Boss",
      labels: ["manager"],
      provenance: systemActor("seed"),
      now: now(),
    }),
  );
  okOf(
    k.identity.grantMembership(s, {
      membershipId: "m-1",
      personId: "boss",
      organizationId: "org-1",
      roles: ["approver", "authorizer"],
      grantedBy: personActor("boss"),
      now: now(),
      audit: auditInput(personActor("boss"), "grant"),
    }),
  );
  okOf(
    k.actions.proposeAction(s, {
      actionId: "a-1",
      title: "Change payroll process",
      subject: { kind: "topic", id: "payroll" },
      policy: {
        approvalRoles: ["approver"],
        authorizationRoles: ["authorizer"],
        employmentImpacting,
      },
      createdBy: systemActor("lab"),
      now: now(0),
    }),
  );
  return { k, s };
}

describe("action authority state machine", () => {
  it("walks proposed → recommended → approved → authorized → executed", () => {
    const { k, s } = setupTenantedAction();
    okOf(
      k.actions.recommendAction(s, {
        actionId: "a-1",
        expectedState: "proposed",
        now: now(1),
        audit: auditInput(systemActor("lab"), "analysis recommends"),
      }),
    );
    okOf(
      k.actions.approveAction(s, {
        actionId: "a-1",
        expectedState: "recommended",
        now: now(2),
        audit: auditInput(personActor("boss"), "approved by owner"),
      }),
    );
    okOf(
      k.actions.authorizeAction(s, {
        actionId: "a-1",
        expectedState: "approved",
        now: now(3),
        audit: auditInput(personActor("boss"), "authorized for execution"),
      }),
    );
    const executed = okOf(
      k.actions.recordExecution(s, {
        actionId: "a-1",
        expectedState: "authorized",
        now: now(4),
        audit: auditInput(personActor("boss"), "executed"),
        outcome: "success",
      }),
    );
    expect(executed.state).toBe("executed");
    // Terminal: nothing may follow execution.
    const after = k.actions.rejectAction(s, {
      actionId: "a-1",
      expectedState: "executed",
      now: now(5),
      audit: auditInput(personActor("boss"), "too late"),
    });
    expect(errOf(after).code).toBe("invariant");
  });

  it("stage skipping is an invariant violation, not a silent success", () => {
    const { k, s } = setupTenantedAction();
    const skipToApproved = k.actions.approveAction(s, {
      actionId: "a-1",
      expectedState: "proposed",
      now: now(1),
      audit: auditInput(personActor("boss"), "skip"),
    });
    expect(errOf(skipToApproved).code).toBe("invariant");

    const skipToExecuted = k.actions.recordExecution(s, {
      actionId: "a-1",
      expectedState: "proposed",
      now: now(2),
      audit: auditInput(personActor("boss"), "skip"),
    });
    expect(errOf(skipToExecuted).code).toBe("invariant");
  });

  it("rejection is allowed from pre-execution states and is terminal", () => {
    const { k, s } = setupTenantedAction();
    const rejected = okOf(
      k.actions.rejectAction(s, {
        actionId: "a-1",
        expectedState: "proposed",
        now: now(1),
        audit: auditInput(personActor("boss"), "not worth it"),
      }),
    );
    expect(rejected.state).toBe("rejected");
    const resurrect = k.actions.recommendAction(s, {
      actionId: "a-1",
      expectedState: "rejected",
      now: now(2),
      audit: auditInput(systemActor("lab"), "try again"),
    });
    expect(errOf(resurrect).code).toBe("invariant");
  });

  it("a wrong expectedState is reported as stale (optimistic concurrency)", () => {
    const { k, s } = setupTenantedAction();
    okOf(
      k.actions.recommendAction(s, {
        actionId: "a-1",
        expectedState: "proposed",
        now: now(1),
        audit: auditInput(systemActor("lab"), "r"),
      }),
    );
    const stale = k.actions.approveAction(s, {
      actionId: "a-1",
      expectedState: "proposed",
      now: now(2),
      audit: auditInput(personActor("boss"), "a"),
    });
    const error = errOf(stale);
    expect(error.code).toBe("stale");
    expect(error.message).toContain("recommended");
  });
});

describe("action authority: who may do what", () => {
  it("systems (the Lab) may propose and recommend but never approve or authorize", () => {
    const { k, s } = setupTenantedAction();
    okOf(
      k.actions.recommendAction(s, {
        actionId: "a-1",
        expectedState: "proposed",
        now: now(1),
        audit: auditInput(systemActor("lab"), "recommendation"),
      }),
    );
    const systemApproval = k.actions.approveAction(s, {
      actionId: "a-1",
      expectedState: "recommended",
      now: now(2),
      audit: auditInput(systemActor("lab"), "self-approve"),
    });
    expect(errOf(systemApproval).code).toBe("forbidden");
    expect(errOf(systemApproval).message).toContain("humans");

    const agentApproval = k.actions.approveAction(s, {
      actionId: "a-1",
      expectedState: "recommended",
      now: now(3),
      audit: auditInput({ kind: "agent", name: "agent-body-7" }, "agent approve"),
    });
    expect(errOf(agentApproval).code).toBe("forbidden");
  });

  it("approval requires the policy approval role (tenant-checked membership)", () => {
    const { k, s } = setupTenantedAction();
    okOf(
      k.identity.registerPerson(s, {
        personId: "intern",
        displayName: "Intern",
        labels: ["employee"],
        provenance: systemActor("seed"),
        now: now(),
      }),
    );
    okOf(
      k.identity.grantMembership(s, {
        membershipId: "m-2",
        personId: "intern",
        organizationId: "org-1",
        roles: ["member"],
        grantedBy: personActor("boss"),
        now: now(),
        audit: auditInput(personActor("boss"), "grant"),
      }),
    );
    okOf(
      k.actions.recommendAction(s, {
        actionId: "a-1",
        expectedState: "proposed",
        now: now(1),
        audit: auditInput(systemActor("lab"), "r"),
      }),
    );
    const internApproval = k.actions.approveAction(s, {
      actionId: "a-1",
      expectedState: "recommended",
      now: now(2),
      audit: auditInput(personActor("intern"), "i can approve, right?"),
    });
    expect(errOf(internApproval).code).toBe("forbidden");

    const bossApproval = okOf(
      k.actions.approveAction(s, {
        actionId: "a-1",
        expectedState: "recommended",
        now: now(3),
        audit: auditInput(personActor("boss"), "proper approval"),
      }),
    );
    expect(bossApproval.state).toBe("approved");
  });

  it("ended memberships no longer grant authority", () => {
    const { k, s } = setupTenantedAction();
    okOf(
      k.identity.endMembership(s, {
        membershipId: "m-1",
        endedBy: personActor("boss"),
        now: now(1),
        audit: auditInput(personActor("boss"), "role rotation"),
      }),
    );
    okOf(
      k.actions.recommendAction(s, {
        actionId: "a-1",
        expectedState: "proposed",
        now: now(2),
        audit: auditInput(systemActor("lab"), "r"),
      }),
    );
    const approval = k.actions.approveAction(s, {
      actionId: "a-1",
      expectedState: "recommended",
      now: now(3),
      audit: auditInput(personActor("boss"), "former approver"),
    });
    expect(errOf(approval).code).toBe("forbidden");
  });

  it("employment-impacting actions require a recorded human decision on approval", () => {
    const { k, s } = setupTenantedAction(true);
    okOf(
      k.actions.recommendAction(s, {
        actionId: "a-1",
        expectedState: "proposed",
        now: now(1),
        audit: auditInput(systemActor("lab"), "r"),
      }),
    );
    const missingDecision = k.actions.approveAction(s, {
      actionId: "a-1",
      expectedState: "recommended",
      now: now(2),
      audit: auditInput(personActor("boss"), "approved"),
    });
    expect(errOf(missingDecision).code).toBe("forbidden");
    expect(errOf(missingDecision).message).toContain("employment-impacting");

    const withDecision = okOf(
      k.actions.approveAction(s, {
        actionId: "a-1",
        expectedState: "recommended",
        now: now(3),
        audit: auditInput(personActor("boss"), "approved with recorded decision"),
        humanDecision: { decidedBy: "boss" as never, decidedAt: now(3) },
      }),
    );
    expect(withDecision.state).toBe("approved");
  });

  it("every consequential transition lands in the audit trail with who/what/when/why", () => {
    const { k, s } = setupTenantedAction();
    okOf(
      k.actions.recommendAction(s, {
        actionId: "a-1",
        expectedState: "proposed",
        now: now(1),
        audit: auditInput(systemActor("lab"), "recommendation ready", 1),
      }),
    );
    okOf(
      k.actions.approveAction(s, {
        actionId: "a-1",
        expectedState: "recommended",
        now: now(2),
        audit: auditInput(personActor("boss"), "approved", 2),
      }),
    );
    const entries = k.audit.queryAudit(s, { subject: { kind: "action", id: "a-1" } });
    expect(entries).toHaveLength(2);
    expect(entries[0]?.action).toBe("action.recommended");
    expect(entries[1]?.action).toBe("action.approved");
    expect(entries[1]?.actor.personId).toBe("boss" as never);
    expect(entries[1]?.reason).toBe("approved");
    expect(entries[1]?.at).toBe(now(2));
  });
});
