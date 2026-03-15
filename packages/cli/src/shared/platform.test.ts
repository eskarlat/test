import { describe, it, expect, vi } from "vitest";
import { setFilePermissions, getPlatformSignals, resolvePaths } from "./platform.js";

vi.mock("node:fs", () => ({
  chmodSync: vi.fn(),
}));

import { chmodSync } from "node:fs";

describe("platform", () => {
  describe("setFilePermissions", () => {
    it("calls chmodSync on non-Windows", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      setFilePermissions("/tmp/test", 0o600);
      expect(chmodSync).toHaveBeenCalledWith("/tmp/test", 0o600);
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });
  });

  describe("getPlatformSignals", () => {
    it("returns array of signals", () => {
      const signals = getPlatformSignals();
      expect(signals).toContain("SIGINT");
      expect(signals).toContain("SIGTERM");
    });
  });

  describe("resolvePaths", () => {
    it("returns path structure", () => {
      const paths = resolvePaths();
      expect(paths.globalDir).toContain(".renre-kit");
      expect(paths.configFile).toContain("config.json");
      expect(paths.dataDb).toContain("data.db");
      expect(paths.serverPid).toContain("server.pid");
      expect(paths.serverJson).toContain("server.json");
      expect(paths.extensionsDir).toContain("extensions");
      expect(paths.logsDir).toContain("logs");
      expect(paths.scriptsDir).toContain("scripts");
      expect(paths.backupsDir).toContain("backups");
    });
  });
});
