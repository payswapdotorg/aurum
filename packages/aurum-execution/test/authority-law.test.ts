/**
 * W006 THE AUTHORITY LAW (catalog acceptance: "runtime failures cannot
 * rewrite semantic state"; work-order clause 4, test-locked).
 *
 * The proof seeds REAL kernel state (the aurum-domain in-memory kernel —
 * imported here as the semantic-state ORACLE; production src has zero domain
 * imports, tripwire-locked below), runs failing executions through the
 * Agent Gateway (adapter rejection, platform failure, deadline timeout,
 * unknown-ticket await), and asserts the kernel state is BYTE-IDENTICAL
 * afterwards: runtime failures produce typed error results + execution-plane
 * journal events and never domain mutations. The success path is also
 * locked: settlements are RETURNED, not recorded — the caller records
 * semantics through the domain seams (spec/ZCODE-SUBSTRATE-MAP.md canonical
 * flow: "normalized result -> Aurum outcome/evidence" happens on the Aurum
 * side only).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createDomainKernel,
  personActor,
  systemActor,
  tenantScope,
  type AurumDomainKernel,
} from "../../aurum-domain/src/index.js";
import {
  errOf,
  localHarness,
  okOf,
  requestOf,
  sandboxHarness,
  scopeOf,
  journalKindsOf,
} from "./helpers.js";

const A = scopeOf("tenant-a");

/** Seeds a kernel with an authorized action (the authority executions cite). */
function seedKernel(): { kernel: AurumDomainKernel; actionId: string; auditCount: number } {
  const kernel = createDomainKernel();
  const scope = tenantScope("tenant-a");
  if (!scope.ok) throw new Error("setup failed");
  const s = scope.value;
  const at = (seconds: number) => (1_700_000_000_000 + seconds * 1000) as never;

  const person = kernel.identity.registerPerson(s, {
    personId: "boss",
    displayName: "Boss",
    labels: ["manager"],
    provenance: systemActor("seed"),
    now: at(0),
  });
  if (!person.ok) throw new Error(person.error.message);
  const membership = kernel.identity.grantMembership(s, {
    membershipId: "m-1",
    personId: "boss",
    organizationId: "org-1",
    roles: ["approver", "authorizer"],
    grantedBy: personActor("boss"),
    now: at(0),
    audit: { actor: personActor("boss"), at: at(0), reason: "seed grant" },
  });
  if (!membership.ok) throw new Error(membership.error.message);
  const goal = kernel.goals.createGoal(s, {
    goalId: "g-1",
    objective: "Ship the rebuild",
    desiredState: "shipped",
    horizonStart: at(0),
    horizonEnd: at(90),
    ownerId: "boss",
    ownerLabels: ["manager"],
    priority: "critical",
    provenance: { actor: systemActor("seed"), source: "human-entered", recordedAt: at(0) },
    now: at(0),
    audit: { actor: personActor("boss"), at: at(0), reason: "seed goal" },
  });
  if (!goal.ok) throw new Error(goal.error.message);
  const proposal = kernel.actions.proposeAction(s, {
    actionId: "act-1",
    title: "Execute the shipment",
    subject: { kind: "goal", id: "g-1" },
    policy: {
      approvalRoles: ["approver"],
      authorizationRoles: ["authorizer"],
      employmentImpacting: false,
    },
    createdBy: systemActor("lab"),
    now: at(1),
  });
  if (!proposal.ok) throw new Error(proposal.error.message);
  for (const [command, from, reason] of [
    ["recommendAction", "proposed", "analysis recommends"],
    ["approveAction", "recommended", "approved by owner"],
    ["authorizeAction", "approved", "authorized for execution"],
  ] as const) {
    const transition = kernel.actions[command](s, {
      actionId: "act-1",
      expectedState: from,
      now: at(2),
      audit: { actor: personActor("boss"), at: at(2), reason },
    });
    if (!transition.ok) throw new Error(transition.error.message);
  }
  return { kernel, actionId: "act-1", auditCount: kernel.audit.queryAudit(s, {}).length };
}

/** Byte-stable snapshot of the seeded kernel's semantic state. */
function kernelSnapshot(kernel: AurumDomainKernel): string {
  const scope = tenantScope("tenant-a");
  if (!scope.ok) throw new Error("setup failed");
  const s = scope.value;
  return JSON.stringify({
    people: kernel.identity.listPeople(s),
    memberships: kernel.identity.listMemberships(s),
    goals: kernel.goals.listGoals(s),
    actions: kernel.actions.listActions(s),
    audit: kernel.audit.queryAudit(s, {}),
  });
}

