/**
 * W014 ACCEPTANCE (structural) — THE EMERGENCE AREA PROPOSES, NEVER
 * PUBLISHES; THE LAB CANNOT SELF-PUBLISH. Source-locked tripwires
 * (mirroring the W011 marketplace-tripwires + W013 learning-contract-
 * hygiene patterns):
 *
 * - no file under src/emergence imports @aurum/execution, any execution
 *   seam, @aurum/application (the W011 module law — the application
 *   package is never a marketplace dependency), or ANY foreign package;
 * - THE PUBLICATION-MUTATION REACH IS ZERO: no emergence source file
 *   references any publication/installation/activation mutation
 *   identifier (store puts + service commands + domain transitions);
 * - the EmergenceService surface is EXACTLY the five documented methods
 *   (no publish/submit/draft-shaped capability exists at all);
 * - the emergence contract exports no execution/publication-shaped name;
 * - the emergence domain layer is pure: imports only local emergence
 *   domain files + the W011 AREA CONTRACT (the W013 cross-area law), no
 *   IO, no kernel;
 * - THE W013 MIRROR IS EXACT: every mirrored field exists in the upstream
 *   learning/cognition source files (content scan — the W011 vocabulary
 *   equality precedent; no import needed);
 * - no lint-disable comments; contract files within the policy line cap.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcRoot = join(packageRoot, "src");
const emergenceRoot = join(srcRoot, "emergence");
const domainRoot = join(emergenceRoot, "domain");
const appRoot = join(emergenceRoot, "app");

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

/** Extracts the `readonly <name>` members of one interface in a source. */
function interfaceMembersOf(source: string, interfaceName: string): string[] {
  // exact name boundary: "ContextClass" must not match "ContextClassAxes"
  const start =
    source.indexOf(`export interface ${interfaceName} {`) >= 0
      ? source.indexOf(`export interface ${interfaceName} {`)
      : source.indexOf(`export interface ${interfaceName} extends`);
  expect(start, `interface ${interfaceName} not found`).toBeGreaterThan(-1);
  let depth = 0;
  let end = -1;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const body = source.slice(start, end);
  // P003-completion repair: optional members (`name?:`) carry the `?` BEFORE
  // the colon — the original pattern only matched required members, so the
  // upstream mirror checks false-negatived on goalId/failure.
  return [...body.matchAll(/^\s{2}(?:readonly )?(\w+)\??:/gm)].map((match) => match[1] ?? "");
}

const PUBLICATION_MUTATION_IDENTIFIERS = [
  "submitForPublication(",
  "reviewPublication(",
  "handleDraftPackage(",
  "handleSubmitPackageVersion(",
  "handleReviewPublication(",
  "installPublishedVersion(",
  "activateInstallation(",
  ".putVersion(",
  ".putPackage(",
  ".putInstallation(",
  ".putActivation(",
  ".draftPackage(",
  ".submitPackageVersion(",
  ".reviewPublication(",
  ".installPackage(",
  ".activatePackage(",
];

