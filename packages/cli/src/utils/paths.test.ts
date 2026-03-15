import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { globalDir, globalPaths, projectPaths, findProjectDir } from "./paths.js";

describe("paths", () => {
  describe("globalDir", () => {
    it("returns ~/.renre-kit", () => {
      expect(globalDir()).toBe(join(homedir(), ".renre-kit"));
    });
  });

  describe("globalPaths", () => {
    it("returns all expected path keys", () => {
      const paths = globalPaths();
      expect(paths.globalDir).toBe(join(homedir(), ".renre-kit"));
      expect(paths.configFile).toBe(join(homedir(), ".renre-kit", "config.json"));
      expect(paths.dataDb).toBe(join(homedir(), ".renre-kit", "data.db"));
      expect(paths.serverPid).toBe(join(homedir(), ".renre-kit", "server.pid"));
      expect(paths.serverJson).toBe(join(homedir(), ".renre-kit", "server.json"));
      expect(paths.extensionsDir).toBe(join(homedir(), ".renre-kit", "extensions"));
      expect(paths.logsDir).toBe(join(homedir(), ".renre-kit", "logs"));
      expect(paths.scriptsDir).toBe(join(homedir(), ".renre-kit", "scripts"));
      expect(paths.backupsDir).toBe(join(homedir(), ".renre-kit", "backups"));
      expect(paths.projectsDir).toBe(join(homedir(), ".renre-kit", "projects"));
      expect(paths.migrationsDir).toBe(join(homedir(), ".renre-kit", "migrations"));
    });
  });

  describe("projectPaths", () => {
    it("returns all expected path keys relative to project dir", () => {
      const paths = projectPaths("/tmp/my-project");
      expect(paths.renreKitDir).toBe("/tmp/my-project/.renre-kit");
      expect(paths.projectJson).toBe("/tmp/my-project/.renre-kit/project.json");
      expect(paths.extensionsJson).toBe("/tmp/my-project/.renre-kit/extensions.json");
      expect(paths.hooksDir).toBe("/tmp/my-project/.github/hooks");
      expect(paths.hooksJson).toBe("/tmp/my-project/.github/hooks/renre-kit.json");
      expect(paths.skillsDir).toBe("/tmp/my-project/.github/skills");
      expect(paths.scriptsDir).toBe("/tmp/my-project/.renre-kit/scripts");
      expect(paths.gitignore).toBe("/tmp/my-project/.gitignore");
    });
  });

  describe("findProjectDir", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "renre-test-"));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("finds project in current directory", () => {
      mkdirSync(join(tempDir, ".renre-kit"), { recursive: true });
      writeFileSync(join(tempDir, ".renre-kit", "project.json"), "{}");
      expect(findProjectDir(tempDir)).toBe(tempDir);
    });

    it("finds project in parent directory", () => {
      mkdirSync(join(tempDir, ".renre-kit"), { recursive: true });
      writeFileSync(join(tempDir, ".renre-kit", "project.json"), "{}");
      const childDir = join(tempDir, "src", "components");
      mkdirSync(childDir, { recursive: true });
      expect(findProjectDir(childDir)).toBe(tempDir);
    });

    it("returns null when no project found", () => {
      expect(findProjectDir(tempDir)).toBeNull();
    });
  });
});
