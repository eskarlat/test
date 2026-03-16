import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  loadExtension: vi.fn(),
  isSuspended: vi.fn().mockReturnValue(false),
  recordError: vi.fn(),
  recordSuccess: vi.fn(),
  reset: vi.fn(),
  publish: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  registerExtensionProvider: vi.fn(),
  unregisterExtensionProvider: vi.fn(),
  registerExtension: vi.fn(),
  unregisterExtension: vi.fn(),
  mcpDisconnect: vi.fn(),
  mcpDisconnectAll: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue("{}"),
  dbPrepare: vi.fn(),
}));

vi.mock("./extension-loader.js", () => ({
  loadExtension: mocks.loadExtension,
}));

vi.mock("./extension-circuit-breaker.js", () => ({
  circuitBreaker: {
    isSuspended: mocks.isSuspended,
    recordError: mocks.recordError,
    recordSuccess: mocks.recordSuccess,
    reset: mocks.reset,
  },
}));

vi.mock("./event-bus.js", () => ({
  eventBus: { publish: mocks.publish },
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: mocks.logInfo,
    warn: mocks.logWarn,
    error: mocks.logError,
    debug: vi.fn(),
  },
}));

vi.mock("./db-manager.js", () => ({
  dbManager: {
    getConnection: () => ({
      prepare: mocks.dbPrepare,
    }),
  },
}));

vi.mock("./context-provider-manager.js", () => ({
  registerExtensionProvider: mocks.registerExtensionProvider,
  unregisterExtensionProvider: mocks.unregisterExtensionProvider,
}));

vi.mock("./hook-feature-registry.js", () => ({
  hookFeatureRegistry: {
    registerExtension: mocks.registerExtension,
    unregisterExtension: mocks.unregisterExtension,
  },
}));

