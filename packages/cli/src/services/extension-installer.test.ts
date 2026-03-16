import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

// Mock node:fs with memfs, adding cpSync which memfs doesn't provide
const mockCpSync = vi.fn();
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return {
    ...memfs.fs,
    cpSync: mockCpSync,
  };
});

// Mock node:child_process
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

// Mock paths
vi.mock("../utils/paths.js", () => ({
  globalPaths: vi.fn(() => ({
    globalDir: "/home/user/.renre-kit",
    extensionsDir: "/home/user/.renre-kit/extensions",
  })),
  projectPaths: vi.fn((projectDir: string) => ({
    renreKitDir: `${projectDir}/.renre-kit`,
    projectJson: `${projectDir}/.renre-kit/project.json`,
    extensionsJson: `${projectDir}/.renre-kit/extensions.json`,
    hooksDir: `${projectDir}/.github/hooks`,
    hooksJson: `${projectDir}/.github/hooks/renre-kit.json`,
    skillsDir: `${projectDir}/.github/skills`,
    scriptsDir: `${projectDir}/.renre-kit/scripts`,
  })),
}));

// Mock project-manager
vi.mock("../services/project-manager.js", () => ({
  readExtensionsJson: vi.fn(),
  writeExtensionsJson: vi.fn(),
}));

// Mock logger
vi.mock("../utils/logger.js", () => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  spinner: vi.fn(() => ({
    stop: vi.fn(),
    message: vi.fn(),
  })),
}));

