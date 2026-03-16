import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

// Mock paths
vi.mock("../utils/paths.js", () => ({
  findProjectDir: vi.fn(),
  globalPaths: () => ({
    globalDir: "/home/test/.renre-kit",
    configFile: "/home/test/.renre-kit/config.json",
  }),
}));

// Mock config
vi.mock("../utils/config.js", () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}));

// Mock project-manager
vi.mock("../services/project-manager.js", () => ({
  readProjectJson: vi.fn(),
  readExtensionsJson: vi.fn(),
  writeExtensionsJson: vi.fn(),
}));

// Mock marketplace-client
vi.mock("../services/marketplace-client.js", () => ({
  loadCache: vi.fn(),
  refreshCache: vi.fn(),
  searchExtensions: vi.fn(),
  resolveExtension: vi.fn(),
  isCacheStale: vi.fn(),
}));

// Mock extension-installer
vi.mock("../services/extension-installer.js", () => ({
  validateAndInstall: vi.fn(),
  uninstallExtension: vi.fn(),
  installFromLocal: vi.fn(),
  formatPermissions: vi.fn(() => "  database: true"),
}));

// Mock server-client
vi.mock("../services/server-client.js", () => ({
  notifyExtensionReload: vi.fn(),
  notifyExtensionUnload: vi.fn(),
  notifyExtensionUpgrade: vi.fn(),
  notifyExtensionEnable: vi.fn(),
  notifyExtensionDisable: vi.fn(),
  readServerState: vi.fn(),
}));

// Mock formatter
vi.mock("../utils/formatter.js", () => ({
  formatTable: vi.fn((_headers: string[], rows: string[][]) =>
    rows.map((r) => r.join(" | ")).join("\n"),
  ),
}));

// Mock shared/urls
vi.mock("../shared/urls.js", () => ({
  isLocalPath: vi.fn((v: string) => v.startsWith("/")),
}));

import { findProjectDir } from "../utils/paths.js";
import { readConfig, writeConfig } from "../utils/config.js";
import {
  readProjectJson,
  readExtensionsJson,
  writeExtensionsJson,
} from "../services/project-manager.js";
import {
  loadCache,
  refreshCache,
  searchExtensions,
  resolveExtension,
  isCacheStale,
} from "../services/marketplace-client.js";
import {
  validateAndInstall,
  uninstallExtension,
  installFromLocal,
} from "../services/extension-installer.js";
import {
  notifyExtensionReload,
  notifyExtensionEnable,
  notifyExtensionDisable,
  readServerState,
} from "../services/server-client.js";

const mockFindProjectDir = vi.mocked(findProjectDir);
const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);
const mockReadProjectJson = vi.mocked(readProjectJson);
const mockReadExtensionsJson = vi.mocked(readExtensionsJson);
const mockWriteExtensionsJson = vi.mocked(writeExtensionsJson);
const mockLoadCache = vi.mocked(loadCache);
const mockRefreshCache = vi.mocked(refreshCache);
const mockSearchExtensions = vi.mocked(searchExtensions);
const mockResolveExtension = vi.mocked(resolveExtension);
const mockIsCacheStale = vi.mocked(isCacheStale);
const mockValidateAndInstall = vi.mocked(validateAndInstall);
const mockUninstallExtension = vi.mocked(uninstallExtension);
const mockInstallFromLocal = vi.mocked(installFromLocal);
const _mockNotifyExtensionReload = vi.mocked(notifyExtensionReload);
const mockNotifyExtensionEnable = vi.mocked(notifyExtensionEnable);
const mockNotifyExtensionDisable = vi.mocked(notifyExtensionDisable);
const mockReadServerState = vi.mocked(readServerState);

const defaultConfig = {
  port: 42888,
  logLevel: "info" as const,
  marketplaces: [
    { name: "official", url: "https://marketplace.renre-kit.dev", type: "url" as const },
  ],
  backup: { intervalHours: 24, maxCount: 10, maxAgeDays: 30 },
};

