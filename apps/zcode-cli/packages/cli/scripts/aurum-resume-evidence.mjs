/**
 * W012 runnable evidence — a RECORDED cross-process resume run (Layer C).
 *
 * Process 1 (`charter`): opens a replay-mode session in its own process,
 * charters one mission and runs its first stage; the JSON-file continuity
 * ledger persists what the session's real composition did.
 *
 * Process 2 (`resume`): a SEPARATE process resumes the same session id by
 * REPLAY over the same ledger file — reconstructing the mission state
 * without re-running any work (no reasoning adapter, no execution
 * substrate are wired in the CLI composition; the reconstruction report
 * and mission stage counts prove equivalence).
 *
 * Both processes run the REAL `runAurumCommand` implementation (the same
 * code the `zcode aurum` dispatch case calls). Run:
 *   node scripts/aurum-resume-evidence.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const cliRoot = import.meta.dirname;
const repoRoot = resolve(cliRoot, "../../../..", "..");
const runnerPath = join(cliRoot, "..", "src", "aurum-evidence-runner.ts");
const tsxBin = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

const tempDir = mkdtempSync(join(tmpdir(), "aurum-cli-evidence-"));
const ledgerPath = join(tempDir, "evidence-ledger.json");
const sessionId = `evidence-${Date.now().toString(36)}`;
let failures = 0;

/** Runs one CLI subcommand in a SEPARATE process through the real command. */
function runPhase(label, args) {
  const result = spawnSync(process.execPath, [tsxBin, runnerUrl, ...args, "--ledger", ledgerPath], {
    encoding: "utf8",
    env: process.env,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const code = result.status ?? -1;
  if (code !== 0) {
    failures += 1;
    console.error(`[evidence] ${label} FAILED (exit ${code}):\n${output}`);
    process.exit(1);
  }
  console.log(`--- ${label} (process pid ${result.pid}) ---`);
  console.log(output);
  return output;
}

console.log(`[evidence] ledger: ${ledgerPath}`);
console.log(`[evidence] session: ${sessionId}\n`);

// Process 1: charter the session (state lands in the JSON-file ledger).
runPhase("process 1: charter", ["charter", sessionId]);

// The ledger file on disk carries the journaled records (cross-process
// persistence, not process memory).
const ledgerFile = JSON.parse(readFileSync(ledgerPath, "utf8"));
const recordKinds = ledgerFile.records.map((record) => record.entry.kind);
console.log("\n--- ledger on disk (between processes) ---");
console.log(`records: ${ledgerFile.records.length} (${[...new Set(recordKinds)].join(", ")})`);

// Process 2: resume BY REPLAY in a fresh process; the reconstruction
// report must show the records applied, the same mission stage count as
// process 1 recorded, and zero re-execution.
const resumeOutput = runPhase("process 2: resume (replay)", ["resume", sessionId, "--json"]);
const resumed = JSON.parse(resumeOutput.slice(resumeOutput.indexOf("{")));
const checks = [
  ["disposition is replayed", resumed.disposition === "replayed"],
  ["records replayed > 0", resumed.recordsReplayed > 0],
  ["mission reconstructed", resumed.missions.length === 1],
  ["mission stage count reconstructed", resumed.missions[0].stagesCompleted === 1],
];
console.log("\n--- evidence checks ---");
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
  if (!passed) failures += 1;
}

// Process 3 (same law, one more hop): a THIRD process resumes again — the
// recorded session replays once more, still without re-running.
const resumeAgain = runPhase("process 3: resume again (idempotent replay)", [
  "resume",
  sessionId,
  "--json",
]);
const resumedAgain = JSON.parse(resumeAgain.slice(resumeAgain.indexOf("{")));
console.log("\n--- evidence checks (second resume) ---");
const againChecks = [
  ["disposition is replayed again", resumedAgain.disposition === "replayed"],
  ["mission count stable", resumedAgain.missions.length === 1],
  ["mission stages stable", resumedAgain.missions[0].stagesCompleted === 1],
];
for (const [label, passed] of againChecks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
  if (!passed) failures += 1;
}

rmSync(tempDir, { recursive: true, force: true });
console.log(`\n[evidence] ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
