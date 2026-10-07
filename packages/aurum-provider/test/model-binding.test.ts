/**
 * ACCEPTANCE: ModelBinding — append-only supersession, one active binding
 * per purpose, full audit trail, idempotent re-selection.
 */
import { describe, expect, it } from "vitest";
import { TENANT_A, makeConnectedProvider, makeFabric } from "./helpers.js";

describe("model bindings", () => {
  async function catalogWithTwoModels() {
    const harness = makeFabric();
    const { definitionId } = await makeConnectedProvider(harness);
    const first = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "model-one",
    });
    const second = await harness.fabric.catalog.addManualEntry(TENANT_A, {
      providerDefinitionId: definitionId,
      modelKey: "model-two",
    });
    return { harness, first, second };
  }

  it("selects a model and exposes exactly one active binding per purpose", async () => {
    const { harness, first } = await catalogWithTwoModels();
    const { active } = await harness.fabric.bindings.selectModel(TENANT_A, "cognition", first.id);
    expect(active.status).toBe("active");
    expect(active.purpose).toBe("cognition");
    expect(active.catalogEntryId).toBe(first.id);
    expect(await harness.fabric.bindings.getActiveBinding(TENANT_A, "cognition")).toMatchObject({
      id: active.id,
    });
  });

  it("supersedes the previous binding — append-only, never deleted", async () => {
    const { harness, first, second } = await catalogWithTwoModels();
    const firstSelection = await harness.fabric.bindings.selectModel(
      TENANT_A,
      "cognition",
      first.id,
    );
    const secondSelection = await harness.fabric.bindings.selectModel(
      TENANT_A,
      "cognition",
      second.id,
      {
        reason: "cost optimization",
      },
    );
    // The old binding is retained, marked superseded, successor recorded:
    expect(secondSelection.superseded?.id).toBe(firstSelection.active.id);
    expect(secondSelection.superseded?.status).toBe("superseded");
    expect(secondSelection.superseded?.supersededBy).toBe(secondSelection.active.id);
    expect(secondSelection.superseded?.supersedeReason).toBe("cost optimization");
    // The superseded row is still retrievable (never hard-deleted):
    const retained = await harness.fabric.bindings.getBinding(TENANT_A, firstSelection.active.id);
    expect(retained.status).toBe("superseded");
    // Exactly one active binding for the purpose:
    const active = await harness.fabric.bindings.getActiveBinding(TENANT_A, "cognition");
    expect(active?.id).toBe(secondSelection.active.id);
  });

  it("keeps a complete, ordered audit trail per purpose", async () => {
    const { harness, first, second } = await catalogWithTwoModels();
    await harness.fabric.bindings.selectModel(TENANT_A, "conversation", first.id);
    await harness.fabric.bindings.selectModel(TENANT_A, "conversation", second.id);
    const history = await harness.fabric.bindings.listBindingHistory(TENANT_A, "conversation");
    expect(history.length).toBe(2);
    expect(history[0]?.status).toBe("superseded");
    expect(history[1]?.status).toBe("active");
    expect(history[0]?.selectedAt <= (history[1]?.selectedAt ?? "")).toBe(true);
  });

  it("keeps purposes independent of each other", async () => {
    const { harness, first, second } = await catalogWithTwoModels();
    await harness.fabric.bindings.selectModel(TENANT_A, "analysis", first.id);
    await harness.fabric.bindings.selectModel(TENANT_A, "background", second.id);
    expect(
      (await harness.fabric.bindings.getActiveBinding(TENANT_A, "analysis"))?.catalogEntryId,
    ).toBe(first.id);
    expect(
      (await harness.fabric.bindings.getActiveBinding(TENANT_A, "background"))?.catalogEntryId,
    ).toBe(second.id);
    // Swapping one purpose does not disturb the other:
    await harness.fabric.bindings.selectModel(TENANT_A, "analysis", second.id);
    expect(
      (await harness.fabric.bindings.getActiveBinding(TENANT_A, "background"))?.catalogEntryId,
    ).toBe(second.id);
    expect(
      (await harness.fabric.bindings.getActiveBinding(TENANT_A, "analysis"))?.catalogEntryId,
    ).toBe(second.id);
  });

  it("treats re-selecting the already-active model as an idempotent no-op", async () => {
    const { harness, first } = await catalogWithTwoModels();
    const firstSelection = await harness.fabric.bindings.selectModel(
      TENANT_A,
      "cognition",
      first.id,
    );
    const again = await harness.fabric.bindings.selectModel(TENANT_A, "cognition", first.id);
    expect(again.superseded).toBeNull();
    expect(again.active.id).toBe(firstSelection.active.id);
    const history = await harness.fabric.bindings.listBindingHistory(TENANT_A, "cognition");
    expect(history.length).toBe(1);
  });

  it("clearing a binding supersedes it without a successor (record retained)", async () => {
    const { harness, first } = await catalogWithTwoModels();
    const selection = await harness.fabric.bindings.selectModel(TENANT_A, "cognition", first.id);
    const cleared = await harness.fabric.bindings.clearBinding(
      TENANT_A,
      "cognition",
      "tenant decision",
    );
    expect(cleared?.id).toBe(selection.active.id);
    expect(cleared?.status).toBe("superseded");
    expect(cleared?.supersededBy).toBeNull();
    expect(await harness.fabric.bindings.getActiveBinding(TENANT_A, "cognition")).toBeNull();
    // History preserved:
    const history = await harness.fabric.bindings.listBindingHistory(TENANT_A, "cognition");
    expect(history.length).toBe(1);
    expect(history[0]?.status).toBe("superseded");
  });

  it("rejects selection of unknown catalog entries", async () => {
    const { harness } = await catalogWithTwoModels();
    await expect(
      harness.fabric.bindings.selectModel(TENANT_A, "cognition", "cat-missing"),
    ).rejects.toMatchObject({ code: "CATALOG_ENTRY_NOT_FOUND", notFound: true });
  });
});
