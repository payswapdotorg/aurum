/**
 * ACCEPTANCE (structural): provider SDK types never appear in domain
 * contracts; no provider SDK packages are dependencies; credential
 * material never enters domain/app signatures; the domain layer stays
 * IO-free; no lint-disable comments exist in the package source.
 *
 * These are source-and-surface scans that complement the behavior tests:
 * they prove the CONTRACT shape, not just today's runtime behavior.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as providerSurface from "../src/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcRoot = join(packageRoot, "src");

function walkSources(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkSources(target));
    else if (target.endsWith(".ts")) files.push(target);
  }
  return files;
}

const SDK_NAME_PATTERN =
  /^(OpenAI|Anthropic|AzureOpenAI|AnthropicBedrock|ChatCompletion|Gemini|Cohere|Groq|Mistral|Together|DeepSeek)/;

describe("contract hygiene", () => {
  it("public surface exports no provider SDK type names", () => {
    const exportedNames = Object.keys(providerSurface);
    expect(exportedNames.length).toBeGreaterThan(40);
    const offenders = exportedNames.filter((name) => SDK_NAME_PATTERN.test(name));
    expect(offenders).toEqual([]);
  });

  it("package has no provider SDK dependency (adapters stay SDK-free today)", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const offenders = Object.keys(all).filter((dep) =>
      /(^@?openai$|anthropic|@google|cohere-ai|groq-sdk|@mistralai|deepseek)/i.test(dep),
    );
    expect(offenders).toEqual([]);
  });

  it("source never imports a provider SDK package anywhere", () => {
    for (const file of walkSources(srcRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) =>
          /from\s+["'](?:@?(?:openai)|@anthropic-ai\/sdk|@google\/|cohere-ai)/.test(line),
        );
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });

  it("credential material type never appears in domain or app layers", () => {
    for (const file of walkSources(srcRoot)) {
      if (!/(\/domain\/|\/app\/)/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      expect(source.includes("SecretMaterial"), file).toBe(false);
      expect(source.includes("apiKeyString"), file).toBe(false);
    }
  });

  it("domain layer imports no node/io modules and calls no io", () => {
    for (const file of walkSources(join(srcRoot, "domain"))) {
      const source = readFileSync(file, "utf8");
      const nodeImports = source.split("\n").filter((line) => /from\s+["']node:/.test(line));
      expect(nodeImports, `${file}: ${nodeImports.join("; ")}`).toEqual([]);
      expect(/\b(fetch|setTimeout|setInterval)\s*\(/.test(source), file).toBe(false);
    }
  });

  it("no lint-disable comments anywhere in package source", () => {
    for (const file of walkSources(srcRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source.split("\n").filter((line) => /(oxlint|eslint)-disable/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    }
  });
});
