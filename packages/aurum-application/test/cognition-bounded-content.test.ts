/**
 * W007 ACCEPTANCE CLAUSE 2 — "LLM supplies bounded content".
 *
 * Proofs:
 * - the reasoning boundary is a fixed, narrow schema: anything outside
 *   (extra fields, over-cap counts, oversized strings, invalid kinds) is
 *   refused with `mission-model-refused` and the mission stays resumable;
 * - ANTI-FABRICATION: findings may only cite observation ids that were in
 *   the bounded request — citing anything else (including retracted
 *   observations, which never enter the orientation) is refused;
 * - the REQUEST side is bounded too: capped observation digest, no domain
 *   records, explicit truncation counts;
 * - a port error propagates typed; re-advance re-invokes the port.
 */
import { describe, expect, it } from "vitest";
import type { ReasonedContent } from "../src/index.js";
import {
  cognitionFixture,
  createMissionInput,
  daysAgo,
  errOf,
  now,
  okOf,
  scope,
  seedObservation,
  standardContent,
  topic,
} from "./cognition-helpers.js";

function contentWith(overrides: Record<string, unknown>): ReasonedContent {
  return { ...standardContent(), ...overrides } as ReasonedContent;
}

async function runReasonStage(
  fx: ReturnType<typeof cognitionFixture>,
  s: ReturnType<typeof scope>,
): Promise<unknown> {
  seedObservation(fx.kernel, s, { observationId: "obs-1" });
  seedObservation(fx.kernel, s, { observationId: "obs-2" });
  okOf(fx.service.createMission(s, createMissionInput()));
  okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
  return fx.service.advance(s, "mission-1", { now: now(2) });
}

