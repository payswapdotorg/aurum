// Vitest configuration for @aurum/infra (P001).
//
// `@aurum/domain` resolves through the workspace link once the TL executes
// CR-P001-package-wiring; until then (and identically after) the alias points
// the public entrypoint specifier at the domain package's public entry source
// — the same boundary a real node_modules link provides, so no deep import is
// possible either way.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@aurum/domain": fileURLToPath(new URL("../aurum-domain/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
