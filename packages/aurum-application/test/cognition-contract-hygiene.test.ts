/**
 * W007 ACCEPTANCE (structural): the cognition module's authority and
 * boundedness laws, source-locked.
 *
 * Tripwires:
 * - THE AUTHORITY LAW: no cognition source ever calls approveAction /
 *   authorizeAction / recordExecution / rejectAction — the gate pick is
 *   propose/recommend/get only; cognition structurally cannot execute;
 * - no @aurum/execution, @zcode/shared or provider-plane import anywhere
 *   in src/cognition (the model boundary is the local ReasoningPort only);
 * - the cognition domain layer is IO-free;
 * - @aurum/domain only through its package entrypoint (no deep imports);
 * - the bounded content schema has NO control-flow fields (the model can
 *   never order stages, authorize or persist);
 * - the service surface is exactly the seven loop operations;
 * - no lint-disable comments in cognition sources.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as surface from "../src/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cognitionRoot = join(packageRoot, "src", "cognition");
const cognitionDomainRoot = join(cognitionRoot, "domain");

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

describe("cognition contract hygiene (authority + boundedness laws)", () => {
  it("the authority law: no cognition source touches approve/authorize/execute/reject", () => {
    for (const file of walkSources(cognitionRoot)) {
      const source = readFileSync(file, "utf8");
      for (const name of FORBIDDEN_AUTHORITY_CALLS) {
        // Call syntax (`.approveAction(`) and pick/key syntax (`"approveAction"`)
        // both trip; prose mentions in design comments do not.
        const callPattern = new RegExp(`\\.${name}\\(`);
        const keyPattern = new RegExp(`["']${name}["']`);
        expect(callPattern.test(source), `${file} calls ${name}`).toBe(false);
        expect(keyPattern.test(source), `${file} picks ${name}`).toBe(false);
      }
    }
  });

  it("the gate port picks propose/recommend/get only", () => {
    const ports = readFileSync(join(cognitionRoot, "domain", "ports.ts"), "utf8");
    const gateBlock = ports.slice(ports.indexOf("MissionAuthorityGate"));
    expect(gateBlock).toContain("proposeAction");
    expect(gateBlock).toContain("recommendAction");
    expect(gateBlock).toContain("getAction");
    expect(gateBlock).not.toContain("approveAction");
    expect(gateBlock).not.toContain("authorizeAction");
    const seams = readFileSync(
      join(cognitionRoot, "adapters", "kernel-cognition-seams.ts"),
      "utf8",
    );
    expect(seams).toContain("proposeAction");
    expect(seams).toContain("recommendAction");
    expect(seams).not.toContain("approveAction");
    expect(seams).not.toContain("authorizeAction");
  });

  it("no execution-plane or provider-plane imports anywhere in cognition", () => {
    for (const file of walkSources(cognitionRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) =>
          /["'](@aurum\/execution|@zcode\/shared|@aurum\/provider|@aurum\/agent|openai|anthropic)["']/.test(
            line,
          ),
        );
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("the cognition domain layer is IO-free (no node: imports, no fetch/timers)", () => {
    for (const file of walkSources(cognitionDomainRoot)) {
      const source = readFileSync(file, "utf8");
      const nodeImports = source.split("\n").filter((line) => /from\s+["']node:/.test(line));
      expect(nodeImports, `${file}: ${nodeImports.join("; ")}`).toEqual([]);
      expect(/\b(fetch|setTimeout|setInterval)\s*\(/.test(source), file).toBe(false);
    }
  });

  it("imports @aurum/domain only through its public package specifier", () => {
    for (const file of walkSources(cognitionRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /["']@aurum\/domain\/[^"']*["']/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("the bounded content schema carries no control-flow channel", () => {
    const bounded = readFileSync(join(cognitionRoot, "domain", "bounded.ts"), "utf8");
    const interfaceBody = bounded.slice(
      bounded.indexOf("export interface ReasonedContent"),
      bounded.indexOf("const CONTENT_FIELDS"),
    );
    const controlFlowFields = interfaceBody
      .split("\n")
      .filter((line) =>
        /^\s*readonly\s+(stage|next|nextStage|command|continue|abort|authorize|approve|persist|action)\b/.test(
          line,
        ),
      );
    expect(controlFlowFields).toEqual([]);
    // The runtime field whitelist is exactly the five bounded fields.
    expect(bounded).toContain(
      'const CONTENT_FIELDS = ["summary", "findings", "gaps", "hypotheses", "proposals"] as const;',
    );
  });

  it("the service surface is exactly the seven loop operations", () => {
    const source = readFileSync(join(cognitionRoot, "app", "cognitionService.ts"), "utf8");
    const methodNames = [
      ...source.matchAll(
        /^ {2}(createMission|advance|runToCompletion|getMission|listMissions|missionTrajectory|cancelMission)\(/gm,
      ),
    ].map((match) => match[1]);
    expect(new Set(methodNames)).toEqual(
      new Set([
        "createMission",
        "advance",
        "runToCompletion",
        "getMission",
        "listMissions",
        "missionTrajectory",
        "cancelMission",
      ]),
    );
  });

  it("the public surface exports no execution-shaped capability", () => {
    const exportedNames = Object.keys(surface);
    const offenders = exportedNames.filter((name) => EXECUTION_EXPORT_PATTERN.test(name));
    expect(offenders).toEqual([]);
    expect(exportedNames).toContain("createCognitionService");
    expect(exportedNames).toContain("MISSION_STAGES");
    expect(exportedNames).toContain("createScriptedReasoner");
    expect(exportedNames).toContain("reasonedContentIssues");
    expect(exportedNames).toContain("missionTrajectoryOf");
  });

  it("no lint-disable comments anywhere in cognition sources", () => {
    for (const file of walkSources(cognitionRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source.split("\n").filter((line) => /(oxlint|eslint)-disable/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("the stage machine constant is frozen at six application-owned stages", () => {
    expect(surface.MISSION_STAGES).toEqual([
      "orient",
      "reason",
      "evaluate",
      "propose",
      "gate",
      "record",
    ]);
    expect(Object.isFrozen(surface.MISSION_STAGES)).toBe(true);
  });
});
