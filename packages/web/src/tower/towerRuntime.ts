/**
 * Aurum control-tower runtime composition (W010 Layer B): the web variant
 * mounts the CANONICAL LOCAL RUNTIME exported from the application package
 * — the real domain kernel + the four real public services + the tower,
 * composed in-process. The web holds no record-mutation code of its own:
 * reads go through tower view models, actions through tower delegation.
 *
 * W012 WIDENING (the TowerServiceAccess ruling): the session type now
 * carries the TRANSPORT-TARGET surface — `runtime.tower` may satisfy its
 * reads/results synchronously (this local composition) or asynchronously
 * (an RPC client over the wire-agnostic envelope). The web mount keeps the
 * in-process composition today; the desktop renderer swaps in the RPC
 * client behind the SAME `TowerSession` shape (one composition swapped per
 * variant — the W010 ruling, transport-ready).
 *
 * HONEST COMPOSITION BOUNDS (mirror of the application-side headers):
 * - in-memory, session-scoped: reloading the page starts a fresh kernel
 *   (the browser composition is a projection variant, never a second
 *   persistent company truth; the storage-backed replayable composition is
 *   the W012 continuity layer, landed in the application package);
 * - the default reasoning port REFUSES: advancing through the reason stage
 *   returns the typed `mission-model-refused` and the mission stays
 *   resumable at that boundary — nothing is ever fabricated (a wired
 *   reasoner returning no admissible content is what completes with
 *   `knowledge-gap-remains`);
 * - no authenticated identity: the operator id is a local label, and the
 *   kernel authority still decides every consequential transition (the
 *   approve citation law cannot be bypassed from the UI).
 */
import {
  createLocalControlTowerRuntime,
  tenantScope,
  type LocalControlTowerRuntime,
  type TenantScope,
  type TowerServiceAccess,
} from "@aurum/application";

/**
 * What a tower UI needs from its session's runtime: the tower service
 * (reads + delegated actions), possibly arriving over a transport. The
 * full local runtime satisfies this structurally; an RPC-backed session
 * provides exactly this shape.
 */
export interface TowerRuntimeAccess {
  readonly tower: TowerServiceAccess;
}

/** One browser session: the composed runtime + its tenant scope. */
export interface TowerSession {
  readonly runtime: TowerRuntimeAccess;
  readonly scope: TenantScope;
}

const SESSION_TENANT = "studio";

/** Creates the session composition (one per browser page load). */
export function createTowerSession(tenantName: string = SESSION_TENANT): TowerSession {
  const scoped = tenantScope(tenantName);
  if (!scoped.ok) {
    throw new Error(`Invalid control-tower tenant name: ${tenantName}`);
  }
  const runtime: LocalControlTowerRuntime = createLocalControlTowerRuntime();
  return { runtime, scope: scoped.value };
}
