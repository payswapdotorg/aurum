// Vitest configuration for @aurum/infra (P001/P002/P003). The domain,
// provider and agent workspace imports resolve through their real links
// (CR-P001 and CR-P002 resolved by the TL). The @aurum/application import
// (P003 — the application storage ports and their reference error
// constructors) resolves through an INTERIM ALIAS to the package's public
// entry source until CR-P003-package-wiring lands the workspace link; the
// alias points at exactly the entrypoint the real link will provide, so
// behavior is identical before and after (the CR-P002 precedent).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@aurum/application",
        replacement: fileURLToPath(new URL("../aurum-application/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
