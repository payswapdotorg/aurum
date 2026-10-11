/**
 * Aurum-facing platform boundary — capability vocabulary (W001).
 *
 * A capability descriptor answers ONE question: "what classes of execution
 * environment can this platform run?" It is a plain, string-union-typed
 * inventory of substrate execution surfaces — the exact classes mandated by
 * spec/WORK-ITEM-CATALOG.md §W001 (local / browser / computer / workflow /
 * remote / sandbox) — plus control flags the transport port can honor.
 *
 * Descriptors carry no configuration, no credentials, no addresses and no
 * Aurum semantics: everything environment-specific stays behind the seam,
 * reachable only through the opaque handle issued by the seam registry
 * (seam.ts).
 */

/**
 * Execution-environment classes the platform can run. Plain string union by
 * mandate (never an object graph, never a registry of instances).
 *
 * - `local` — local workspace process execution (ZCode local substrate).
 * - `browser` — browser automation environment (browser-use substrate).
 * - `computer` — computer-use environment (desktop/GUI driving substrate).
 * - `workflow` — dynamic workflow backend (execution substrate for plans).
 * - `remote` — remote workspace attachment (ssh/wsl/docker remotes).
 * - `sandbox` — isolated/sandboxed environment.
 */
export const AURUM_TRANSPORT_CAPABILITY_CLASSES = [
  "local",
  "browser",
  "computer",
  "workflow",
  "remote",
  "sandbox",
] as const;

/** Execution-environment class (plain string union). */
export type AurumTransportCapabilityClass = (typeof AURUM_TRANSPORT_CAPABILITY_CLASSES)[number];

/** Type guard for a capability class value. */
export function isAurumTransportCapabilityClass(
  value: unknown,
): value is AurumTransportCapabilityClass {
  return (
    typeof value === "string" &&
    (AURUM_TRANSPORT_CAPABILITY_CLASSES as readonly string[]).includes(value)
  );
}

/**
 * Which control operations the platform can actually honor for submissions
 * running on this capability. Adapters MUST reject unsupported control
 * requests with the typed error `aurum-transport/control-unsupported` rather
 * than silently no-opping.
 */
export interface AurumTransportControlSurface {
  /** Cancel requests are honored for in-flight submissions. */
  readonly cancellable: boolean;
  /** Pause requests are honored for in-flight submissions. */
  readonly pausable: boolean;
  /** Resume requests are honored for paused submissions. */
  readonly resumable: boolean;
}

/**
 * Static description of one platform capability. All identifying fields are
 * opaque strings; none of them are addresses, secrets or semantic ids.
 */
export interface AurumTransportCapabilityDescriptor {
  /**
   * Opaque, stable identifier for this capability as issued by the substrate
   * adapter. Unique within one seam registry; carries no meaning across
   * restarts unless the adapter promises stability.
   */
  readonly capabilityId: string;
  /** Execution-environment class. */
  readonly capabilityClass: AurumTransportCapabilityClass;
  /**
   * Opaque variant label distinguishing concrete environments inside one
   * class (e.g. a headless versus interactive browser). Free-form string;
   * never parsed by the boundary or by Aurum contracts.
   */
  readonly variant: string;
  /** Control operations honored on this capability. */
  readonly control: AurumTransportControlSurface;
  /**
   * Maximum simultaneous in-flight submissions the adapter accepts on this
   * capability. `0` means "platform decides" (no explicit bound promised).
   */
  readonly maxConcurrentSubmissions: number;
  /**
   * Human-facing note from the adapter. Diagnostic only — MUST NOT be used
   * for any decision; it is not semantic authority.
   */
  readonly notes?: string;
}
