/**
 * P002 area 4 — the agent fabric (migration 0004): agent bodies, role
 * history and the body->model attachment ledger over PostgreSQL, proven by
 * driving the REAL application services (`createAgentFabric`) through the
 * SAME journeys the @aurum/agent suite drives, over BOTH the PG-backed
 * store and the W003 in-memory reference (identical deterministic deps —
 * the P002 equivalence ruling).
 *
 * THE IDENTITY LAW is proven at TWO levels: the service level (the W003
 * reference proof — JSON.stringify(body) byte-for-byte across swaps,
 * including updatedAt) and the RAW TABLE level (stronger than the W003
 * reference can reach): across attach/swap/swap/detach the body's row
 * count in fabric_agent_bodies NEVER moves, its current record stays
 * byte-identical AND the role-assignment ledger rows are equally frozen —
 * model attachment writes ONLY the binding ledger. The ledgers are
 * append-only at the DATABASE level: trigger-rejected UPDATE/DELETE,
 * PK-rejected version rewrites, superseded versions retained verbatim at
 * their own mutation_seq. Credential material never enters storage:
 * free-text facets arrive pre-sanitized (opaque refs only) and the raw
 * tables are swept for credential shapes (test-locked).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { containsCredentialMaterial } from "@aurum/provider";
import {
  buildAgentBody,
  buildBodyModelBinding,
  buildRoleAssignment,
  createInMemoryAgentFabricStore,
} from "@aurum/agent";
import type { AgentBody, BodyModelBinding } from "@aurum/agent";
import { listJournal } from "../src/domain-storage/journal/write-journal.js";
import { readVersionRows } from "../src/fabric-storage/adapters/versioned-record.js";
import { createPgAgentFabricStore } from "../src/fabric-storage/stores.js";
import {
  TENANT_A,
  TENANT_B,
  expectSameFailure,
  expectSameRead,
  makeAgentServicePair,
} from "./fabric-test-utils.js";
import type { AgentServicePair } from "./fabric-test-utils.js";

let pair: AgentServicePair;

beforeAll(async () => {
  pair = await makeAgentServicePair();
});

afterAll(async () => {
  await pair.harness.close();
});

/** The full-facet body input the agent suite's makeBody helper uses. */
const BODY_INPUT = {
  displayName: "Ride Support Agent",
  role: { title: "Support Specialist", description: "Handles ride support conversations" },
  permittedCapabilities: ["conversation", "information-retrieval"],
  memoryPolicy: { retention: "persistent", sharing: "team" },
  escalation: { onUncertainty: "ask-human", escalatesTo: ["Human Support Lead"] },
  relationships: [
    { kind: "reports-to", targetBodyId: null, targetRole: "Support Lead", note: null },
  ],
} as const;

