// Vitest configuration for @aurum/infra (P001). `@aurum/domain` resolves
// through the workspace link (CR-P001 resolved by the TL).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
