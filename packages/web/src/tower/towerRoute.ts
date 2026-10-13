/**
 * Aurum control-tower route module (W010 Layer B): pure pathname matching
 * for the tree of tower routes. This module is deliberately trivial and
 * dependency-free — it is the only routing logic the tower surface owns,
 * and it stays typechecked (no web test infrastructure exists; proofs of
 * the semantics live in aurum-application's vitest suites).
 *
 * Route shapes:
 * - /tower                      → the Today board (primary IA)
 * - /tower/mission/<id>         → a conversation thread over one mission
 * - /tower/plan/<id>            → a conversation thread over one plan
 * - anything else under /tower  → the board (honest fallback, no 404 game)
 */

/** What the tower surface should render for a pathname. */
export type TowerRoute =
  | { readonly kind: "board" }
  | { readonly kind: "mission"; readonly missionId: string }
  | { readonly kind: "plan"; readonly planId: string };

const TOWER_PREFIX = "/tower";

/** Whether a pathname belongs to the tower surface at all. */
export function isTowerPath(pathname: string): boolean {
  return pathname === TOWER_PREFIX || pathname.startsWith(`${TOWER_PREFIX}/`);
}

/** Resolves the tower route for a pathname (null when not a tower path). */
export function resolveTowerRoute(pathname: string): TowerRoute | null {
  if (!isTowerPath(pathname)) return null;
  const rest = pathname.slice(TOWER_PREFIX.length).replace(/^\/+/, "");
  if (rest.length === 0) return { kind: "board" };
  const separator = rest.indexOf("/");
  if (separator === -1) return { kind: "board" };
  const kind = rest.slice(0, separator);
  const rawId = rest.slice(separator + 1);
  const id = decodeURIComponent(rawId);
  if (id.length === 0) return { kind: "board" };
  if (kind === "mission") return { kind: "mission", missionId: id };
  if (kind === "plan") return { kind: "plan", planId: id };
  return { kind: "board" };
}

/** The canonical path of a tower route (for links + history updates). */
export function towerPathOf(route: TowerRoute): string {
  switch (route.kind) {
    case "board":
      return TOWER_PREFIX;
    case "mission":
      return `${TOWER_PREFIX}/mission/${encodeURIComponent(route.missionId)}`;
    case "plan":
      return `${TOWER_PREFIX}/plan/${encodeURIComponent(route.planId)}`;
  }
}