vi.mock("./mcp-manager.js", () => ({
  disconnect: mocks.mcpDisconnect,
  disconnectAll: mocks.mcpDisconnectAll,
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import {
  mountExtension,
  unmountExtension,
  unmountAllForProject,
  remountExtension,
  listMounted,
  getMountedInfo,
  getRouter,
  getRegistry,
  mountProjectExtensions,
  startMemoryMonitor,
} from "./extension-registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeLoaded(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-ext",
    version: "1.0.0",
    router: { stack: [{ route: { path: "/" } }] },
    manifest: {
      name: "test-ext",
      version: "1.0.0",
      displayName: "Test",
      description: "Test extension",
      author: "author",
      backend: { entrypoint: "index.js", actions: [] },
      ...((overrides["manifest"] as Record<string, unknown>) ?? {}),
    },
    routeCount: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extension-registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock values after clearAllMocks
    mocks.isSuspended.mockReturnValue(false);
    mocks.existsSync.mockReturnValue(false);
    mocks.readFileSync.mockReturnValue("{}");
    // Clear the registry between tests
    const registry = getRegistry();
    registry.clear();
  });

  // -------------------------------------------------------------------------
  // mountExtension
  // -------------------------------------------------------------------------

  describe("mountExtension", () => {
    it("mounts an extension successfully", async () => {
      const loaded = fakeLoaded();
      mocks.loadExtension.mockResolvedValue(loaded);

      const info = await mountExtension("proj-1", "test-ext", "1.0.0");

      expect(info.name).toBe("test-ext");
      expect(info.version).toBe("1.0.0");
      expect(info.status).toBe("mounted");
      expect(info.routeCount).toBe(1);
      expect(mocks.publish).toHaveBeenCalledWith("extension:mounted", expect.objectContaining({
        projectId: "proj-1",
        name: "test-ext",
      }));
    });

    it("returns suspended status when circuit breaker is open", async () => {
      mocks.isSuspended.mockReturnValue(true);

      const info = await mountExtension("proj-1", "test-ext", "1.0.0");

      expect(info.status).toBe("suspended");
      expect(info.error).toBe("Circuit breaker open");
      expect(mocks.loadExtension).not.toHaveBeenCalled();
    });

    it("returns failed status on load error", async () => {
      mocks.loadExtension.mockRejectedValue(new Error("Load failed"));

      const info = await mountExtension("proj-1", "test-ext", "1.0.0");

      expect(info.status).toBe("failed");
      expect(info.error).toBe("Load failed");
      expect(mocks.recordError).toHaveBeenCalledWith("proj-1", "test-ext");
      expect(mocks.publish).toHaveBeenCalledWith("extension:error", expect.objectContaining({
        error: "Load failed",
      }));
    });

    it("returns incompatible status when error has incompatible flag", async () => {
      const err = Object.assign(new Error("SDK too old"), { incompatible: true });
      mocks.loadExtension.mockRejectedValue(err);

      const info = await mountExtension("proj-1", "test-ext", "1.0.0");

      expect(info.status).toBe("incompatible");
    });

    it("registers context provider when manifest declares one", async () => {
      const loaded = fakeLoaded({
        manifest: { contextProvider: { entrypoint: "ctx.js" } },
      });
      mocks.loadExtension.mockResolvedValue(loaded);

      await mountExtension("proj-1", "test-ext", "1.0.0");

      expect(mocks.registerExtensionProvider).toHaveBeenCalledWith(
        "test-ext",
        loaded.manifest,
      );
    });

    it("registers hook features when manifest declares hooks", async () => {
      const loaded = fakeLoaded({
        manifest: {
          hooks: { events: ["sessionStart", "sessionEnd"], timeout: 3000 },
        },
      });
      mocks.loadExtension.mockResolvedValue(loaded);

      await mountExtension("proj-1", "test-ext", "1.0.0");

      expect(mocks.registerExtension).toHaveBeenCalledTimes(2);
      expect(mocks.registerExtension).toHaveBeenCalledWith(
        "test-ext",
        "sessionStart",
        "sessionStart",
        3000,
      );
    });

    it("passes settings config to loadExtension", async () => {
      mocks.loadExtension.mockResolvedValue(fakeLoaded());
      const settings = { apiKey: "secret" };

      await mountExtension("proj-1", "test-ext", "1.0.0", settings);

      expect(mocks.loadExtension).toHaveBeenCalledWith(
        "test-ext",
        "1.0.0",
        "proj-1",
        settings,
      );
    });
  });

  // -------------------------------------------------------------------------
  // unmountExtension
  // -------------------------------------------------------------------------

  describe("unmountExtension", () => {
    it("unmounts a previously mounted extension", async () => {
      mocks.loadExtension.mockResolvedValue(fakeLoaded());
      await mountExtension("proj-1", "test-ext", "1.0.0");

      await unmountExtension("proj-1", "test-ext");

      expect(getMountedInfo("proj-1", "test-ext")).toBeNull();
      expect(mocks.unregisterExtensionProvider).toHaveBeenCalledWith("test-ext");
      expect(mocks.unregisterExtension).toHaveBeenCalledWith("test-ext");
      expect(mocks.mcpDisconnect).toHaveBeenCalledWith("proj-1", "test-ext");
      expect(mocks.reset).toHaveBeenCalledWith("proj-1", "test-ext");
      expect(mocks.publish).toHaveBeenCalledWith("extension:unmounted", {
        projectId: "proj-1",
        name: "test-ext",
      });
    });

    it("is a no-op when project has no extensions", async () => {
      await unmountExtension("nonexistent", "test-ext");
      expect(mocks.mcpDisconnect).not.toHaveBeenCalled();
    });

    it("is a no-op when extension is not mounted", async () => {
      mocks.loadExtension.mockResolvedValue(fakeLoaded());
      await mountExtension("proj-1", "test-ext", "1.0.0");

      await unmountExtension("proj-1", "other-ext");
      // The original extension should still be there
      expect(getMountedInfo("proj-1", "test-ext")).not.toBeNull();
    });

    it("pauses scheduler before cleanup", async () => {
      const pauseAll = vi.fn();
      // The extension-registry stores the loaded result which includes the scheduler
      const loaded = fakeLoaded();
      // Attach scheduler to the loaded result (as done in extension-loader)
      (loaded as Record<string, unknown>).scheduler = { pauseAll };
      mocks.loadExtension.mockResolvedValue(loaded);
      await mountExtension("proj-1", "test-ext", "1.0.0");

      await unmountExtension("proj-1", "test-ext");

      expect(pauseAll).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // unmountAllForProject
  // -------------------------------------------------------------------------

  describe("unmountAllForProject", () => {
    it("unmounts all extensions for a project", async () => {
      mocks.loadExtension
        .mockResolvedValueOnce(fakeLoaded({ name: "ext-a" }))
        .mockResolvedValueOnce(fakeLoaded({ name: "ext-b" }));

      await mountExtension("proj-1", "ext-a", "1.0.0");
      await mountExtension("proj-1", "ext-b", "1.0.0");

      await unmountAllForProject("proj-1");

      expect(listMounted("proj-1")).toEqual([]);
      expect(mocks.mcpDisconnectAll).toHaveBeenCalledWith("proj-1");
    });

    it("is a no-op for unknown project", async () => {
      await unmountAllForProject("nonexistent");
      expect(mocks.mcpDisconnectAll).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // remountExtension
  // -------------------------------------------------------------------------

  describe("remountExtension", () => {
    it("unmounts then mounts again", async () => {
      mocks.loadExtension.mockResolvedValue(fakeLoaded());
      await mountExtension("proj-1", "test-ext", "1.0.0");

      mocks.loadExtension.mockResolvedValue(fakeLoaded({ routeCount: 3 }));
      const info = await remountExtension("proj-1", "test-ext", "2.0.0");

      expect(info.status).toBe("mounted");
      expect(info.version).toBe("2.0.0");
    });
  });

  // -------------------------------------------------------------------------
  // listMounted / getMountedInfo / getRouter
  // -------------------------------------------------------------------------

  describe("listMounted", () => {
    it("returns empty array when no extensions mounted", () => {
      expect(listMounted("proj-1")).toEqual([]);
    });

    it("returns all mounted extension info", async () => {
      mocks.loadExtension.mockResolvedValue(fakeLoaded());
      await mountExtension("proj-1", "test-ext", "1.0.0");

      const list = listMounted("proj-1");
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("test-ext");
    });
  });

  describe("getMountedInfo", () => {
    it("returns null for unknown extension", () => {
      expect(getMountedInfo("proj-1", "unknown")).toBeNull();
    });

    it("returns info for mounted extension", async () => {
      mocks.loadExtension.mockResolvedValue(fakeLoaded());
      await mountExtension("proj-1", "test-ext", "1.0.0");

      const info = getMountedInfo("proj-1", "test-ext");
      expect(info).not.toBeNull();
      expect(info!.name).toBe("test-ext");
    });
  });

  describe("getRouter", () => {
    it("returns null for unknown extension", () => {
      expect(getRouter("proj-1", "unknown")).toBeNull();
    });

    it("returns router for mounted extension", async () => {
      const fakeRouter = { stack: [] };
      mocks.loadExtension.mockResolvedValue(fakeLoaded({ router: fakeRouter }));
      await mountExtension("proj-1", "test-ext", "1.0.0");

      const router = getRouter("proj-1", "test-ext");
      expect(router).toBe(fakeRouter);
    });
  });

  // -------------------------------------------------------------------------
  // mountProjectExtensions
  // -------------------------------------------------------------------------

  describe("mountProjectExtensions", () => {
    it("returns empty array when extensions.json does not exist", async () => {
      mocks.existsSync.mockReturnValue(false);
      const result = await mountProjectExtensions("proj-1", "/some/path");
      expect(result).toEqual([]);
    });

    it("returns empty array when extensions.json is invalid JSON", async () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue("not valid json{");

      const result = await mountProjectExtensions("proj-1", "/some/path");
      expect(result).toEqual([]);
      expect(mocks.logWarn).toHaveBeenCalled();
    });

    it("mounts enabled extensions from extensions.json", async () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue(
        JSON.stringify({
          extensions: [
            { name: "ext-a", version: "1.0.0", enabled: true, source: "local" },
            { name: "ext-b", version: "2.0.0", enabled: false, source: "local" },
          ],
        }),
      );
      // Mock DB for rollbackOrphanedMigrations
      mocks.dbPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
      });

      mocks.loadExtension.mockResolvedValue(fakeLoaded({ name: "ext-a" }));

      const result = await mountProjectExtensions("proj-1", "/some/path");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("ext-a");
      // ext-b should not have been loaded (disabled)
      expect(mocks.loadExtension).toHaveBeenCalledTimes(1);
    });

    it("rolls back orphaned migrations", async () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue(
        JSON.stringify({ extensions: [] }),
      );

      const runFn = vi.fn();
      mocks.dbPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([{ extension_name: "removed-ext" }]),
        run: runFn,
      });

      await mountProjectExtensions("proj-1", "/some/path");

      // Should have deleted orphaned migration rows
      expect(runFn).toHaveBeenCalledWith("removed-ext", "proj-1");
    });
  });

  // -------------------------------------------------------------------------
  // startMemoryMonitor
  // -------------------------------------------------------------------------

  describe("startMemoryMonitor", () => {
    it("starts an interval timer", () => {
      const spy = vi.spyOn(global, "setInterval");
      startMemoryMonitor();
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 30_000);
      spy.mockRestore();
    });
  });
});