describe("fabric agent: round-trip equivalence (real services)", () => {
  it("body lifecycle round-trips: create, update, assignRole twice, retire", async () => {
    const bodies = [];
    for (const fabric of [pair.pg, pair.mem]) {
      bodies.push(await fabric.bodies.createBody(TENANT_A, BODY_INPUT));
    }
    expectSameRead(bodies[0], bodies[1]);
    const bodyId = bodies[0]?.id as string;

    // Facet update round-trips with a bumped updatedAt.
    const updated = [];
    for (const fabric of [pair.pg, pair.mem]) {
      updated.push(
        await fabric.bodies.updateBody(TENANT_A, bodyId, {
          displayName: "Ride Support Agent II",
          communication: { style: "concise and operational" },
        }),
      );
    }
    expectSameRead(updated[0], updated[1]);

    // Role assignment supersedes the initial assignment and appends the
    // next; the body carries the new role with a bumped updatedAt.
    const assignments = [];
    for (const fabric of [pair.pg, pair.mem]) {
      assignments.push(
        await fabric.bodies.assignRole(TENANT_A, bodyId, {
          title: "Senior Support Specialist",
          description: "Escalation owner",
        }),
      );
    }
    expectSameRead(assignments[0], assignments[1]);
    expect(assignments[0]?.assignment.supersededAt).toBeNull();
    expectSameRead(
      await pair.pg.bodies.roleHistory(TENANT_A, bodyId),
      await pair.mem.bodies.roleHistory(TENANT_A, bodyId),
    );
    expect(
      (await pair.pg.bodies.roleHistory(TENANT_A, bodyId)).map((row) => row.role.title),
    ).toEqual(["Support Specialist", "Senior Support Specialist"]);

    // List views round-trip.
    expectSameRead(
      await pair.pg.bodies.listBodies(TENANT_A),
      await pair.mem.bodies.listBodies(TENANT_A),
    );

    // One-way retirement (no un-retire path exists on any surface).
    const retired = [];
    for (const fabric of [pair.pg, pair.mem]) {
      retired.push(await fabric.bodies.retireBody(TENANT_A, bodyId, "reorg"));
    }
    expectSameRead(retired[0], retired[1]);
    expect(retired[0]?.lifecycle.state).toBe("retired");
    // Retired bodies are immutable: the same failure on both stores.
    await expectSameFailure(
      pair.pg.bodies.updateBody(TENANT_A, bodyId, { displayName: "nope" }),
      pair.mem.bodies.updateBody(TENANT_A, bodyId, { displayName: "nope" }),
    );
    await expectSameFailure(
      pair.pg.bodies.assignRole(TENANT_A, bodyId, { title: "Nope" }),
      pair.mem.bodies.assignRole(TENANT_A, bodyId, { title: "Nope" }),
    );
  });

  it("model attachments round-trip: attach, swap, idempotent re-attach, detach, purposes independent", async () => {
    const bodies = [];
    for (const fabric of [pair.pg, pair.mem]) {
      bodies.push(await fabric.bodies.createBody(TENANT_A, BODY_INPUT));
    }
    const bodyId = bodies[0]?.id as string;
    pair.lookupActive("binding-1");
    pair.lookupActive("binding-2");
    pair.lookupActive("binding-3");
    pair.lookupActive("binding-con-1");

    // Attach for two purposes.
    const firstAttaches = [];
    for (const fabric of [pair.pg, pair.mem]) {
      firstAttaches.push(
        await fabric.modelBindings.attachModel(TENANT_A, bodyId, {
          purpose: "cognition",
          modelBindingRef: "binding-1",
        }),
      );
    }
    expectSameRead(firstAttaches[0], firstAttaches[1]);
    expect(firstAttaches[0]?.attached.status).toBe("attached");
    expect(firstAttaches[0]?.superseded).toBeNull();
    const conversationAttaches = [];
    for (const fabric of [pair.pg, pair.mem]) {
      conversationAttaches.push(
        await fabric.modelBindings.attachModel(TENANT_A, bodyId, {
          purpose: "conversation",
          modelBindingRef: "binding-con-1",
        }),
      );
    }
    expectSameRead(conversationAttaches[0], conversationAttaches[1]);

    // Swap cognition twice: supersede chains with successor links.
    const swapOnes = [];
    for (const fabric of [pair.pg, pair.mem]) {
      swapOnes.push(
        await fabric.modelBindings.attachModel(TENANT_A, bodyId, {
          purpose: "cognition",
          modelBindingRef: "binding-2",
        }),
      );
    }
    expectSameRead(swapOnes[0], swapOnes[1]);
    expect(swapOnes[0]?.superseded?.modelBindingRef).toBe("binding-1");
    const swapTwos = [];
    for (const fabric of [pair.pg, pair.mem]) {
      swapTwos.push(
        await fabric.modelBindings.attachModel(TENANT_A, bodyId, {
          purpose: "cognition",
          modelBindingRef: "binding-3",
        }),
      );
    }
    expectSameRead(swapTwos[0], swapTwos[1]);
    expect(swapTwos[0]?.superseded?.modelBindingRef).toBe("binding-2");

    // Idempotent re-attach of the SAME reference: no audit spam.
    const again = [];
    for (const fabric of [pair.pg, pair.mem]) {
      again.push(
        await fabric.modelBindings.attachModel(TENANT_A, bodyId, {
          purpose: "cognition",
          modelBindingRef: "binding-3",
        }),
      );
    }
    expectSameRead(again[0], again[1]);
    expect(again[0]?.superseded).toBeNull();
    expect(again[0]?.attached.id).toBe(swapTwos[0]?.attached.id);

    // Exactly one attached per (body, purpose); history is append-only
    // with successor links; superseded rows stay retrievable.
    expectSameRead(
      await pair.pg.modelBindings.attachmentHistory(TENANT_A, bodyId),
      await pair.mem.modelBindings.attachmentHistory(TENANT_A, bodyId),
    );
    expect(
      (await pair.pg.modelBindings.attachmentHistory(TENANT_A, bodyId)).map(
        (row) => `${row.purpose}:${row.status}`,
      ),
    ).toEqual([
      "cognition:superseded",
      "conversation:attached",
      "cognition:superseded",
      "cognition:attached",
    ]);
    const retained = await pair.pg.modelBindings.getAttachment(
      TENANT_A,
      swapOnes[0]?.attached.id as string,
    );
    expect(retained.status).toBe("superseded");

    // currentAttachment per purpose.
    expectSameRead(
      await pair.pg.modelBindings.currentAttachment(TENANT_A, bodyId, "cognition"),
      await pair.mem.modelBindings.currentAttachment(TENANT_A, bodyId, "cognition"),
    );
    expect(
      (await pair.pg.modelBindings.currentAttachment(TENANT_A, bodyId, "cognition"))
        ?.modelBindingRef,
    ).toBe("binding-3");

    // Detach: supersede without successor; conversation's own attachment.
    const detached = [];
    for (const fabric of [pair.pg, pair.mem]) {
      detached.push(await fabric.modelBindings.detachModel(TENANT_A, bodyId, "conversation"));
    }
    expectSameRead(detached[0], detached[1]);
    expect(detached[0]?.status).toBe("superseded");
    expect(detached[0]?.supersededBy).toBeNull();
    expectSameRead(
      await pair.pg.modelBindings.currentAttachment(TENANT_A, bodyId, "conversation"),
      await pair.mem.modelBindings.currentAttachment(TENANT_A, bodyId, "conversation"),
    );
    expect(
      await pair.pg.modelBindings.currentAttachment(TENANT_A, bodyId, "conversation"),
    ).toBeNull();
  });

  it("attachment failures are identical issue-for-issue (closed purposes, inactive refs, retired bodies)", async () => {
    const bodies = [];
    for (const fabric of [pair.pg, pair.mem]) {
      bodies.push(await fabric.bodies.createBody(TENANT_A, BODY_INPUT));
    }
    const bodyId = bodies[0]?.id as string;
    // Unknown purpose: closed vocabulary.
    await expectSameFailure(
      pair.pg.modelBindings.attachModel(TENANT_A, bodyId, {
        purpose: "vibes",
        modelBindingRef: "binding-1",
      }),
      pair.mem.modelBindings.attachModel(TENANT_A, bodyId, {
        purpose: "vibes",
        modelBindingRef: "binding-1",
      }),
    );
    // Missing/inactive references: uniform VALIDATION_FAILED (no existence
    // leakage — the lookup resolves null for both).
    for (const ref of ["binding-missing", "binding-inactive"]) {
      await expectSameFailure(
        pair.pg.modelBindings.attachModel(TENANT_A, bodyId, {
          purpose: "cognition",
          modelBindingRef: ref,
        }),
        pair.mem.modelBindings.attachModel(TENANT_A, bodyId, {
          purpose: "cognition",
          modelBindingRef: ref,
        }),
      );
    }
    // Missing body: uniform BODY_NOT_FOUND.
    await expectSameFailure(
      pair.pg.bodies.getBody(TENANT_A, "body-missing"),
      pair.mem.bodies.getBody(TENANT_A, "body-missing"),
    );
    // Retired bodies cannot attach models.
    for (const fabric of [pair.pg, pair.mem]) {
      await fabric.bodies.retireBody(TENANT_A, bodyId);
    }
    pair.lookupActive("binding-1");
    await expectSameFailure(
      pair.pg.modelBindings.attachModel(TENANT_A, bodyId, {
        purpose: "cognition",
        modelBindingRef: "binding-1",
      }),
      pair.mem.modelBindings.attachModel(TENANT_A, bodyId, {
        purpose: "cognition",
        modelBindingRef: "binding-1",
      }),
    );
  });
});

