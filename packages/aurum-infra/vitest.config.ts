// Vitest configuration for @aurum/infra (P001/P002). All workspace imports
// resolve through their real links (CR-P001 and CR-P002 resolved by the TL).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
