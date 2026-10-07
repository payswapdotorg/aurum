/**
 * Audit trail: append-only entries for every consequential transition,
 * who/what/when/why fields, querying by subject and time window, and
 * tenant scoping of the trail itself.
 */
import { describe, expect, it } from "vitest";
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

describe("audit trail", () => {
  it("goal creation and revision both land in the trail", () => {
    const k = kernel();
    const s = scope("acme");
    const content = {
      objective: "o",
      desiredState: "d",
      horizonStart: now(0),
      horizonEnd: now(1000),
      ownerId: "p-1",
      ownerLabels: ["employee"],
      priority: "high",
    };
    const proven = provenance(systemActor("seed"));
    okOf(
      k.goals.createGoal(s, {
        goalId: "g-1",
        ...content,
        provenance: proven,
        now: now(0),
        audit: auditInput(personActor("p-1"), "annual planning"),
      }),
    );
    okOf(
      k.goals.reviseGoal(s, {
        goalId: "g-1",
        ...content,
        provenance: proven,
        now: now(5),
        audit: auditInput(personActor("p-2"), "owner clarified the objective", 5),
      }),
    );

    const entries = k.audit.queryAudit(s, { subject: { kind: "goal", id: "g-1" } });
    expect(entries.map((entry) => entry.action)).toEqual(["goal.created", "goal.revised"]);
    expect(entries[0]?.reason).toBe("annual planning");
    expect(entries[1]?.actor.personId).toBe("p-2" as never);
    expect(entries[1]?.at).toBe(now(5));
  });

  it("queries filter by time window and subject kind", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.inquiry.raiseUnknown(s, {
        unknownId: "u-1",
        question: "demand?",
        consequence: "overstock",
        provenance: provenance(systemActor("seed")),
        now: now(0),
      }),
    );
    okOf(
      k.inquiry.resolveUnknown(s, {
        unknownId: "u-1",
        outcome: "study done",
        now: now(10),
        audit: auditInput(personActor("p-1"), "learning mission finished", 10),
      }),
    );

    expect(k.audit.queryAudit(s, {})).toHaveLength(2);
    expect(k.audit.queryAudit(s, { since: now(5) })).toHaveLength(1);
    expect(k.audit.queryAudit(s, { until: now(5) })).toHaveLength(1);
    expect(k.audit.queryAudit(s, { subject: { kind: "unknown", id: "u-1" } })).toHaveLength(2);
    expect(k.audit.queryAudit(s, { subject: { kind: "goal", id: "g-1" } })).toHaveLength(0);
  });

  it("audit entries are frozen and retrievable by id", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.inquiry.raiseUnknown(s, {
        unknownId: "u-1",
        question: "demand?",
        consequence: "overstock",
        provenance: provenance(systemActor("seed")),
        now: now(0),
      }),
    );
    const entries = k.audit.queryAudit(s, {});
    expect(entries).toHaveLength(1);
    expect(Object.isFrozen(entries[0])).toBe(true);
    const byId = okOf(k.audit.getAudit(s, entries[0]?.auditId ?? ""));
    expect(byId.action).toBe("unknown.raised");
    expect(errOf(k.audit.getAudit(s, "audit-999")).code).toBe("not-found");
  });

  it("membership grants and ends are audited with actor and details", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.identity.registerPerson(s, {
        personId: "p-1",
        displayName: "A",
        labels: ["employee"],
        provenance: systemActor("seed"),
        now: now(),
      }),
    );
    okOf(
      k.identity.grantMembership(s, {
        membershipId: "m-1",
        personId: "p-1",
        organizationId: "org-1",
        roles: ["approver"],
        grantedBy: personActor("p-1"),
        now: now(0),
        audit: auditInput(personActor("boss"), "onboarding complete"),
      }),
    );
    okOf(
      k.identity.endMembership(s, {
        membershipId: "m-1",
        endedBy: personActor("p-1"),
        now: now(5),
        audit: auditInput(personActor("boss"), "rotation"),
      }),
    );
    const grants = k.audit.queryAudit(s, { subject: { kind: "person", id: "p-1" } });
    expect(grants.map((entry) => entry.action)).toEqual(["membership.granted", "membership.ended"]);
  });
});
