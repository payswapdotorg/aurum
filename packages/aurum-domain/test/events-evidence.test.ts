/**
 * Events and observations: recording what happened and the evidence
 * encountered, provenance requirements, payload validation, retraction as
 * an audited consequential transition.
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
import type { SubjectReference } from "../src/index.js";

describe("events", () => {
  it("records events with occurredAt <= recordedAt invariant", () => {
    const k = kernel();
    const s = scope("acme");
    const event = okOf(
      k.events.recordEvent(s, {
        eventId: "e-1",
        kind: "delivery.completed",
        summary: "Order 42 delivered",
        occurredAt: now(0),
        subjects: [{ kind: "topic", id: "order-42" }],
        payload: { orderId: 42, late: false },
        provenance: provenance(systemActor("logistics-api")),
      }),
    );
    expect(event.kind).toBe("delivery.completed");
    expect(event.occurredAt).toBe(now(0));
    expect(event.payload).toEqual({ orderId: 42, late: false });

    const future = k.events.recordEvent(s, {
      eventId: "e-2",
      kind: "delivery.completed",
      summary: "recorded before it happened",
      occurredAt: now(10),
      provenance: { actor: systemActor("x"), source: "system-captured", recordedAt: now(5) },
    });
    expect(errOf(future).code).toBe("validation");
    expect(errOf(future).issues.map((i) => i.field)).toContain("occurredAt");

    const badPayload = k.events.recordEvent(s, {
      eventId: "e-3",
      kind: "k",
      summary: "s",
      occurredAt: now(0),
      payload: () => 1,
      provenance: provenance(systemActor("x")),
    });
    expect(errOf(badPayload).code).toBe("validation");

    const duplicate = k.events.recordEvent(s, {
      eventId: "e-1",
      kind: "k",
      summary: "s",
      occurredAt: now(0),
      provenance: provenance(systemActor("x")),
    });
    expect(errOf(duplicate).code).toBe("conflict");
  });
});

describe("observations", () => {
  it("requires provenance and a typed subject", () => {
    const k = kernel();
    const s = scope("acme");
    const noProvenance = k.evidence.recordObservation(s, {
      observationId: "o-1",
      subject: { kind: "topic", id: "t" },
      content: "c",
      observedAt: now(),
      provenance: undefined as never,
    });
    expect(errOf(noProvenance).code).toBe("validation");
    expect(errOf(noProvenance).issues.map((i) => i.field)).toContain("provenance");

    const invalidSubject = { kind: "planet", id: "" } as unknown as SubjectReference;
    const badSubject = k.evidence.recordObservation(s, {
      observationId: "o-1",
      subject: invalidSubject,
      content: "c",
      observedAt: now(),
      provenance: provenance(systemActor("x")),
    });
    expect(errOf(badSubject).issues.map((i) => i.field)).toContain("subject");
  });

  it("lists observations per subject and retraction is audited + terminal", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.evidence.recordObservation(s, {
        observationId: "o-1",
        subject: { kind: "topic", id: "inventory" },
        content: "stock 5",
        observedAt: now(0),
        provenance: provenance(systemActor("erp")),
      }),
    );
    okOf(
      k.evidence.recordObservation(s, {
        observationId: "o-2",
        subject: { kind: "topic", id: "inventory" },
        content: "stock 6",
        observedAt: now(1),
        provenance: provenance(systemActor("erp")),
      }),
    );
    okOf(
      k.evidence.recordObservation(s, {
        observationId: "o-3",
        subject: { kind: "topic", id: "other" },
        content: "unrelated",
        observedAt: now(2),
        provenance: provenance(systemActor("erp")),
      }),
    );

    expect(k.evidence.listObservations(s, { kind: "topic", id: "inventory" })).toHaveLength(2);

    const retracted = okOf(
      k.evidence.retractObservation(s, "o-1", {
        reason: "duplicate sensor reading",
        now: now(5),
        audit: auditInput(personActor("p-1"), "sensor double-fired"),
      }),
    );
    expect(retracted.status).toBe("retracted");
    expect(retracted.retractedBy?.kind).toBe("person");

    const doubleRetract = k.evidence.retractObservation(s, "o-1", {
      reason: "again",
      now: now(6),
      audit: auditInput(personActor("p-1"), "again"),
    });
    expect(errOf(doubleRetract).code).toBe("conflict");

    const entries = k.audit.queryAudit(s, { subject: { kind: "observation", id: "o-1" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("observation.retracted");
    expect(entries[0]?.reason).toBe("sensor double-fired");
    expect(retracted.retractedAt).toBe(now(5));
  });

  it("observations can link to events", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.events.recordEvent(s, {
        eventId: "e-1",
        kind: "delivery.completed",
        summary: "Order 42 delivered",
        occurredAt: now(0),
        provenance: provenance(systemActor("logistics-api")),
      }),
    );
    const observation = okOf(
      k.evidence.recordObservation(s, {
        observationId: "o-1",
        eventId: "e-1",
        subject: { kind: "topic", id: "order-42" },
        content: "customer signed the delivery note",
        observedAt: now(0),
        provenance: provenance(systemActor("logistics-api")),
      }),
    );
    expect(observation.eventId).toBe("e-1" as never);
  });
});
