/**
 * ACCEPTANCE: AgentBody — persistent organizational identity owning role,
 * behaviors, context access, memory policy, capabilities, escalation,
 * hooks, relationships and role history; one-way lifecycle (active/retired).
 */
import { describe, expect, it } from "vitest";
import { AgentFabricError } from "../src/domain/errors.js";
import { TENANT_A, makeAgentFabric, makeBody } from "./helpers.js";

describe("agent body", () => {
  it("creates a body carrying every organizational facet", async () => {
    const harness = makeAgentFabric();
    const body = await harness.fabric.bodies.createBody(TENANT_A, {
      displayName: "PaySwap Ops Agent",
      role: { title: "Payments Operator", description: "Monitors payment flows" },
      communication: {
        style: "concise and operational",
        verbosity: "terse",
        languages: ["en", "de"],
      },
      informationAcquisition: {
        askBeforeAssuming: true,
        preferredSources: ["ledger", "psp-api"],
        freshnessRequirement: "live",
      },
      companyContextAccess: { grantedScopes: ["payments", "rides"], deniedScopes: ["hr"] },
      memoryPolicy: { retention: "persistent", sharing: "organization" },
      permittedCapabilities: ["conversation", "tool-invocation", "payment-proposal"],
      escalation: { onUncertainty: "block", escalatesTo: ["Finance Controller"] },
      evidenceHooks: [{ channel: "evidence-bus", events: ["decision", "handoff"] }],
      learningHooks: [{ channel: "learning-bus", triggers: ["outcome-recorded"] }],
      relationships: [
        {
          kind: "escalates-to",
          targetBodyId: null,
          targetRole: "Finance Controller",
          note: "above 10k",
        },
      ],
    });
    expect(body.lifecycle).toEqual({ state: "active", retiredAt: null, reason: null });
    expect(body.role.title).toBe("Payments Operator");
    expect(body.communication.languages).toEqual(["en", "de"]);
    expect(body.informationAcquisition.freshnessRequirement).toBe("live");
    expect(body.companyContextAccess.grantedScopes).toEqual(["payments", "rides"]);
    expect(body.memoryPolicy).toEqual({ retention: "persistent", sharing: "organization" });
    expect(body.permittedCapabilities).toContain("payment-proposal");
    expect(body.escalation.onUncertainty).toBe("block");
    expect(body.evidenceHooks[0]?.channel).toBe("evidence-bus");
    expect(body.learningHooks[0]?.triggers).toEqual(["outcome-recorded"]);
    expect(body.relationships[0]?.kind).toBe("escalates-to");
    // No model anywhere on the body record:
    expect(JSON.stringify(body)).not.toMatch(/model|binding/i);
  });

  it("sanitizes credential-shaped free text on every facet", async () => {
    const harness = makeAgentFabric();
    const body = await harness.fabric.bodies.createBody(TENANT_A, {
      displayName: "Leaky Agent",
      role: { title: "Ops", description: "uses key sk-abc123def456ghi789jkl for lookups" },
      communication: { style: "password: SuperSecret99", verbosity: "standard", languages: ["en"] },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("sk-abc123def456ghi789jkl");
    expect(serialized).not.toContain("SuperSecret99");
    expect(serialized).toContain("[REDACTED]");
  });

  it("rejects unknown capabilities and invalid names", async () => {
    const harness = makeAgentFabric();
    await expect(
      harness.fabric.bodies.createBody(TENANT_A, {
        displayName: "X",
        role: { title: "Ops" },
        permittedCapabilities: ["mind-control"],
      }),
    ).rejects.toBeInstanceOf(AgentFabricError);
    await expect(
      harness.fabric.bodies.createBody(TENANT_A, { displayName: "   ", role: { title: "Ops" } }),
    ).rejects.toBeInstanceOf(AgentFabricError);
  });

  it("updates facets and bumps updatedAt", async () => {
    const harness = makeAgentFabric();
    const created = await harness.fabric.bodies.createBody(TENANT_A, {
      displayName: "Before",
      role: { title: "Ops" },
    });
    const updated = await harness.fabric.bodies.updateBody(TENANT_A, created.id, {
      displayName: "After",
      memoryPolicy: { retention: "persistent", sharing: "team" },
    });
    expect(updated.displayName).toBe("After");
    expect(updated.memoryPolicy.retention).toBe("persistent");
    expect(updated.updatedAt > created.updatedAt).toBe(true);
  });

  it("assigns roles append-only with full history", async () => {
    const harness = makeAgentFabric();
    const bodyId = await makeBody(harness);
    const second = await harness.fabric.bodies.assignRole(TENANT_A, bodyId, {
      title: "Senior Support Specialist",
      description: "escalation tier 2",
    });
    expect(second.body.role.title).toBe("Senior Support Specialist");
    const history = await harness.fabric.bodies.roleHistory(TENANT_A, bodyId);
    expect(history.length).toBe(2);
    expect(history[0]?.role.title).toBe("Support Specialist");
    expect(history[0]?.supersededAt).not.toBeNull();
    expect(history[0]?.supersededBy).toBe(history[1]?.id);
    expect(history[1]?.supersededAt).toBeNull();
  });

  it("retirement is one-way: retired bodies are immutable and cannot re-activate", async () => {
    const harness = makeAgentFabric();
    const bodyId = await makeBody(harness);
    const retired = await harness.fabric.bodies.retireBody(TENANT_A, bodyId, "org change");
    expect(retired.lifecycle).toEqual({
      state: "retired",
      retiredAt: retired.updatedAt,
      reason: "org change",
    });
    // Retiring again fails:
    await expect(harness.fabric.bodies.retireBody(TENANT_A, bodyId)).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    // Facet updates fail:
    await expect(
      harness.fabric.bodies.updateBody(TENANT_A, bodyId, { displayName: "Zombie" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    // Role changes fail:
    await expect(
      harness.fabric.bodies.assignRole(TENANT_A, bodyId, { title: "Nope" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    // There is no un-retire/activate operation anywhere on the service:
    const service = Object.getOwnPropertyNames(Object.getPrototypeOf(harness.fabric.bodies));
    expect(service.some((name) => /activat|reactivat|unretire/i.test(name))).toBe(false);
  });
});
