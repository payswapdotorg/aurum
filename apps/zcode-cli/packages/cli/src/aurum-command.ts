/**
 * `zcode aurum` — the CLI mount of the Aurum cross-platform continuity
 * (W012 Layer C): REPLAY-mode sessions over a JSON-file continuity ledger.
 * Every invocation is its own process; sessions reconstruct by REPLAYING
 * the recorded semantic records — never by re-running work (no model
 * invocation, no task dispatch: the CLI composition wires no reasoning
 * adapter and no execution substrate; the honest default refusals apply).
 *
 * Subcommands:
 *   status                list the sessions recorded in the ledger
 *   charter <sessionId>   open a replay session, charter one mission and
 *                         run its FIRST stage (orient — reads only), then
 *                         exit; the ledger carries the journaled state
 *   resume <sessionId>    resume the recorded session IN THIS PROCESS by
 *                         replay, print the reconstruction report
 *
 * The cross-process evidence run (scripts/aurum-resume-evidence.mjs) drives
 * charter in one process and resume in another over the same ledger file.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { RunContext, GlobalOptions } from "@zcode/shared-types";
import {
  createContinuousTowerSession,
  createContinuityService,
  createInMemoryAttachmentSurface,
  createJsonFileContinuityLedger,
  createTowerReplayer,
  domainTime,
  tenantScope,
  type ContinuityService,
  type DomainTimestamp,
} from "@aurum/application";

const AURUM_COMMAND_USAGE = `Usage: zcode aurum <status|charter|resume> [sessionId] [--ledger <path>] [--tenant <name>]

  status                List the sessions recorded in the continuity ledger
  charter <sessionId>   Open a replay session, charter one mission, run its
                        first stage (orient), then exit — the ledger persists
  resume <sessionId>    Resume the recorded session in THIS process by replay
                        (reconstruction only: zero model invocations, zero
                        substrate submissions)

Options:
  --ledger <path>   Continuity ledger file (default: ~/.zcode/aurum-continuity.json)
  --tenant <name>   Tenant name for the session scope (default: studio)`;

const DEFAULT_LEDGER_PATH = () => resolve(homedir(), ".zcode", "aurum-continuity.json");
const DEFAULT_TENANT = "studio";

interface AurumCommandFlags {
  readonly ledgerPath: string;
  readonly tenantName: string;
  readonly sessionId?: string;
}

function parseAurumFlags(args: readonly string[]): AurumCommandFlags | null {
  const flags: { ledgerPath?: string; tenantName?: string; sessionId?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--ledger") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      flags.ledgerPath = value;
      index += 1;
    } else if (arg === "--tenant") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      flags.tenantName = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      return null; // unknown flag
    } else if (flags.sessionId === undefined) {
      flags.sessionId = arg;
    } else {
      return null; // more than one positional
    }
  }
  return {
    ledgerPath: flags.ledgerPath ?? DEFAULT_LEDGER_PATH(),
    tenantName: flags.tenantName ?? DEFAULT_TENANT,
    sessionId: flags.sessionId,
  };
}

/**
 * Composes the CLI continuity service over one JSON-file ledger: the
 * REPLAY composition (variant "cli", mode "replay"). The reasoning port is
 * the unwired refuser and the substrate is the in-process reference — the
 * honest defaults; replay never touches either.
 */
export function composeAurumCliService(ledgerPath: string): ContinuityService {
  const absolute = resolve(ledgerPath);
  mkdirSync(dirname(absolute), { recursive: true });
  const ledger = createJsonFileContinuityLedger(absolute);
  return createContinuityService({
    ledger,
    surface: createInMemoryAttachmentSurface(),
    compose: createContinuousTowerSession({ ledger }),
    replay: createTowerReplayer({ ledger }),
  });
}

function domainNow(): DomainTimestamp {
  const now = domainTime(Date.now());
  if (!now.ok) throw new Error("system clock is not a valid domain time");
  return now.value;
}

