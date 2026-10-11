/**
 * Fail-closed STUB environments (W006 adapters) for the environment classes
 * whose real ZCode substrate wiring is follow-up work: browser, computer,
 * workflow, remote.
 *
 * Each stub is REGISTERED (visible in the environment inventory and the W001
 * seam — `listCapabilities` lists it, `lookup` issues a handle) but
 * `wired: false`, so:
 * - the Agent Gateway's admission gate rejects submissions with the TYPED
 *   `execution/not-wired` error before any platform call (fail-closed);
 * - if the transport is ever driven despite the gate, EVERY method rejects
 *   with a typed boundary error (`transport-closed` — the platform-honest
 *   signal that this capability's transport is not available);
 * - the control surface declares no controls (nothing is cancellable,
 *   pausable or resumable when nothing can run).
 *
 * The adaptation path for the real wiring is documented by the W001 boundary
 * README (browser-use substrate / zcode-cua / dynamic workflow backend /
 * remote attachments); the descriptors carry a diagnostic note only.
 */
import { AurumBoundaryError, type AurumExecutionTransportPort } from "@zcode/shared/aurum-boundary";
import type { ExecutionEnvironment } from "../domain/ports.js";
import type { ExecutionEnvironmentClass } from "../domain/vocabulary.js";

export const STUB_ENVIRONMENT_CLASSES = ["browser", "computer", "workflow", "remote"] as const;

export type StubEnvironmentClass = (typeof STUB_ENVIRONMENT_CLASSES)[number];

export interface StubEnvironmentConfig {
  readonly environmentClass: StubEnvironmentClass;
  readonly environmentId?: string;
  readonly variant?: string;
}

function notWiredRejection(environmentClass: string, operation: string): never {
  throw new AurumBoundaryError(
    "aurum-transport/transport-closed",
    `environment class "${environmentClass}" is registered but not yet wired (W006 stub); ${operation} rejected fail-closed — ZCode substrate adaptation is follow-up work`,
  );
}

function stubTransport(environmentClass: string): AurumExecutionTransportPort {
  return {
    async submit() {
      notWiredRejection(environmentClass, "submit");
    },
    async poll() {
      notWiredRejection(environmentClass, "poll");
    },
    async awaitCompletion() {
      notWiredRejection(environmentClass, "awaitCompletion");
    },
    async cancel() {
      notWiredRejection(environmentClass, "cancel");
    },
  };
}

/** Builds one fail-closed stub environment. */
export function createStubEnvironment(config: StubEnvironmentConfig): ExecutionEnvironment {
  const environmentId = config.environmentId ?? `stub-${config.environmentClass}`;
  const variant = config.variant ?? "not-wired";
  return {
    descriptor: {
      environmentId,
      environmentClass: config.environmentClass satisfies ExecutionEnvironmentClass,
      variant,
      control: { cancellable: false, pausable: false, resumable: false },
      wired: false,
      notes: "not yet wired — ZCode substrate adaptation pending (W006 fail-closed stub)",
    },
    transport: stubTransport(config.environmentClass),
  };
}

/** Builds all four mandated stubs (browser/computer/workflow/remote). */
export function createStandardStubEnvironments(): readonly ExecutionEnvironment[] {
  return STUB_ENVIRONMENT_CLASSES.map((environmentClass) =>
    createStubEnvironment({ environmentClass }),
  );
}
