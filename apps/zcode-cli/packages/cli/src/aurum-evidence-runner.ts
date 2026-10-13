/**
 * W012 evidence runner — the harness entry the evidence script spawns once
 * per PROCESS. It calls the REAL `runAurumCommand` (the same function the
 * `zcode aurum` dispatch case invokes) with a minimal in-memory
 * RunContext, so each phase is a genuine separate process driving the
 * CLI's own continuity implementation.
 */
import { runAurumCommand } from "./aurum-command.js";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const args = argv.filter((arg) => arg !== "--json");

const exitCode = await runAurumCommand(
  {
    argv: process.argv.slice(2),
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
  },
  {
    browserExecutable: undefined,
    browserUse: undefined,
    detectedLocale: undefined,
    enableWorkflow: false,
    force: false,
    json,
    locale: undefined,
    memoryBench: undefined,
    noColor: true,
    outputFormat: undefined,
    verbose: false,
  },
  args,
);
process.exit(exitCode);
