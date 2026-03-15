import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  globalPaths: vi.fn().mockReturnValue({
    extensionsDir: "/mock/extensions",
    globalDir: "/mock/global",
  }),
  createScopedProxy: vi.fn().mockReturnValue({}),
  getConnection: vi.fn().mockReturnValue({}),
  runExtensionMigrations: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
  validateManifest: vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [], incompatible: false }),
  recordSuccess: vi.fn(),
  recordError: vi.fn(),
  resolveSettings: vi.fn().mockReturnValue({}),
  mcpConnect: vi.fn().mockReturnValue(null),
  getProjectRegistry: vi.fn().mockReturnValue(new Map()),
  copilotBridge: { ensureStarted: vi.fn() },
  createScopedLLM: vi.fn().mockReturnValue(null),
  createRequire: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

vi.mock("node:module", () => ({
  createRequire: mocks.createRequire,
}));

vi.mock("./paths.js", () => ({
  globalPaths: mocks.globalPaths,
}));

vi.mock("./db-manager.js", () => ({
  dbManager: {
    createScopedProxy: mocks.createScopedProxy,
    getConnection: mocks.getConnection,
    runExtensionMigrations: mocks.runExtensionMigrations,
  },
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: mocks.logInfo,
    warn: mocks.logWarn,
    error: mocks.logError,
    debug: mocks.logDebug,
  },
}));

vi.mock("./manifest-validator.js", () => ({
  validateManifest: mocks.validateManifest,
}));

vi.mock("./extension-circuit-breaker.js", () => ({
  circuitBreaker: {
    recordSuccess: mocks.recordSuccess,
    recordError: mocks.recordError,
  },
}));

vi.mock("./settings-resolver.js", () => ({
  resolveSettings: mocks.resolveSettings,
}));

vi.mock("./mcp-manager.js", () => ({
  connect: mocks.mcpConnect,
}));

vi.mock("../routes/projects.js", () => ({
  getRegistry: mocks.getProjectRegistry,
}));

vi.mock("./copilot-bridge.js", () => ({
  copilotBridge: mocks.copilotBridge,
}));

vi.mock("./scoped-llm.js", () => ({
  createScopedLLM: mocks.createScopedLLM,
}));

