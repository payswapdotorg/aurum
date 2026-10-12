/**
 * W011 ACCEPTANCE (structural) — THE SEPARATION IS STRUCTURAL + the
 * marketplace NEVER executes.
 *
 * Tripwires (source-scans + surface scans, mirroring the W008 lab
 * contract-hygiene and W009 truth-law patterns):
 * - NO FUSED PRIMITIVE: no single function in the app layer performs a
 *   publication transition AND an installation transition; resolution
 *   sequences machines 2+3 but NEVER touches machine 1 (publication).
 * - NO EXECUTION: no export name on the public surface is
 *   execution-shaped (run/submit/invoke/execute/...); no source file
 *   imports an execution plane (@aurum/execution or execution seams) or
 *   @aurum/application (the plan surface — a W002/W009 consumer, never a
 *   dependency).
 * - The domain layer is pure: no imports from app/ or adapters/, no IO
 *   (node:/fetch/timers), no foreign package imports at all (pure local
 *   mirrors pending CR-W011).
 * - The domain vocabulary mirrors are EXACT: the mirrored fabric sets
 *   match @aurum/agent's frozen members (guarded by content equality
 *   against the upstream source files until the CR wires the dep).
 * - No lint-disable comments; no third-party dependencies (CR-W011
 *   interim state: the workspace links land with the TL's pnpm install).
 * - module.ts requires mirrors architecture-policy.yaml exactly.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as surface from "../src/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcRoot = join(packageRoot, "src");
const marketplaceRoot = join(srcRoot, "marketplace");
const domainRoot = join(marketplaceRoot, "domain");
const appRoot = join(marketplaceRoot, "app");

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

const EXECUTION_EXPORT_PATTERN =
  /^(run|submit|invoke|execute|activateAndInstall|deploy|dispatch|trigger|fire|launch|start|stop|kill|spawn|installAndActivate|publishAndInstall)$/i;

describe("no fused primitive (publication/installation/activation are structurally separate)", () => {
  it("no app-layer function calls BOTH a publication transition and an installation transition", () => {
    const PUBLICATION_FNS = ["submitForPublication", "reviewPublication"];
    const INSTALLATION_FNS = ["installPublishedVersion", "uninstallInstallation"];
    const ACTIVATION_FNS = ["activateInstallation", "deactivateActivation"];
    for (const file of walkSources(appRoot)) {
      const source = readFileSync(file, "utf8");
      const fnBlocks = [...source.matchAll(/export function (\w+)\(([\s\S]*?)\n\}/g)];
      for (const match of fnBlocks) {
        const fnName = match[1] ?? "";
        const body = match[0];
        const callsPublication = PUBLICATION_FNS.some((fn) => body.includes(`${fn}(`));
        const callsInstallation = INSTALLATION_FNS.some((fn) => body.includes(`${fn}(`));
        const callsActivation = ACTIVATION_FNS.some((fn) => body.includes(`${fn}(`));
        if (callsPublication) {
          expect(
            callsInstallation || callsActivation,
            `${file}: ${fnName} fuses publication with installation/activation`,
          ).toBe(false);
        }
      }
    }
  });

  it("the resolveRecruitment handler sequences machines 2+3 but NEVER a publication transition", () => {
    const source = readFileSync(join(appRoot, "recruitment.ts"), "utf8");
    const start = source.indexOf("export function handleResolveRecruitment");
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    let endIdx = -1;
    for (let i = source.indexOf("{", start); i < source.length; i += 1) {
      const c = source[i];
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    const body = source.slice(start, endIdx + 1);
    expect(body).toContain("installPublishedVersion(");
    expect(body).toContain("activateInstallation(");
    expect(body).not.toContain("submitForPublication(");
    expect(body).not.toContain("reviewPublication(");
  });

  it("the publication machine module has no reference to installation/activation records", () => {
    const source = readFileSync(join(domainRoot, "publication.ts"), "utf8");
    expect(source).not.toContain("PackageInstallation");
    expect(source).not.toContain("PackageActivation");
    expect(source).not.toContain("installPublishedVersion");
  });
});

describe("the marketplace NEVER executes (surface + import tripwires)", () => {
  it("the public surface exports no execution-shaped capability", () => {
    const exportedNames = Object.keys(surface);
    expect(exportedNames.length).toBeGreaterThan(60);
    const offenders = exportedNames.filter((name) => EXECUTION_EXPORT_PATTERN.test(name));
    expect(offenders, `execution-shaped exports: ${offenders.join(", ")}`).toEqual([]);
    expect(exportedNames).toContain("createMarketplaceService");
    expect(exportedNames).toContain("rankCandidatePackages");
    expect(exportedNames).toContain("citeExecutionApproval");
  });

  it("no source file imports @aurum/execution, an execution seam, or @aurum/application", () => {
    for (const file of walkSources(marketplaceRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /["']@aurum\/(execution|application)/.test(line))
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
      // Execution-plane seams are external module specifiers only — the
      // marketplace's OWN machine-4 module (executionApproval.js) is a
      // relative import and is the citation ledger, not a seam.
      const seamOffenders = source
        .split("\n")
        .filter((line) => /from\s+["'](@[^"']*|node:[^"']*execution[^"']*)["']/.test(line))
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
      expect(seamOffenders, `${file}: ${seamOffenders.join("; ")}`).toEqual([]);
    }
  });

  it("the domain layer is pure: no app/adapters imports, no IO, no foreign packages", () => {
    for (const file of walkSources(domainRoot)) {
      const source = readFileSync(file, "utf8");
      const relativeImports = source
        .split("\n")
        .filter((line) => /from\s+["']\.\.\/(app|adapters)\//.test(line));
      expect(relativeImports, `${file}: domain imports app/adapters`).toEqual([]);
      const nodeImports = source.split("\n").filter((line) => /from\s+["']node:/.test(line));
      expect(nodeImports, `${file}: domain imports node builtins`).toEqual([]);
      expect(/\b(fetch|setTimeout|setInterval)\s*\(/.test(source), file).toBe(false);
      const foreignImports = source
        .split("\n")
        .filter((line) => /from\s+["']@aurum\//.test(line) || /from\s+["']@zcode\//.test(line));
      expect(foreignImports, `${file}: domain imports foreign packages`).toEqual([]);
    }
  });

  it("the mirrored fabric vocabulary is EXACT against @aurum/agent's frozen sets", () => {
    const vocabularySource = readFileSync(join(domainRoot, "vocabulary.ts"), "utf8");
    const agentVocabularyPath = join(
      packageRoot,
      "..",
      "aurum-agent",
      "src",
      "domain",
      "vocabulary.ts",
    );
    const agentSource = readFileSync(agentVocabularyPath, "utf8");
    // Extract the closed-set members from both files and compare content.
    function extractMembers(source: string, constantName: string): string[] {
      const start = source.indexOf(`export const ${constantName}`);
      expect(start).toBeGreaterThan(-1);
      const bracketStart = source.indexOf("[", start);
      const bracketEnd = source.indexOf("]", bracketStart);
      const body = source.slice(bracketStart + 1, bracketEnd);
      return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
    }
    expect(extractMembers(vocabularySource, "MARKETPLACE_AGENT_CAPABILITIES")).toEqual(
      extractMembers(agentSource, "AGENT_CAPABILITIES"),
    );
    expect(extractMembers(vocabularySource, "MARKETPLACE_BODY_MODEL_PURPOSES")).toEqual(
      extractMembers(agentSource, "BODY_MODEL_PURPOSES"),
    );
    // The W005 candidate actor kinds mirror the kernel exactly.
    const kernelActorsPath = join(
      packageRoot,
      "..",
      "aurum-domain",
      "src",
      "domain",
      "candidate",
      "actors.ts",
    );
    const kernelActors = readFileSync(kernelActorsPath, "utf8");
    expect(extractMembers(vocabularySource, "MARKETPLACE_CANDIDATE_ACTOR_KINDS")).toEqual(
      extractMembers(kernelActors, "CANDIDATE_ACTOR_KINDS"),
    );
  });

  it("no lint-disable comments anywhere in the package source", () => {
    for (const file of walkSources(srcRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source.split("\n").filter((line) => /(?:oxlint|eslint)-disable/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("no third-party dependencies — the @aurum workspace links land with CR-W011 (TL-owned lockfile)", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toBeUndefined();
  });

  it("module.ts requires mirrors architecture-policy.yaml exactly", () => {
    const moduleSource = readFileSync(join(srcRoot, "module.ts"), "utf8");
    const manifestMatch = moduleSource.match(/requires\s*:\s*\[([^\]]*)\]/s);
    expect(manifestMatch).not.toBeNull();
    const manifestRequires = [...(manifestMatch?.[1] ?? "").matchAll(/["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    );
    const policySource = readFileSync(
      join(packageRoot, "..", "..", "architecture-policy.yaml"),
      "utf8",
    );
    const policyBlock = policySource.slice(policySource.indexOf("- id: aurum-marketplace"));
    const policyMatch = policyBlock.match(/requires:\s*\[([^\]]*)\]/);
    expect(policyMatch).not.toBeNull();
    const policyRequires = [...(policyMatch?.[1] ?? "").matchAll(/([A-Za-z-]+)/g)].map(
      (match) => match[1] ?? "",
    );
    expect(manifestRequires).toEqual(policyRequires);
  });

  it("the contract surface stays under the policy line limit (contract files <= 300 lines)", () => {
    for (const file of walkSources(srcRoot)) {
      if (/contract(\.|$)/.test(file.replaceAll("\\", "/"))) {
        const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
        expect(lines, `${file}: ${lines} lines`).toBeLessThanOrEqual(300);
      }
    }
  });
});
