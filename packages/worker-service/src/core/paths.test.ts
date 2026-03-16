import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { globalDir, globalPaths } from "./paths.js";

describe("paths", () => {
  const expectedBase = join(homedir(), ".renre-kit");

  describe("globalDir", () => {
    it("returns ~/.renre-kit", () => {
      expect(globalDir()).toBe(expectedBase);
    });
  });

  describe("globalPaths", () => {
    it("returns object with all expected keys", () => {
      const p = globalPaths();
      expect(p.globalDir).toBe(expectedBase);
      expect(p.configFile).toBe(join(expectedBase, "config.json"));
      expect(p.dataDb).toBe(join(expectedBase, "data.db"));
      expect(p.serverPid).toBe(join(expectedBase, "server.pid"));
      expect(p.serverJson).toBe(join(expectedBase, "server.json"));
      expect(p.extensionsDir).toBe(join(expectedBase, "extensions"));
      expect(p.logsDir).toBe(join(expectedBase, "logs"));
      expect(p.scriptsDir).toBe(join(expectedBase, "scripts"));
      expect(p.backupsDir).toBe(join(expectedBase, "backups"));
      expect(p.projectsDir).toBe(join(expectedBase, "projects"));
      expect(p.migrationsDir).toBe(join(expectedBase, "migrations"));
      expect(p.coreMigrationsDir).toBe(join(expectedBase, "migrations", "core"));
    });

    it("uses path.join not string concatenation", () => {
      const p = globalPaths();
      // All paths should start with the base directory
      for (const value of Object.values(p)) {
        expect(value).toContain(expectedBase);
      }
    });

    it("returns consistent results on repeated calls", () => {
      const p1 = globalPaths();
      const p2 = globalPaths();
      expect(p1).toEqual(p2);
    });
  });
});
