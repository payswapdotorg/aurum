// Vitest configuration for @aurum/infra (P001/P002).
//
// `@aurum/domain` resolves through the workspace link (CR-P001 resolved by
// the TL). `@aurum/provider` and `@aurum/agent` resolve through the two
// interim aliases below until the TL executes CR-P002-package-wiring; the
// aliases point the public entrypoint specifiers at the packages' public
// entry sources — the same boundary a real node_modules link provides, so
// no deep import is possible either way. Post-CR both aliases are to be
// REMOVED (the P001 precedent).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@aurum/domain": fileURLToPath(new URL("../aurum-domain/src/index.ts", import.meta.url)),
      "@aurum/provider": fileURLToPath(new URL("../aurum-provider/src/index.ts", import.meta.url)),
      "@aurum/agent": fileURLToPath(new URL("../aurum-agent/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
