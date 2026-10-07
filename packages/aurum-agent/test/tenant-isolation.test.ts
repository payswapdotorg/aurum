/**
 * ACCEPTANCE: two-tenant isolation on every agent store — foreign ids
 * uniformly not-found, no existence leakage.
 */
import { describe, expect, it } from "vitest";
import { TENANT_A, TENANT_B, makeAgentFabric } from "./helpers.js";

describe("two-tenant isolation (agent)", () => {
  it("bodies: foreign tenant sees uniform not-found; lists stay separate", async () => {
    const harness = makeAgentFabric();
    const body = await harness.fabric.bodies.createBody(TENANT_A, {
      displayName: "A-only",
      role: { title: "Ops" },
    });
    const foreign = await captureError(() => harness.fabric.bodies.getBody(TENANT_B, body.id));
    const missing = await captureError(() =>
      harness.fabric.bodies.getBody(TENANT_B, "agent-body-x"),
    );
    expect(foreign?.code).toBe("BODY_NOT_FOUND");
    expect(foreign?.code).toBe(missing?.code);
    expect(foreign?.shape).toBe(missing?.shape);
    expect(await harness.fabric.bodies.listBodies(TENANT_B)).toEqual([]);
    // Updates through a foreign tenant also fail closed:
    await expect(
      harness.fabric.bodies.updateBody(TENANT_B, body.id, { displayName: "Hijacked" }),
    ).rejects.toMatchObject({ code: "BODY_NOT_FOUND" });
    // The original is untouched:
    expect((await harness.fabric.bodies.getBody(TENANT_A, body.id)).displayName).toBe("A-only");
  });

  it("role history: foreign tenant sees an empty ledger", async () => {
    const harness = makeAgentFabric();
    const body = await harness.fabric.bodies.createBody(TENANT_A, {
      displayName: "A-only",
      role: { title: "Ops" },
    });
    await harness.fabric.bodies.assignRole(TENANT_A, body.id, { title: "Ops 2" });
    expect((await harness.fabric.bodies.roleHistory(TENANT_A, body.id)).length).toBe(2);
    // Foreign read of the body itself fails before the ledger is touched:
    await expect(harness.fabric.bodies.roleHistory(TENANT_B, body.id)).rejects.toMatchObject({
      code: "BODY_NOT_FOUND",
    });
    // Raw store: nothing leaks:
    expect(await harness.store.roleHistory.listByBody(TENANT_B, body.id)).toEqual([]);
  });

  it("model attachments: foreign tenant cannot read or attach on foreign bodies", async () => {
    const harness = makeAgentFabric();
    const body = await harness.fabric.bodies.createBody(TENANT_A, {
      displayName: "A-only",
      role: { title: "Ops" },
    });
    harness.lookup.active("binding-1");
    const attached = await harness.fabric.modelBindings.attachModel(TENANT_A, body.id, {
      purpose: "cognition",
      modelBindingRef: "binding-1",
    });
    // Foreign attach fails as BODY_NOT_FOUND (uniform with a missing body):
    await expect(
      harness.fabric.modelBindings.attachModel(TENANT_B, body.id, {
        purpose: "cognition",
        modelBindingRef: "binding-1",
      }),
    ).rejects.toMatchObject({ code: "BODY_NOT_FOUND" });
    // Foreign read of the attachment row:
    const foreign = await captureError(() =>
      harness.fabric.modelBindings.getAttachment(TENANT_B, attached.attached.id),
    );
    const missing = await captureError(() =>
      harness.fabric.modelBindings.getAttachment(TENANT_B, "bmb-x"),
    );
    expect(foreign?.code).toBe("BODY_MODEL_BINDING_NOT_FOUND");
    expect(foreign?.code).toBe(missing?.code);
    expect(foreign?.shape).toBe(missing?.shape);
    // Raw store: tenant B has no attachment rows at all:
    expect(await harness.store.modelBindings.listByBody(TENANT_B, body.id)).toEqual([]);
  });

  it("tenant B lives an independent life on the same store", async () => {
    const harness = makeAgentFabric();
    await harness.fabric.bodies.createBody(TENANT_A, { displayName: "A", role: { title: "Ops" } });
    const bodyB = await harness.fabric.bodies.createBody(TENANT_B, {
      displayName: "B",
      role: { title: "Ops" },
    });
    harness.lookup.active("binding-b");
    await harness.fabric.modelBindings.attachModel(TENANT_B, bodyB.id, {
      purpose: "cognition",
      modelBindingRef: "binding-b",
    });
    expect(
      (await harness.fabric.bodies.listBodies(TENANT_A)).map((body) => body.displayName),
    ).toEqual(["A"]);
    expect(
      (await harness.fabric.bodies.listBodies(TENANT_B)).map((body) => body.displayName),
    ).toEqual(["B"]);
    expect((await harness.fabric.modelBindings.attachmentHistory(TENANT_B, bodyB.id)).length).toBe(
      1,
    );
  });
});

async function captureError(
  action: () => Promise<unknown>,
): Promise<{ code: string; shape: string } | null> {
  try {
    await action();
    return null;
  } catch (error) {
    if (error instanceof Error) {
      const code = (error as { code?: string }).code ?? "";
      const shape = error.message.split(" ").slice(0, 2).join(" ");
      return { code, shape };
    }
    throw error;
  }
}
