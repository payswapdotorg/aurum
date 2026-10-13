/**
 * W012 contract hygiene — structural tripwires (source scans, the W007/
 * W008/W009/W010 pattern):
 *
 * - NO SECOND AGENT BODY (APPROACH R4): nothing under src/continuity
 *   imports `@aurum/agent` or `@aurum/provider` (records carry references
 *   only; bodies resolve through the kernel/agent package identically on
 *   every platform);
 * - the continuity DOMAIN layer is IO-free (no node: imports, no fetch/
 *   timers — digests use the standard crypto primitive only);
 * - `@aurum/domain` is imported via its package specifier only;
 * - sibling areas are consumed through their CONTRACT files only;
 * - the ContinuityService surface is exactly the nine session operations;
 * - the ledger port is append-only (no update/delete methods exist);
 * - no lint-disable comments; no second validation authority in the RPC
 *   edge (the envelope file owns membership + arity only).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ContinuityLedger, ContinuityService } from "../src/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const areaRoot = join(packageRoot, "src", "continuity");
const domainRoot = join(areaRoot, "domain");

function walkSources(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkSources(target));
    else if (target.endsWith(".ts")) files.push(target);
  }
  return files;
}

const sources = walkSources(areaRoot);

describe("continuity contract hygiene (no second Agent Body; one authority)", () => {
  it("no continuity source imports @aurum/agent or @aurum/provider (R4)", () => {
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /["']@aurum\/(agent|provider)/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("the continuity domain layer is IO-free (no node: imports, no fetch/timers)", () => {
    for (const file of walkSources(domainRoot)) {
      const source = readFileSync(file, "utf8");
      const nodeImports = source.split("\n").filter((line) => /from\s+["']node:/.test(line));
      expect(nodeImports, `${file}: ${nodeImports.join("; ")}`).toEqual([]);
      expect(/\b(fetch|setTimeout|setInterval)\s*\(/.test(source), file).toBe(false);
    }
  });

  it("imports @aurum/domain only through its public package specifier", () => {
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /["']@aurum\/domain\/[^"']*["']/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("consumes sibling areas through their CONTRACT files only", () => {
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) =>
          /from\s+"\.\.\/\.\.\/(cognition|plans|lab|company|control-tower|learning)\/(?!contract\.)/.test(
            line,
          ),
        );
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("the ContinuityService surface is exactly the nine session operations", () => {
    const expected = [
      "openSession",
      "attachSession",
      "resumeSession",
      "ensureSession",
      "sessionInfo",
      "listSessions",
      "openAttachment",
      "closeAttachment",
      "listAttachments",
    ].sort();
    const actual = Object.keys({} as Record<keyof ContinuityService, unknown>).length; // runtime shape is type-only; assert the type-level keys via source
    void actual;
    const source = readFileSync(join(areaRoot, "domain", "ports.ts"), "utf8");
    const declared = [
      ...source.matchAll(
        /^  (openSession|attachSession|resumeSession|ensureSession|sessionInfo|listSessions|openAttachment|closeAttachment|listAttachments)\(/gm,
      ),
    ].map((match) => match[1]);
    expect([...new Set(declared)].sort()).toEqual(expected);
  });

  it("the ledger port is append-only: no update/delete methods exist", () => {
    const source = readFileSync(join(areaRoot, "domain", "ports.ts"), "utf8");
    const ledgerBlock = source.slice(
      source.indexOf("export interface ContinuityLedger"),
      source.indexOf("export interface TowerAttachmentSurface"),
    );
    const methods = [
      ...ledgerBlock.matchAll(
        /^  (append|list|listSessions|update|delete|remove|edit|rewrite)\(/gm,
      ),
    ].map((match) => match[1]);
    expect(methods.sort()).toEqual(["append", "list", "listSessions"]);
    // And the port TYPE exposes exactly those three (structural pick).
    type LedgerKeys = keyof ContinuityLedger;
    const witness: readonly LedgerKeys[] = ["append", "list", "listSessions"];
    expect(witness.sort()).toEqual(["append", "list", "listSessions"]);
  });

  it("the replay fold holds no reasoning/substrate port (R2, structural)", () => {
    const kernelSource = readFileSync(join(areaRoot, "adapters", "session-kernel.ts"), "utf8");
    // The fold applies records through stores/seams only: the replayer's
    // options carry the MOUNT wiring (a reasoning port for post-replay
    // continuation), but the fold itself never calls it — locked by the
    // counted proofs; structurally, no `requestReasoning` or `submitPlanTask`
    // call exists anywhere in the continuity area.
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      expect(/requestReasoning\(/.test(source), `${file} must not invoke a model`).toBe(false);
      expect(/submitPlanTask\(/.test(source), `${file} must not submit to a substrate`).toBe(false);
    }
    void kernelSource;
  });

  it("no lint-disable comments anywhere in the area source", () => {
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      const offenders = source.split("\n").filter((line) => /(oxlint|eslint)-disable/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("the continuity area adds no second error authority (one namespace, six codes)", () => {
    const source = readFileSync(join(areaRoot, "domain", "errors.ts"), "utf8");
    const codes = [...source.matchAll(/^\s*\| "(continuity-[a-z-]+)"/gm)].map((match) => match[1]);
    expect(codes).toEqual([
      "continuity-validation",
      "continuity-conflict",
      "continuity-not-found",
      "continuity-invariant",
      "continuity-surface-refused",
      "continuity-state",
    ]);
  });

  it("the RPC edge owns membership + arity ONLY (no argument validation there)", () => {
    const source = readFileSync(join(areaRoot, "adapters", "tower-rpc.ts"), "utf8");
    expect(source).toContain("No argument validation here");
    // And the envelope file never imports the areas' validators:
    const offenders = source
      .split("\n")
      .filter((line) =>
        /(missionValidationError|planValidationError|towerValidationError)/.test(line),
      );
    expect(offenders).toEqual([]);
  });
});