describe("fabric agent: THE IDENTITY LAW at the storage level", () => {
  it("body identity across model swaps survives round-trips BYTE-FOR-BYTE (service + raw table)", async () => {
    const bodies = [];
    for (const fabric of [pair.pg, pair.mem]) {
      bodies.push(await fabric.bodies.createBody(TENANT_A, BODY_INPUT));
    }
    const bodyId = bodies[0]?.id as string;
    pair.lookupActive("binding-1");
    pair.lookupActive("binding-2");
    pair.lookupActive("binding-3");

    // A role assignment precedes the swaps: the role ledger is frozen across
    // every model swap too (a swap writes ONLY the binding ledger — all
    // three agent tables are covered by this proof).
    const assigned = [];
    for (const fabric of [pair.pg, pair.mem]) {
      assigned.push(
        await fabric.bodies.assignRole(TENANT_A, bodyId, {
          title: "Swap Witness",
          description: "role rows must never move across model swaps",
        }),
      );
    }
    expectSameRead(assigned[0], assigned[1]);

    // The attach/swap/detach journey below is driven SYMMETRICALLY on both
    // fabrics (same calls, same order) so the deterministic clocks and id
    // generators stay in lockstep for every later proof; every identity
    // assertion targets the PG side's raw tables, and the service-level
    // byte-for-byte check runs against BOTH fabrics' bodies.
    for (const fabric of [pair.pg, pair.mem]) {
      await fabric.modelBindings.attachModel(TENANT_A, bodyId, {
        purpose: "cognition",
        modelBindingRef: "binding-1",
      });
    }

    // The W003 reference proof, replayed against PG-backed storage: the
    // body record — facets AND updatedAt — is byte-for-byte unchanged
    // across every swap, and identical to the in-memory reference's body.
    // updatedAt was last bumped by the assignRole; the swaps never touch it.
    // Byte-for-byte baselines PER SIDE (jsonb normalizes key order, so a
    // cross-fabric STRING comparison would be shape noise, not semantics:
    // each side must stay byte-identical to ITSELF, and the two sides stay
    // deep-equal through expectSameRead).
    const before = JSON.stringify(await pair.pg.bodies.getBody(TENANT_A, bodyId));
    const memBefore = JSON.stringify(await pair.mem.bodies.getBody(TENANT_A, bodyId));
    const updatedAtBefore = (await pair.pg.bodies.getBody(TENANT_A, bodyId)).updatedAt;
    expect(updatedAtBefore).toBe(assigned[0]?.body.updatedAt);
    expect(updatedAtBefore).not.toBe(bodies[0]?.updatedAt);
    expectSameRead(
      await pair.pg.bodies.getBody(TENANT_A, bodyId),
      await pair.mem.bodies.getBody(TENANT_A, bodyId),
    );

    // RAW TABLE level (stronger than the W003 reference can reach): the
    // body's version rows AND the role-assignment ledger rows are frozen
    // from here on — count and content.
    const bodyRowsBefore = await readVersionRows<AgentBody>(
      pair.harness.sql,
      "fabric_agent_bodies",
      "body_id",
      TENANT_A,
      bodyId,
    );
    expect(bodyRowsBefore).toHaveLength(2);
    const roleRowsForBody = () =>
      pair.harness.sql<{
        readonly assignment_id: string;
        readonly mutation_seq: number;
        readonly record_text: string;
      }>`
        select assignment_id, mutation_seq, record::text as record_text
        from fabric_role_assignments
        where tenant_id = ${TENANT_A} and body_id = ${bodyId}
        order by seq
      `;
    const roleRowsBefore = await roleRowsForBody();
    // The initial assignment carries two versions (opened + superseded by
    // the Swap Witness assignment) and the witness carries one: 3 rows.
    expect(roleRowsBefore).toHaveLength(3);

    // Swap 1: binding-1 -> binding-2. Both fabrics' bodies stay
    // byte-identical to `before` (and to each other).
    for (const fabric of [pair.pg, pair.mem]) {
      await fabric.modelBindings.attachModel(TENANT_A, bodyId, {
        purpose: "cognition",
        modelBindingRef: "binding-2",
      });
    }
    expect(JSON.stringify(await pair.pg.bodies.getBody(TENANT_A, bodyId))).toBe(before);
    expect(JSON.stringify(await pair.mem.bodies.getBody(TENANT_A, bodyId))).toBe(memBefore);
    expectSameRead(
      await pair.pg.bodies.getBody(TENANT_A, bodyId),
      await pair.mem.bodies.getBody(TENANT_A, bodyId),
    );

    // Swap 2: binding-2 -> binding-3.
    for (const fabric of [pair.pg, pair.mem]) {
      await fabric.modelBindings.attachModel(TENANT_A, bodyId, {
        purpose: "cognition",
        modelBindingRef: "binding-3",
      });
    }
    const after = await pair.pg.bodies.getBody(TENANT_A, bodyId);
    expect(JSON.stringify(after)).toBe(before);
    expect(after.updatedAt).toBe(updatedAtBefore);
    expect(JSON.stringify(await pair.mem.bodies.getBody(TENANT_A, bodyId))).toBe(memBefore);
    expectSameRead(
      await pair.pg.bodies.getBody(TENANT_A, bodyId),
      await pair.mem.bodies.getBody(TENANT_A, bodyId),
    );

    // Detach: still frozen.
    for (const fabric of [pair.pg, pair.mem]) {
      await fabric.modelBindings.detachModel(TENANT_A, bodyId, "cognition");
    }
    expect(JSON.stringify(await pair.pg.bodies.getBody(TENANT_A, bodyId))).toBe(before);

    // The attachment ledger, however, moved on (append-only audit):
    // nothing attached for cognition after the detach — on BOTH fabrics.
    expect(await pair.pg.modelBindings.currentAttachment(TENANT_A, bodyId, "cognition")).toBeNull();
    expect(
      await pair.mem.modelBindings.currentAttachment(TENANT_A, bodyId, "cognition"),
    ).toBeNull();

    // RAW TABLE: the body's rows NEVER moved across the three swaps and
    // the detach — same count, same mutation_seq, byte-identical records.
    const bodyRowsAfter = await readVersionRows<AgentBody>(
      pair.harness.sql,
      "fabric_agent_bodies",
      "body_id",
      TENANT_A,
      bodyId,
    );
    expect(bodyRowsAfter).toHaveLength(2);
    expect(JSON.stringify(bodyRowsAfter)).toBe(JSON.stringify(bodyRowsBefore));
    // The role ledger is equally frozen: the swap wrote no role rows.
    const roleRowsAfter = await roleRowsForBody();
    expect(JSON.stringify(roleRowsAfter)).toBe(JSON.stringify(roleRowsBefore));
    // No body journal row was recorded for any swap either — the journal
    // saw ONLY fabric-body-model-bindings writes.
    const journal = await listJournal(pair.harness.sql, TENANT_A);
    const bodyWrites = journal.filter(
      (row) => row.area === "fabric-bodies" && row.recordId === bodyId,
    );
    expect(bodyWrites).toHaveLength(2);
    expect(bodyWrites.map((row) => row.journalKey)).toEqual([
      `fabric-bodies:put:${bodyId}:1`,
      `fabric-bodies:put:${bodyId}:2`,
    ]);
  });
});