function writeLine(ctx: RunContext, text: string): void {
  ctx.stdout.write(`${text}\n`);
}

const runAurumStatus = (ctx: RunContext, options: GlobalOptions, flags: AurumCommandFlags): number => {
  const service = composeAurumCliService(flags.ledgerPath);
  const sessions = service.listSessions();
  if (options.json) {
    writeLine(
      ctx,
      JSON.stringify(
        {
          ledger: flags.ledgerPath,
          sessions: sessions.map((info) => ({
            sessionId: info.sessionId,
            tenantId: info.tenantId,
            variant: info.variant,
            mode: info.mode,
            live: info.live,
            recordCount: info.recordCount,
            attachmentCount: info.attachmentCount,
            resumes: info.resumes.length,
            openedAt: info.openedAt,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  writeLine(ctx, `Aurum continuity ledger: ${flags.ledgerPath}`);
  if (sessions.length === 0) {
    writeLine(ctx, "No recorded sessions (charter one with `zcode aurum charter <sessionId>`).");
    return 0;
  }
  for (const info of sessions) {
    writeLine(
      ctx,
      `${info.sessionId}  tenant=${info.tenantId} variant=${info.variant} mode=${info.mode} ` +
        `records=${info.recordCount} resumes=${info.resumes.length} attachments=${info.attachmentCount}` +
        `${info.live ? "  [live in this process]" : ""}`,
    );
  }
  return 0;
};

const runAurumCharter = async (
  ctx: RunContext,
  options: GlobalOptions,
  flags: AurumCommandFlags,
  sessionId: string,
): Promise<number> => {
  const service = composeAurumCliService(flags.ledgerPath);
  const scope = tenantScope(flags.tenantName);
  if (!scope.ok) {
    writeLine(ctx, `Invalid tenant name: ${flags.tenantName}`);
    return 1;
  }
  const now = domainNow();
  const ensured = await service.ensureSession({
    sessionId,
    tenantName: flags.tenantName,
    operator: { kind: "system", name: "zcode-cli" },
    variant: "cli",
    mode: "replay",
    now,
    cause: "cli charter",
  });
  if (!ensured.ok) {
    writeLine(ctx, `aurum charter failed: ${ensured.error.message}`);
    return 1;
  }
  const attached = service.attachSession(sessionId);
  if (!attached.ok) {
    writeLine(ctx, `aurum charter failed: ${attached.error.message}`);
    return 1;
  }
  const missionId = `mission-${sessionId}-${now.toString(36)}`;
  const tower = attached.value.runtime.tower;
  const created = await tower.createMission(scope.value, {
    missionId,
    subject: { kind: "topic", id: "operations" },
    question: "What should the company learn next?",
    consequence: "Operating blind spots persist",
    createdBy: { kind: "system", name: "zcode-cli" },
    now,
  });
  if (!created.ok) {
    writeLine(ctx, `aurum charter failed: ${created.error.message}`);
    return 1;
  }
  // ONE stage (orient — reads only; no model is wired in this composition,
  // so the mission honestly stops at the reason boundary on later runs).
  const advanced = await tower.advanceMission(scope.value, missionId, { now });
  if (!advanced.ok) {
    writeLine(ctx, `aurum charter failed: ${advanced.error.message}`);
    return 1;
  }
  if (options.json) {
    writeLine(
      ctx,
      JSON.stringify(
        {
          disposition: ensured.value.disposition,
          sessionId,
          missionId,
          stage: advanced.value.stages.length,
          status: advanced.value.status,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  writeLine(
    ctx,
    `Chartered ${missionId} in session ${sessionId} (disposition: ${ensured.value.disposition}); ` +
      `stage ${advanced.value.stages.length} recorded. Ledger: ${flags.ledgerPath}`,
  );
  return 0;
};

const runAurumResume = async (
  ctx: RunContext,
  options: GlobalOptions,
  flags: AurumCommandFlags,
  sessionId: string,
): Promise<number> => {
  const service = composeAurumCliService(flags.ledgerPath);
  const now = domainNow();
  const ensured = await service.ensureSession({
    sessionId,
    tenantName: flags.tenantName,
    operator: { kind: "system", name: "zcode-cli" },
    variant: "cli",
    mode: "replay",
    now,
    cause: "cli resume",
  });
  if (!ensured.ok) {
    writeLine(ctx, `aurum resume failed: ${ensured.error.message}`);
    return 1;
  }
  const info = service.sessionInfo(sessionId);
  if (!info.ok) {
    writeLine(ctx, `aurum resume failed: ${info.error.message}`);
    return 1;
  }
  const attached = service.attachSession(sessionId);
  if (!attached.ok) {
    writeLine(ctx, `aurum resume failed: ${attached.error.message}`);
    return 1;
  }
  const scope = tenantScope(flags.tenantName);
  if (!scope.ok) {
    writeLine(ctx, `Invalid tenant name: ${flags.tenantName}`);
    return 1;
  }
  const overview = await attached.value.runtime.tower.overview(scope.value, {
    now,
    askedBy: { kind: "system", name: "zcode-cli" },
    reason: "cli resume reconstruction read",
  });
  if (!overview.ok) {
    writeLine(ctx, `aurum resume failed: ${JSON.stringify(overview.error)}`);
    return 1;
  }
  if (options.json) {
    writeLine(
      ctx,
      JSON.stringify(
        {
          disposition: ensured.value.disposition,
          sessionId,
          recordsReplayed: ensured.value.report?.recordsApplied ?? 0,
          replayedByKind: ensured.value.report?.byKind ?? {},
          missions: overview.value.missions.map((mission) => ({
            missionId: mission.missionId,
            status: mission.status,
            stagesCompleted: mission.stagesCompleted,
            totalStages: mission.totalStages,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const report = ensured.value.report;
  writeLine(ctx, `Resumed session ${sessionId} (disposition: ${ensured.value.disposition}).`);
  if (report !== undefined) {
    writeLine(
      ctx,
      `Replayed ${report.recordsApplied} records by kind: ${Object.entries(report.byKind)
        .map(([kind, count]) => `${kind}×${count}`)
        .join(", ")}`,
    );
  }
  writeLine(
    ctx,
    "Reconstruction only: zero model invocations, zero substrate submissions " +
      "(no reasoning adapter and no execution substrate are wired in this composition).",
  );
  for (const mission of overview.value.missions) {
    writeLine(
      ctx,
      `  mission ${mission.missionId}: ${mission.status} (${mission.stagesCompleted}/${mission.totalStages} stages)`,
    );
  }
  return 0;
};

export const runAurumCommand = async (
  ctx: RunContext,
  options: GlobalOptions,
  args: readonly string[],
): Promise<number> => {
  const subcommand = args[0];
  if (subcommand === undefined || subcommand === "help" || subcommand === "--help") {
    writeLine(ctx, AURUM_COMMAND_USAGE);
    return subcommand === undefined ? 1 : 0;
  }
  const flags = parseAurumFlags(args.slice(1));
  if (flags === null) {
    writeLine(ctx, AURUM_COMMAND_USAGE);
    return 1;
  }
  if (subcommand === "status") {
    return runAurumStatus(ctx, options, flags);
  }
  if (subcommand === "charter") {
    if (flags.sessionId === undefined) {
      writeLine(ctx, AURUM_COMMAND_USAGE);
      return 1;
    }
    return runAurumCharter(ctx, options, flags, flags.sessionId);
  }
  if (subcommand === "resume") {
    if (flags.sessionId === undefined) {
      writeLine(ctx, AURUM_COMMAND_USAGE);
      return 1;
    }
    return runAurumResume(ctx, options, flags, flags.sessionId);
  }
  writeLine(ctx, `Unknown aurum subcommand: ${subcommand}\n${AURUM_COMMAND_USAGE}`);
  return 1;
};
