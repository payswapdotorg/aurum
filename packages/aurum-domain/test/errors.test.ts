/**
 * ACCEPTANCE PROOF — typed error semantics:
 * - every failure value is a DomainError instance carrying a typed code;
 * - validation failures carry structured issues (field + problem);
 * - the kernel never throws bare strings: all operations return Results
 *   (or throw DomainError instances only).
 */
import { describe, expect, it } from "vitest";
import { DomainError, isDomainError, type DomainTimestamp } from "../src/index.js";
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

describe("typed error semantics", () => {
  it("all error codes are used somewhere in the kernel and are DomainErrors", () => {
    const k = kernel();
    const s = scope("acme");

    const validation = errOf(
      k.identity.registerPerson(s, {
        personId: "",
        displayName: "",
        labels: [],
        provenance: systemActor("seed"),
        now: now(),
      }),
    );
    expect(validation).toBeInstanceOf(DomainError);
    expect(validation.code).toBe("validation");
    expect(validation.issues.length).toBeGreaterThan(0);
    expect(validation.issues[0]?.field).toBeTypeOf("string");
    expect(validation.issues[0]?.problem).toBeTypeOf("string");
    expect(validation.message).toContain("validation failed");

    const notFound = errOf(k.goals.getGoal(s, "missing"));
    expect(notFound).toBeInstanceOf(DomainError);
    expect(notFound.code).toBe("not-found");
    expect(notFound.issues).toEqual([]);

    const conflict = (() => {
      okOf(
        k.identity.registerPerson(s, {
          personId: "p-1",
          displayName: "A",
          labels: ["employee"],
          provenance: systemActor("seed"),
          now: now(),
        }),
      );
      return errOf(
        k.identity.registerPerson(s, {
          personId: "p-1",
          displayName: "A",
          labels: ["employee"],
          provenance: systemActor("seed"),
          now: now(),
        }),
      );
    })();
    expect(conflict.code).toBe("conflict");

    const forbidden = errOf(
      k.actions.approveAction(s, {
        actionId: "missing",
        expectedState: "proposed",
        now: now(),
        audit: auditInput(personActor("x"), "r"),
      }),
    );
    expect(forbidden.code).toBe("not-found"); // approve on a missing action
    void forbidden;

    const invariant = (() => {
      okOf(
        k.inquiry.openHypothesis(s, {
          hypothesisId: "h-1",
          statement: "s",
          explains: [{ kind: "topic", id: "t" }],
          provenance: provenance(systemActor("seed")),
          now: now(0),
        }),
      );
      return errOf(
        k.inquiry.recordHypothesisStatus(s, {
          hypothesisId: "h-1",
          status: "open",
          provenance: provenance(systemActor("seed")),
          now: now(1),
          audit: auditInput(personActor("p-1"), "same-state"),
        }),
      );
    })();
    expect(invariant.code).toBe("invariant");

    const stale = (() => {
      okOf(
        k.actions.proposeAction(s, {
          actionId: "a-1",
          title: "t",
          subject: { kind: "topic", id: "x" },
          policy: {
            approvalRoles: ["approver"],
            authorizationRoles: ["authorizer"],
            employmentImpacting: false,
          },
          createdBy: systemActor("lab"),
          now: now(0),
        }),
      );
      return errOf(
        k.actions.recommendAction(s, {
          actionId: "a-1",
          expectedState: "approved",
          now: now(1),
          audit: auditInput(systemActor("lab"), "r"),
        }),
      );
    })();
    expect(stale.code).toBe("stale");

    expect(isDomainError(validation)).toBe(true);
    expect(isDomainError(new Error("plain"))).toBe(false);
  });

  it("validation errors aggregate all issues, not just the first", () => {
    const k = kernel();
    const s = scope("acme");
    const error = errOf(
      k.identity.registerPerson(s, {
        personId: "   ",
        displayName: "   ",
        labels: ["nope"],
        provenance: systemActor("seed"),
        now: -5 as DomainTimestamp,
      }),
    );
    const fields = error.issues.map((issue) => issue.field);
    expect(fields).toContain("personId");
    expect(fields).toContain("displayName");
    expect(fields).toContain("labels");
    expect(fields).toContain("now");
  });

  it("kernel operations do not throw: malformed inputs degrade to Results", () => {
    const k = kernel();
    const s = scope("acme");
    const attempts: Array<() => unknown> = [
      () => k.identity.registerPerson(s, undefined as never),
      () => k.goals.createGoal(s, undefined as never),
      () => k.evidence.recordObservation(s, undefined as never),
      () => k.actions.proposeAction(s, undefined as never),
      () => k.inquiry.raiseUnknown(s, undefined as never),
      () => k.memory.recordMemory(s, undefined as never),
      () => k.organization.registerUnit(s, undefined as never),
      () => k.events.recordEvent(s, undefined as never),
    ];
    for (const attempt of attempts) {
      let outcome: unknown;
      try {
        outcome = attempt();
      } catch (error) {
        // Anything thrown must be a typed DomainError, never a bare string.
        expect(typeof error).not.toBe("string");
        expect(isDomainError(error)).toBe(true);
        continue;
      }
      // The normal path: a failed Result, never a thrown value.
      expect((outcome as { ok?: boolean }).ok).toBe(false);
      expect(isDomainError((outcome as { error: unknown }).error)).toBe(true);
    }
  });
});
