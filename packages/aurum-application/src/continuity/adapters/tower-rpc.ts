/**
 * The wire-agnostic tower RPC envelope (W012 adapters layer, APPROACH R6):
 * `{method, args}` in, the tower service's OWN `Result` out — verbatim, no
 * second validation authority. Method-name MEMBERSHIP and ARITY are checked
 * at the envelope edge; every argument is validated by the owning service
 * exactly as in-process callers are validated (the proofs in
 * test/continuity-rpc.test.ts lock both halves).
 *
 * The transport is deliberately not owned here: the desktop preload bridge
 * carries envelopes over `ipcRenderer.invoke`; a server transport can carry
 * them over fetch/websocket later. The envelope crosses wires as plain
 * JSON — scope, inputs and results are all serializable record types.
 */
import { err, ok, type Result, type TenantScope } from "@aurum/domain";
import {
  continuityInvariant,
  continuityValidationError,
  type ContinuityError,
} from "../domain/errors.js";
import type { MaybePromise, TowerServiceAccess } from "../domain/ports.js";
import type {
  ControlTowerService,
  ConversationTopic,
  TowerReadInput,
} from "../../control-tower/contract.control-tower.js";

/** One RPC call: a tower method name + its positional arguments. */
export interface TowerRpcEnvelope {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** The complete method table (name -> arity), checked at the edge. */
export const TOWER_RPC_METHODS: Readonly<Record<string, number>> = {
  overview: 2,
  conversation: 2,
  createMission: 2,
  advanceMission: 3,
  runMissionToCompletion: 3,
  cancelMission: 3,
  submitPlanForApproval: 2,
  approvePlan: 2,
  rejectPlan: 2,
  activatePlan: 2,
  dispatchTask: 2,
} as const;

function envelopeIssues(envelope: unknown): { method: string; args: readonly unknown[] } | null {
  if (envelope === null || typeof envelope !== "object") return null;
  const candidate = envelope as { method?: unknown; args?: unknown };
  if (typeof candidate.method !== "string") return null;
  if (!Array.isArray(candidate.args)) return null;
  return { method: candidate.method, args: candidate.args };
}

/** Dispatches validated envelopes to the REAL tower service (the handler). */
export interface TowerRpcHandler {
  invoke(envelope: TowerRpcEnvelope): Promise<Result<unknown, ContinuityError>>;
}

export function createTowerRpcHandler(tower: ControlTowerService): TowerRpcHandler {
  return {
    async invoke(envelope: TowerRpcEnvelope): Promise<Result<unknown, ContinuityError>> {
      const shape = envelopeIssues(envelope);
      if (shape === null) {
        return err(
          continuityValidationError([
            { field: "envelope", problem: "must be { method: string, args: unknown[] }" },
          ]),
        );
      }
      const arity = TOWER_RPC_METHODS[shape.method];
      if (arity === undefined) {
        return err(
          continuityValidationError([
            { field: "method", problem: `'${shape.method}' is not a tower method` },
          ]),
        );
      }
      if (shape.args.length !== arity) {
        return err(
          continuityValidationError([
            {
              field: "args",
              problem: `'${shape.method}' expects ${arity} argument(s), got ${shape.args.length}`,
            },
          ]),
        );
      }
      try {
        // No argument validation here — the owning service validates exactly
        // as it does for in-process callers (no second authority, R6).
        const methods = tower as unknown as Record<string, (...args: unknown[]) => unknown>;
        const method = methods[shape.method];
        if (typeof method !== "function") {
          return err(
            continuityValidationError([
              { field: "method", problem: `'${shape.method}' is not callable on this tower` },
            ]),
          );
        }
        const value = await method(...shape.args);
        return ok(value);
      } catch (error) {
        // A throw crossing the envelope edge is a transport-observed crash:
        // typed as a continuity invariant, never swallowed.
        return err(continuityInvariant(`tower call '${shape.method}' threw: ${String(error)}`));
      }
    },
  };
}

/** Carries envelopes across a wire (ipcRenderer.invoke / fetch / loopback). */
export type TowerRpcTransport = (
  envelope: TowerRpcEnvelope,
) => Promise<Result<unknown, ContinuityError>>;

/**
 * The RPC CLIENT: a `TowerServiceAccess` whose every method wraps one
 * envelope. The transport's ok-payload IS the tower's own `Result` — the
 * client returns it VERBATIM (the payload is typed at this boundary; the
 * client performs no validation of its own, R6).
 */
export function createTowerRpcClient(transport: TowerRpcTransport): TowerServiceAccess {
  const call = async (method: string, args: readonly unknown[]): Promise<unknown> => {
    const transported = await transport({ method, args });
    if (!transported.ok) throw transported.error;
    return transported.value;
  };
  return {
    overview: ((scope: TenantScope, input: TowerReadInput) =>
      call("overview", [scope, input])) as TowerServiceAccess["overview"],
    conversation: ((scope: TenantScope, topic: ConversationTopic) =>
      call("conversation", [scope, topic])) as TowerServiceAccess["conversation"],
    createMission: ((...args: Parameters<ControlTowerService["createMission"]>) =>
      call("createMission", args)) as TowerServiceAccess["createMission"],
    advanceMission: ((...args: Parameters<ControlTowerService["advanceMission"]>) =>
      call("advanceMission", args)) as TowerServiceAccess["advanceMission"],
    runMissionToCompletion: ((...args: Parameters<ControlTowerService["runMissionToCompletion"]>) =>
      call("runMissionToCompletion", args)) as TowerServiceAccess["runMissionToCompletion"],
    cancelMission: ((...args: Parameters<ControlTowerService["cancelMission"]>) =>
      call("cancelMission", args)) as TowerServiceAccess["cancelMission"],
    submitPlanForApproval: ((...args: Parameters<ControlTowerService["submitPlanForApproval"]>) =>
      call("submitPlanForApproval", args)) as TowerServiceAccess["submitPlanForApproval"],
    approvePlan: ((...args: Parameters<ControlTowerService["approvePlan"]>) =>
      call("approvePlan", args)) as TowerServiceAccess["approvePlan"],
    rejectPlan: ((...args: Parameters<ControlTowerService["rejectPlan"]>) =>
      call("rejectPlan", args)) as TowerServiceAccess["rejectPlan"],
    activatePlan: ((...args: Parameters<ControlTowerService["activatePlan"]>) =>
      call("activatePlan", args)) as TowerServiceAccess["activatePlan"],
    dispatchTask: ((...args: Parameters<ControlTowerService["dispatchTask"]>) =>
      call("dispatchTask", args)) as TowerServiceAccess["dispatchTask"],
  };
}

/** The client's settled shape for one tower call (proof-suite witness). */
export type TowerRpcSettled<M extends keyof TowerServiceAccess> = MaybePromise<
  ReturnType<TowerServiceAccess[M]>
>;