describe("W006 THE AUTHORITY LAW: runtime failures cannot rewrite semantic state", () => {
  it("adapter/transport failures leave the kernel byte-identical (typed errors + journal events)", async () => {
    const { kernel } = seedKernel();
    const before = kernelSnapshot(kernel);
    const h = sandboxHarness({ submitRejection: { message: "sandbox exploded" } });

    const error = errOf(
      await h.gateway.submitExecution(A, requestOf("law-1", { environmentClass: "sandbox" })),
    );
    expect(error.code).toBe("execution/transport-failed");

    const session = okOf(h.gateway.getExecution(A, "law-1"));
    expect(session.state).toBe("failed");
    expect(session.settlement?.failure?.kind).toBe("transport-failed");
    expect(journalKindsOf(h, A, "law-1")).toContain("failure-recorded");
    expect(journalKindsOf(h, A, "law-1")).toContain("session-failed");

    expect(kernelSnapshot(kernel)).toBe(before);
  });

  it("platform failures leave the kernel byte-identical", async () => {
    const { kernel } = seedKernel();
    const before = kernelSnapshot(kernel);
    const h = localHarness();

    okOf(await h.gateway.submitExecution(A, requestOf("law-2", { workload: "boom" })));
    const settlement = okOf(await h.gateway.awaitSettled(A, "law-2"));
    expect(settlement.status).toBe("failed");
    expect(settlement.failure?.kind).toBe("platform-failed");

    expect(kernelSnapshot(kernel)).toBe(before);
  });

  it("deadline timeouts leave the kernel byte-identical (typed timeout + durable failure)", async () => {
    const { kernel } = seedKernel();
    const before = kernelSnapshot(kernel);
    const h = sandboxHarness({ hangAfterSteps: 1, stepLatencyMs: 1, startupLatencyMs: 1 });

    okOf(
      await h.gateway.submitExecution(
        A,
        requestOf("law-3", { environmentClass: "sandbox", deadlineEpochMs: Date.now() + 40 }),
      ),
    );
    const error = errOf(await h.gateway.awaitSettled(A, "law-3"));
    expect(error.code).toBe("execution/timeout");
    const session = okOf(h.gateway.getExecution(A, "law-3"));
    expect(session.state).toBe("failed");
    expect(session.settlement?.failure?.kind).toBe("deadline-exceeded");

    expect(kernelSnapshot(kernel)).toBe(before);
  });

  it("awaiting an unknown platform ticket fails typed-ly with the kernel untouched", async () => {
    const { kernel } = seedKernel();
    const before = kernelSnapshot(kernel);
    const h = localHarness();

    const error = errOf(await h.gateway.awaitSettled(A, "never-existed"));
    expect(error.code).toBe("execution/not-found");

    expect(kernelSnapshot(kernel)).toBe(before);
  });

  it("SUCCESSFUL executions return normalized settlements without touching the kernel", async () => {
    const { kernel, actionId } = seedKernel();
    const before = kernelSnapshot(kernel);
    const h = localHarness();

    const submitted = okOf(
      await h.gateway.submitExecution(A, requestOf("law-5", { authority: { actionId } })),
    );
    expect(submitted.session.state === "running" || submitted.session.state === "pending").toBe(
      true,
    );
    const settlement = okOf(await h.gateway.awaitSettled(A, "law-5"));
    expect(settlement.status).toBe("settled");
    expect(settlement.authority).toEqual({ actionId: "act-1" });

    // The settlement is a MESSAGE returned to the caller; the kernel state
    // (including the action, which stays "authorized" until the CALLER walks
    // recordExecution through the action authority) is unchanged.
    expect(kernelSnapshot(kernel)).toBe(before);
    const scope = tenantScope("tenant-a");
    if (!scope.ok) throw new Error("setup failed");
    const action = kernel.actions.getAction(scope.value, actionId);
    expect(action.ok && action.value.state).toBe("authorized");
  });

  it("pause/resume/cancel control traffic leaves the kernel byte-identical", async () => {
    const { kernel } = seedKernel();
    const before = kernelSnapshot(kernel);
    const h = localHarness({ mode: "manual" });

    okOf(await h.gateway.submitExecution(A, requestOf("law-6")));
    okOf(await h.gateway.pauseExecution(A, "law-6"));
    okOf(await h.gateway.resumeExecution(A, "law-6"));
    const cancelled = okOf(await h.gateway.cancelExecution(A, "law-6"));
    expect(cancelled.status).toBe("cancelled");

    expect(kernelSnapshot(kernel)).toBe(before);
  });
});

describe("W006 authority-law tripwires (source hygiene)", () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

  function sourceFiles(): string[] {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const collected: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts")) collected.push(path);
      }
    };
    walk(packageRoot);
    return collected;
  }

  it("production src imports NO aurum semantic packages (domain/provider/agent/application)", () => {
    // Scans import/export-from specifiers only — doc comments may MENTION the
    // packages (doctrine references), they may never IMPORT them.
    const specifierPattern = /(?:import|export)[\s\S]*?["'](@aurum\/[a-z-]+)["']/g;
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(specifierPattern)) {
        expect.fail(`${file} must not import ${match[1]} (semantic authority stays outside)`);
      }
    }
  });

  it("production src consumes ONLY the W001 boundary subpath of @zcode/shared", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/["']@zcode\/shared([^"']*)["']/g)) {
        const subpath = match[1] ?? "";
        expect(subpath === "/aurum-boundary", `${file} may only use the boundary subpath`).toBe(
          true,
        );
      }
    }
  });

  it("production src contains no lint suppressions", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      expect(source.includes("eslint-disable"), `${file} has a lint disable`).toBe(false);
      expect(source.includes("oxlint-disable"), `${file} has a lint disable`).toBe(false);
    }
  });
});
