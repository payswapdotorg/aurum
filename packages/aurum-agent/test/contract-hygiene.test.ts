/**
 * ACCEPTANCE (structural, agent side): no provider SDK types on the agent
 * public surface, no SDK dependencies, domain layer IO-free, no
 * lint-disable comments, and @aurum/provider is imported only via its
 * package entrypoint (never a deep path) — mirroring the provider-side
 * hygiene tests.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as agentSurface from "../src/index.js";

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

describe("agent contract hygiene", () => {
  it("public surface exports no provider SDK type names", () => {
    const exportedNames = Object.keys(agentSurface);
    expect(exportedNames.length).toBeGreaterThan(30);
    const offenders = exportedNames.filter((name) => SDK_NAME_PATTERN.test(name));
    expect(offenders).toEqual([]);
  });

  it("depends on @aurum/provider (declared) and no provider SDKs", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@aurum/provider"]).toBe("workspace:*");
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const offenders = Object.keys(all).filter((dep) =>
      /(^@?openai$|@anthropic-ai|@google\/|cohere-ai|groq-sdk|@mistralai|deepseek)/i.test(dep),
    );
    expect(offenders).toEqual([]);
  });

  it("imports @aurum/provider only through its public package specifier", () => {
    for (const file of walkSources(srcRoot)) {
      const source = readFileSync(file, "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /["']@aurum\/provider\/[^"']*["']/.test(line));
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
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