// Mock hook-file-generator
vi.mock("./hook-file-generator.js", () => ({
  addExtensionHooks: vi.fn(),
  removeExtensionHooks: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { readExtensionsJson, writeExtensionsJson } from "../services/project-manager.js";
import { addExtensionHooks, removeExtensionHooks } from "./hook-file-generator.js";
import * as clack from "@clack/prompts";

const mockSpawnSync = vi.mocked(spawnSync);
const mockReadExtensionsJson = vi.mocked(readExtensionsJson);
const mockWriteExtensionsJson = vi.mocked(writeExtensionsJson);
const mockAddExtensionHooks = vi.mocked(addExtensionHooks);
const mockRemoveExtensionHooks = vi.mocked(removeExtensionHooks);

describe("extension-installer", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  describe("downloadExtension", () => {
    it("returns existing directory if already downloaded", async () => {
      vol.mkdirSync("/home/user/.renre-kit/extensions/my-ext/1.0.0", { recursive: true });

      const { downloadExtension } = await import("./extension-installer.js");
      const result = await downloadExtension("my-ext", "1.0.0", "https://github.com/test/my-ext");
      expect(result).toBe("/home/user/.renre-kit/extensions/my-ext/1.0.0");
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });

    it("clones with --branch for tag-like versions", async () => {
      mockSpawnSync.mockReturnValue({ status: 0 } as any);

      const { downloadExtension } = await import("./extension-installer.js");
      await downloadExtension("my-ext", "1.0.0", "https://github.com/test/my-ext");

      expect(mockSpawnSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["clone", "--depth=1", "--branch", "1.0.0"]),
        expect.any(Object),
      );
    });

    it("clones without --branch for non-tag versions", async () => {
      mockSpawnSync.mockReturnValue({ status: 0 } as any);

      const { downloadExtension } = await import("./extension-installer.js");
      await downloadExtension("my-ext", "latest", "https://github.com/test/my-ext");

      const args = mockSpawnSync.mock.calls[0][1] as string[];
      expect(args).not.toContain("--branch");
    });

    it("throws on git clone failure", async () => {
      mockSpawnSync.mockReturnValue({ status: 1 } as any);

      const { downloadExtension } = await import("./extension-installer.js");
      await expect(
        downloadExtension("my-ext", "1.0.0", "https://github.com/test/my-ext"),
      ).rejects.toThrow("git clone failed");
    });
  });

  describe("formatPermissions", () => {
    it("returns '(none)' for empty or undefined permissions", async () => {
      const { formatPermissions } = await import("./extension-installer.js");
      expect(formatPermissions(undefined)).toContain("(none)");
      expect(formatPermissions({})).toContain("(none)");
    });

    it("lists active permissions", async () => {
      const { formatPermissions } = await import("./extension-installer.js");
      const result = formatPermissions({ database: true, network: true, vault: false });
      expect(result).toContain("database");
      expect(result).toContain("network");
      expect(result).not.toContain("vault");
    });

    it("returns '(none)' when all permissions are falsy", async () => {
      const { formatPermissions } = await import("./extension-installer.js");
      const result = formatPermissions({ database: false, network: false });
      expect(result).toContain("(none)");
    });
  });

  describe("validateAndInstall", () => {
    const baseOptions = {
      projectDir: "/my-project",
      name: "my-ext",
      version: "1.0.0",
      repository: "https://github.com/test/my-ext",
      marketplace: "official",
      yes: true,
    };

    function setupManifest(manifest: Record<string, unknown>) {
      const extDir = "/home/user/.renre-kit/extensions/my-ext/1.0.0";
      vol.mkdirSync(extDir, { recursive: true });
      vol.writeFileSync(`${extDir}/manifest.json`, JSON.stringify(manifest));
      // Create project extensions dir
      vol.mkdirSync("/my-project/.renre-kit", { recursive: true });
    }

    it("returns error if download fails", async () => {
      mockSpawnSync.mockReturnValue({ status: 1 } as any);

      const { validateAndInstall } = await import("./extension-installer.js");
      const result = await validateAndInstall(baseOptions, false);

      expect(result.success).toBe(false);
      expect(result.error).toContain("git clone failed");
    });

    it("returns error if manifest is missing", async () => {
      // Extension dir exists but no manifest.json
      vol.mkdirSync("/home/user/.renre-kit/extensions/my-ext/1.0.0", { recursive: true });

      const { validateAndInstall } = await import("./extension-installer.js");
      const result = await validateAndInstall(baseOptions, false);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Manifest validation failed");
    });

    it("returns error if manifest is missing required fields", async () => {
      const extDir = "/home/user/.renre-kit/extensions/my-ext/1.0.0";
      vol.mkdirSync(extDir, { recursive: true });
      vol.writeFileSync(`${extDir}/manifest.json`, JSON.stringify({ name: "my-ext" }));

      const { validateAndInstall } = await import("./extension-installer.js");
      const result = await validateAndInstall(baseOptions, false);

      expect(result.success).toBe(false);
      expect(result.error).toContain("missing required fields");
    });

    it("installs successfully and writes extensions.json", async () => {
      setupManifest({
        name: "my-ext",
        version: "1.0.0",
        sdkVersion: "0.1.0",
      });
      mockReadExtensionsJson.mockReturnValue({ extensions: [] });

      const { validateAndInstall } = await import("./extension-installer.js");
      const result = await validateAndInstall(baseOptions, false);

      expect(result.success).toBe(true);
      expect(mockWriteExtensionsJson).toHaveBeenCalledWith(
        "/my-project",
        expect.objectContaining({
          extensions: expect.arrayContaining([
            expect.objectContaining({ name: "my-ext", version: "1.0.0" }),
          ]),
        }),
      );
    });

    it("updates existing extension entry", async () => {
      setupManifest({
        name: "my-ext",
        version: "1.0.0",
        sdkVersion: "0.1.0",
      });
      mockReadExtensionsJson.mockReturnValue({
        extensions: [
          { name: "my-ext", version: "0.9.0", enabled: true, source: "old", marketplace: "official", settings: {} },
        ],
      });

      const { validateAndInstall } = await import("./extension-installer.js");
      const result = await validateAndInstall(baseOptions, false);

      expect(result.success).toBe(true);
      const writeCall = mockWriteExtensionsJson.mock.calls[0][1];
      expect(writeCall.extensions).toHaveLength(1);
      expect(writeCall.extensions[0].version).toBe("1.0.0");
    });

    it("adds hooks when manifest declares hook events", async () => {
      setupManifest({
        name: "my-ext",
        version: "1.0.0",
        sdkVersion: "0.1.0",
        hooks: { events: ["sessionStart", "preToolUse"] },
      });
      mockReadExtensionsJson.mockReturnValue({ extensions: [] });

      const { validateAndInstall } = await import("./extension-installer.js");
      await validateAndInstall(baseOptions, false);

      expect(mockAddExtensionHooks).toHaveBeenCalledWith(
        "/my-project",
        "my-ext",
        ["sessionStart", "preToolUse"],
        "my-ext",
      );
    });

    it("copies skills when manifest declares skills", async () => {
      const extDir = "/home/user/.renre-kit/extensions/my-ext/1.0.0";
      vol.mkdirSync(extDir, { recursive: true });
      vol.mkdirSync(`${extDir}/skills`, { recursive: true });
      vol.writeFileSync(`${extDir}/skills/my-skill.md`, "# My Skill");
      vol.writeFileSync(
        `${extDir}/manifest.json`,
        JSON.stringify({
          name: "my-ext",
          version: "1.0.0",
          sdkVersion: "0.1.0",
          skills: [{ name: "my-skill", file: "skills/my-skill.md" }],
        }),
      );
      vol.mkdirSync("/my-project/.renre-kit", { recursive: true });
      mockReadExtensionsJson.mockReturnValue({ extensions: [] });

      const { validateAndInstall } = await import("./extension-installer.js");
      await validateAndInstall(baseOptions, false);

      expect(
        vol.existsSync("/my-project/.github/skills/my-skill/SKILL.md"),
      ).toBe(true);
    });

    it("cancels when user declines permissions in interactive mode", async () => {
      setupManifest({
        name: "my-ext",
        version: "1.0.0",
        sdkVersion: "0.1.0",
        permissions: { database: true },
      });

      vi.mocked(clack.confirm).mockResolvedValue(false);
      vi.mocked(clack.isCancel).mockReturnValue(false);

      const { validateAndInstall } = await import("./extension-installer.js");
      const result = await validateAndInstall(
        { ...baseOptions, yes: false },
        true,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("cancelled by user");
    });
  });

  describe("uninstallExtension", () => {
    it("removes extension from extensions.json", async () => {
      mockReadExtensionsJson.mockReturnValue({
        extensions: [
          { name: "my-ext", version: "1.0.0", enabled: true, source: "repo" },
          { name: "other", version: "1.0.0", enabled: true, source: "repo" },
        ],
      });

      const { uninstallExtension } = await import("./extension-installer.js");
      uninstallExtension("/my-project", "my-ext");

      expect(mockWriteExtensionsJson).toHaveBeenCalledWith(
        "/my-project",
        expect.objectContaining({
          extensions: [
            expect.objectContaining({ name: "other" }),
          ],
        }),
      );
    });

    it("calls removeExtensionHooks", async () => {
      mockReadExtensionsJson.mockReturnValue({
        extensions: [{ name: "my-ext", version: "1.0.0", enabled: true, source: "repo" }],
      });

      const { uninstallExtension } = await import("./extension-installer.js");
      uninstallExtension("/my-project", "my-ext");

      expect(mockRemoveExtensionHooks).toHaveBeenCalledWith("/my-project", "my-ext");
    });

    it("removes skill and script directories", async () => {
      mockReadExtensionsJson.mockReturnValue({
        extensions: [{ name: "my-ext", version: "1.0.0", enabled: true, source: "repo" }],
      });

      vol.mkdirSync("/my-project/.github/skills/my-ext", { recursive: true });
      vol.writeFileSync("/my-project/.github/skills/my-ext/SKILL.md", "# Skill");
      vol.mkdirSync("/my-project/.renre-kit/scripts/my-ext", { recursive: true });
      vol.writeFileSync("/my-project/.renre-kit/scripts/my-ext/run.sh", "#!/bin/sh");

      const { uninstallExtension } = await import("./extension-installer.js");
      uninstallExtension("/my-project", "my-ext");

      expect(vol.existsSync("/my-project/.github/skills/my-ext")).toBe(false);
      expect(vol.existsSync("/my-project/.renre-kit/scripts/my-ext")).toBe(false);
    });

    it("does nothing if extensions.json is null", async () => {
      mockReadExtensionsJson.mockReturnValue(null);

      const { uninstallExtension } = await import("./extension-installer.js");
      uninstallExtension("/my-project", "my-ext");

      expect(mockWriteExtensionsJson).not.toHaveBeenCalled();
    });
  });

  describe("installFromLocal", () => {
    it("copies local directory to global extensions dir", async () => {
      const { installFromLocal } = await import("./extension-installer.js");
      const result = installFromLocal("my-ext", "1.0.0", "/local/my-ext");

      expect(result).toBe("/home/user/.renre-kit/extensions/my-ext/1.0.0");
      expect(mockCpSync).toHaveBeenCalledWith(
        "/local/my-ext",
        "/home/user/.renre-kit/extensions/my-ext/1.0.0",
        { recursive: true },
      );
    });
  });
});
