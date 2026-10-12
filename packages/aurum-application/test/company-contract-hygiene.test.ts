/**
 * ACCEPTANCE (structural, catalog W004): THE COMPANY SLICE CANNOT MUTATE THE
 * KERNEL AND CANNOT EXECUTE.
 *
 * Tripwires:
 * - no file under src/company/** imports @aurum/execution (or any execution
 *   seam) — the company slice never even links the execution plane;
 * - the public surface exports no execution-shaped capability (no
 *   run/submit/invoke/execute/activate/install/authorize/... primitives);
 * - the CompanyIntelligence service exposes exactly the nine query/log
 *   methods — nothing else;
 * - CompanyDomainViews is READ-ONLY: no write-shaped kernel method is
 *   picked anywhere in the ports (the slice-owned query log is separate);
 * - the company domain layer contains no IO (no node: imports, no
 *   fetch/setTimeout/setInterval calls);
 * - @aurum/domain is imported only through its package entrypoint (never a
 *   deep path);
 * - no lint-disable comments anywhere in the package source;
 * - no new third-party dependencies (only the @aurum/domain workspace link);
 * - src/contract.ts carries the company re-export (alongside lab + plans).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as surface from "../src/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const companyRoot = join(packageRoot, "src", "company");
const companyDomainRoot = join(packageRoot, "src", "company", "domain");

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

const WRITE_SHAPED_KERNEL_METHOD =
  /\b(register\w*|record\w*|retract\w*|revise\w*|create\w*|grant\w*|end\w*|put\w*|append\w*|raise\w*|open\w*|resolve\w*)\s*\(/;

describe("company contract hygiene (queries cannot mutate; cannot execute)", () => {
  it("no company source file imports @aurum/execution (or any execution seam)", () => {
    for (const file of walkSources(companyRoot)) {
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
    // The surface is query/honesty-shaped only.
    expect(exportedNames).toContain("createCompanyIntelligenceService");
    expect(exportedNames).toContain("classifySubjectKnowledge");
    expect(exportedNames).toContain("claimSupportStatus");
    expect(exportedNames).toContain("ANSWER_CLASSIFICATIONS");
  });

  it("the CompanyIntelligence service exposes exactly the nine query/log methods", () => {
    const source = readFileSync(join(companyRoot, "app", "companyService.ts"), "utf8");
    const methodNames = [
      ...source.matchAll(
        /^  (askAboutSubject|whoOwns|whatChangedSince|reportCoverage|situation|goalAttention|reportUnknowns|getQueryLog|listQueryLogs)\(/gm,
      ),
    ].map((match) => match[1]);
    expect(new Set(methodNames)).toEqual(
      new Set([
        "askAboutSubject",
        "whoOwns",
        "whatChangedSince",
        "reportCoverage",
        "situation",
        "goalAttention",
        "reportUnknowns",
        "getQueryLog",
        "listQueryLogs",
      ]),
    );
    expect(methodNames).toHaveLength(9);
  });

  it("CompanyDomainViews is read-only: no write-shaped kernel method is picked", () => {
    const source = readFileSync(join(companyRoot, "domain", "ports.ts"), "utf8");
    const start = source.indexOf("export interface CompanyDomainViews");
    const end = source.indexOf("}", start);
    expect(start).toBeGreaterThan(-1);
    const viewsBlock = source.slice(start, end);
    const offenders = viewsBlock
      .split("\n")
      .filter((line) => WRITE_SHAPED_KERNEL_METHOD.test(line));
    expect(offenders, `write-shaped picks: ${offenders.join("; ")}`).toEqual([]);
    // The read seams are present and are queries only.
    expect(viewsBlock).toContain('"queryAudit"');
    expect(viewsBlock).toContain('"getGoalRevision"');
    // The slice-owned query log is declared separately, after the views.
    const logBlock = source.slice(source.indexOf("export interface CompanyQueryLog"));
    expect(logBlock).toContain("appendQueryLog");
  });

  it("the company domain layer is IO-free (no node: imports, no fetch/timers)", () => {
    for (const file of walkSources(companyDomainRoot)) {
      const source = readFileSync(file, "utf8");
      const nodeImports = source.split("\n").filter((line) => /from\s+["']node:/.test(line));
      expect(nodeImports, `${file}: ${nodeImports.join("; ")}`).toEqual([]);
      expect(/\b(fetch|setTimeout|setInterval)\s*\(/.test(source), file).toBe(false);
    }
  });

  it("imports @aurum/domain only through its public package specifier", () => {
    for (const file of walkSources(companyRoot)) {
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

  it("src/contract.ts carries the company re-export alongside lab and plans", () => {
    const source = readFileSync(join(packageRoot, "src", "contract.ts"), "utf8");
    expect(source).toContain('export * from "./lab/contract.lab.js";');
    expect(source).toContain('export * from "./plans/contract.plans.js";');
    expect(source).toContain('export * from "./company/contract.company.js";');
  });
});