describe("cognition bounded content (catalog clause 2)", () => {
  it("accepts valid content and records request + content + model name on the stage", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    const mission = okOf(await fx.service.advance(s, "mission-1", { now: now(2) }));
    const reason = mission.stages[1];
    if (reason?.stage !== "reason") throw new Error("expected reason record");
    expect(reason.modelName).toBe("scripted-reasoner");
    expect(reason.content.summary).toContain("Invoice processing");
    expect(reason.request.observations.map((entry) => entry.observationId)).toEqual([
      "obs-1",
      "obs-2",
    ]);
    expect(fx.reasoner.calls.length).toBe(1);
  });

  it("refuses content carrying an extra top-level field (no control-flow channel)", async () => {
    const sneaky = contentWith({ stage: "record", authorize: true }) as unknown as {
      stage: string;
      authorize: boolean;
    };
    const fx = cognitionFixture([sneaky as unknown as ReasonedContent, standardContent()]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    const error = errOf(await fx.service.advance(s, "mission-1", { now: now(2) }));
    expect(error.code).toBe("mission-model-refused");
    const fields = error.issues.map((issue) => issue.field).sort();
    expect(fields).toEqual(["authorize", "stage"]);

    // The mission is resumable: the reason stage re-runs on the next advance
    // (script entry 2) and the journal proceeds — no control-flow was taken.
    const mission = okOf(await fx.service.advance(s, "mission-1", { now: now(3) }));
    expect(mission.stages.length).toBe(2);
    expect(fx.reasoner.calls.length).toBe(2);
  });

  it("refuses findings that cite observations outside the request (anti-fabrication)", async () => {
    const fabricated = standardContent({ observations: ["obs-1", "obs-invented"] });
    const fx = cognitionFixture([fabricated]);
    const error = errOf(
      (await runReasonStage(fx, scope("t1"))) as {
        ok: boolean;
        error: { code: string; issues: unknown[] };
      },
    );
    expect(error.code).toBe("mission-model-refused");
    expect(error.issues.some((issue) => JSON.stringify(issue).includes("obs-invented"))).toBe(true);
  });

  it("refuses findings citing retracted observations (retracted evidence never orients)", async () => {
    const fx = cognitionFixture([standardContent({ observations: ["obs-1", "obs-2"] })]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2", retracted: true });
    okOf(fx.service.createMission(s, createMissionInput()));
    okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    const error = errOf(await fx.service.advance(s, "mission-1", { now: now(2) }));
    expect(error.code).toBe("mission-model-refused");
    expect(error.issues.some((issue) => JSON.stringify(issue).includes("obs-2"))).toBe(true);
  });

  it("enforces the bounded caps on every collection", async () => {
    const tooManyFindings = contentWith({
      findings: Array.from({ length: 9 }, (_, index) => ({
        statement: `finding ${index}`,
        basedOn: ["obs-1"],
      })),
    });
    const fx = cognitionFixture([tooManyFindings]);
    const error = errOf(
      (await runReasonStage(fx, scope("t1"))) as { ok: boolean; error: { code: string } },
    );
    expect(error.code).toBe("mission-model-refused");
  });

  it("refuses over-cap gaps, hypotheses and proposals", async () => {
    const overCap = contentWith({
      gaps: Array.from({ length: 6 }, (_, index) => ({
        question: `gap ${index}?`,
        consequence: "unknown persists",
      })),
      hypotheses: Array.from({ length: 5 }, (_, index) => ({
        statement: `hypothesis ${index}`,
        explains: [topic()],
      })),
      proposals: Array.from({ length: 6 }, (_, index) => ({
        kind: "ask",
        title: `ask ${index}`,
        rationale: "why not",
      })),
    });
    const fx = cognitionFixture([overCap]);
    const error = errOf(
      (await runReasonStage(fx, scope("t1"))) as {
        ok: boolean;
        error: { code: string; issues: { field: string }[] };
      },
    );
    expect(error.code).toBe("mission-model-refused");
    const fields = new Set(error.issues.map((issue) => issue.field));
    expect(fields.has("gaps")).toBe(true);
    expect(fields.has("hypotheses")).toBe(true);
    expect(fields.has("proposals")).toBe(true);
  });

  it("refuses oversized or empty strings in the bounded fields", async () => {
    const oversized = contentWith({
      summary: "x".repeat(2001),
      findings: [{ statement: "y".repeat(501), basedOn: ["obs-1"] }],
    });
    const fx = cognitionFixture([oversized]);
    const error = errOf(
      (await runReasonStage(fx, scope("t1"))) as {
        ok: boolean;
        error: { code: string; issues: { field: string }[] };
      },
    );
    expect(error.code).toBe("mission-model-refused");
    const fields = new Set(error.issues.map((issue) => issue.field));
    expect(fields.has("summary")).toBe(true);
    expect(fields.has("findings.0.statement")).toBe(true);

    const empty = contentWith({ summary: "   " });
    const fx2 = cognitionFixture([empty]);
    const error2 = errOf(
      (await runReasonStage(fx2, scope("t1"))) as { ok: boolean; error: { code: string } },
    );
    expect(error2.code).toBe("mission-model-refused");
  });

  it("refuses invalid proposal kinds and unknown proposal fields", async () => {
    const evil = contentWith({
      proposals: [
        {
          kind: "authorize",
          title: "just do it",
          rationale: "bypass the gate",
          executeNow: true,
        },
      ],
    });
    const fx = cognitionFixture([evil]);
    const error = errOf(
      (await runReasonStage(fx, scope("t1"))) as {
        ok: boolean;
        error: { code: string; issues: { field: string }[] };
      },
    );
    expect(error.code).toBe("mission-model-refused");
    const fields = new Set(error.issues.map((issue) => issue.field));
    expect(fields.has("proposals.0")).toBe(true);
    expect(fields.has("proposals.0.executeNow")).toBe(true);
  });

  it("refuses empty, duplicate or over-cap citations", async () => {
    const badCitations = contentWith({
      findings: [
        { statement: "no citation", basedOn: [] },
        { statement: "duplicate citation", basedOn: ["obs-1", "obs-1"] },
        {
          statement: "too many citations",
          basedOn: ["obs-1", "obs-2", "obs-3", "obs-4", "obs-5"],
        },
      ],
    });
    const fx = cognitionFixture([badCitations]);
    const error = errOf(
      (await runReasonStage(fx, scope("t1"))) as {
        ok: boolean;
        error: { code: string; issues: { field: string }[] };
      },
    );
    expect(error.code).toBe("mission-model-refused");
    const fields = error.issues.map((issue) => issue.field);
    expect(fields).toContain("findings.0.basedOn");
    expect(fields).toContain("findings.1.basedOn");
    expect(fields).toContain("findings.2.basedOn");
  });

  it("bounds the request: caps observations at 12 and reports truncation honestly", async () => {
    const fx = cognitionFixture([standardContent()]);
    const s = scope("t1");
    for (let index = 1; index <= 15; index += 1) {
      seedObservation(fx.kernel, s, { observationId: `obs-${index}` });
    }
    okOf(fx.service.createMission(s, createMissionInput()));
    okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    const mission = okOf(await fx.service.advance(s, "mission-1", { now: now(2) }));
    const reason = mission.stages[1];
    if (reason?.stage !== "reason") throw new Error("expected reason record");
    expect(reason.request.observations.length).toBe(12);
    expect(reason.request.truncated.observations).toBe(3);
  });

  it("the request carries no domain records (no provenance, no state history)", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    okOf(await fx.service.advance(s, "mission-1", { now: now(2) }));
    const request = fx.reasoner.calls[0];
    expect(request).toBeDefined();
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain("provenance");
    expect(serialized).not.toContain("stateHistory");
    expect(serialized).not.toContain("personId");
    // Goal-less mission: the goal key is absent entirely (optional spread).
    expect(Object.keys(request ?? {}).sort()).toEqual([
      "beliefs",
      "consequence",
      "memory",
      "missionId",
      "observations",
      "openContradictions",
      "openUnknowns",
      "question",
      "subject",
      "truncated",
    ]);
  });

  it("stale observations still orient (freshness is an evaluation concern, not a gate)", async () => {
    const fx = cognitionFixture();
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1", asOf: daysAgo(45) });
    seedObservation(fx.kernel, s, { observationId: "obs-2", asOf: daysAgo(45) });
    okOf(fx.service.createMission(s, createMissionInput()));
    const mission = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(1) }));
    const evaluate = mission.stages[2];
    if (evaluate?.stage !== "evaluate") throw new Error("expected evaluate record");
    // Both findings are stale-backed: admitted 0, both become re-verify gaps.
    expect(evaluate.evaluation.admittedFindings).toBe(0);
    expect(evaluate.evaluation.staleFindings).toBe(2);
    expect(evaluate.evaluation.gaps.every((gap) => gap.origin === "stale-evidence")).toBe(true);
    expect(mission.disposition).toBe("knowledge-gap-remains");
  });

  it("a port error propagates typed and the mission resumes with a fresh call", async () => {
    const refused = {
      error: { code: "mission-model-refused", message: "adapter offline" } as never,
    };
    const fx = cognitionFixture([refused, standardContent()]);
    const s = scope("t1");
    seedObservation(fx.kernel, s, { observationId: "obs-1" });
    seedObservation(fx.kernel, s, { observationId: "obs-2" });
    okOf(fx.service.createMission(s, createMissionInput()));
    okOf(await fx.service.advance(s, "mission-1", { now: now(1) }));
    const error = errOf(await fx.service.advance(s, "mission-1", { now: now(2) }));
    expect(error.code).toBe("mission-model-refused");
    expect(fx.reasoner.calls.length).toBe(1);
    // Resume: the reason stage is re-attempted (call 2) and succeeds.
    const mission = okOf(await fx.service.advance(s, "mission-1", { now: now(3) }));
    expect(mission.stages.length).toBe(2);
    expect(fx.reasoner.calls.length).toBe(2);
    const finished = okOf(await fx.service.runToCompletion(s, "mission-1", { now: now(4) }));
    expect(finished.status).toBe("complete");
  });
});