vi.mock("./scoped-scheduler.js", () => ({
  ScopedScheduler: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { loadExtension, setExtensionLoaderIO } from "./extension-loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-ext",
    version: "1.0.0",
    displayName: "Test Extension",
    description: "A test extension",
    author: "author",
    backend: { entrypoint: "index.js", actions: [] },
    ...overrides,
  };
}

function setupMockRequire(routerFactory: unknown) {
  const requireFn = vi.fn().mockReturnValue(routerFactory);
  mocks.createRequire.mockReturnValue(requireFn);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extension-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    mocks.validateManifest.mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
      incompatible: false,
    });
  });

  describe("loadExtension", () => {
    it("throws when extension directory does not exist", async () => {
      mocks.existsSync.mockReturnValue(false);

      await expect(
        loadExtension("test-ext", "1.0.0", "proj-1", {}),
      ).rejects.toThrow("Extension directory not found");
    });

    it("throws when manifest.json is missing", async () => {
      // First call: extDir exists; second call: manifest.json does not exist
      mocks.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);

      await expect(
        loadExtension("test-ext", "1.0.0", "proj-1", {}),
      ).rejects.toThrow("Missing manifest.json");
    });

    it("throws when manifest is invalid", async () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue(JSON.stringify(sampleManifest()));
      mocks.validateManifest.mockReturnValue({
        valid: false,
        errors: ["Missing field: name"],
        warnings: [],
        incompatible: false,
      });

      await expect(
        loadExtension("test-ext", "1.0.0", "proj-1", {}),
      ).rejects.toThrow("Invalid manifest");
    });

    it("throws with incompatible flag when SDK version mismatch", async () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue(JSON.stringify(sampleManifest()));
      mocks.validateManifest.mockReturnValue({
        valid: false,
        errors: ["SDK too old"],
        warnings: [],
        incompatible: true,
      });

      try {
        await loadExtension("test-ext", "1.0.0", "proj-1", {});
        expect.fail("Should have thrown");
      } catch (err) {
        expect((err as { incompatible?: boolean }).incompatible).toBe(true);
        expect((err as Error).message).toContain("incompatible");
      }
    });

    it("loads extension successfully with router factory", async () => {
      const manifest = sampleManifest();
      mocks.readFileSync.mockReturnValue(JSON.stringify(manifest));

      // Create a fake router with a stack
      const fakeRouter = { stack: [{ route: { path: "/" } }, { route: { path: "/action" } }] };
      const routerFactory = vi.fn().mockReturnValue(fakeRouter);
      setupMockRequire(routerFactory);

      const result = await loadExtension("test-ext", "1.0.0", "proj-1", {});

      expect(result.name).toBe("test-ext");
      expect(result.version).toBe("1.0.0");
      expect(result.router).toBe(fakeRouter);
      expect(result.routeCount).toBe(2);
      expect(mocks.recordSuccess).toHaveBeenCalledWith("proj-1", "test-ext");
    });

    it("supports default export pattern for router factory", async () => {
      const manifest = sampleManifest();
      mocks.readFileSync.mockReturnValue(JSON.stringify(manifest));

      const fakeRouter = { stack: [] };
      const routerFactory = vi.fn().mockReturnValue(fakeRouter);
      setupMockRequire({ default: routerFactory });

      const result = await loadExtension("test-ext", "1.0.0", "proj-1", {});

      expect(result.router).toBe(fakeRouter);
    });

    it("throws when entrypoint does not export a function", async () => {
      const manifest = sampleManifest();
      mocks.readFileSync.mockReturnValue(JSON.stringify(manifest));
      setupMockRequire({ default: "not-a-function" });

      await expect(
        loadExtension("test-ext", "1.0.0", "proj-1", {}),
      ).rejects.toThrow("does not export a router factory function");
    });

    it("throws when backend entrypoint is missing", async () => {
      const manifest = sampleManifest({ backend: {} });
      mocks.readFileSync.mockReturnValue(JSON.stringify(manifest));

      await expect(
        loadExtension("test-ext", "1.0.0", "proj-1", {}),
      ).rejects.toThrow("no backend entrypoint");
    });

    it("throws when entrypoint file does not exist on disk", async () => {
      const manifest = sampleManifest();
      mocks.readFileSync.mockReturnValue(JSON.stringify(manifest));
      // extDir exists, manifest.json exists, entrypoint file does not
      mocks.existsSync
        .mockReturnValueOnce(true)   // extDir
        .mockReturnValueOnce(true)   // manifest.json
        .mockReturnValueOnce(false); // entrypoint

      await expect(
        loadExtension("test-ext", "1.0.0", "proj-1", {}),
      ).rejects.toThrow("Backend entrypoint not found");
    });

    it("runs migrations when declared in manifest", async () => {
      const manifest = sampleManifest({ migrations: "migrations" });
      mocks.readFileSync.mockReturnValue(JSON.stringify(manifest));

      const fakeRouter = { stack: [] };
      setupMockRequire(vi.fn().mockReturnValue(fakeRouter));

      await loadExtension("test-ext", "1.0.0", "proj-1", {});

      expect(mocks.runExtensionMigrations).toHaveBeenCalledWith(
        "test-ext",
        "proj-1",
        expect.stringContaining("migrations"),
      );
    });

    it("includes mcpTransport when manifest declares MCP", async () => {
      const manifest = sampleManifest({ mcp: { transport: "stdio", command: "node", args: [] } });
      mocks.readFileSync.mockReturnValue(JSON.stringify(manifest));

      const fakeRouter = { stack: [] };
      setupMockRequire(vi.fn().mockReturnValue(fakeRouter));

      const result = await loadExtension("test-ext", "1.0.0", "proj-1", {});

      expect(result.mcpTransport).toBe("stdio");
    });

    it("logs warnings from manifest validation", async () => {
      mocks.validateManifest.mockReturnValue({
        valid: true,
        errors: [],
        warnings: ["Something is deprecated"],
        incompatible: false,
      });

      const manifest = sampleManifest();
      mocks.readFileSync.mockReturnValue(JSON.stringify(manifest));

      const fakeRouter = { stack: [] };
      setupMockRequire(vi.fn().mockReturnValue(fakeRouter));

      await loadExtension("test-ext", "1.0.0", "proj-1", {});

      expect(mocks.logWarn).toHaveBeenCalledWith(
        "ext:test-ext",
        "Something is deprecated",
      );
    });
  });

  describe("setExtensionLoaderIO", () => {
    it("accepts a Socket.IO instance without throwing", () => {
      expect(() => setExtensionLoaderIO({} as never)).not.toThrow();
    });
  });
});
