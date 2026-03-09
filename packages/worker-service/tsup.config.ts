import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  shims: true,
  sourcemap: true,
  splitting: false,
  external: ["better-sqlite3"],
  onSuccess: async () => {
    // Copy SQL migration files to dist/migrations/core/
    const src = join("src", "migrations", "core");
    const dest = join("dist", "migrations", "core");
    mkdirSync(dest, { recursive: true });
    for (const file of readdirSync(src)) {
      if (file.endsWith(".sql")) {
        copyFileSync(join(src, file), join(dest, file));
      }
    }

    // Copy worker-service.cjs hook entry point to dist/scripts/
    const scriptsSrc = join("src", "scripts", "worker-service.cjs");
    const scriptsDest = join("dist", "scripts");
    mkdirSync(scriptsDest, { recursive: true });
    copyFileSync(scriptsSrc, join(scriptsDest, "worker-service.cjs"));
  },
});
