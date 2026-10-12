/**
 * W009 information relay (catalog clause 3: minimal context, correlation/
 * causation, idempotency). Tests cover the pure relay functions + the
 * in-memory handoff store's idempotent delivery.
 */
import { describe, expect, it } from "vitest";
import {
  buildHandoffPayload,
  deliverHandoffIdempotent,
  executorAuthorityIssues,
  handoffDescriptorIssues,
  handoffPayloadsIdentical,
  type HandoffPayload,
} from "../src/index.js";
import { errOf, okOf, planTask } from "./plans-helpers.js";

const settlement = (requestId: string, settledAt: number) => ({
  requestId,
  status: "settled" as const,
  settledAt,
});

describe("minimal-context law (catalog clause 3)", () => {
  it("a handoff payload contains EXACTLY the declared information requirements", () => {
    const producingTask = planTask("producer", {
      produces: [{ handoffId: "h1", knowledge: "result", mediaType: "application/json" }],
    });
    const consumingTask = planTask("consumer", {
      consumes: [{ handoffId: "h1", knowledge: "result", mediaType: "application/json" }],
      dependsOn: ["producer"],
    });
    const payload = okOf(
      buildHandoffPayload({
        planId: "plan-1",
        producingTask,
        consumingTask,
        handoffId: "h1",
        producingSettlement: settlement("req-1", 1000),
        payload: '{"value":42}',
        mediaType: "application/json",
        deliveredAt: 2000,
      }),
    );
    // Deep-equal proof: the payload's fields are EXACTLY the declared
    // requirements — planId, taskId (consumer), handoffId, producingTaskId,
    // producingSettlementRef, payload, mediaType, deliveredAt. Nothing else.
    expect(Object.keys(payload).sort()).toEqual(
      [
        "planId",
        "taskId",
        "handoffId",
        "producingTaskId",
        "producingSettlementRef",
        "payload",
        "mediaType",
        "deliveredAt",
      ].sort(),
    );
    expect(payload.planId).toBe("plan-1");
    expect(payload.taskId).toBe("consumer");
    expect(payload.handoffId).toBe("h1");
    expect(payload.producingTaskId).toBe("producer");
    expect(payload.producingSettlementRef.requestId).toBe("req-1");
    expect(payload.producingSettlementRef.settledAt).toBe(1000);
    expect(payload.payload).toBe('{"value":42}');
    expect(payload.mediaType).toBe("application/json");
  });

  it("a foreign-task payload CANNOT be constructed (handoffId must be declared on the consuming task)", () => {
    const producingTask = planTask("producer", {
      produces: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
    });
    const consumingTask = planTask("consumer", {
      consumes: [{ handoffId: "h-other", knowledge: "k", mediaType: "application/json" }],
    });
    const result = buildHandoffPayload({
      planId: "plan-1",
      producingTask,
      consumingTask,
      handoffId: "h1", // declared on producer but NOT on consumer
      producingSettlement: settlement("req-1", 1000),
      payload: "{}",
      mediaType: "application/json",
      deliveredAt: 2000,
    });
    expect(errOf(result).code).toBe("plan-validation");
  });

  it("the producing task must declare the handoff in its `produces` list", () => {
    const producingTask = planTask("producer", {
      produces: [{ handoffId: "h-other", knowledge: "k", mediaType: "application/json" }],
    });
    const consumingTask = planTask("consumer", {
      consumes: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
    });
    const result = buildHandoffPayload({
      planId: "plan-1",
      producingTask,
      consumingTask,
      handoffId: "h1",
      producingSettlement: settlement("req-1", 1000),
      payload: "{}",
      mediaType: "application/json",
      deliveredAt: 2000,
    });
    expect(errOf(result).code).toBe("plan-validation");
  });

  it("the payload's mediaType must match the consuming task's descriptor", () => {
    const producingTask = planTask("producer", {
      produces: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
    });
    const consumingTask = planTask("consumer", {
      consumes: [{ handoffId: "h1", knowledge: "k", mediaType: "application/xml" }],
    });
    const result = buildHandoffPayload({
      planId: "plan-1",
      producingTask,
      consumingTask,
      handoffId: "h1",
      producingSettlement: settlement("req-1", 1000),
      payload: "<x/>",
      mediaType: "application/json", // wrong media type
      deliveredAt: 2000,
    });
    expect(errOf(result).code).toBe("plan-validation");
  });

  it("rejects oversized payloads (> 2MB)", () => {
    const producingTask = planTask("producer", {
      produces: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
    });
    const consumingTask = planTask("consumer", {
      consumes: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
    });
    const result = buildHandoffPayload({
      planId: "plan-1",
      producingTask,
      consumingTask,
      handoffId: "h1",
      producingSettlement: settlement("req-1", 1000),
      payload: "x".repeat(2_000_001),
      mediaType: "application/json",
      deliveredAt: 2000,
    });
    expect(errOf(result).code).toBe("plan-validation");
  });
});

