/**
 * W013 ACCEPTANCE (structural): THE LEARNING AREA PROPOSES AND CALIBRATES,
 * NEVER AUTHORIZES OR EXECUTES — and it learns CONDITIONALLY, never
 * globally. Source-locked tripwires:
 *
 * - no file under src/learning/** imports @aurum/execution (or any
 *   execution submission seam) — learning never even links the execution
 *   plane (the W008 lab law extends to the learning area unchanged);
 * - the OutcomeLearning service surface is exactly the five
 *   record/query/calibrate methods — no execution-shaped capability
 *   (no run/submit/invoke/execute/activate/install/authorize/...);
 * - the learning ports are READ-ONLY picks of the lab/domain seams (no
 *   mutation picks), and the outcome store port is APPEND-ONLY (put/get/
 *   list only — no update, no delete: recorded evidence never rewrites);
 * - the learning domain + app layers hold no kernel (no
 *   createDomainKernel, no AurumDomainKernel, no kernel store handles);
 * - THE CONDITIONAL LAW, structurally: conditionalEvidence REQUIRES a
 *   context anchor — there is no global-evidence method on the surface;
 * - the learning domain layer is IO-free;
 * - @aurum/domain only through its public package entrypoint;
 * - no lint-disable comments in the learning source.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const learningRoot = join(packageRoot, "src", "learning");
const domainRoot = join(learningRoot, "domain");
const appRoot = join(learningRoot, "app");

function walkSources(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkSources(target));
    else if (target.endsWith(".ts")) files.push(target);
  }
  return files;
}

const EXECUTION_EXPORT_PATTERN =
  /^(run|submit|invoke|execute|activate|install|authorize|deploy|dispatch|trigger|fire|launch|start|stop|kill|spawn)$/i;

describe("learning contract hygiene (learning proposes and calibrates, never executes)", () => {
  it("no learning source file imports @aurum/execution (or any execution seam)", () => {
    for (const file of walkSources(learningRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source.split("\n").filter((line) => /["']@aurum\/execution/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
      const seamOffenders = source
        .split("\n")
        .filter((line) => /from\s+["'][^"']*execution[^"']*["']/.test(line));
      expect(seamOffenders, `${file}: ${seamOffenders.join("; ")}`).toEqual([]);
    }
  });

  it("the OutcomeLearning service surface is exactly the five learning methods", () => {
    const service = readFileSync(join(appRoot, "learningService.ts"), "utf8");
    const surfaceBlock = service.slice(service.indexOf("export interface OutcomeLearning"));
    const declared = [...surfaceBlock.matchAll(/^\s{2}(readonly )?(\w+)(?::|\()/gm)].map(
      (match) => match[2],
    );
    expect(new Set(declared)).toEqual(
      new Set([
        "recordOutcome",
        "getOutcome",
        "listOutcomes",
        "conditionalEvidence",
        "calibratedSearch",
      ]),
    );
  });

  it("the public surface exports no execution-shaped capability from the learning area", () => {
    const contract = readFileSync(join(learningRoot, "contract.learning.ts"), "utf8");
    const exported = [...contract.matchAll(/^export (?:\{([^}]*)\}|type \{([^}]*)\})/gm)]
      .flatMap((match) => (match[1] ?? match[2] ?? "").split(","))
      .map((name) => name.trim().split(" as ").at(-1)?.trim() ?? "")
      .filter((name) => name.length > 0);
    expect(exported.length).toBeGreaterThan(25);
    const offenders = exported.filter((name) => EXECUTION_EXPORT_PATTERN.test(name));
    expect(offenders).toEqual([]);
    // The learning surface is record/join/calibrate-shaped only.
    for (const name of [
      "createOutcomeLearning",
      "calibrateEvidence",
      "applyConditionalCalibration",
    ]) {
      expect(exported).toContain(name);
    }
  });

  it("the learning ports are read-only picks; the outcome store is append-only", () => {
    const ports = readFileSync(join(domainRoot, "ports.ts"), "utf8");
    // Read seams: exactly the lab evaluation view + the candidate view.
    expect(ports).toContain('Pick<LabEvaluationStore, "getEvaluation">');
    expect(ports).toContain('Pick<OrganizationCandidateRegistry, "getCandidate">');
    expect(ports).toContain('Pick<OrganizationalLab, "searchOrganizations">');
    // No mutation picks anywhere in the ports file.
    const mutationPicks = ports
      .split("\n")
      .filter((line) =>
        /"(registerCandidate|putEvaluation|recordObservation|appendObservation|write|update|delete|remove|activate|install|authorize)"/.test(
          line,
        ),
      );
    expect(mutationPicks, `${mutationPicks.join("; ")}`).toEqual([]);
    // The outcome store port: put/get/list ONLY — no rewrite, no removal.
    const storeBlock = ports.slice(ports.indexOf("export interface OutcomeStore"));
    const storeMethods = [...storeBlock.matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1]);
    expect(new Set(storeMethods)).toEqual(new Set(["putOutcome", "getOutcome", "listOutcomes"]));
  });

  it("THE CONDITIONAL LAW: the evidence query requires a context anchor (no global evidence)", () => {
    const service = readFileSync(join(appRoot, "learningService.ts"), "utf8");
    // The query type carries exactly the two anchor options + now.
    const queryBlock = service.slice(
      service.indexOf("export interface ConditionalEvidenceQuery"),
      service.indexOf("export interface OutcomeLearning"),
    );
    for (const anchor of [
      "readonly fingerprint?:",
      "readonly contextClassKey?:",
      "readonly now:",
    ]) {
      expect(queryBlock).toContain(anchor);
    }
    // No method name on the service surface can be read as a global ranking.
    const offenders = service
      .split("\n")
      .filter((line) =>
        /(globalEvidence|bestOrganization|universalRanking|globalRanking)/.test(line),
      );
    expect(offenders).toEqual([]);
  });

  it("the learning domain + app layers hold no kernel at all", () => {
    for (const file of [...walkSources(domainRoot), ...walkSources(appRoot)]) {
      const source = readFileSync(file, "utf8");
      expect(source.includes("createDomainKernel"), `${file} composes the kernel`).toBe(false);
      expect(source.includes("AurumDomainKernel"), `${file} types a kernel handle`).toBe(false);
    }
  });

  it("the learning domain layer is IO-free (no node: imports, no fetch/timers)", () => {
    for (const file of walkSources(domainRoot)) {
      const source = readFileSync(file, "utf8");
      const nodeImports = source.split("\n").filter((line) => /from\s+["']node:/.test(line));
      expect(nodeImports, `${file}: ${nodeImports.join("; ")}`).toEqual([]);
      expect(/\b(fetch|setTimeout|setInterval)\s*\(/.test(source), file).toBe(false);
    }
  });

  it("imports @aurum/domain only through its public package specifier", () => {
    for (const file of walkSources(learningRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /["']@aurum\/domain\/[^"']*["']/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("no lint-disable comments in the learning source", () => {
    for (const file of walkSources(learningRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source.split("\n").filter((line) => /(oxlint|eslint)-disable/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });
});
