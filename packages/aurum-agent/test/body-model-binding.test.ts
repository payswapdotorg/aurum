/**
 * ACCEPTANCE (THE IDENTITY LAW): model swap preserves Agent Body identity
 * BYTE-FOR-BYTE — test-locked, including updatedAt. Attaching, swapping and
 * detaching models never writes the body record; identity, memory policy,
 * goals surface, evidence hooks and permissions survive every swap.
 */
import { describe, expect, it } from "vitest";
import { TENANT_A, makeAgentFabric, makeBody } from "./helpers.js";

describe("body model bindings", () => {
  it("attaches a model for a purpose, referencing an active provider binding", async () => {
    const harness = makeAgentFabric();
    const bodyId = await makeBody(harness);
    harness.lookup.active("binding-1");
    const result = await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "cognition",
      modelBindingRef: "binding-1",
    });
    expect(result.attached.status).toBe("attached");
    expect(result.attached.purpose).toBe("cognition");
    expect(result.attached.modelBindingRef).toBe("binding-1");
    expect(result.superseded).toBeNull();
    const current = await harness.fabric.modelBindings.currentAttachment(
      TENANT_A,
      bodyId,
      "cognition",
    );
    expect(current?.id).toBe(result.attached.id);
  });

  it("MODEL SWAP preserves the body record BYTE-FOR-BYTE, including updatedAt", async () => {
    const harness = makeAgentFabric();
    const bodyId = await makeBody(harness);
    harness.lookup.active("binding-1");
    harness.lookup.active("binding-2");
    harness.lookup.active("binding-3");

    const first = await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "cognition",
      modelBindingRef: "binding-1",
    });
    const before = JSON.stringify(await harness.fabric.bodies.getBody(TENANT_A, bodyId));
    const updatedAtBefore = (await harness.fabric.bodies.getBody(TENANT_A, bodyId)).updatedAt;
    expect(updatedAtBefore).toBe(first.body.updatedAt);

    // Swap 1: binding-1 -> binding-2
    const swapOne = await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "cognition",
      modelBindingRef: "binding-2",
    });
    expect(JSON.stringify(await harness.fabric.bodies.getBody(TENANT_A, bodyId))).toBe(before);

    // Swap 2: binding-2 -> binding-3 (multiple swaps, still frozen)
    await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "cognition",
      modelBindingRef: "binding-3",
    });
    const after = await harness.fabric.bodies.getBody(TENANT_A, bodyId);
    expect(JSON.stringify(after)).toBe(before);
    expect(after.updatedAt).toBe(updatedAtBefore);

    // The attachment ledger, however, moved on (append-only audit):
    expect(swapOne.superseded?.modelBindingRef).toBe("binding-1");
    const current = await harness.fabric.modelBindings.currentAttachment(
      TENANT_A,
      bodyId,
      "cognition",
    );
    expect(current?.modelBindingRef).toBe("binding-3");
  });

  it("detach also preserves the body byte-for-byte", async () => {
    const harness = makeAgentFabric();
    const bodyId = await makeBody(harness);
    harness.lookup.active("binding-1");
    await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "conversation",
      modelBindingRef: "binding-1",
    });
    const before = JSON.stringify(await harness.fabric.bodies.getBody(TENANT_A, bodyId));
    const detached = await harness.fabric.modelBindings.detachModel(
      TENANT_A,
      bodyId,
      "conversation",
    );
    expect(detached?.status).toBe("superseded");
    expect(detached?.supersededBy).toBeNull();
    expect(JSON.stringify(await harness.fabric.bodies.getBody(TENANT_A, bodyId))).toBe(before);
    expect(
      await harness.fabric.modelBindings.currentAttachment(TENANT_A, bodyId, "conversation"),
    ).toBeNull();
  });

  it("keeps exactly one attached binding per (body, purpose); purposes are independent", async () => {
    const harness = makeAgentFabric();
    const bodyId = await makeBody(harness);
    harness.lookup.active("binding-cog-1");
    harness.lookup.active("binding-cog-2");
    harness.lookup.active("binding-con-1");
    await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "cognition",
      modelBindingRef: "binding-cog-1",
    });
    await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "conversation",
      modelBindingRef: "binding-con-1",
    });
    await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "cognition",
      modelBindingRef: "binding-cog-2",
    });
    const history = await harness.fabric.modelBindings.attachmentHistory(TENANT_A, bodyId);
    expect(history.length).toBe(3);
    const attached = history.filter((binding) => binding.status === "attached");
    expect(attached.length).toBe(2);
    expect(new Set(attached.map((binding) => binding.purpose)).size).toBe(2);
    expect(
      (await harness.fabric.modelBindings.currentAttachment(TENANT_A, bodyId, "cognition"))
        ?.modelBindingRef,
    ).toBe("binding-cog-2");
    expect(
      (await harness.fabric.modelBindings.currentAttachment(TENANT_A, bodyId, "conversation"))
        ?.modelBindingRef,
    ).toBe("binding-con-1");
  });

  it("attachment history is append-only with successor links", async () => {
    const harness = makeAgentFabric();
    const bodyId = await makeBody(harness);
    harness.lookup.active("binding-1");
    harness.lookup.active("binding-2");
    const first = await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "analysis",
      modelBindingRef: "binding-1",
    });
    const second = await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "analysis",
      modelBindingRef: "binding-2",
    });
    const history = await harness.fabric.modelBindings.attachmentHistory(TENANT_A, bodyId);
    expect(history.map((binding) => binding.status)).toEqual(["superseded", "attached"]);
    expect(history[0]?.supersededBy).toBe(second.attached.id);
    expect(history[0]?.id).toBe(first.attached.id);
    // Superseded rows are still retrievable (never deleted):
    const retained = await harness.fabric.modelBindings.getAttachment(TENANT_A, first.attached.id);
    expect(retained.status).toBe("superseded");
  });

  it("re-attaching the same reference is an idempotent no-op", async () => {
    const harness = makeAgentFabric();
    const bodyId = await makeBody(harness);
    harness.lookup.active("binding-1");
    await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "background",
      modelBindingRef: "binding-1",
    });
    const again = await harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
      purpose: "background",
      modelBindingRef: "binding-1",
    });
    expect(again.superseded).toBeNull();
    const history = await harness.fabric.modelBindings.attachmentHistory(TENANT_A, bodyId);
    expect(history.length).toBe(1);
  });

  it("rejects unknown purposes (closed vocabulary) and non-active references uniformly", async () => {
    const harness = makeAgentFabric();
    const bodyId = await makeBody(harness);
    await expect(
      harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
        purpose: "vibes",
        modelBindingRef: "binding-1",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    // Missing, inactive and foreign references are all rejected the same way:
    for (const ref of ["binding-missing", "binding-inactive"]) {
      await expect(
        harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
          purpose: "cognition",
          modelBindingRef: ref,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect(harness.lookup.calls.length).toBe(2);
  });

  it("retired bodies cannot attach models", async () => {
    const harness = makeAgentFabric();
    const bodyId = await makeBody(harness);
    await harness.fabric.bodies.retireBody(TENANT_A, bodyId);
    harness.lookup.active("binding-1");
    await expect(
      harness.fabric.modelBindings.attachModel(TENANT_A, bodyId, {
        purpose: "cognition",
        modelBindingRef: "binding-1",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("stored body records are deep-frozen (mutation defense in depth)", async () => {
    const harness = makeAgentFabric();
    const bodyId = await makeBody(harness);
    const body = await harness.fabric.bodies.getBody(TENANT_A, bodyId);
    expect(Object.isFrozen(body)).toBe(true);
    expect(Object.isFrozen(body.role)).toBe(true);
    expect(Object.isFrozen(body.memoryPolicy)).toBe(true);
  });
});
