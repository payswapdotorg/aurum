/**
 * W009 truth-law tripwire (catalog: "plan remains Aurum truth while ZCode
 * workflow is execution substrate"). Source-scans the plans domain layer
 * (and the plan record's structural shape) to prove no execution-session id
 * ever appears in plan records.
 *
 * Tripwires:
 * - no file under src/plans/domain/** imports @aurum/execution or any
 *   execution-substrate module (the plan layer never even links the
 *   execution plane); the substrate adapter lives in adapters/ only.
 * - the ExecutionPlan record type contains NO execution-session-shaped
 *   field (requestId, submissionTicket, ExecutionSession, sessionId,
 *   attemptId, etc.) — the plan is semantic truth; execution sessions are
 *   substrate projections.
 * - the plans domain layer is IO-free (no node: imports, no fetch/timers).
 * - @aurum/domain is imported only through its public package specifier
 *   (no deep paths).
 * - no lint-disable comments anywhere in the plans source.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const plansRoot = join(packageRoot, "src", "plans");
const plansDomainRoot = join(plansRoot, "domain");
const plansAppRoot = join(plansRoot, "app");
const plansAdaptersRoot = join(plansRoot, "adapters");

function walkSources(root: string): string[] {
  const files: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkSources(target));
    else if (target.endsWith(".ts")) files.push(target);
  }
  return files;
}

const EXECUTION_SESSION_FIELD_PATTERN =
  /\b(requestId|submissionTicket|ExecutionSession|sessionId|attemptId|submissionKey|executionSessionId)\b/;

describe("plan-is-truth law (catalog: plan remains Aurum truth)", () => {
  it("no plans/domain source file imports @aurum/execution or any execution seam", () => {
    for (const file of walkSources(plansDomainRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /["']@aurum\/execution/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
      const seamOffenders = source
        .split("\n")
        .filter((line) => /from\s+["'][^"']*execution[^"']*["']/.test(line));
      expect(seamOffenders, `${file}: ${seamOffenders.join("; ")}`).toEqual([]);
    }
  });

  it("no plans/domain source file imports @zcode/shared (the W001 boundary)", () => {
    for (const file of walkSources(plansDomainRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /["']@zcode\/shared/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("the ExecutionPlan record type contains no execution-session-shaped field", () => {
    const recordsSource = readFileSync(join(plansDomainRoot, "records.ts"), "utf8");
    // The ExecutionPlan interface block.
    const planIfaceStart = recordsSource.indexOf("export interface ExecutionPlan");
    expect(planIfaceStart).toBeGreaterThan(-1);
    const planIfaceEnd = recordsSource.indexOf("}", planIfaceStart + "export interface ExecutionPlan".length);
    // Find the matching closing brace by counting braces.
    let depth = 0;
    let endIdx = -1;
    for (let i = planIfaceStart; i < recordsSource.length; i++) {
      const c = recordsSource[i];
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    expect(endIdx).toBeGreaterThan(-1);
    const planIfaceBlock = recordsSource.slice(planIfaceStart, endIdx + 1);
    const offenders: string[] = [];
    const lines = planIfaceBlock.split("\n");
    for (const line of lines) {
      if (EXECUTION_SESSION_FIELD_PATTERN.test(line)) {
        offenders.push(line.trim());
      }
    }
    expect(offenders, `ExecutionPlan has execution-session-shaped fields:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the TaskDag, PlanTask, TaskResourceAllocation records contain no execution-session-shaped field", () => {
    for (const typeName of ["TaskDag", "PlanTask", "TaskResourceAllocation"]) {
      const recordsSource = readFileSync(join(plansDomainRoot, "records.ts"), "utf8");
      const start = recordsSource.indexOf(`export interface ${typeName}`);
      expect(start).toBeGreaterThan(-1);
      let depth = 0;
      let endIdx = -1;
      for (let i = start; i < recordsSource.length; i++) {
        const c = recordsSource[i];
        if (c === "{") depth += 1;
        else if (c === "}") {
          depth -= 1;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
      const block = recordsSource.slice(start, endIdx + 1);
      const offenders = block
        .split("\n")
        .filter((line) => EXECUTION_SESSION_FIELD_PATTERN.test(line))
        .map((line) => line.trim());
      expect(
        offenders,
        `${typeName} has execution-session-shaped fields:\n${offenders.join("\n")}`,
      ).toEqual([]);
    }
  });

  it("the plans domain layer is IO-free (no node: imports, no fetch/timers)", () => {
    for (const file of walkSources(plansDomainRoot)) {
      const source = readFileSync(file, "utf8");
      const nodeImports = source
        .split("\n")
        .filter((line) => /from\s+["']node:/.test(line));
      expect(nodeImports, `${file}: ${nodeImports.join("; ")}`).toEqual([]);
      expect(/\b(fetch|setTimeout|setInterval)\s*\(/.test(source), file).toBe(false);
    }
  });

  it("imports @aurum/domain only through its public package specifier", () => {
    for (const file of walkSources(plansRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /["']@aurum\/domain\/[^"']*["']/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("no lint-disable comments anywhere in plans source", () => {
    for (const file of walkSources(plansRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /(?:oxlint|eslint)-disable/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("the substrate adapter stub does NOT construct an AgentGateway (gated by CR-W009)", () => {
    const adapterSource = readFileSync(
      join(plansAdaptersRoot, "w006-substrate-adapter.ts"),
      "utf8",
    );
    // The real adapter is in a code comment (documented stub). The active
    // module must NOT import @aurum/execution (would fail to compile until
    // CR-W009 wires the dep). Active imports = `export {}` only.
    const activeImports = adapterSource
      .split("\n")
      .filter((line) => /^import\s/.test(line));
    expect(activeImports).toEqual([]);
  });

  it("app + adapters layers may reference the substrate port but never persist execution-session ids on the plan", () => {
    // The app service records completion settlements on TaskCompletionRecord
    // (relay-side) — never on ExecutionPlan. Scan planService.ts for any
    // ExecutionPlan field write that includes a requestId or submissionTicket.
    for (const file of [...walkSources(plansAppRoot), ...walkSources(plansAdaptersRoot)]) {
      const source = readFileSync(file, "utf8");
      // Lines that look like a property write onto an ExecutionPlan-shaped
      // object spread (`...`) — we just look for execution-session ids being
      // placed onto a `plan` or `updated` object literal.
      const lines = source.split("\n");
      for (const line of lines) {
        if (
          /(?:^|\s)(plan|updated|stored)\s*[:.].*\b(requestId|submissionTicket|sessionId|attemptId)\b/.test(
            line,
          )
        ) {
          throw new Error(`${file}: suspicious plan-record write: ${line.trim()}`);
        }
      }
    }
  });
});
