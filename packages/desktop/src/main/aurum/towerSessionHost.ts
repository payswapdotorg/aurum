/**
 * Aurum tower session host (W012 Layer B): the main-process CONTINUOUS
 * session (APPROACH R3) — the live recording runtime outlives renderer
 * reloads; a re-attach returns the SAME live tower. ONE JSON-file
 * continuity ledger under userData journals what the session's real
 * composition did (the cross-platform replay source); the file-system
 * attachment surface materializes remote attachments next to it.
 *
 * The desktop mount wires NO model adapter and NO remote execution plane:
 * the default reasoning port refuses honestly (`mission-model-refused`,
 * mission stays resumable at the reason boundary), exactly like the W010
 * web composition. The transport is the wire-agnostic tower RPC envelope
 * (R6): method membership + arity are checked at the envelope edge; every
 * argument is validated by the owning service.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ipcMain } from "electron";
import {
  createContinuousTowerSession,
  createContinuityService,
  createFileSystemAttachmentSurface,
  createJsonFileContinuityLedger,
  createTowerReplayer,
  createTowerRpcHandler,
  domainTime,
  type ContinuityService,
  type LiveTowerSession,
  type TowerRpcEnvelope,
  type TowerRpcHandler,
} from "@aurum/application";
import { AURUM_TOWER_IPC_CHANNEL, type AurumTowerIpcPayload } from "./towerIpc.js";

/** Compile-time witness: the local payload mirror IS the wire envelope. */
const _payloadMatchesEnvelope: AurumTowerIpcPayload extends TowerRpcEnvelope
  ? TowerRpcEnvelope extends AurumTowerIpcPayload
    ? true
    : never
  : never = true;
void _payloadMatchesEnvelope;

/** The one desktop tower session (stable id; ensureSession is idempotent). */
const DESKTOP_TOWER_SESSION_ID = "desktop-tower";
const DESKTOP_TOWER_TENANT = "studio";

interface AurumTowerHost {
  /** The continuity service (ledger + surface + the live registry). */
  readonly service: ContinuityService;
  /** The live continuous session (created or attached — always the same). */
  readonly session: LiveTowerSession;
  /** The envelope handler over the live session's tower service. */
  readonly handler: TowerRpcHandler;
}

let host: AurumTowerHost | null = null;
let registered = false;

/**
 * Starts (or returns) the desktop-continuous tower session host. The ledger
 * + attachment directories live under `<userData>/aurum-continuity/`; the
 * session id is stable, so a desktop restart RESUMES the recorded session
 * by replay (the continuity service's recovery path) instead of forking a
 * new one — remote recovery never duplicates runs.
 */
export async function ensureAurumTowerHost(options: {
  readonly userDataPath: string;
  readonly now?: () => number;
}): Promise<AurumTowerHost> {
  if (host !== null) return host;
  const continuityRoot = join(options.userDataPath, "aurum-continuity");
  mkdirSync(continuityRoot, { recursive: true });
  const ledger = createJsonFileContinuityLedger(join(continuityRoot, "tower-ledger.json"));
  const surface = createFileSystemAttachmentSurface(join(continuityRoot, "attachments"));
  const service = createContinuityService({
    ledger,
    surface,
    compose: createContinuousTowerSession({ ledger }),
    replay: createTowerReplayer({ ledger }),
  });
  const now = domainTime((options.now ?? Date.now)());
  if (!now.ok) {
    throw new Error("aurum tower host: system clock is not a valid domain time");
  }
  const ensured = await service.ensureSession({
    sessionId: DESKTOP_TOWER_SESSION_ID,
    tenantName: DESKTOP_TOWER_TENANT,
    operator: { kind: "system", name: "zcode-desktop" },
    variant: "desktop",
    mode: "continuous",
    now: now.value,
    cause: "desktop session host start",
  });
  if (!ensured.ok) {
    throw new Error(`aurum tower host cannot ensure its session: ${ensured.error.message}`);
  }
  const attached = service.attachSession(DESKTOP_TOWER_SESSION_ID);
  if (!attached.ok) {
    throw new Error(`aurum tower host cannot attach its session: ${attached.error.message}`);
  }
  host = {
    service,
    session: attached.value,
    handler: createTowerRpcHandler(attached.value.runtime.tower),
  };
  return host;
}

/**
 * Registers the ONE IPC channel (idempotent): the renderer's tower page
 * invokes wire-agnostic envelopes; the handler checks method membership +
 * arity at the edge and dispatches to the LIVE tower service.
 */
export async function registerAurumTowerIpc(options: {
  readonly userDataPath: string;
  readonly logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  readonly now?: () => number;
}): Promise<void> {
  if (registered) return;
  const towerHost = await ensureAurumTowerHost(options);
  ipcMain.handle(AURUM_TOWER_IPC_CHANNEL, (_event, envelope: unknown) => {
    return towerHost.handler.invoke(envelope as TowerRpcEnvelope);
  });
  registered = true;
  options.logger.info(
    `[aurum-tower] continuous session host ready (session=${DESKTOP_TOWER_SESSION_ID}, disposition=live)`,
  );
}

/** Test/teardown hook: forget the process-resident host + channel. */
export function resetAurumTowerHostForTests(): void {
  if (registered) {
    ipcMain.removeHandler(AURUM_TOWER_IPC_CHANNEL);
    registered = false;
  }
  host = null;
}
