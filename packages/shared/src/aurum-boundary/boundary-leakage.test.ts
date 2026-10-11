/**
 * W001 leakage tripwires.
 *
 * These tests lock the boundary's core promise: the Aurum-facing surface
 * under packages/shared/src/aurum-boundary never imports Aurum domain
 * packages, never imports ZCode substrate internals, and never exports
 * identifiers that carry ZCode semantic-state authority names.
 *
 * The scans are source-scans (regex over the boundary directory) exactly as
 * mandated by the W001 assignment, and each scan self-verifies: the
 * directory must actually be discovered and non-trivial, the export-name
 * collector must actually collect names, and the forbidden-substring
 * matcher must actually match a synthetic offender — a tripwire that
 * cannot bite is not a tripwire.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const boundaryDir = dirname(fileURLToPath(import.meta.url));

/** Every .ts file in the boundary directory (source + tests). */
const allBoundaryFiles = readdirSync(boundaryDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => join(boundaryDir, name));

/** Non-test source files — the declared surface. */
const surfaceFiles = allBoundaryFiles.filter((name) => !name.endsWith(".test.ts"));

/** Import/export-from specifiers found in a source text. */
function importSpecifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

/** Exported identifier names declared in a source text. */
function exportedIdentifiersOf(source: string): string[] {
  const names: string[] = [];
  const declaration = /export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(declaration)) {
    const name = match[1];
    if (name !== undefined) names.push(name);
  }
  const namedList = /export\s*\{([^}]*)\}/g;
  for (const match of source.matchAll(namedList)) {
    const list = match[1] ?? "";
    for (const rawEntry of list.split(",")) {
      const entry = rawEntry.trim();
      if (entry.length === 0) continue;
      const alias = entry.split(/\s+as\s+/);
      names.push((alias.at(-1) ?? entry).trim());
    }
  }
  return names;
}

/**
 * ZCode semantic-state authority vocabulary (spec/ZCODE-SUBSTRATE-MAP.md):
 * these names must never appear in the boundary's exported identifiers.
 */
const FORBIDDEN_EXPORT_SUBSTRINGS = [
  "task",
  "session",
  "workspace",
  "agentruntime",
  "workflowjournal",
  "pluginregistry",
  "providerconfig",
  "zcode",
] as const;

describe("W001 boundary import tripwires", () => {
  it("discovers a non-trivial boundary directory (the scan must have something to scan)", () => {
    expect(allBoundaryFiles.length).toBeGreaterThanOrEqual(8);
    expect(surfaceFiles.length).toBeGreaterThanOrEqual(6);
  });

  it("imports no @aurum domain package, no @zcode substrate package, no bare package at all", () => {
    const offenders: string[] = [];
    for (const file of allBoundaryFiles) {
      const specifiers = importSpecifiersOf(readFileSync(file, "utf8"));
      for (const specifier of specifiers) {
        const isRelative = specifier.startsWith(".") || specifier.startsWith("/");
        const isNodeBuiltin = specifier.startsWith("node:");
        const isVitestSelfImport = file.endsWith(".test.ts") && specifier === "vitest";
        if (!isRelative && !isNodeBuiltin && !isVitestSelfImport) {
          offenders.push(`${file}: "${specifier}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every relative import inside packages/shared/src (no escaping the boundary home)", () => {
    const sharedSrcRoot = join(boundaryDir, "..");
    const offenders: string[] = [];
    for (const file of allBoundaryFiles) {
      for (const specifier of importSpecifiersOf(readFileSync(file, "utf8"))) {
        if (!specifier.startsWith(".")) continue;
        const resolved = join(dirname(file), specifier);
        if (!resolved.startsWith(sharedSrcRoot)) {
          offenders.push(`${file}: "${specifier}" resolves to ${resolved}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("W001 boundary export-name tripwires", () => {
  it("collects a non-trivial export surface (the scan must have something to scan)", () => {
    const collected = surfaceFiles.flatMap((file) =>
      exportedIdentifiersOf(readFileSync(file, "utf8")),
    );
    expect(collected.length).toBeGreaterThanOrEqual(30);
  });

  it("the forbidden-substring matcher actually bites (synthetic offender check)", () => {
    const banned = FORBIDDEN_EXPORT_SUBSTRINGS.map((word) => word.toLowerCase());
    const bites = (identifier: string) =>
      banned.some((word) => identifier.toLowerCase().includes(word));
    expect(bites("AurumTaskRef")).toBe(true);
    expect(bites("AurumSessionToken")).toBe(true);
    expect(bites("AurumWorkspacePath")).toBe(true);
    expect(bites("ZcodeAgentRuntimeHandle")).toBe(true);
    expect(bites("AurumExecutionTransportPort")).toBe(false);
    expect(bites("AurumSubmissionTicket")).toBe(false);
  });

  it("exports no identifier carrying ZCode semantic-state authority names", () => {
    const banned = FORBIDDEN_EXPORT_SUBSTRINGS.map((word) => word.toLowerCase());
    const offenders: string[] = [];
    for (const file of surfaceFiles) {
      for (const identifier of exportedIdentifiersOf(readFileSync(file, "utf8"))) {
        if (banned.some((word) => identifier.toLowerCase().includes(word))) {
          offenders.push(`${file}: ${identifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares the mandated platform vocabulary exactly once, in the mandated shape", () => {
    const surface = surfaceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    // Mandated lifecycle vocabulary (W001): pending/running/settled/cancelled/failed
    // (+ paused as the documented control-plane extension).
    for (const state of ["pending", "running", "settled", "cancelled", "failed", "paused"]) {
      expect(surface).toContain(`"${state}"`);
    }
    // Mandated capability classes: local/browser/computer/workflow/remote/sandbox.
    for (const capabilityClass of [
      "local",
      "browser",
      "computer",
      "workflow",
      "remote",
      "sandbox",
    ]) {
      expect(surface).toContain(`"${capabilityClass}"`);
    }
  });
});
