/**
 * Identity, memberships and the organization world model: people
 * registration, role grants/revocation, org/sites/units, parent validation
 * (uniform not-found for foreign-tenant parents) and cycle prevention.
 */
import { describe, expect, it } from "vitest";
import {
  activeRolesFor,
  isKnownRole,
  wouldCreateUnitCycle,
  type MembershipRecord,
} from "../src/index.js";
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

describe("identity", () => {
  it("registers people with typed labels and validates input", () => {
    const k = kernel();
    const s = scope("acme");
    const person = okOf(
      k.identity.registerPerson(s, {
        personId: "p-1",
        displayName: "Alice",
        labels: ["employee", "manager"],
        externalRef: "hr-1234",
        provenance: systemActor("hr-import"),
        now: now(),
      }),
    );
    expect(person.displayName).toBe("Alice");
    expect([...person.labels]).toEqual(["employee", "manager"]);

    const badLabel = k.identity.registerPerson(s, {
      personId: "p-2",
      displayName: "Bob",
      labels: ["wizard"],
      provenance: systemActor("seed"),
      now: now(),
    });
    expect(errOf(badLabel).code).toBe("validation");
    expect(errOf(badLabel).issues.map((i) => i.field)).toContain("labels");

    const duplicate = k.identity.registerPerson(s, {
      personId: "p-1",
      displayName: "Alice again",
      labels: ["employee"],
      provenance: systemActor("seed"),
      now: now(),
    });
    expect(errOf(duplicate).code).toBe("conflict");
  });

  it("grants and ends memberships with role validation and audit", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.identity.registerPerson(s, {
        personId: "p-1",
        displayName: "Alice",
        labels: ["employee"],
        provenance: systemActor("seed"),
        now: now(),
      }),
    );

    const badRole = k.identity.grantMembership(s, {
      membershipId: "m-1",
      personId: "p-1",
      organizationId: "org-1",
      roles: ["superuser"],
      grantedBy: personActor("p-1"),
      now: now(),
      audit: auditInput(personActor("p-1"), "grant"),
    });
    expect(errOf(badRole).code).toBe("validation");

    const unknownPerson = k.identity.grantMembership(s, {
      membershipId: "m-1",
      personId: "ghost",
      organizationId: "org-1",
      roles: ["member"],
      grantedBy: personActor("p-1"),
      now: now(),
      audit: auditInput(personActor("p-1"), "grant"),
    });
    expect(errOf(unknownPerson).code).toBe("not-found");

    const membership = okOf(
      k.identity.grantMembership(s, {
        membershipId: "m-1",
        personId: "p-1",
        organizationId: "org-1",
        roles: ["approver", "executor"],
        grantedBy: personActor("p-1"),
        now: now(0),
        audit: auditInput(personActor("boss"), "onboarding"),
      }),
    );
    expect(membership.status).toBe("active");
    expect(k.identity.rolesOf(s, "p-1", now(1))).toContain("approver");

    const ended = okOf(
      k.identity.endMembership(s, {
        membershipId: "m-1",
        endedBy: personActor("p-1"),
        now: now(2),
        audit: auditInput(personActor("boss"), "offboarding"),
      }),
    );
    expect(ended.status).toBe("ended");
    expect(k.identity.rolesOf(s, "p-1", now(3))).toHaveLength(0);

    const doubleEnd = k.identity.endMembership(s, {
      membershipId: "m-1",
      endedBy: personActor("p-1"),
      now: now(4),
      audit: auditInput(personActor("boss"), "again"),
    });
    expect(errOf(doubleEnd).code).toBe("conflict");
  });

  it("activeRolesFor respects grant/end times", () => {
    const memberships = [
      {
        personId: "p-1" as never,
        status: "active" as const,
        roles: Object.freeze(["approver"] as const),
        grantedAt: now(0),
        endedAt: undefined,
      },
      {
        personId: "p-2" as never,
        status: "ended" as const,
        roles: Object.freeze(["authorizer"] as const),
        grantedAt: now(0),
        endedAt: now(10),
      },
    ] as unknown as MembershipRecord[];
    expect(activeRolesFor("p-1" as never, memberships, now(5))).toEqual(["approver"]);
    expect(activeRolesFor("p-2" as never, memberships, now(5))).toEqual([]);
    expect(isKnownRole("approver")).toBe(true);
    expect(isKnownRole("wizard")).toBe(false);
  });
});

