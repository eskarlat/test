import { describe, it, expect, vi } from "vitest";

const mockChmodSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, chmodSync: mockChmodSync };
});

import { join } from "node:path";
import { homedir } from "node:os";
import { setFilePermissions, getPlatformSignals, resolvePaths } from "./platform.js";

describe("platform utilities", () => {
  describe("setFilePermissions", () => {
    it("calls chmodSync on non-win32 platforms", () => {
      // On Linux (test env), this should call chmodSync
      if (process.platform !== "win32") {
        setFilePermissions("/tmp/test-file", 0o600);
        expect(mockChmodSync).toHaveBeenCalledWith("/tmp/test-file", 0o600);
      }
    });
  });

  describe("getPlatformSignals", () => {
    it("returns array of signal names", () => {
      const signals = getPlatformSignals();
      expect(Array.isArray(signals)).toBe(true);
      expect(signals).toContain("SIGINT");
      expect(signals).toContain("SIGTERM");
      expect(signals).toContain("SIGBREAK");
    });
  });

  describe("resolvePaths", () => {
    const expectedBase = join(homedir(), ".renre-kit");

    it("returns object with correct keys", () => {
      const p = resolvePaths();
      expect(p.globalDir).toBe(expectedBase);
      expect(p.configFile).toBe(join(expectedBase, "config.json"));
      expect(p.dataDb).toBe(join(expectedBase, "data.db"));
      expect(p.serverPid).toBe(join(expectedBase, "server.pid"));
      expect(p.serverJson).toBe(join(expectedBase, "server.json"));
      expect(p.extensionsDir).toBe(join(expectedBase, "extensions"));
      expect(p.logsDir).toBe(join(expectedBase, "logs"));
      expect(p.scriptsDir).toBe(join(expectedBase, "scripts"));
      expect(p.backupsDir).toBe(join(expectedBase, "backups"));
    });

    it("uses path.join for all paths", () => {
      const p = resolvePaths();
      for (const value of Object.values(p)) {
        expect(value).toContain(expectedBase);
      }
    });
  });
});
