import { defineConfig } from "tsup";

export default defineConfig([
  // Backend bundle (Node.js)
  {
    entry: { "backend/index": "backend/src/index.ts" },
    format: ["esm"],
    target: "node20",
    outDir: ".",
    clean: false,
    dts: false,
    sourcemap: true,
    external: ["express", "@renre-kit/extension-sdk"],
  },
  // UI bundle (Browser)
  {
    entry: { "ui/index": "ui/src/index.tsx" },
    format: ["esm"],
    target: "es2022",
    outDir: ".",
    clean: false,
    dts: false,
    sourcemap: true,
    external: ["react", "react-dom", "react/jsx-runtime", "@renre-kit/extension-sdk"],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
]);
