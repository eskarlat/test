import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "backend/index": "backend/src/index.ts" },
  format: ["esm"],
  target: "node20",
  outDir: ".",
  clean: false,
  dts: false,
  sourcemap: true,
  external: ["express", "@renre-kit/extension-sdk"],
});
