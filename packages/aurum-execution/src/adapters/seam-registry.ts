/**
 * In-process execution environment registry + W001 seam bridge (W006
 * adapters).
 *
 * One registry serves BOTH sides of the platform seam:
 * - the SEMANTIC side: `ExecutionEnvironmentRegistry` (domain port) —
 *   lists/selects/resolves environment objects (descriptor + transport);
 * - the PLATFORM side: `AurumSeamRegistry` (W001 boundary) — lists
 *   capabilities, resolves opaque handles, describes issued handles.
 *
 * Both views are built from the SAME registration list, so a handle minted
 * by the seam always resolves to the same environment the registry selected
 * (the gateway asserts capability-id agreement — invariant otherwise).
 * Handles are deterministic per environment (`handle:<environmentId>`) and
 * never persisted by consumers (the boundary doctrine: persist capabilityId,
 * never the seam handle).
 *
 * The class vocabulary is the identity mapping (the catalog-mandated string
 * unions align 1:1 between the semantic and platform sides); control
 * surfaces cross verbatim.
 */
import { mintAurumCapabilityHandle, type AurumSeamRegistry } from "@zcode/shared/aurum-boundary";
import type { AurumTransportCapabilityDescriptor } from "@zcode/shared/aurum-boundary";
import {
  executionEnvironmentUnavailable,
  executionNotFound,
  err,
  ok,
  type ExecutionError,
  type Result,
} from "../domain/errors.js";
import type { ExecutionEnvironment } from "../domain/ports.js";
import type { ExecutionEnvironmentRegistry } from "../domain/ports.js";
import type {
  EnvironmentSelectionQuery,
  ExecutionEnvironmentDescriptor,
} from "../domain/vocabulary.js";
import { matchesSelectionQuery } from "../domain/vocabulary.js";

export interface InProcessEnvironmentRegistry {
  /** The semantic-side registry (domain port). */
  readonly registry: ExecutionEnvironmentRegistry;
  /** The W001 platform-side seam registry. */
  readonly seam: AurumSeamRegistry;
}

function boundaryDescriptorOf(
  descriptor: ExecutionEnvironmentDescriptor,
): AurumTransportCapabilityDescriptor {
  return {
    capabilityId: descriptor.environmentId,
    capabilityClass: descriptor.environmentClass,
    variant: descriptor.variant,
    control: descriptor.control,
    maxConcurrentSubmissions: 0,
    ...(descriptor.notes === undefined ? {} : { notes: descriptor.notes }),
  };
}

/** Builds the in-process registry + seam bridge over registered environments. */
export function createInProcessEnvironmentRegistry(
  environments: readonly ExecutionEnvironment[],
): InProcessEnvironmentRegistry {
  const byEnvironmentId = new Map<string, ExecutionEnvironment>();
  for (const environment of environments) {
    if (byEnvironmentId.has(environment.descriptor.environmentId)) {
      throw new Error(`duplicate environment id ${environment.descriptor.environmentId}`);
    }
    byEnvironmentId.set(environment.descriptor.environmentId, environment);
  }
  const handles = new Map<string, ReturnType<typeof mintAurumCapabilityHandle>>();
  const ordered = environments.map((environment) => environment.descriptor);

  function handleOf(environmentId: string): ReturnType<typeof mintAurumCapabilityHandle> {
    const existing = handles.get(environmentId);
    if (existing !== undefined) return existing;
    const handle = mintAurumCapabilityHandle(`handle:${environmentId}`);
    handles.set(environmentId, handle);
    return handle;
  }

  const registry: ExecutionEnvironmentRegistry = {
    listEnvironments(): readonly ExecutionEnvironmentDescriptor[] {
      return ordered;
    },
    selectEnvironment(
      query: EnvironmentSelectionQuery,
    ): Result<ExecutionEnvironment, ExecutionError> {
      for (const environment of environments) {
        if (matchesSelectionQuery(environment.descriptor, query)) {
          return ok(environment);
        }
      }
      return err(
        executionEnvironmentUnavailable(
          `${query.environmentClass}${query.variant === undefined ? "" : `/${query.variant}`}`,
        ),
      );
    },
    resolveByCapabilityId(capabilityId: string): Result<ExecutionEnvironment, ExecutionError> {
      const found = byEnvironmentId.get(capabilityId);
      if (found === undefined) {
        return err(executionNotFound(`environment ${capabilityId}`));
      }
      return ok(found);
    },
  };

  const seam: AurumSeamRegistry = {
    listCapabilities(): readonly AurumTransportCapabilityDescriptor[] {
      return ordered.map(boundaryDescriptorOf);
    },
    lookup(query) {
      for (const descriptor of ordered) {
        if (
          descriptor.environmentClass === query.capabilityClass &&
          (query.variant === undefined || descriptor.variant === query.variant)
        ) {
          return {
            ok: true as const,
            handle: handleOf(descriptor.environmentId),
            descriptor: boundaryDescriptorOf(descriptor),
          };
        }
      }
      return {
        ok: false as const,
        error: {
          code: "aurum-seam/capability-unavailable" as const,
          message: `no capability for ${query.capabilityClass}${query.variant === undefined ? "" : `/${query.variant}`}`,
          retryable: false,
        },
      };
    },
    describe(handle) {
      const token = handle as string;
      if (token.startsWith("handle:")) {
        const environmentId = token.slice("handle:".length);
        const found = byEnvironmentId.get(environmentId);
        if (found !== undefined) {
          return { ok: true as const, descriptor: boundaryDescriptorOf(found.descriptor) };
        }
      }
      return {
        ok: false as const,
        error: {
          code: "aurum-seam/handle-invalid" as const,
          message: `handle was not issued by this registry: ${token}`,
          retryable: false,
        },
      };
    },
  };

  return { registry, seam };
}
