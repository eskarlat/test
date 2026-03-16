import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/cli/vitest.config.ts",
  "packages/worker-service/vitest.config.ts",
  "packages/console-ui/vitest.config.ts",
  "packages/extension-sdk/vitest.config.ts",
  "packages/source-resolver/vitest.config.ts",
]);
