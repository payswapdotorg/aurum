/**
 * Aurum tower page (W012 Layer B): the desktop renderer mount — the WEB
 * tower components (source-alias reuse, the W010 mount-agnostic ruling)
 * over the RPC client behind the SAME `TowerSession` shape. The
 * composition swap is exactly one object: `{ tower: rpcClient }` instead of
 * the web's in-process `createLocalControlTowerRuntime()`. The live
 * continuous session lives in the MAIN process — reloading this page
 * re-attaches to the SAME live runtime (desktop continuity, R3).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  continuityInvariant,
  createTowerRpcClient,
  tenantScope,
  type ContinuityError,
  type TowerRpcEnvelope,
  type TowerServiceAccess,
} from "@aurum/application";
import { TowerApp } from "../../../../../web/src/tower/TowerApp.js";
import type { TowerSession } from "../../../../../web/src/tower/towerRuntime.js";

declare global {
  interface Window {
    /** The preload bridge (context isolation): tower envelopes over IPC. */
    readonly aurumTower?: {
      readonly invoke: (envelope: TowerRpcEnvelope) => Promise<unknown>;
    };
  }
}

/** The serialized transport payload (the tower Result or an edge refusal). */
type TowerTransportPayload =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: ContinuityError };

const TOWER_TENANT = "studio";

/** The transport: preload bridge → single IPC channel → main handler. */
function towerTransport(envelope: TowerRpcEnvelope): Promise<TowerTransportPayload> {
  const bridge = window.aurumTower;
  if (bridge === undefined) {
    return Promise.resolve({
      ok: false as const,
      error: continuityInvariant("the aurum tower preload bridge is not available in this window"),
    });
  }
  return bridge
    .invoke(envelope)
    .then((payload) => payload as TowerTransportPayload)
    .catch((error: unknown) => ({
      ok: false as const,
      error: continuityInvariant(`tower transport failed: ${String(error)}`),
    }));
}

function mountTowerPage(): void {
  const root = document.getElementById("root");
  if (root === null) throw new Error("aurum tower page: #root is missing");
  const scoped = tenantScope(TOWER_TENANT);
  if (!scoped.ok) throw new Error(`Invalid tower tenant name: ${TOWER_TENANT}`);
  const tower: TowerServiceAccess = createTowerRpcClient(towerTransport);
  // THE composition swap (W010's "one composition swapped per variant"):
  // the web hands the full local runtime; the desktop hands the RPC client
  // over the live main-process session. Same TowerSession shape.
  const session: TowerSession = { runtime: { tower }, scope: scoped.value };
  createRoot(root).render(
    <StrictMode>
      <TowerApp session={session} />
    </StrictMode>,
  );
}

mountTowerPage();