describe("organization world model", () => {
  it("registers organizations, sites and units; snapshots are complete", () => {
    const k = kernel();
    const s = scope("acme");
    const org = okOf(
      k.organization.registerOrganization(s, {
        organizationId: "org-1",
        name: "Acme GmbH",
        provenance: systemActor("seed"),
        now: now(),
        audit: auditInput(personActor("p-1"), "initial import"),
      }),
    );
    expect(org.name).toBe("Acme GmbH");

    const site = okOf(
      k.organization.registerSite(s, {
        siteId: "site-1",
        organizationId: "org-1",
        name: "Headquarters",
        provenance: systemActor("seed"),
        now: now(),
        audit: auditInput(personActor("p-1"), "import"),
      }),
    );
    expect(site.organizationId).toBe("org-1" as never);

    okOf(
      k.organization.registerUnit(s, {
        unitId: "u-1",
        organizationId: "org-1",
        name: "Operations",
        provenance: systemActor("seed"),
        now: now(),
        audit: auditInput(personActor("p-1"), "import"),
      }),
    );
    const sub = okOf(
      k.organization.registerUnit(s, {
        unitId: "u-2",
        organizationId: "org-1",
        parentUnitId: "u-1",
        name: "Logistics",
        provenance: systemActor("seed"),
        now: now(),
        audit: auditInput(personActor("p-1"), "import"),
      }),
    );
    expect(sub.parentUnitId).toBe("u-1" as never);

    const snapshot = okOf(k.organization.describeOrganization(s, "org-1"));
    expect(snapshot.sites.map((x) => x.siteId)).toEqual(["site-1" as never]);
    expect(snapshot.units.map((x) => x.unitId)).toEqual(["u-1" as never, "u-2" as never]);
  });

  it("units cannot attach to foreign-tenant parents (uniform not-found)", () => {
    const k = kernel();
    const acme = scope("acme");
    const globex = scope("globex");
    okOf(
      k.organization.registerOrganization(acme, {
        organizationId: "org-1",
        name: "Acme",
        provenance: systemActor("seed"),
        now: now(),
        audit: auditInput(personActor("p-1"), "import"),
      }),
    );
    okOf(
      k.organization.registerUnit(acme, {
        unitId: "u-1",
        organizationId: "org-1",
        name: "Ops",
        provenance: systemActor("seed"),
        now: now(),
        audit: auditInput(personActor("p-1"), "import"),
      }),
    );
    okOf(
      k.organization.registerOrganization(globex, {
        organizationId: "org-2",
        name: "Globex",
        provenance: systemActor("seed"),
        now: now(),
        audit: auditInput(personActor("p-1"), "import"),
      }),
    );
    const foreignParent = k.organization.registerUnit(globex, {
      unitId: "u-9",
      organizationId: "org-2",
      parentUnitId: "u-1",
      name: "Stolen",
      provenance: systemActor("seed"),
      now: now(),
      audit: auditInput(personActor("p-1"), "import"),
    });
    expect(errOf(foreignParent).code).toBe("not-found");
    expect(errOf(foreignParent).message).toBe("parent unit not found");
  });

  it("unit cycles are rejected", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.organization.registerOrganization(s, {
        organizationId: "org-1",
        name: "Acme",
        provenance: systemActor("seed"),
        now: now(),
        audit: auditInput(personActor("p-1"), "import"),
      }),
    );
    okOf(
      k.organization.registerUnit(s, {
        unitId: "u-1",
        organizationId: "org-1",
        name: "A",
        provenance: systemActor("seed"),
        now: now(),
        audit: auditInput(personActor("p-1"), "import"),
      }),
    );
    okOf(
      k.organization.registerUnit(s, {
        unitId: "u-2",
        organizationId: "org-1",
        parentUnitId: "u-1",
        name: "B",
        provenance: systemActor("seed"),
        now: now(),
        audit: auditInput(personActor("p-1"), "import"),
      }),
    );
    // Self-parenting is the registration-time cycle case.
    const selfParent = k.organization.registerUnit(s, {
      unitId: "u-4",
      organizationId: "org-1",
      parentUnitId: "u-4",
      name: "Self",
      provenance: systemActor("seed"),
      now: now(),
      audit: auditInput(personActor("p-1"), "import"),
    });
    expect(errOf(selfParent).code).toBe("conflict");
    expect(errOf(selfParent).message).toContain("cycle");
    // The pure detector recognizes re-parenting cycles for future move ops.
    const units = okOf(k.organization.describeOrganization(s, "org-1")).units;
    expect(wouldCreateUnitCycle("u-1" as never, "u-2" as never, units)).toBe(true);
    expect(wouldCreateUnitCycle("u-3" as never, "u-2" as never, units)).toBe(false);
  });
});