describe("marketplace command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.stdout.isTTY = false as any;
    mockReadConfig.mockReturnValue(defaultConfig);
    mockReadServerState.mockReturnValue(null);

    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    vi.restoreAllMocks();
  });

  async function runMarketplace(...args: string[]) {
    const { registerMarketplaceCommand } = await import("./marketplace.js");
    const program = new Command();
    program.exitOverride();
    registerMarketplaceCommand(program);
    return program.parseAsync(["node", "test", "marketplace", ...args]);
  }

  function setupProjectContext() {
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "Test" });
  }

  describe("search", () => {
    it("searches marketplace cache and displays results", async () => {
      setupProjectContext();
      const cache = {
        marketplaces: [
          {
            name: "official",
            url: "https://example.com",
            extensions: [
              {
                name: "git-tracker",
                version: "1.0.0",
                description: "Tracks git activity",
                repository: "https://github.com/test/git-tracker",
                tags: ["git"],
              },
            ],
            fetchedAt: new Date().toISOString(),
          },
        ],
        fetchedAt: new Date().toISOString(),
      };
      mockLoadCache.mockReturnValue(cache);
      mockIsCacheStale.mockReturnValue(false);
      mockSearchExtensions.mockReturnValue([
        {
          name: "git-tracker",
          version: "1.0.0",
          description: "Tracks git activity",
          repository: "https://github.com/test/git-tracker",
          tags: ["git"],
          marketplace: "official",
        },
      ]);
      mockReadExtensionsJson.mockReturnValue({ extensions: [] });

      await runMarketplace("search", "git");

      expect(mockSearchExtensions).toHaveBeenCalledWith(cache, "git");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("refreshes cache if empty", async () => {
      setupProjectContext();
      const freshCache = {
        marketplaces: [],
        fetchedAt: new Date().toISOString(),
      };
      // 1st call: search action `if (!loadCache())` -> null
      // 2nd call: getOrRefreshCache `loadCache()` -> null -> triggers refresh
      // 3rd call: runSearch `loadCache()` -> freshCache
      mockLoadCache
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValue(freshCache);
      mockRefreshCache.mockResolvedValue(freshCache);
      mockSearchExtensions.mockReturnValue([]);
      mockReadExtensionsJson.mockReturnValue({ extensions: [] });

      await runMarketplace("search", "test");

      expect(mockRefreshCache).toHaveBeenCalled();
    });
  });

  describe("add (install)", () => {
    it("installs an extension from marketplace", async () => {
      setupProjectContext();
      const cache = {
        marketplaces: [
          {
            name: "official",
            url: "https://example.com",
            extensions: [
              {
                name: "my-ext",
                version: "2.0.0",
                description: "Test",
                repository: "https://github.com/test/my-ext",
                tags: [],
              },
            ],
            fetchedAt: new Date().toISOString(),
          },
        ],
        fetchedAt: new Date().toISOString(),
      };
      mockLoadCache.mockReturnValue(cache);
      mockIsCacheStale.mockReturnValue(false);
      mockResolveExtension.mockReturnValue({
        marketplaceName: "official",
        ext: {
          name: "my-ext",
          version: "2.0.0",
          description: "Test",
          repository: "https://github.com/test/my-ext",
          tags: [],
        },
      });
      mockValidateAndInstall.mockResolvedValue({ success: true });

      await runMarketplace("add", "my-ext");

      expect(mockValidateAndInstall).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "my-ext",
          version: "2.0.0",
          marketplace: "official",
        }),
        false, // non-interactive
      );
    });

    it("installs from local path with --local flag", async () => {
      setupProjectContext();
      mockInstallFromLocal.mockReturnValue("/home/test/.renre-kit/extensions/my-ext/local");
      mockReadExtensionsJson.mockReturnValue({ extensions: [] });

      await runMarketplace("add", "my-ext", "--local", "/path/to/ext");

      expect(mockInstallFromLocal).toHaveBeenCalledWith("my-ext", "local", "/path/to/ext");
      expect(mockWriteExtensionsJson).toHaveBeenCalled();
    });

    it("exits when no extension name provided", async () => {
      await expect(runMarketplace("add")).rejects.toThrow("process.exit called");
    });

    it("exits when extension not found in marketplace", async () => {
      setupProjectContext();
      const cache = { marketplaces: [], fetchedAt: new Date().toISOString() };
      mockLoadCache.mockReturnValue(cache);
      mockIsCacheStale.mockReturnValue(false);
      mockResolveExtension.mockReturnValue(null);

      await expect(runMarketplace("add", "nonexistent")).rejects.toThrow(
        "process.exit called",
      );
    });

    it("exits when not in a project", async () => {
      mockFindProjectDir.mockReturnValue(null);

      await expect(runMarketplace("add", "my-ext")).rejects.toThrow(
        "process.exit called",
      );
    });
  });

  describe("remove", () => {
    it("removes an installed extension", async () => {
      setupProjectContext();

      await runMarketplace("remove", "my-ext", "--yes");

      expect(mockUninstallExtension).toHaveBeenCalledWith("/test-project", "my-ext");
    });

    it("exits when not in a project", async () => {
      mockFindProjectDir.mockReturnValue(null);

      await expect(runMarketplace("remove", "my-ext")).rejects.toThrow(
        "process.exit called",
      );
    });
  });

  describe("list", () => {
    it("lists installed extensions", async () => {
      setupProjectContext();
      mockReadExtensionsJson.mockReturnValue({
        extensions: [
          { name: "ext-a", version: "1.0.0", enabled: true, source: "official" },
          { name: "ext-b", version: "2.0.0", enabled: false, source: "local" },
        ],
      });
      mockLoadCache.mockReturnValue(null);

      await runMarketplace("list");

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("shows no extensions message when none installed", async () => {
      setupProjectContext();
      mockReadExtensionsJson.mockReturnValue({ extensions: [] });

      await expect(runMarketplace("list")).resolves.not.toThrow();
    });

    it("exits when not in a project", async () => {
      mockFindProjectDir.mockReturnValue(null);

      await expect(runMarketplace("list")).rejects.toThrow("process.exit called");
    });
  });

  describe("enable", () => {
    it("enables a disabled extension", async () => {
      setupProjectContext();
      const extJson = {
        extensions: [
          { name: "my-ext", version: "1.0.0", enabled: false, source: "official" },
        ],
      };
      mockReadExtensionsJson.mockReturnValue(extJson);

      await runMarketplace("enable", "my-ext");

      expect(mockWriteExtensionsJson).toHaveBeenCalledWith(
        "/test-project",
        expect.objectContaining({
          extensions: [
            expect.objectContaining({ name: "my-ext", enabled: true }),
          ],
        }),
      );
    });

    it("notifies server when running", async () => {
      setupProjectContext();
      mockReadExtensionsJson.mockReturnValue({
        extensions: [
          { name: "my-ext", version: "1.0.0", enabled: false, source: "official" },
        ],
      });
      mockReadServerState.mockReturnValue({
        pid: 1234,
        port: 42888,
        startedAt: "2026-01-01T00:00:00Z",
        activeProjects: [],
      });

      await runMarketplace("enable", "my-ext");

      expect(mockNotifyExtensionEnable).toHaveBeenCalledWith("proj-1", "my-ext");
    });

    it("does nothing when already enabled", async () => {
      setupProjectContext();
      mockReadExtensionsJson.mockReturnValue({
        extensions: [
          { name: "my-ext", version: "1.0.0", enabled: true, source: "official" },
        ],
      });

      await runMarketplace("enable", "my-ext");

      expect(mockWriteExtensionsJson).not.toHaveBeenCalled();
    });

    it("exits when extension not installed", async () => {
      setupProjectContext();
      mockReadExtensionsJson.mockReturnValue({ extensions: [] });

      await expect(runMarketplace("enable", "nonexistent")).rejects.toThrow(
        "process.exit called",
      );
    });
  });

  describe("disable", () => {
    it("disables an enabled extension", async () => {
      setupProjectContext();
      mockReadExtensionsJson.mockReturnValue({
        extensions: [
          { name: "my-ext", version: "1.0.0", enabled: true, source: "official" },
        ],
      });

      await runMarketplace("disable", "my-ext");

      expect(mockWriteExtensionsJson).toHaveBeenCalledWith(
        "/test-project",
        expect.objectContaining({
          extensions: [
            expect.objectContaining({ name: "my-ext", enabled: false }),
          ],
        }),
      );
    });

    it("notifies server when running", async () => {
      setupProjectContext();
      mockReadExtensionsJson.mockReturnValue({
        extensions: [
          { name: "my-ext", version: "1.0.0", enabled: true, source: "official" },
        ],
      });
      mockReadServerState.mockReturnValue({
        pid: 1234,
        port: 42888,
        startedAt: "2026-01-01T00:00:00Z",
        activeProjects: [],
      });

      await runMarketplace("disable", "my-ext");

      expect(mockNotifyExtensionDisable).toHaveBeenCalledWith("proj-1", "my-ext");
    });

    it("does nothing when already disabled", async () => {
      setupProjectContext();
      mockReadExtensionsJson.mockReturnValue({
        extensions: [
          { name: "my-ext", version: "1.0.0", enabled: false, source: "official" },
        ],
      });

      await runMarketplace("disable", "my-ext");

      expect(mockWriteExtensionsJson).not.toHaveBeenCalled();
    });
  });

  describe("register", () => {
    it("registers a new marketplace source", async () => {
      mockReadConfig.mockReturnValue({ ...defaultConfig, marketplaces: [] });

      await runMarketplace(
        "register",
        "https://custom.market.dev",
        "--name",
        "custom",
      );

      expect(mockWriteConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          marketplaces: [
            expect.objectContaining({
              name: "custom",
              url: "https://custom.market.dev",
              type: "url",
            }),
          ],
        }),
      );
    });

    it("registers a local marketplace", async () => {
      mockReadConfig.mockReturnValue({ ...defaultConfig, marketplaces: [] });

      await runMarketplace(
        "register",
        "/path/to/local/marketplace",
        "--name",
        "local-mp",
      );

      expect(mockWriteConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          marketplaces: [
            expect.objectContaining({
              name: "local-mp",
              type: "local",
            }),
          ],
        }),
      );
    });

    it("warns when marketplace already registered", async () => {
      // Already has "official"
      await runMarketplace(
        "register",
        "https://marketplace.renre-kit.dev",
        "--name",
        "official",
      );

      expect(mockWriteConfig).not.toHaveBeenCalled();
    });
  });

  describe("unregister", () => {
    it("removes a registered marketplace", async () => {
      await runMarketplace("unregister", "official");

      expect(mockWriteConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          marketplaces: [],
        }),
      );
    });

    it("warns when marketplace not found", async () => {
      await runMarketplace("unregister", "nonexistent");

      expect(mockWriteConfig).not.toHaveBeenCalled();
    });
  });

  describe("list-sources", () => {
    it("lists registered marketplace sources", async () => {
      await runMarketplace("list-sources");

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });
});
