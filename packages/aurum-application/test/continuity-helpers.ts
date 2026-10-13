/**
 * W012 test helpers: fixtures for the continuity proofs. Everything is
 * imported from the PUBLIC application contract (../src/index.js) — the
 * same boundary the platform variants consume. The fixture composes the
 * REAL canonical local runtime through the recording composition with a
 * deterministic scripted reasoner and a COUNTING substrate double; no real
 * model or execution plane is ever called, and the counters are the
 * never-re-runs proof instruments (APPROACH R2).
 */
import { expect } from "vitest";
import {
  tenantScope,
  type ActorReference,
  type AurumDomainKernel,
  type DomainTimestamp,
  type PersonId,
  type TenantScope,
} from "@aurum/domain";
import {
  createContinuousTowerSession,
  createInMemoryAttachmentSurface,
  createInMemoryContinuityLedger,
  createInProcessExecutionSubstrate,
  createScriptedReasoner,
  createTowerReplayer,
  createContinuityService,
  type ContinuityLedger,
  type ContinuityService,
  type ExecutionSubstratePort,
  type LocalControlTowerRuntime,
  type ReasonerScriptEntry,
  type ScriptedReasoner,
  type TowerAttachmentSurface,
} from "../src/index.js";

const T0 = 1_700_000_000_000;

export function scope(name: string): TenantScope {
  const result = tenantScope(name);
  if (!result.ok) throw new Error(`test setup: invalid tenant name ${name}`);
  return result.value;
}

export function personActor(personId: string): ActorReference {
  return { kind: "person", personId: personId as PersonId };
}

export function systemActor(name: string): ActorReference {
  return { kind: "system", name };
}

export const now = (secondsAfterBase = 0): DomainTimestamp =>
  (T0 + secondsAfterBase * 1000) as DomainTimestamp;

export function okOf<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T {
  expect(result.ok, `expected ok, got error: ${result.ok ? "" : String(result.error)}`).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

export function errOf<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): E {
  expect(
    result.ok,
    `expected error, got value: ${result.ok ? JSON.stringify(result.value) : ""}`,
  ).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

/** A substrate double that COUNTS submissions (the R2 proof instrument). */
export function countingSubstrate(): ExecutionSubstratePort & { submissions: number } {
  const inner = createInProcessExecutionSubstrate();
  let submissions = 0;
  return {
    submitPlanTask: async (...args: Parameters<ExecutionSubstratePort["submitPlanTask"]>) => {
      submissions += 1;
      return inner.submitPlanTask(...args);
    },
    awaitPlanTaskSettlement: (
      ...args: Parameters<ExecutionSubstratePort["awaitPlanTaskSettlement"]>
    ) => inner.awaitPlanTaskSettlement(...args),
    cancelPlanTask: (...args: Parameters<ExecutionSubstratePort["cancelPlanTask"]>) =>
      inner.cancelPlanTask(...args),
    get submissions() {
      return submissions;
    },
  } as ExecutionSubstratePort & { submissions: number };
}

export interface ContinuityFixture {
  readonly service: ContinuityService;
  readonly ledger: ContinuityLedger;
  readonly surface: TowerAttachmentSurface & { materialized: ReadonlyMap<string, Uint8Array> };
  readonly reasoner: ScriptedReasoner;
  readonly substrate: ExecutionSubstratePort & { submissions: number };
  /** Opens a desktop-continuous session and returns its live runtime. */
  openContinuous(
    sessionId: string,
    options?: { tenant?: string; script?: readonly ReasonerScriptEntry[] },
  ): LocalControlTowerRuntime;
  /** Simulates process death: a FRESH service over the SAME ledger. */
  revive(): ContinuityFixture;
}

/**
 * Kernel-plane pre-seed (the harness contract documented on
 * `TowerSessionKernelOptions.seedKernel`): two active observations about the
 * standard topic so the scripted reasoner's findings are ADMISSIBLE
 * (anti-fabrication: findings may only cite observations that exist). These
 * writes are kernel-plane, created OUTSIDE the session composition — both
 * the live and the replayed compositions apply the identical seed.
 */
export function seedStandardObservations(kernel: AurumDomainKernel, s: TenantScope): void {
  for (const [index, observationId] of ["obs-1", "obs-2"].entries()) {
    const result = kernel.evidence.recordObservation(s, {
      observationId,
      subject: { kind: "topic", id: "invoices" },
      content: `Observation ${observationId} about invoice processing`,
      observedAt: now(0),
      provenance: { actor: personActor("p-1"), source: "human-entered", recordedAt: now(0) },
      freshness: { asOf: now(0) },
    });
    if (!result.ok) throw new Error(`seed observation failed: ${result.error.message}`);
    void index;
  }
}

export function continuityFixture(
  options: {
    readonly ledger?: ContinuityLedger;
    readonly script?: readonly ReasonerScriptEntry[];
  } = {},
): ContinuityFixture {
  const ledger = options.ledger ?? createInMemoryContinuityLedger();
  const surface = createInMemoryAttachmentSurface();
  const reasoner = createScriptedReasoner(options.script ?? []);
  const substrate = countingSubstrate();
  const kernelOptions = {
    ledger,
    reasoning: reasoner,
    substrate,
    seedKernel: seedStandardObservations,
  };
  const service = createContinuityService({
    ledger,
    surface,
    compose: createContinuousTowerSession(kernelOptions),
    replay: createTowerReplayer(kernelOptions),
  });
  const fixture: ContinuityFixture = {
    service,
    ledger,
    surface,
    reasoner,
    substrate,
    openContinuous(sessionId, openOptions) {
      const tenant = openOptions?.tenant ?? "acme";
      const opened = service.openSession(scope(tenant), {
        sessionId,
        operator: personActor("operator-1"),
        variant: "desktop",
        mode: "continuous",
        now: now(0),
      });
      return okOf(opened).runtime;
    },
    revive() {
      return continuityFixture({ ledger, script: options.script });
    },
  };
  return fixture;
}

/** A standard tower read input (a logged company query). */
export function towerRead(atSeconds = 30): {
  now: DomainTimestamp;
  askedBy: ActorReference;
  reason: string;
} {
  return {
    now: now(atSeconds),
    askedBy: personActor("boss"),
    reason: "continuity proof board read",
  };
}

/** Charters one mission through the tower (the only semantic path for questions). */
export function charterMission(
  runtime: LocalControlTowerRuntime,
  s: TenantScope,
  missionId: string,
  atSeconds = 1,
) {
  return runtime.tower.createMission(s, {
    missionId,
    subject: { kind: "topic", id: "invoices" },
    question: "Why is invoice processing slow?",
    consequence: "SLA breaches accumulate",
    createdBy: personActor("p-1"),
    now: now(atSeconds),
  });
}
