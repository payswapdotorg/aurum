/**
 * Aurum tower preload bridge (W012 Layer B): the ONE contextBridge surface
 * of the desktop mount. The renderer's tower page sends wire-agnostic
 * tower RPC envelopes; this bridge forwards them over the single IPC
 * channel. No semantic logic lives here — method membership + arity are
 * checked at the envelope edge in the main-process handler; every argument
 * is validated by the owning service (APPROACH R6: no second authority).
 */
import { contextBridge, ipcRenderer } from "electron";
import { AURUM_TOWER_IPC_CHANNEL } from "../main/aurum/towerIpc.js";

contextBridge.exposeInMainWorld("aurumTower", {
  /**
   * Invokes one tower RPC envelope on the live continuous session. The
   * returned payload is the tower service's OWN Result, verbatim (or the
   * envelope edge's typed refusal).
   */
  invoke: (envelope: unknown): Promise<unknown> =>
    ipcRenderer.invoke(AURUM_TOWER_IPC_CHANNEL, envelope),
});