describe("correlation/causation retained (catalog clause 3)", () => {
  it("the payload carries (planId, taskId, handoffId) correlation identity", () => {
    const producingTask = planTask("producer", {
      produces: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
    });
    const consumingTask = planTask("consumer", {
      consumes: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
    });
    const payload = okOf(
      buildHandoffPayload({
        planId: "plan-42",
        producingTask,
        consumingTask,
        handoffId: "h1",
        producingSettlement: settlement("req-7", 5000),
        payload: "{}",
        mediaType: "application/json",
        deliveredAt: 6000,
      }),
    );
    expect(payload.planId).toBe("plan-42");
    expect(payload.taskId).toBe("consumer");
    expect(payload.handoffId).toBe("h1");
  });

  it("the payload carries (producingTaskId, producingSettlementRef) causation identity", () => {
    const producingTask = planTask("producer", {
      produces: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
    });
    const consumingTask = planTask("consumer", {
      consumes: [{ handoffId: "h1", knowledge: "k", mediaType: "application/json" }],
    });
    const payload = okOf(
      buildHandoffPayload({
        planId: "plan-42",
        producingTask,
        consumingTask,
        handoffId: "h1",
        producingSettlement: settlement("req-7", 5000),
        payload: "{}",
        mediaType: "application/json",
        deliveredAt: 6000,
      }),
    );
    expect(payload.producingTaskId).toBe("producer");
    expect(payload.producingSettlementRef.requestId).toBe("req-7");
    expect(payload.producingSettlementRef.settledAt).toBe(5000);
  });
});

describe("idempotent delivery (catalog clause 3)", () => {
  const makePayload = (): HandoffPayload => ({
    planId: "plan-1",
    taskId: "consumer",
    handoffId: "h1",
    producingTaskId: "producer",
    producingSettlementRef: { requestId: "req-1", settledAt: 1000 },
    payload: '{"v":1}',
    mediaType: "application/json",
    deliveredAt: 2000,
  });

  it("first delivery returns outcome 'delivered-first'", () => {
    const result = deliverHandoffIdempotent(undefined, makePayload());
    const outcome = okOf(result);
    expect(outcome.outcome).toBe("delivered-first");
    expect(outcome.payload.handoffId).toBe("h1");
  });

  it("byte-identical re-delivery returns outcome 'delivered-duplicate' and the SAME payload", () => {
    const first = makePayload();
    const firstResult = okOf(deliverHandoffIdempotent(undefined, first));
    expect(firstResult.outcome).toBe("delivered-first");
    const dupResult = okOf(deliverHandoffIdempotent(first, first));
    expect(dupResult.outcome).toBe("delivered-duplicate");
    // Byte-identical: every field equal.
    expect(handoffPayloadsIdentical(dupResult.payload, first)).toBe(true);
  });

  it("divergent duplicate delivery is REFUSED as plan-handoff-divergent", () => {
    const first = makePayload();
    const divergent: HandoffPayload = { ...first, payload: '{"v":2}' };
    const result = deliverHandoffIdempotent(first, divergent);
    expect(errOf(result).code).toBe("plan-handoff-divergent");
  });

  it("a different handoff id is treated as a NEW delivery (not a duplicate)", () => {
    const first = makePayload();
    const different: HandoffPayload = { ...first, handoffId: "h2" };
    const result = deliverHandoffIdempotent(first, different);
    expect(okOf(result).outcome).toBe("delivered-first");
  });
});

describe("authorization-awareness (catalog clause 3)", () => {
  it("executorAuthorityIssues rejects an empty requirement", () => {
    const issues = executorAuthorityIssues({});
    expect(issues.length).toBeGreaterThan(0);
  });

  it("executorAuthorityIssues accepts a requirement with actionId only", () => {
    expect(executorAuthorityIssues({ actionId: "act-1" })).toEqual([]);
  });

  it("executorAuthorityIssues accepts a requirement with auditRef only", () => {
    expect(executorAuthorityIssues({ auditRef: "audit-1" })).toEqual([]);
  });

  it("executorAuthorityIssues accepts a requirement with both", () => {
    expect(executorAuthorityIssues({ actionId: "act-1", auditRef: "audit-1" })).toEqual([]);
  });
});

describe("handoff descriptor validation (catalog clause 2)", () => {
  it("rejects an empty handoffId", () => {
    expect(handoffDescriptorIssues({ handoffId: "", knowledge: "k", mediaType: "m" }).length).toBeGreaterThan(0);
  });

  it("rejects an empty knowledge", () => {
    expect(handoffDescriptorIssues({ handoffId: "h", knowledge: "", mediaType: "m" }).length).toBeGreaterThan(0);
  });

  it("rejects an empty mediaType", () => {
    expect(handoffDescriptorIssues({ handoffId: "h", knowledge: "k", mediaType: "" }).length).toBeGreaterThan(0);
  });

  it("accepts a valid descriptor", () => {
    expect(
      handoffDescriptorIssues({ handoffId: "h", knowledge: "k", mediaType: "m" }),
    ).toEqual([]);
  });
});
