/**
 * P001 evidence area proof: the PG event log and observation ledger round-trip
 * with semantics identical to the in-memory reference — same records
 * (including the retraction-derived record values), same validation issues,
 * same conflict/not-found discipline, same audit side-effects — and every
 * table in the area is append-only by database trigger (retraction is an
 * appended fact, not an update).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RecordEventInput, RecordObservationInput, RetractEvidenceInput } from "@aurum/domain";
import {
  createPgEventLog,
  createPgEvidenceLedger,
} from "../src/domain-storage/adapters/evidence-store.js";
import { createPgAuditTrail } from "../src/domain-storage/adapters/audit-store.js";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import {
  auditInput,
  errOf,
  expectSameResult,
  memoryKernel,
  now,
  okOf,
  personActor,
  pgHarness,
  provenance,
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

const subject = { kind: "site" as const, id: "site-1" };
const otherSubject = { kind: "person" as const, id: "p-2" };

function eventInput(overrides: Record<string, unknown> = {}): RecordEventInput {
  return {
    eventId: "e-1",
    kind: "delivery.completed",
    summary: "shipment arrived",
    occurredAt: now(10),
    provenance: provenance(systemActor("wms"), 12),
    subjects: [subject],
    payload: { boxes: 3 },
    ...overrides,
  };
}

function observationInput(overrides: Record<string, unknown> = {}): RecordObservationInput {
  return {
    observationId: "obs-1",
    eventId: "e-1",
    subject,
    content: "site-1 reports 3 boxes delivered",
    observedAt: now(11),
    provenance: provenance(personActor("p-1"), 12),
    freshness: { asOf: now(11) },
    ...overrides,
  };
}

function retraction(reason = "double-counted", atSeconds = 30): RetractEvidenceInput {
  return { reason, now: now(atSeconds), audit: auditInput(personActor("p-9"), "retracting") };
}

describe("PG event log equivalence with the in-memory reference", () => {
  it("round-trips events with identical records", async () => {
    const local = await pgHarness();
    try {
      const pgEvents = createPgEventLog(local.sql);
      const memory = memoryKernel();
      const s = scope("events-equivalence");

      const commands: readonly RecordEventInput[] = [
        eventInput(),
        eventInput({ eventId: "e-2", payload: undefined, subjects: [] }),
        eventInput({ eventId: "e-3", kind: "alert.raised", payload: [1, 2, { ok: true }] }),
      ];
      for (const command of commands) {
        expectSameResult(
          await pgEvents.recordEvent(s, command),
          memory.events.recordEvent(s, command),
        );
      }
      for (const eventId of ["e-1", "e-2", "e-3", "missing"]) {
        expectSameResult(await pgEvents.getEvent(s, eventId), memory.events.getEvent(s, eventId));
      }
      expectSameResult(
        await pgEvents.recordEvent(s, eventInput()),
        memory.events.recordEvent(s, eventInput()),
      );
    } finally {
      await local.close();
    }
  });

  it("mirrors event validation issue-for-issue (conflict precedes payload)", async () => {
    const local = await pgHarness();
    try {
      const pgEvents = createPgEventLog(local.sql);
      const memory = memoryKernel();
      const s = scope("events-validation");

      const invalid: readonly Record<string, unknown>[] = [
        { eventId: "" },
        { kind: "  " },
        { kind: "x".repeat(121) },
        { summary: "" },
        { occurredAt: -1 },
        { provenance: undefined },
        { provenance: provenance(personActor("p-1"), 5), occurredAt: now(10) },
        { subjects: [{ kind: "warp", id: "x" }] },
        { subjects: [{ kind: "site", id: "  " }] },
      ];
      for (const overrides of invalid) {
        const input = eventInput(overrides);
        expectSameResult(await pgEvents.recordEvent(s, input), memory.events.recordEvent(s, input));
      }
      // A duplicate with a non-JSON payload conflicts (in-memory check order).
      okOf(memory.events.recordEvent(s, eventInput()));
      okOf(await pgEvents.recordEvent(s, eventInput()));
      const duplicate = eventInput({ payload: new Date(0) });
      expectSameResult(
        await pgEvents.recordEvent(s, duplicate),
        memory.events.recordEvent(s, duplicate),
      );
    } finally {
      await local.close();
    }
  });
});

describe("PG observation ledger equivalence with the in-memory reference", () => {
  it("round-trips records, listing and retraction-derived values", async () => {
    const local = await pgHarness();
    try {
      const pgObs = createPgEvidenceLedger(local.sql);
      const memory = memoryKernel();
      const s = scope("obs-equivalence");

      const commands: readonly RecordObservationInput[] = [
        observationInput(),
        observationInput({ observationId: "obs-2", subject: otherSubject, eventId: undefined }),
        observationInput({
          observationId: "obs-3",
          subject: otherSubject,
          freshness: { validUntil: now(50) },
        }),
        observationInput({ observationId: "obs-4", subject, freshness: undefined }),
        observationInput({ observationId: "obs-5", subject, eventId: "e-x" }),
      ];
      for (const command of commands) {
        expectSameResult(
          await pgObs.recordObservation(s, command),
          memory.evidence.recordObservation(s, command),
        );
      }
      for (const observationId of ["obs-1", "obs-2", "obs-5", "missing"]) {
        expectSameResult(
          await pgObs.getObservation(s, observationId),
          memory.evidence.getObservation(s, observationId),
        );
      }
      expect(await pgObs.listObservations(s, subject)).toEqual(
        memory.evidence.listObservations(s, subject),
      );
      expect(await pgObs.listObservations(s, otherSubject)).toEqual(
        memory.evidence.listObservations(s, otherSubject),
      );

      // Retraction: same derived record, same audit, same double-retract conflict.
      expectSameResult(
        await pgObs.retractObservation(s, "obs-1", retraction()),
        memory.evidence.retractObservation(s, "obs-1", retraction()),
      );
      expectSameResult(
        await pgObs.getObservation(s, "obs-1"),
        memory.evidence.getObservation(s, "obs-1"),
      );
      expect(await pgObs.listObservations(s, subject)).toEqual(
        memory.evidence.listObservations(s, subject),
      );
      expectSameResult(
        await pgObs.retractObservation(s, "obs-1", retraction("again")),
        memory.evidence.retractObservation(s, "obs-1", retraction("again")),
      );
      expectSameResult(
        await pgObs.retractObservation(s, "missing", retraction()),
        memory.evidence.retractObservation(s, "missing", retraction()),
      );
    } finally {
      await local.close();
    }
  });

  it("mirrors observation validation and conflict discipline issue-for-issue", async () => {
    const local = await pgHarness();
    try {
      const pgObs = createPgEvidenceLedger(local.sql);
      const memory = memoryKernel();
      const s = scope("obs-validation");

      const invalid: readonly Record<string, unknown>[] = [
        { observationId: "" },
        { subject: { kind: "warp", id: "x" } },
        { subject: { kind: "site", id: " " } },
        { content: "" },
        { observedAt: -3 },
        { eventId: "  " },
        { provenance: undefined },
        { freshness: { asOf: -1 } },
        { freshness: { validUntil: "soon" } },
      ];
      for (const overrides of invalid) {
        const input = observationInput(overrides);
        expectSameResult(
          await pgObs.recordObservation(s, input),
          memory.evidence.recordObservation(s, input),
        );
      }
      const seed = observationInput();
      okOf(await pgObs.recordObservation(s, seed));
      okOf(memory.evidence.recordObservation(s, seed));
      expectSameResult(
        await pgObs.recordObservation(s, observationInput()),
        memory.evidence.recordObservation(s, observationInput()),
      );
      const badRetract = retraction("  ");
      expectSameResult(
        await pgObs.retractObservation(s, "obs-1", badRetract),
        memory.evidence.retractObservation(s, "obs-1", badRetract),
      );
      const badRetractNow = { ...retraction(), now: -1 } as RetractEvidenceInput;
      expectSameResult(
        await pgObs.retractObservation(s, "obs-1", badRetractNow),
        memory.evidence.retractObservation(s, "obs-1", badRetractNow),
      );
    } finally {
      await local.close();
    }
  });

  it("appends matching audit entries for retractions", async () => {
    const local = await pgHarness();
    try {
      const pgObs = createPgEvidenceLedger(local.sql);
      const pgAudit = createPgAuditTrail(local.sql);
      const memory = memoryKernel();
      const s = scope("obs-audit");

      okOf(await pgObs.recordObservation(s, observationInput()));
      okOf(memory.evidence.recordObservation(s, observationInput()));
      okOf(await pgObs.retractObservation(s, "obs-1", retraction()));
      okOf(memory.evidence.retractObservation(s, "obs-1", retraction()));
      expect(await pgAudit.queryAudit(s, {})).toEqual(memory.audit.queryAudit(s, {}));
    } finally {
      await local.close();
    }
  });

  it("keeps tenant isolation uniform (foreign reads indistinguishable)", async () => {
    const local = await pgHarness();
    try {
      const pgObs = createPgEvidenceLedger(local.sql);
      const pgEvents = createPgEventLog(local.sql);
      const s = scope("obs-owner");
      const foreign = scope("obs-foreign");

      okOf(await pgObs.recordObservation(s, observationInput()));
      okOf(await pgEvents.recordEvent(s, eventInput()));

      const foreignObs = errOf(await pgObs.getObservation(foreign, "obs-1"));
      const missingObs = errOf(await pgObs.getObservation(s, "missing"));
      expect(foreignObs.message).toBe(missingObs.message);
      expect(foreignObs.message).toBe("observation not found");

      const foreignEvent = errOf(await pgEvents.getEvent(foreign, "e-1"));
      const missingEvent = errOf(await pgEvents.getEvent(s, "missing"));
      expect(foreignEvent.message).toBe(missingEvent.message);
      expect(foreignEvent.message).toBe("event not found");

      expect(await pgObs.listObservations(foreign, subject)).toEqual([]);
      expectSameResult(
        await pgObs.retractObservation(foreign, "obs-1", retraction()),
        memoryKernel().evidence.retractObservation(scope("nobody"), "obs-1", retraction()),
      );
      // The owner's record is untouched by the foreign retraction attempt.
      const record = okOf(await pgObs.getObservation(s, "obs-1"));
      expect(record.status).toBe("active");
    } finally {
      await local.close();
    }
  });
});

describe("PG evidence database enforcement", () => {
  it("rejects UPDATE and DELETE on events and observations (append-only)", async () => {
    const pgEvents = createPgEventLog(harness.sql);
    const pgObs = createPgEvidenceLedger(harness.sql);
    const s = scope("evidence-immutable");
    const event = okOf(await pgEvents.recordEvent(s, eventInput()));
    const observation = okOf(await pgObs.recordObservation(s, observationInput()));
    okOf(await pgObs.retractObservation(s, "obs-1", retraction()));

    await expect(
      harness.sql`update domain_events set summary = 'tampered' where tenant_id = ${s.tenantId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.sql`delete from domain_events where tenant_id = ${s.tenantId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.sql`update domain_observations set record = jsonb_build_object('content', 'tampered') where tenant_id = ${s.tenantId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.sql`delete from domain_observations where tenant_id = ${s.tenantId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.sql`update domain_observation_retractions set reason = 'forged' where tenant_id = ${s.tenantId}`,
    ).rejects.toThrow(/append-only/);

    expect(okOf(await pgEvents.getEvent(s, "e-1"))).toEqual(event);
    const retracted = okOf(await pgObs.getObservation(s, "obs-1"));
    expect(retracted.status).toBe("retracted");
    expect(retracted.content).toBe(observation.content);
    expect(retracted.subject).toEqual(observation.subject);
    expect(retracted.retractedAt).toBe(now(30));
    expect(retracted.retractedBy).toEqual(personActor("p-9"));
  });

  it("rejects a second retraction row (one-way transition by primary key)", async () => {
    const pgObs = createPgEvidenceLedger(harness.sql);
    const s = scope("evidence-one-retraction");
    okOf(await pgObs.recordObservation(s, observationInput()));
    okOf(await pgObs.retractObservation(s, "obs-1", retraction()));
    await expect(
      harness.sql`
        insert into domain_observation_retractions
          (tenant_id, observation_id, retracted_at, retracted_by, reason)
        values (${s.tenantId}, 'obs-1', ${now(40)}, ${harness.sql.json(personActor("p-evil"))}, 'forged')
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("journeys every evidence mutation through the write journal", async () => {
    const pgEvents = createPgEventLog(harness.sql);
    const pgObs = createPgEvidenceLedger(harness.sql);
    const s = scope("evidence-journal");
    await pgEvents.recordEvent(s, eventInput());
    await pgObs.recordObservation(s, observationInput());
    await pgObs.retractObservation(s, "obs-1", retraction());
    const rows = (await listJournal(harness.sql, s.tenantId)).filter(
      (row) => row.area === "evidence",
    );
    expect(rows.map((row) => row.journalKey)).toEqual([
      "evidence:record-event:e-1",
      "evidence:record-observation:obs-1",
      "evidence:retract-observation:obs-1",
    ]);
  });
});
