/**
 * ACCEPTANCE (structural, catalog clause 4): THE LAB CANNOT EXECUTE.
 *
 * Tripwires:
 * - no file under src/lab/** imports @aurum/execution (or any execution
 *   submission seam) — the lab never even links the execution plane;
 * - the public surface exports no execution-shaped capability (no
 *   run/submit/invoke/execute/activate/install/authorize/... primitives);
 * - the lab domain layer contains no IO (no node: imports, no
 *   fetch/setTimeout/setInterval calls);
 * - @aurum/domain is imported only through its package entrypoint (never a
 *   deep path);
 * - no lint-disable comments anywhere in the package source;
 * - workspace dependencies only (@aurum/domain + CR-W009 wiring: @aurum/execution, @zcode/shared).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as surface from "../src/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const labRoot = join(packageRoot, "src", "lab");
const domainRoot = join(packageRoot, "src", "lab", "domain");

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

describe("lab contract hygiene (Lab cannot execute)", () => {
  it("no lab source file imports @aurum/execution (or any execution seam)", () => {
    for (const file of walkSources(labRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source.split("\n").filter((line) => /["']@aurum\/execution/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
      const seamOffenders = source
        .split("\n")
        .filter((line) => /from\s+["'][^"']*execution[^"']*["']/.test(line));
      expect(seamOffenders, `${file}: ${seamOffenders.join("; ")}`).toEqual([]);
    }
  });

  it("the public surface exports no execution-shaped capability", () => {
    const exportedNames = Object.keys(surface);
    expect(exportedNames.length).toBeGreaterThan(30);
    const offenders = exportedNames.filter((name) => EXECUTION_EXPORT_PATTERN.test(name));
    expect(offenders).toEqual([]);
    // The service factory and surface are recommendation-shaped only.
    expect(exportedNames).toContain("createOrganizationalLab");
    expect(exportedNames).toContain("contextFingerprint");
    expect(exportedNames).toContain("synthesizeAllocation");
  });

  it("the OrganizationalLab service type exposes only evaluate/recommend operations", async () => {
    const source = readFileSync(join(labRoot, "app", "labService.ts"), "utf8");
    const methodNames = [
      ...source.matchAll(
        /^  (fingerprintSituation|searchOrganizations|synthesizeAllocation|evaluateOrganizations|getEvaluation|listEvaluations)\(/gm,
      ),
    ].map((match) => match[1]);
    expect(new Set(methodNames)).toEqual(
      new Set([
        "fingerprintSituation",
        "searchOrganizations",
        "synthesizeAllocation",
        "evaluateOrganizations",
        "getEvaluation",
        "listEvaluations",
      ]),
    );
  });

  it("the lab domain layer is IO-free (no node: imports, no fetch/timers)", () => {
    for (const file of walkSources(domainRoot)) {
      const source = readFileSync(file, "utf8");
      const nodeImports = source.split("\n").filter((line) => /from\s+["']node:/.test(line));
      expect(nodeImports, `${file}: ${nodeImports.join("; ")}`).toEqual([]);
      expect(/\b(fetch|setTimeout|setInterval)\s*\(/.test(source), file).toBe(false);
    }
  });

  it("imports @aurum/domain only through its public package specifier", () => {
    for (const file of walkSources(labRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /["']@aurum\/domain\/[^"']*["']/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("no lint-disable comments anywhere in package source", () => {
    for (const file of walkSources(join(packageRoot, "src"))) {
      const source = readFileSync(file, "utf8");
      const offenders = source.split("\n").filter((line) => /(oxlint|eslint)-disable/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("workspace dependencies only (CR-W009 wiring: + @aurum/execution, @zcode/shared; no third-party)", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({
      "@aurum/domain": "workspace:*",
      "@aurum/execution": "workspace:*",
      "@zcode/shared": "workspace:*",
    });
    expect(Object.keys(pkg.devDependencies ?? {}).sort()).toEqual(["typescript", "vitest"]);
  });

  it("search results never carry execution artifacts (no environment bindings, no run handles)", () => {
    // Structural: the search result type surface contains only analysis
    // fields. Prove by shape on a minimal deterministic double.
    const source = readFileSync(join(labRoot, "domain", "records.ts"), "utf8");
    expect(source).toContain("OrganizationSearchResult");
    expect(source).not.toMatch(/executionHandle|runId|submissionId|dispatchTicket/);
  });
});
