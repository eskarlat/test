import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@renre-kit/extension-sdk": path.resolve(
        __dirname,
        "../extension-sdk/src/index.ts",
      ),
    },
  },
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.*", "src/test-helpers.*"],
    },
  },
});
