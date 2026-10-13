/**
 * Aurum tower IPC vocabulary (W012 Layer B): the TWO shared constants of
 * the surgical desktop mount (APPROACH R7) — ONE IPC channel carrying the
 * wire-agnostic tower RPC envelope, and ONE command id opening the tower
 * window. Deliberately dependency-free (no Electron, no @aurum imports) so
 * the preload bridge — which bundles separately and cannot reach the
 * application package — includes the same source file; the payload shape
 * is the wire-agnostic envelope, mirrored structurally here (the
 * compile-time witness lives in towerSessionHost.ts, which has the
 * application types).
 */
/** The single IPC channel: renderer → main tower envelope invocations. */
export const AURUM_TOWER_IPC_CHANNEL = "zcode:aurum-tower-invoke";

/** The single desktop command id: open (or focus) the Aurum tower window. */
export const AURUM_TOWER_OPEN_COMMAND_ID = "help.open-aurum-tower";

/**
 * The payload shape crossing the channel. Structural mirror of the
 * application package's `TowerRpcEnvelope` — kept local so the preload
 * (a separate bundle without @aurum/application) can share the constants.
 */
export interface AurumTowerIpcPayload {
  readonly method: string;
  readonly args: readonly unknown[];
}
