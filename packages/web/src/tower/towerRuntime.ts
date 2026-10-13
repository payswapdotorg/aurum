/**
 * Aurum control-tower runtime composition (W010 Layer B): the web variant
 * mounts the CANONICAL LOCAL RUNTIME exported from the application package
 * — the real domain kernel + the four real public services + the tower,
 * composed in-process. The web holds no record-mutation code of its own:
 * reads go through tower view models, actions through tower delegation.
 *
 * HONEST COMPOSITION BOUNDS (mirror of the application-side headers):
 * - in-memory, session-scoped: reloading the page starts a fresh kernel
 *   (the browser composition is a projection variant, never a second
 *   persistent company truth; server transport + persistence are W012/P3);
 * - the default reasoning port REFUSES: missions driven from this surface
 *   complete with `knowledge-gap-remains` rather than fabricating content
 *   (a provider-plane reasoning adapter is follow-up wiring);
 * - no authenticated identity: the operator id is a local label, and the
 *   kernel authority still decides every consequential transition (the
 *   approve citation law cannot be bypassed from the UI).
 */
import {
  createLocalControlTowerRuntime,
  tenantScope,
  type LocalControlTowerRuntime,
  type TenantScope,
} from "@aurum/application";

/** One browser session: the composed runtime + its tenant scope. */
export interface TowerSession {
  readonly runtime: LocalControlTowerRuntime;
  readonly scope: TenantScope;
}

const SESSION_TENANT = "studio";

/** Creates the session composition (one per browser page load). */
export function createTowerSession(tenantName: string = SESSION_TENANT): TowerSession {
  const scoped = tenantScope(tenantName);
  if (!scoped.ok) {
    throw new Error(`Invalid control-tower tenant name: ${tenantName}`);
  }
  return { runtime: createLocalControlTowerRuntime(), scope: scoped.value };
}