describe("the emergence area never links the execution or application planes", () => {
  it("no emergence source file imports @aurum/execution, an execution seam, @aurum/application, or any foreign package", () => {
    for (const file of walkSources(emergenceRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /from\s+["']@aurum\//.test(line) || /from\s+["']@zcode\//.test(line))
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
      const seamOffenders = source
        .split("\n")
        .filter((line) => /from\s+["'][^"']*execution[^"']*["']/.test(line))
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
      expect(seamOffenders, `${file}: ${seamOffenders.join("; ")}`).toEqual([]);
    }
  });
});

describe("THE PUBLICATION-MUTATION REACH IS ZERO (Lab cannot self-publish, structurally)", () => {
  it("no emergence source file references ANY publication/installation/activation mutation identifier", () => {
    for (const file of walkSources(emergenceRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = PUBLICATION_MUTATION_IDENTIFIERS.filter((identifier) =>
        source.includes(identifier),
      );
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("the EmergenceService surface is EXACTLY the five documented methods", () => {
    const service = readFileSync(join(appRoot, "inputs.ts"), "utf8");
    const surfaceBlock = service.slice(service.indexOf("export interface EmergenceService"));
    const declared = [...surfaceBlock.matchAll(/^\s{2}(readonly )?(\w+)(?::|\()/gm)].map(
      (match) => match[2],
    );
    expect(new Set(declared)).toEqual(
      new Set(["detectGaps", "propose", "reviewProposal", "getProposal", "listProposals"]),
    );
  });

  it("the emergence contract exports no execution/publication-shaped capability", () => {
    const contract = readFileSync(join(emergenceRoot, "contract.emergence.ts"), "utf8");
    const exported = [...contract.matchAll(/^export (?:\{([^}]*)\}|type \{([^}]*)\})/gm)]
      .flatMap((match) => (match[1] ?? match[2] ?? "").split(","))
      .map((name) => name.trim().split(" as ").at(-1)?.trim() ?? "")
      .filter((name) => name.length > 0);
    expect(exported.length).toBeGreaterThan(40);
    const offenders = exported.filter((name) =>
      /^(run|submit|publish|execute|install|activate|authorize|deploy|dispatch|trigger|fire|launch|start|stop|kill|spawn|draft)$/i.test(
        name,
      ),
    );
    expect(offenders, `publication-shaped exports: ${offenders.join(", ")}`).toEqual([]);
    // The propose-and-project surface is exactly here:
    for (const name of [
      "createEmergenceService",
      "detectEmergenceGaps",
      "catalogDraftOfProposal",
      "buildEmergenceProposal",
      "reviewEmergenceProposal",
      "deriveEmergenceAlternatives",
    ]) {
      expect(exported).toContain(name);
    }
  });

  it("the emergence deps ports are READ PICKS of the W011 surfaces (no mutation picks)", () => {
    const ports = readFileSync(join(domainRoot, "ports.ts"), "utf8");
    expect(ports).toContain('Pick<MarketplaceCatalogStore, "listVersions">');
    expect(ports).toContain('Pick<MarketplaceGovernanceStore, "listRecruitments">');
    const mutationPicks = ports
      .split("\n")
      .filter((line) =>
        /"(putVersion|putPackage|putInstallation|putActivation|putRecruitment|putExecutionRequest|draftPackage|submitPackageVersion|reviewPublication|installPackage|activatePackage|uninstallInstallation|deactivateActivation|requestExecutionUse|citeExecutionApproval|withdrawExecutionRequest)"/.test(
          line,
        ),
      );
    expect(mutationPicks, `${mutationPicks.join("; ")}`).toEqual([]);
    // The emergence proposal store is the area's OWN record store.
    const storeBlock = ports.slice(ports.indexOf("export interface EmergenceProposalStore"));
    const storeMethods = [...storeBlock.matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1]);
    expect(new Set(storeMethods)).toEqual(new Set(["putProposal", "getProposal", "listProposals"]));
  });
});

describe("the emergence domain layer is pure (local + W011 area contract only)", () => {
  it("domain imports are ONLY local emergence files + the W011 area contract (allowlist)", () => {
    for (const file of walkSources(domainRoot)) {
      const source = readFileSync(file, "utf8");
      const importLines = source
        .split("\n")
        .filter((line) => /^\s*import\s/.test(line) && /from\s/.test(line));
      for (const line of importLines) {
        const specifier = line.match(/from\s+["']([^"']+)["']/)?.[1] ?? "";
        const allowed =
          specifier.startsWith("./") || specifier === "../../marketplace/contract.marketplace.js";
        expect(allowed, `${file}: illegal domain import ${specifier}`).toBe(true);
      }
    }
  });

  it("the domain layer is IO-free (no node: imports, no fetch/timers)", () => {
    for (const file of walkSources(domainRoot)) {
      const source = readFileSync(file, "utf8");
      const nodeImports = source.split("\n").filter((line) => /from\s+["']node:/.test(line));
      expect(nodeImports, `${file}: ${nodeImports.join("; ")}`).toEqual([]);
      expect(/\b(fetch|setTimeout|setInterval)\s*\(/.test(source), file).toBe(false);
    }
  });

  it("no kernel composition anywhere in the emergence domain + app layers", () => {
    for (const file of [...walkSources(domainRoot), ...walkSources(appRoot)]) {
      const source = readFileSync(file, "utf8");
      expect(source.includes("createDomainKernel"), `${file} composes the kernel`).toBe(false);
      expect(source.includes("AurumDomainKernel"), `${file} types a kernel handle`).toBe(false);
    }
  });
});

describe("THE W013 MIRROR IS EXACT against the upstream learning/cognition source", () => {
  const learningRecords = readFileSync(
    join(packageRoot, "..", "aurum-application", "src", "learning", "domain", "records.ts"),
    "utf8",
  );
  const contextClassSource = readFileSync(
    join(packageRoot, "..", "aurum-application", "src", "learning", "domain", "contextClass.ts"),
    "utf8",
  );
  const shapeSource = readFileSync(
    join(packageRoot, "..", "aurum-application", "src", "learning", "domain", "shape.ts"),
    "utf8",
  );
  const cognitionRecords = readFileSync(
    join(packageRoot, "..", "aurum-application", "src", "cognition", "domain", "records.ts"),
    "utf8",
  );

  it("EmergenceOutcomeEvidence mirrors real OutcomeJoinRecord field names (nested where upstream nests)", () => {
    const upstream = interfaceMembersOf(learningRecords, "OutcomeJoinRecord");
    for (const mirrored of [
      "outcomeId",
      "evaluationId",
      "candidateId",
      "goalId",
      "contextClass",
      "shape",
      "observation",
      "allocation",
      "recordedAt",
    ]) {
      expect(upstream, `OutcomeJoinRecord lacks ${mirrored}`).toContain(mirrored);
    }
    // The nested conditioning-key fields exist in the upstream nested types.
    const contextClass = interfaceMembersOf(contextClassSource, "ContextClass");
    for (const mirrored of ["classKey", "demandSignature"]) {
      expect(contextClass).toContain(mirrored);
    }
    const shape = interfaceMembersOf(shapeSource, "OrganizationShape");
    expect(shape).toContain("shapeKey");
  });

  it("the mirrored observation/allocation picks cover only real upstream fields", () => {
    const observation = interfaceMembersOf(learningRecords, "OutcomeObservation");
    for (const mirrored of ["status", "source", "observedAt", "failure", "metric"]) {
      expect(observation).toContain(mirrored);
    }
    const allocation = interfaceMembersOf(learningRecords, "AllocationJoin");
    for (const mirrored of [
      "actorCount",
      "humanLikeActorCount",
      "automatedActorCount",
      "totalEffortShare",
    ]) {
      expect(allocation).toContain(mirrored);
    }
  });

  it("the outcome-status mirror equals the frozen W013 OUTCOME_STATUSES set", () => {
    const vocabularySource = readFileSync(
      join(packageRoot, "..", "aurum-application", "src", "learning", "domain", "vocabulary.ts"),
      "utf8",
    );
    function extractMembers(source: string, constantName: string): string[] {
      const start = source.indexOf(`export const ${constantName}`);
      expect(start).toBeGreaterThan(-1);
      const bracketStart = source.indexOf("[", start);
      const bracketEnd = source.indexOf("]", bracketStart);
      return [...source.slice(bracketStart + 1, bracketEnd).matchAll(/"([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      );
    }
    const emergenceEvidence = readFileSync(join(domainRoot, "evidence.ts"), "utf8");
    expect(extractMembers(emergenceEvidence, "EMERGENCE_OUTCOME_STATUSES")).toEqual(
      extractMembers(vocabularySource, "OUTCOME_STATUSES"),
    );
  });

  it("the cognition unknown mirror covers the real UnknownEffect fields", () => {
    const unknownEffect = interfaceMembersOf(cognitionRecords, "UnknownEffect");
    for (const mirrored of ["unknownId", "question", "consequence"]) {
      expect(unknownEffect).toContain(mirrored);
    }
  });
});

describe("hygiene: lint-disables, line caps, module manifest parity", () => {
  it("no lint-disable comments anywhere in the emergence source", () => {
    for (const file of walkSources(emergenceRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source.split("\n").filter((line) => /(oxlint|eslint)-disable/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("every emergence source file is within the 400-line policy cap", () => {
    for (const file of walkSources(emergenceRoot)) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
      expect(lines, `${file}: ${lines} lines`).toBeLessThanOrEqual(400);
    }
  });

  it("contract files are within the 300-line policy cap (incl. the composed package contract)", () => {
    for (const file of walkSources(srcRoot)) {
      if (/contract(\.|$)/.test(file.replaceAll("\\", "/"))) {
        const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
        expect(lines, `${file}: ${lines} lines`).toBeLessThanOrEqual(300);
      }
    }
  });

  it("the emergence area adds no third-party dependency (workspace links unchanged)", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({
      "@aurum/domain": "workspace:*",
      "@aurum/agent": "workspace:*",
    });
  });
});