describe("fabric agent: ledgers are append-only at the database level", () => {
  it("retains superseded attachments verbatim at their own mutation_seq with successor links", async () => {
    // The identity proof attached binding-1, swapped to binding-2, then
    // binding-3, then detached: the first attachment carries two versions.
    const journal = await listJournal(pair.harness.sql, TENANT_A);
    const firstAttachmentId = journal.find((row) => row.area === "fabric-body-model-bindings")
      ?.recordId as string;
    const versions = await readVersionRows<BodyModelBinding>(
      pair.harness.sql,
      "fabric_body_model_bindings",
      "binding_id",
      TENANT_A,
      firstAttachmentId,
    );
    expect(versions).toHaveLength(2);
    expect(versions[0]?.mutationSeq).toBe(0);
    expect(versions[0]?.record.status).toBe("attached");
    expect(versions[0]?.record.supersededBy).toBeNull();
    expect(versions[1]?.mutationSeq).toBe(1);
    expect(versions[1]?.record.status).toBe("superseded");
    expect(typeof versions[1]?.record.supersededBy).toBe("string");
    // Same record identity, same attach fields — only the supersede moved.
    expect(versions[1]?.record.id).toBe(versions[0]?.record.id);
    expect(versions[1]?.record.bodyId).toBe(versions[0]?.record.bodyId);
    expect(versions[1]?.record.purpose).toBe(versions[0]?.record.purpose);
    expect(versions[1]?.record.modelBindingRef).toBe(versions[0]?.record.modelBindingRef);
    expect(versions[1]?.record.attachedAt).toBe(versions[0]?.record.attachedAt);
    expect(versions[1]?.record.createdAt).toBe(versions[0]?.record.createdAt);
  });

  it("rejects raw UPDATE and DELETE on all three tables (append-only trigger)", async () => {
    const sql = pair.harness.sql;
    await expect(sql`update fabric_agent_bodies set lifecycle_state = 'retired'`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from fabric_agent_bodies`).rejects.toThrow(/append-only/);
    await expect(sql`update fabric_role_assignments set record = '{}'::jsonb`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from fabric_role_assignments`).rejects.toThrow(/append-only/);
    await expect(sql`update fabric_body_model_bindings set status = 'attached'`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from fabric_body_model_bindings`).rejects.toThrow(/append-only/);
  });

  it("rejects version rewrites by primary key and vocabulary violations by CHECK", async () => {
    const sql = pair.harness.sql;
    const journal = await listJournal(sql, TENANT_A);
    const firstAttachmentId = journal.find((row) => row.area === "fabric-body-model-bindings")
      ?.recordId as string;
    const firstBodyId = journal.find((row) => row.area === "fabric-bodies")?.recordId as string;
    await expect(sql`
      insert into fabric_body_model_bindings
        (tenant_id, binding_id, mutation_seq, body_id, purpose, status, record)
      values (${TENANT_A}, ${firstAttachmentId}, 0, ${firstBodyId}, 'cognition', 'attached', '{}'::jsonb)
    `).rejects.toThrow(/duplicate key/i);
    // Purpose outside the closed vocabulary.
    await expect(sql`
      insert into fabric_body_model_bindings
        (tenant_id, binding_id, mutation_seq, body_id, purpose, status, record)
      values (${TENANT_A}, 'binding-bad', 0, ${firstBodyId}, 'vibes', 'attached', '{}'::jsonb)
    `).rejects.toThrow(/violates check constraint/i);
    // Lifecycle state outside the one-way vocabulary.
    await expect(sql`
      insert into fabric_agent_bodies (tenant_id, body_id, mutation_seq, lifecycle_state, record)
      values (${TENANT_A}, 'body-bad', 0, 'zombie', '{}'::jsonb)
    `).rejects.toThrow(/violates check constraint/i);
  });
});

describe("fabric agent: tenant isolation", () => {
  it("foreign-tenant reads are indistinguishable from missing; ids are independently registrable", async () => {
    // Store-level fixed-id records (the provider-core pattern): the SAME
    // body/assignment/binding ids registered under two tenants.
    const pgStore = createPgAgentFabricStore(pair.harness.sql);
    const memStore = createInMemoryAgentFabricStore();
    const body = buildAgentBody(TENANT_B, BODY_INPUT, {
      id: "body-dup",
      now: "2026-02-01T00:00:00.000Z",
    });
    const assignment = buildRoleAssignment(TENANT_B, body.id, body.role, {
      id: "assign-dup",
      now: "2026-02-01T00:00:01.000Z",
    });
    const binding = buildBodyModelBinding(
      TENANT_B,
      body.id,
      {
        purpose: "cognition",
        modelBindingRef: "binding-b",
      },
      { id: "bmb-dup", now: "2026-02-01T00:00:02.000Z" },
    );
    for (const store of [pgStore, memStore]) {
      await store.bodies.put(TENANT_B, body);
      await store.roleHistory.put(TENANT_B, assignment);
      await store.modelBindings.put(TENANT_B, binding);
    }

    // Tenant A never sees tenant B's records (uniform null / empty).
    expectSameRead(
      await pgStore.bodies.getById(TENANT_A, "body-dup"),
      await memStore.bodies.getById(TENANT_A, "body-dup"),
    );
    expect(await pgStore.bodies.getById(TENANT_A, "body-dup")).toBeNull();
    expectSameRead(
      await pgStore.roleHistory.listByBody(TENANT_A, "body-dup"),
      await memStore.roleHistory.listByBody(TENANT_A, "body-dup"),
    );
    expect(await pgStore.roleHistory.listByBody(TENANT_A, "body-dup")).toEqual([]);
    expectSameRead(
      await pgStore.modelBindings.findAttachedByPurpose(TENANT_A, "body-dup", "cognition"),
      await memStore.modelBindings.findAttachedByPurpose(TENANT_A, "body-dup", "cognition"),
    );
    expect(
      await pgStore.modelBindings.findAttachedByPurpose(TENANT_A, "body-dup", "cognition"),
    ).toBeNull();
    // Tenant B sees its OWN records under the same ids.
    expect((await pgStore.bodies.getById(TENANT_B, "body-dup"))?.displayName).toBe(
      "Ride Support Agent",
    );
    expect(
      (await pgStore.roleHistory.listByBody(TENANT_B, "body-dup")).map((row) => row.id),
    ).toEqual(["assign-dup"]);
    expect(
      (await pgStore.modelBindings.findAttachedByPurpose(TENANT_B, "body-dup", "cognition"))?.id,
    ).toBe("bmb-dup");

    // Service level: A's getBody of B's id fails identically on both
    // stores (uniform BODY_NOT_FOUND).
    await expectSameFailure(
      pair.pg.bodies.getBody(TENANT_A, "body-dup"),
      pair.mem.bodies.getBody(TENANT_A, "body-dup"),
    );
  });
});

describe("fabric agent: journal", () => {
  it("records stable mutation-identity keys for bodies, role history and attachments", async () => {
    const journal = await listJournal(pair.harness.sql, TENANT_A);
    const keys = journal.map((row) => row.journalKey);
    // Bodies: one key per version (create; the assignRole-updated body).
    expect(
      keys.filter((key) => key.startsWith("fabric-bodies:put:")).length,
    ).toBeGreaterThanOrEqual(4);
    // Role history: the supersede rewrite carries :2.
    const roleKeys = keys.filter((key) => key.startsWith("fabric-role-history:put:"));
    expect(roleKeys.some((key) => key.endsWith(":2"))).toBe(true);
    // Attachments: version-stamped per binding id.
    const attachKeys = keys.filter((key) => key.startsWith("fabric-body-model-bindings:put:"));
    expect(attachKeys.some((key) => key.endsWith(":2"))).toBe(true);
    for (const row of journal.filter((entry) => entry.area === "fabric-body-model-bindings")) {
      expect(row.operation).toBe("put");
      expect(row.recordId).toBeTruthy();
    }
  });
});

describe("fabric agent: credential opacity (test-locked)", () => {
  it("keeps credential material out of storage: sanitized free text, opaque refs only", async () => {
    // The agent-side surface of the credential law: bodies, assignments and
    // bindings carry NO credential fields — modelBindingRef is an OPAQUE
    // reference by type, and every free-text facet (displayName, role,
    // communication style, relationship notes, attach notes) passes the
    // provider package's unanchored sanitizer at BUILD time, before any
    // store sees the record. The REAL service over PG therefore stores
    // exactly what the in-memory reference stores: redacted text.
    const created = [];
    for (const fabric of [pair.pg, pair.mem]) {
      created.push(
        await fabric.bodies.createBody(TENANT_A, {
          displayName: "Leaky Agent",
          role: { title: "Ops", description: "uses key sk-abc123def456ghi789jkl for lookups" },
          communication: { style: "password: SuperSecret99" },
          relationships: [
            {
              kind: "reports-to",
              targetBodyId: null,
              targetRole: "Lead",
              note: "endpoint https://agent:hunter2secret@api.example.com/v1",
            },
          ],
        }),
      );
    }
    expectSameRead(created[0], created[1]);
    const serialized = JSON.stringify(created[0]);
    expect(serialized).not.toContain("sk-abc123def456ghi789jkl");
    expect(serialized).not.toContain("SuperSecret99");
    expect(serialized).not.toContain("hunter2secret");
    expect(serialized).toContain("[REDACTED]");

    // The attach note is sanitized too, and the modelBindingRef stays an
    // opaque id (never a credential shape) on both stores.
    pair.lookupActive("binding-cred");
    const attached = [];
    for (const fabric of [pair.pg, pair.mem]) {
      attached.push(
        await fabric.modelBindings.attachModel(TENANT_A, created[0]?.id as string, {
          purpose: "cognition",
          modelBindingRef: "binding-cred",
          note: "Bearer abcdefghijklmnop",
        }),
      );
    }
    expectSameRead(attached[0], attached[1]);
    expect(JSON.stringify(attached[0])).not.toContain("Bearer abcdefghijklmnop");

    // RAW TABLE sweep: no credential-shaped material in ANY row of ANY
    // version of the three agent ledgers (both tenants) — the write-time
    // sanitizer plus the opaque-ref shapes make the tables provably clean.
    for (const table of [
      "fabric_agent_bodies",
      "fabric_role_assignments",
      "fabric_body_model_bindings",
    ]) {
      const rows = await pair.harness.sql<{ readonly record_text: string }>`
        select record::text as record_text from ${pair.harness.sql(table)}
      `;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(containsCredentialMaterial(row.record_text)).toBe(false);
      }
    }
  });
});
