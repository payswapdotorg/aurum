/**
 * W010 ACCEPTANCE (structural, catalog clauses 2+3): the control tower is a
 * PROJECTION, never a second authority. Source-locked tripwires:
 *
 * - THE AUTHORITY LAW: the tower's domain + app layers hold NO kernel — no
 *   `createDomainKernel`, no `AurumDomainKernel`, no kernel store handles;
 *   the only kernel composition lives in the ADAPTERS layer (the canonical
 *   local runtime), which is the composition point the web variant mounts;
 * - the ControlTowerDeps picks are exactly the read seams + the nine
 *   delegated actions — no createPlan, no issueHandoff, no kernel
 *   approve/authorize picks, no execution-plane import anywhere in the
 *   tower;
 * - the public surface exports no kernel-shaped or execution-shaped
 *   capability (no createDomainKernel re-export, no run/submit/invoke/...);
 * - the tower domain layer is IO-free;
 * - @aurum/domain only through its package entrypoint (no deep paths);
 * - no lint-disable comments anywhere in the package source.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as surface from "../src/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const towerRoot = join(packageRoot, "src", "control-tower");
const towerDomainRoot = join(towerRoot, "domain");
const towerAppRoot = join(towerRoot, "app");

function walkSources(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkSources(target));
    else if (target.endsWith(".ts")) files.push(target);
  }
  return files;
}

const FORBIDDEN_AUTHORITY_CALLS = [
  "approveAction",
  "authorizeAction",
  "recordExecution",
  "rejectAction",
];

const EXECUTION_EXPORT_PATTERN =
  /^(run|submit|invoke|execute|activate|install|authorize|deploy|dispatch|trigger|fire|launch|start|stop|kill|spawn)$/i;

describe("control-tower contract hygiene (projection, not authority)", () => {
  it("the authority law: domain + app layers hold no kernel at all", () => {
    for (const file of [...walkSources(towerDomainRoot), ...walkSources(towerAppRoot)]) {
      const source = readFileSync(file, "utf8");
      expect(source.includes("createDomainKernel"), `${file} composes the kernel`).toBe(false);
      expect(source.includes("AurumDomainKernel"), `${file} types a kernel handle`).toBe(false);
      for (const name of FORBIDDEN_AUTHORITY_CALLS) {
        const callPattern = new RegExp(`\\.${name}\\(`);
        const keyPattern = new RegExp(`["']${name}["']`);
        expect(callPattern.test(source), `${file} calls ${name}`).toBe(false);
        expect(keyPattern.test(source), `${file} picks ${name}`).toBe(false);
      }
    }
  });

  it("no execution/provider/agent plane import anywhere in the tower", () => {
    for (const file of walkSources(towerRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) =>
          /["'](@aurum\/execution|@zcode\/shared|@aurum\/provider|@aurum\/agent)/.test(line),
        );
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("the deps picks are exactly the reads + the nine delegated actions", () => {
    const ports = readFileSync(join(towerRoot, "domain", "ports.ts"), "utf8");
    // Company + lab: read-only picks.
    const companyBlock = ports.slice(
      ports.indexOf("readonly company:"),
      ports.indexOf("readonly lab:"),
    );
    expect(companyBlock).toContain('"situation"');
    expect(companyBlock).toContain('"goalAttention"');
    expect(companyBlock).toContain('"reportUnknowns"');
    expect(companyBlock).not.toMatch(/"create|"update|"record|"append|"write/);
    const labBlock = ports.slice(ports.indexOf("readonly lab:"), ports.indexOf("readonly plans:"));
    expect(labBlock).toContain('"listEvaluations"');
    expect(labBlock).not.toMatch(/"put|"record|"evaluate|"search/);
    // Plans: 4 reads + 5 delegated actions — createPlan is NOT a tower pick.
    const plansBlock = ports.slice(
      ports.indexOf("readonly plans:"),
      ports.indexOf("readonly cognition:"),
    );
    for (const pick of [
      '"listPlans"',
      '"getPlan"',
      '"readyTasks"',
      '"listEscalations"',
      '"submitForApproval"',
      '"approvePlan"',
      '"rejectPlan"',
      '"activatePlan"',
      '"dispatchTask"',
    ]) {
      expect(plansBlock).toContain(pick);
    }
    expect(plansBlock).not.toContain('"createPlan"');
    expect(plansBlock).not.toContain('"issueHandoff"');
    expect(plansBlock).not.toContain('"completePlan"');
    expect(plansBlock).not.toContain('"cancelPlan"');
    // Cognition: 2 reads + 4 delegated actions.
    const cognitionBlock = ports.slice(
      ports.indexOf("readonly cognition:"),
      ports.indexOf("}\n\n/** Input"),
    );
    for (const pick of [
      '"listMissions"',
      '"getMission"',
      '"createMission"',
      '"advance"',
      '"runToCompletion"',
      '"cancelMission"',
    ]) {
      expect(cognitionBlock).toContain(pick);
    }
  });

  it("the tower service surface is exactly the two reads + nine delegations", () => {
    const ports = readFileSync(join(towerRoot, "domain", "ports.ts"), "utf8");
    const serviceBlock = ports.slice(ports.indexOf("export interface ControlTowerService"));
    const declared = [...serviceBlock.matchAll(/^\s{2}(readonly )?(\w+)(?::|\()/gm)].map(
      (match) => match[2],
    );
    expect(new Set(declared)).toEqual(
      new Set([
        "overview",
        "conversation",
        "createMission",
        "advanceMission",
        "runMissionToCompletion",
        "cancelMission",
        "submitPlanForApproval",
        "approvePlan",
        "rejectPlan",
        "activatePlan",
        "dispatchTask",
      ]),
    );
  });

  it("the public surface exports no kernel-shaped or execution-shaped capability", () => {
    const exportedNames = Object.keys(surface);
    const offenders = exportedNames.filter((name) => EXECUTION_EXPORT_PATTERN.test(name));
    expect(offenders).toEqual([]);
    // The tower surface exports the projection + the local composition only.
    expect(exportedNames).toContain("createControlTowerService");
    expect(exportedNames).toContain("createLocalControlTowerRuntime");
    expect(exportedNames).toContain("createUnwiredReasoner");
    // The kernel factory is NOT re-exported through the application surface.
    expect(exportedNames).not.toContain("createDomainKernel");
    expect(exportedNames).not.toContain("AurumDomainKernel");
  });

  it("the tower domain layer is IO-free (no node: imports, no fetch/timers)", () => {
    for (const file of walkSources(towerDomainRoot)) {
      const source = readFileSync(file, "utf8");
      const nodeImports = source.split("\n").filter((line) => /from\s+["']node:/.test(line));
      expect(nodeImports, `${file}: ${nodeImports.join("; ")}`).toEqual([]);
      expect(/\b(fetch|setTimeout|setInterval)\s*\(/.test(source), file).toBe(false);
    }
  });

  it("imports @aurum/domain only through its public package specifier", () => {
    for (const file of walkSources(towerRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /["']@aurum\/domain\/[^"']*["']/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("the local runtime composes the kernel through the area contracts only", () => {
    const runtime = readFileSync(join(towerRoot, "adapters", "local-runtime.ts"), "utf8");
    // The composition point: the ONE place the kernel is created, then handed
    // to the four area factories + the tower deps.
    expect(runtime).toContain("createDomainKernel()");
    // The tower itself is built from the four PUBLIC services, never from
    // kernel handles.
    expect(runtime).toContain("createControlTowerService({ company, lab, plans, cognition })");
    expect(runtime).not.toMatch(/tower:\s*createControlTowerService\(\{[^}]*kernel/);
  });

  it("no lint-disable comments anywhere in package source", () => {
    for (const file of walkSources(join(packageRoot, "src"))) {
      const source = readFileSync(file, "utf8");
      const offenders = source.split("\n").filter((line) => /(oxlint|eslint)-disable/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });
});
