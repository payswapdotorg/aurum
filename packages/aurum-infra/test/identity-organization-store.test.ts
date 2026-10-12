/**
 * P001 identity + organization area proofs: the PG directories round-trip with
 * semantics identical to the in-memory reference — people/membership records
 * (with the ended-state derived from the appended end fact), rolesOf timing,
 * organizations/sites/units (conflict-before-existence order, self-parenting
 * as a cycle, foreign-tenant parents uniformly not-found, cycle rejection),
 * snapshots, audit side-effects — and every table is append-only by trigger.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  EndMembershipInput,
  GrantMembershipInput,
  RegisterOrganizationInput,
  RegisterPersonInput,
  RegisterSiteInput,
  RegisterUnitInput,
} from "@aurum/domain";
import { createPgIdentityDirectory } from "../src/domain-storage/adapters/identity-store.js";
import { createPgOrganizationDirectory } from "../src/domain-storage/adapters/organization-store.js";
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

function personInput(overrides: Record<string, unknown> = {}): RegisterPersonInput {
  return {
    personId: "p-1",
    displayName: "Ada",
    labels: ["employee"],
    provenance: systemActor("seed"),
    now: now(0),
    ...overrides,
  } as RegisterPersonInput;
}

function membershipInput(overrides: Record<string, unknown> = {}): GrantMembershipInput {
  return {
    membershipId: "ms-1",
    personId: "p-1",
    organizationId: "org-1",
    roles: ["approver"],
    grantedBy: personActor("p-admin"),
    now: now(1),
    audit: auditInput(personActor("p-admin"), "grant"),
    ...overrides,
  } as GrantMembershipInput;
}

function organizationInput(overrides: Record<string, unknown> = {}): RegisterOrganizationInput {
  return {
    organizationId: "org-1",
    name: "Acme",
    provenance: systemActor("seed"),
    now: now(0),
    audit: auditInput(personActor("p-admin"), "register"),
    ...overrides,
  } as RegisterOrganizationInput;
}

describe("PG identity directory equivalence with the in-memory reference", () => {
  it("round-trips people, memberships, ends and derived roles", async () => {
    const local = await pgHarness();
    try {
      const pgIdentity = createPgIdentityDirectory(local.sql);
      const memory = memoryKernel();
      const s = scope("identity-equivalence");

      const people: readonly RegisterPersonInput[] = [
        personInput(),
        personInput({ personId: "p-2", labels: ["contractor", "manager"] }),
        personInput({ personId: "p-3", externalRef: "hr-3" }),
      ];
      for (const command of people) {
        expectSameResult(
          await pgIdentity.registerPerson(s, command),
          memory.identity.registerPerson(s, command),
        );
      }
      // Memberships across people, orgs and units (deferred until the org
      // exists on both sides is unnecessary — membership does not check it).
      const memberships: readonly GrantMembershipInput[] = [
        membershipInput(),
        membershipInput({ membershipId: "ms-2", personId: "p-2", roles: ["owner", "member"] }),
        membershipInput({ membershipId: "ms-3", personId: "p-1", unitId: "u-1" }),
      ];
      for (const command of memberships) {
        expectSameResult(
          await pgIdentity.grantMembership(s, command),
          memory.identity.grantMembership(s, command),
        );
      }
      const end: EndMembershipInput = {
        membershipId: "ms-2",
        endedBy: personActor("p-admin"),
        now: now(10),
        audit: auditInput(personActor("p-admin"), "leave", 10),
      };
      expectSameResult(
        await pgIdentity.endMembership(s, end),
        memory.identity.endMembership(s, end),
      );

      for (const personId of ["p-1", "p-2", "p-3", "missing"]) {
        expectSameResult(
          await pgIdentity.getPerson(s, personId),
          memory.identity.getPerson(s, personId),
        );
      }
      expect(await pgIdentity.listPeople(s)).toEqual(memory.identity.listPeople(s));
      expect(await pgIdentity.listMemberships(s)).toEqual(memory.identity.listMemberships(s));
      for (const at of [now(0), now(2), now(5), now(11)]) {
        for (const personId of ["p-1", "p-2", "p-3", "missing"]) {
          expect(await pgIdentity.rolesOf(s, personId, at)).toEqual(
            memory.identity.rolesOf(s, personId, at),
          );
        }
      }
    } finally {
      await local.close();
    }
  });

  it("mirrors validation failures issue-for-issue", async () => {
    const local = await pgHarness();
    try {
      const pgIdentity = createPgIdentityDirectory(local.sql);
      const memory = memoryKernel();
      const s = scope("identity-validation");

      const badPeople: readonly Record<string, unknown>[] = [
        { displayName: "  " },
        { labels: [] },
        { labels: ["employee", "wizard"] },
        { labels: ["employee", "employee"] },
        { provenance: undefined },
        { provenance: { kind: "person" } },
        { now: -1 },
        { externalRef: "bad\u0007ref" },
      ];
      for (const overrides of badPeople) {
        const input = personInput(overrides);
        expectSameResult(
          await pgIdentity.registerPerson(s, input),
          memory.identity.registerPerson(s, input),
        );
      }
      const badId = personInput({ personId: "p 1x" });
      expectSameResult(
        await pgIdentity.registerPerson(s, badId),
        memory.identity.registerPerson(s, badId),
      );

      okOf(await pgIdentity.registerPerson(s, personInput()));
      okOf(memory.identity.registerPerson(s, personInput()));
      const badMemberships: readonly Record<string, unknown>[] = [
        { roles: [] },
        { roles: ["approver", "wizard"] },
        { roles: ["approver", "approver"] },
        { grantedBy: undefined },
        { grantedBy: { kind: "person" } },
        { now: -1 },
        { audit: { ...auditInput(personActor("p-1"), "why"), reason: "" } },
        { membershipId: "ms 1x" },
        { personId: "nope" },
      ];
      for (const overrides of badMemberships) {
        const input = membershipInput(overrides);
        expectSameResult(
          await pgIdentity.grantMembership(s, input),
          memory.identity.grantMembership(s, input),
        );
      }
      const badEnd: EndMembershipInput = {
        membershipId: "ms-1",
        endedBy: undefined as never,
        now: now(5),
        audit: auditInput(personActor("p-admin"), "leave"),
      };
      expectSameResult(
        await pgIdentity.endMembership(s, badEnd),
        memory.identity.endMembership(s, badEnd),
      );
      // Only the valid commands may have written: the two people ("p 1x" is
      // a legal opaque id — space is not a control character) and the one
      // membership granted under the equally legal "ms 1x" id.
      expect(await pgIdentity.listPeople(s)).toEqual(memory.identity.listPeople(s));
      expect(
        (await listJournal(local.sql, s.tenantId))
          .filter((row) => row.area === "identity")
          .map((row) => row.journalKey),
      ).toEqual([
        "identity:register-person:p 1x",
        "identity:register-person:p-1",
        "identity:grant-membership:ms 1x",
      ]);
    } finally {
      await local.close();
    }
  });

  it("mirrors conflict/not-found discipline incl. foreign tenants and audit", async () => {
    const local = await pgHarness();
    try {
      const pgIdentity = createPgIdentityDirectory(local.sql);
      const pgAudit = createPgAuditTrail(local.sql);
      const memory = memoryKernel();
      const s = scope("identity-conflict");
      const foreign = scope("identity-foreign");

      okOf(await pgIdentity.registerPerson(s, personInput()));
      okOf(memory.identity.registerPerson(s, personInput()));
      expectSameResult(
        await pgIdentity.registerPerson(s, personInput()),
        memory.identity.registerPerson(s, personInput()),
      );
      // Membership conflict is reported before person existence: duplicate
      // membership id AND missing person — the conflict wins on both kernels.
      okOf(await pgIdentity.grantMembership(s, membershipInput()));
      okOf(memory.identity.grantMembership(s, membershipInput()));
      expectSameResult(
        await pgIdentity.grantMembership(s, membershipInput({ personId: "ghost" })),
        memory.identity.grantMembership(s, membershipInput({ personId: "ghost" })),
      );
      // A fresh membership id for a missing person is uniformly not-found.
      expect(
        errOf(
          await pgIdentity.grantMembership(
            s,
            membershipInput({ membershipId: "ms-x", personId: "ghost" }),
          ),
        ).message,
      ).toBe("person not found");
      expectSameResult(
        await pgIdentity.grantMembership(s, membershipInput()),
        memory.identity.grantMembership(s, membershipInput()),
      );
      const end: EndMembershipInput = {
        membershipId: "ms-1",
        endedBy: personActor("p-admin"),
        now: now(9),
        audit: auditInput(personActor("p-admin"), "leave", 9),
      };
      okOf(await pgIdentity.endMembership(s, end));
      okOf(memory.identity.endMembership(s, end));
      expectSameResult(
        await pgIdentity.endMembership(s, end),
        memory.identity.endMembership(s, end),
      );
      expectSameResult(
        await pgIdentity.endMembership(s, { ...end, membershipId: "nope" }),
        memory.identity.endMembership(s, { ...end, membershipId: "nope" }),
      );

      // Foreign-tenant reads are indistinguishable from missing.
      const foreignRead = errOf(await pgIdentity.getPerson(foreign, "p-1"));
      const missingRead = errOf(await pgIdentity.getPerson(s, "missing"));
      expect(foreignRead.message).toBe(missingRead.message);
      expect(foreignRead.message).toBe("person not found");
      expect(await pgIdentity.listPeople(foreign)).toEqual([]);
      expect(await pgIdentity.listMemberships(foreign)).toEqual([]);
      expect(await pgIdentity.rolesOf(foreign, "p-1", now(5))).toEqual([]);
      // The same person id may exist independently in another tenant.
      expectSameResult(
        await pgIdentity.registerPerson(foreign, personInput({ labels: ["consultant"] })),
        memory.identity.registerPerson(foreign, personInput({ labels: ["consultant"] })),
      );

      // Audit equivalence: membership.granted then membership.ended.
      expect(await pgAudit.queryAudit(s, {})).toEqual(memory.audit.queryAudit(s, {}));
    } finally {
      await local.close();
    }
  });
});

describe("PG organization directory equivalence with the in-memory reference", () => {
  it("round-trips organizations, sites, units and snapshots (incl. cycles)", async () => {
    const local = await pgHarness();
    try {
      const pgOrg = createPgOrganizationDirectory(local.sql);
      const memory = memoryKernel();
      const s = scope("org-equivalence");

      expectSameResult(
        await pgOrg.registerOrganization(s, organizationInput()),
        memory.organization.registerOrganization(s, organizationInput()),
      );
      const sites: readonly RegisterSiteInput[] = [
        {
          siteId: "site-1",
          organizationId: "org-1",
          name: "HQ",
          provenance: systemActor("seed"),
          now: now(1),
          audit: auditInput(personActor("p-admin"), "site", 1),
        },
        {
          siteId: "site-2",
          organizationId: "org-1",
          name: "Lab",
          provenance: systemActor("seed"),
          now: now(2),
          audit: auditInput(personActor("p-admin"), "site", 2),
        },
      ];
      for (const command of sites) {
        expectSameResult(
          await pgOrg.registerSite(s, command),
          memory.organization.registerSite(s, command),
        );
      }
      const units: readonly RegisterUnitInput[] = [
        {
          unitId: "u-root",
          organizationId: "org-1",
          name: "root",
          provenance: systemActor("seed"),
          now: now(3),
          audit: auditInput(personActor("p-admin"), "unit", 3),
        },
        {
          unitId: "u-child",
          organizationId: "org-1",
          parentUnitId: "u-root",
          name: "child",
          provenance: systemActor("seed"),
          now: now(4),
          audit: auditInput(personActor("p-admin"), "unit", 4),
        },
        {
          unitId: "u-grand",
          organizationId: "org-1",
          parentUnitId: "u-child",
          name: "grand",
          provenance: systemActor("seed"),
          now: now(5),
          audit: auditInput(personActor("p-admin"), "unit", 5),
        },
      ];
      for (const command of units) {
        expectSameResult(
          await pgOrg.registerUnit(s, command),
          memory.organization.registerUnit(s, command),
        );
      }
      for (const id of ["org-1", "missing"]) {
        expectSameResult(
          await pgOrg.getOrganization(s, id),
          memory.organization.getOrganization(s, id),
        );
        expectSameResult(
          await pgOrg.describeOrganization(s, id),
          memory.organization.describeOrganization(s, id),
        );
      }
      for (const id of ["site-1", "site-2", "missing"]) {
        expectSameResult(await pgOrg.getSite(s, id), memory.organization.getSite(s, id));
      }
      for (const id of ["u-root", "u-child", "u-grand", "missing"]) {
        expectSameResult(await pgOrg.getUnit(s, id), memory.organization.getUnit(s, id));
      }

      // Cycle discipline: self-parenting, missing parent, and a real cycle.
      const selfParent: RegisterUnitInput = {
        unitId: "u-self",
        organizationId: "org-1",
        parentUnitId: "u-self",
        name: "self",
        provenance: systemActor("seed"),
        now: now(6),
        audit: auditInput(personActor("p-admin"), "unit", 6),
      };
      expectSameResult(
        await pgOrg.registerUnit(s, selfParent),
        memory.organization.registerUnit(s, selfParent),
      );
      const missingParent: RegisterUnitInput = {
        unitId: "u-orphan",
        organizationId: "org-1",
        parentUnitId: "u-ghost",
        name: "orphan",
        provenance: systemActor("seed"),
        now: now(7),
        audit: auditInput(personActor("p-admin"), "unit", 7),
      };
      expectSameResult(
        await pgOrg.registerUnit(s, missingParent),
        memory.organization.registerUnit(s, missingParent),
      );
      const cycle: RegisterUnitInput = {
        unitId: "u-root",
        organizationId: "org-1",
        parentUnitId: "u-grand",
        name: "rewired",
        provenance: systemActor("seed"),
        now: now(8),
        audit: auditInput(personActor("p-admin"), "unit", 8),
      };
      expectSameResult(
        await pgOrg.registerUnit(s, cycle),
        memory.organization.registerUnit(s, cycle),
      );
    } finally {
      await local.close();
    }
  });

  it("mirrors validation failures and tenant isolation issue-for-issue", async () => {
    const local = await pgHarness();
    try {
      const pgOrg = createPgOrganizationDirectory(local.sql);
      const memory = memoryKernel();
      const s = scope("org-validation");
      const foreign = scope("org-foreign");

      const badOrgs: readonly Record<string, unknown>[] = [
        { name: "  " },
        { provenance: undefined },
        { now: -1 },
        { audit: { ...auditInput(personActor("p-1"), "why"), reason: "" } },
        { organizationId: "org 1x" },
      ];
      for (const overrides of badOrgs) {
        const input = organizationInput(overrides);
        expectSameResult(
          await pgOrg.registerOrganization(s, input),
          memory.organization.registerOrganization(s, input),
        );
      }
      okOf(await pgOrg.registerOrganization(s, organizationInput()));
      okOf(memory.organization.registerOrganization(s, organizationInput()));

      const badSites: readonly Record<string, unknown>[] = [
        { organizationId: "nope" },
        { name: "" },
        { siteId: "site 1x" },
      ];
      for (const overrides of badSites) {
        const input = {
          siteId: "site-1",
          organizationId: "org-1",
          name: "HQ",
          provenance: systemActor("seed"),
          now: now(1),
          audit: auditInput(personActor("p-admin"), "site", 1),
          ...overrides,
        } as RegisterSiteInput;
        expectSameResult(
          await pgOrg.registerSite(s, input),
          memory.organization.registerSite(s, input),
        );
      }
      const badUnits: readonly Record<string, unknown>[] = [
        { organizationId: "nope" },
        { name: "" },
        { parentUnitId: "  " },
      ];
      for (const overrides of badUnits) {
        const input = {
          unitId: "u-1",
          organizationId: "org-1",
          name: "unit",
          provenance: systemActor("seed"),
          now: now(2),
          audit: auditInput(personActor("p-admin"), "unit", 2),
          ...overrides,
        } as RegisterUnitInput;
        expectSameResult(
          await pgOrg.registerUnit(s, input),
          memory.organization.registerUnit(s, input),
        );
      }

      // Foreign-tenant reads are indistinguishable from missing, and a
      // foreign organization cannot serve as a parent (uniform not-found).
      okOf(
        await pgOrg.registerOrganization(
          foreign,
          organizationInput({ organizationId: "org-2", name: "Globex" }),
        ),
      );
      const foreignRead = errOf(await pgOrg.getOrganization(foreign, "org-1"));
      const missingRead = errOf(await pgOrg.getOrganization(s, "missing"));
      expect(foreignRead.message).toBe(missingRead.message);
      expect(foreignRead.message).toBe("organization not found");
      const foreignUnit: RegisterUnitInput = {
        unitId: "u-f",
        organizationId: "org-1",
        parentUnitId: "u-ghost",
        name: "foreign",
        provenance: systemActor("seed"),
        now: now(3),
        audit: auditInput(personActor("p-admin"), "unit", 3),
      };
      expectSameResult(
        await pgOrg.registerUnit(foreign, foreignUnit),
        memory.organization.registerUnit(foreign, foreignUnit),
      );
      expect(
        (await listJournal(local.sql, s.tenantId))
          .filter((row) => row.area === "organization")
          .map((row) => row.journalKey),
      ).toEqual([
        "organization:register-organization:org 1x",
        "organization:register-organization:org-1",
        "organization:register-site:site 1x",
        "organization:register-unit:u-1",
      ]);
    } finally {
      await local.close();
    }
  });
});

describe("PG identity + organization database enforcement", () => {
  it("rejects UPDATE and DELETE on every table (append-only)", async () => {
    const pgIdentity = createPgIdentityDirectory(harness.sql);
    const pgOrg = createPgOrganizationDirectory(harness.sql);
    const s = scope("identity-org-immutable");
    okOf(await pgIdentity.registerPerson(s, personInput()));
    okOf(await pgOrg.registerOrganization(s, organizationInput()));
    okOf(
      await pgOrg.registerSite(s, {
        siteId: "site-1",
        organizationId: "org-1",
        name: "HQ",
        provenance: systemActor("seed"),
        now: now(1),
        audit: auditInput(personActor("p-admin"), "site", 1),
      }),
    );
    okOf(
      await pgOrg.registerUnit(s, {
        unitId: "u-1",
        organizationId: "org-1",
        name: "unit",
        provenance: systemActor("seed"),
        now: now(2),
        audit: auditInput(personActor("p-admin"), "unit", 2),
      }),
    );
    okOf(await pgIdentity.grantMembership(s, membershipInput()));
    okOf(
      await pgIdentity.endMembership(s, {
        membershipId: "ms-1",
        endedBy: personActor("p-admin"),
        now: now(9),
        audit: auditInput(personActor("p-admin"), "leave", 9),
      }),
    );
    for (const table of [
      "domain_people",
      "domain_memberships",
      "domain_membership_ends",
      "domain_organizations",
      "domain_sites",
      "domain_units",
    ]) {
      await expect(
        harness.sql.unsafe(
          `update ${table} set tenant_id = tenant_id where tenant_id = '${s.tenantId}'`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        harness.sql.unsafe(`delete from ${table} where tenant_id = '${s.tenantId}'`),
      ).rejects.toThrow(/append-only/);
    }
    // The records survived untouched, ends included.
    const memberships = await pgIdentity.listMemberships(s);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.status).toBe("ended");
  });

  it("journeys every mutation through the write journal with stable keys", async () => {
    const pgIdentity = createPgIdentityDirectory(harness.sql);
    const pgOrg = createPgOrganizationDirectory(harness.sql);
    const s = scope("identity-org-journal");
    okOf(await pgIdentity.registerPerson(s, personInput({ personId: "p-9" })));
    okOf(await pgIdentity.grantMembership(s, membershipInput({ personId: "p-9" })));
    okOf(
      await pgIdentity.endMembership(s, {
        membershipId: "ms-1",
        endedBy: personActor("p-admin"),
        now: now(9),
        audit: auditInput(personActor("p-admin"), "leave", 9),
      }),
    );
    okOf(await pgOrg.registerOrganization(s, organizationInput()));
    okOf(
      await pgOrg.registerSite(s, {
        siteId: "site-1",
        organizationId: "org-1",
        name: "HQ",
        provenance: systemActor("seed"),
        now: now(1),
        audit: auditInput(personActor("p-admin"), "site", 1),
      }),
    );
    okOf(
      await pgOrg.registerUnit(s, {
        unitId: "u-1",
        organizationId: "org-1",
        name: "unit",
        provenance: systemActor("seed"),
        now: now(2),
        audit: auditInput(personActor("p-admin"), "unit", 2),
      }),
    );
    const rows = await listJournal(harness.sql, s.tenantId);
    expect(
      rows
        .filter((row) => row.area === "identity" || row.area === "organization")
        .map((row) => row.journalKey),
    ).toEqual([
      "identity:register-person:p-9",
      "identity:grant-membership:ms-1",
      "identity:end-membership:ms-1",
      "organization:register-organization:org-1",
      "organization:register-site:site-1",
      "organization:register-unit:u-1",
    ]);
  });

  it("rejects duplicate registrations and second ends by primary key", async () => {
    const pgIdentity = createPgIdentityDirectory(harness.sql);
    const s = scope("identity-org-constraint");
    okOf(await pgIdentity.registerPerson(s, personInput({ personId: "p-1" })));
    okOf(await pgIdentity.grantMembership(s, membershipInput()));
    okOf(
      await pgIdentity.endMembership(s, {
        membershipId: "ms-1",
        endedBy: personActor("p-admin"),
        now: now(9),
        audit: auditInput(personActor("p-admin"), "leave", 9),
      }),
    );
    await expect(
      harness.sql`
        insert into domain_people (tenant_id, person_id, record)
        values (${s.tenantId}, 'p-1', '{}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      harness.sql`
        insert into domain_membership_ends (tenant_id, membership_id, ended_at, ended_by)
        values (${s.tenantId}, 'ms-1', 1, '{"kind": "system", "name": "x"}'::jsonb)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
    const memberships = await pgIdentity.listMemberships(s);
    expect(memberships[0]?.status).toBe("ended");
    expect(memberships[0]?.endedAt).toBe(now(9));
  });
});
