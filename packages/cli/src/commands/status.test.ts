import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

// Mock paths
vi.mock("../utils/paths.js", () => ({
  findProjectDir: vi.fn(),
}));

// Mock project-manager
vi.mock("../services/project-manager.js", () => ({
  readProjectJson: vi.fn(),
}));

// Mock pid
vi.mock("../utils/pid.js", () => ({
  readPid: vi.fn(),
  isPidAlive: vi.fn(),
  readServerState: vi.fn(),
}));

// Mock server-client
vi.mock("../services/server-client.js", () => ({
  checkHealth: vi.fn(),
  listProjects: vi.fn(),
}));

// Mock config
vi.mock("../utils/config.js", () => ({
  readConfig: vi.fn(),
}));

// Mock formatter
vi.mock("../utils/formatter.js", () => ({
  formatJson: vi.fn((data: unknown) => JSON.stringify(data, null, 2)),
  formatExtensionDetail: vi.fn(() => "detail"),
}));

import { findProjectDir } from "../utils/paths.js";
import { readProjectJson } from "../services/project-manager.js";
import { readPid, isPidAlive, readServerState } from "../utils/pid.js";
import { checkHealth, listProjects } from "../services/server-client.js";
import { readConfig } from "../utils/config.js";

const mockFindProjectDir = vi.mocked(findProjectDir);
const mockReadProjectJson = vi.mocked(readProjectJson);
const mockReadPid = vi.mocked(readPid);
const mockIsPidAlive = vi.mocked(isPidAlive);
const mockReadServerState = vi.mocked(readServerState);
const mockCheckHealth = vi.mocked(checkHealth);
const mockListProjects = vi.mocked(listProjects);
const mockReadConfig = vi.mocked(readConfig);

const defaultConfig = {
  port: 42888,
  logLevel: "info" as const,
  marketplaces: [{ name: "official", url: "https://marketplace.renre-kit.dev", type: "url" as const }],
  backup: { intervalHours: 24, maxCount: 10, maxAgeDays: 30 },
};

describe("status command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockReadConfig.mockReturnValue(defaultConfig);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  async function runStatus(...args: string[]) {
    const { registerStatusCommand } = await import("./status.js");
    const program = new Command();
    program.exitOverride();
    registerStatusCommand(program);
    return program.parseAsync(["node", "test", "status", ...args]);
  }

  it("shows running status with --json flag", async () => {
    mockReadPid.mockReturnValue(1234);
    mockIsPidAlive.mockReturnValue(true);
    mockReadServerState.mockReturnValue({
      pid: 1234,
      port: 42888,
      startedAt: "2026-01-01T00:00:00Z",
      activeProjects: [],
    });
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      uptime: 100,
      memoryUsage: { heapUsed: 1000000, heapTotal: 2000000, rss: 3000000, external: 0, arrayBuffers: 0 },
      port: 42888,
      version: "0.1.0",
    });
    mockListProjects.mockResolvedValue([]);
    mockFindProjectDir.mockReturnValue(null);

    await runStatus("--json");

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0]?.[0];
    const parsed = JSON.parse(output);
    expect(parsed.server.running).toBe(true);
    expect(parsed.server.pid).toBe(1234);
    expect(parsed.server.port).toBe(42888);
  });

  it("shows not running status with --json flag", async () => {
    mockReadPid.mockReturnValue(null);
    mockIsPidAlive.mockReturnValue(false);
    mockReadServerState.mockReturnValue(null);
    mockCheckHealth.mockResolvedValue(null);
    mockListProjects.mockResolvedValue([]);
    mockFindProjectDir.mockReturnValue(null);

    await runStatus("--json");

    const output = consoleSpy.mock.calls[0]?.[0];
    const parsed = JSON.parse(output);
    expect(parsed.server.running).toBe(false);
    expect(parsed.server.pid).toBeNull();
  });

  it("shows short status when running", async () => {
    mockReadPid.mockReturnValue(1234);
    mockIsPidAlive.mockReturnValue(true);
    mockReadServerState.mockReturnValue({
      pid: 1234,
      port: 42888,
      startedAt: "2026-01-01T00:00:00Z",
      activeProjects: [],
    });
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      uptime: 100,
      memoryUsage: { heapUsed: 1000000, heapTotal: 2000000, rss: 3000000, external: 0, arrayBuffers: 0 },
      port: 42888,
      version: "0.1.0",
    });
    mockListProjects.mockResolvedValue([
      { id: "p1", name: "Test", path: "/test", extensionCount: 2, mountedExtensions: [] },
    ]);
    mockFindProjectDir.mockReturnValue(null);

    await runStatus("--short");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("running"),
    );
    expect(consoleSpy.mock.calls[0]?.[0]).toContain("port=42888");
    expect(consoleSpy.mock.calls[0]?.[0]).toContain("projects=1");
  });

  it("shows short status when stopped", async () => {
    mockReadPid.mockReturnValue(null);
    mockIsPidAlive.mockReturnValue(false);
    mockReadServerState.mockReturnValue(null);
    mockListProjects.mockResolvedValue([]);
    mockFindProjectDir.mockReturnValue(null);

    await runStatus("--short");

    expect(consoleSpy).toHaveBeenCalledWith("stopped");
  });

  it("includes current project info in JSON output", async () => {
    mockReadPid.mockReturnValue(1234);
    mockIsPidAlive.mockReturnValue(true);
    mockReadServerState.mockReturnValue({
      pid: 1234,
      port: 42888,
      startedAt: "2026-01-01T00:00:00Z",
      activeProjects: [],
    });
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      uptime: 100,
      memoryUsage: { heapUsed: 1000000, heapTotal: 2000000, rss: 3000000, external: 0, arrayBuffers: 0 },
      port: 42888,
      version: "0.1.0",
    });
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "My Project" });
    mockListProjects.mockResolvedValue([
      {
        id: "proj-1",
        name: "My Project",
        path: "/test-project",
        extensionCount: 1,
        mountedExtensions: [
          { name: "ext-1", version: "1.0.0", status: "mounted" as const, routeCount: 3 },
        ],
      },
    ]);

    await runStatus("--json");

    const output = consoleSpy.mock.calls[0]?.[0];
    const parsed = JSON.parse(output);
    expect(parsed.currentProject).toBeDefined();
    expect(parsed.currentProject.id).toBe("proj-1");
    expect(parsed.activeProjects).toHaveLength(1);
  });

  it("filters by --project flag", async () => {
    mockReadPid.mockReturnValue(1234);
    mockIsPidAlive.mockReturnValue(true);
    mockReadServerState.mockReturnValue({
      pid: 1234,
      port: 42888,
      startedAt: "2026-01-01T00:00:00Z",
      activeProjects: [],
    });
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      uptime: 100,
      memoryUsage: { heapUsed: 1000000, heapTotal: 2000000, rss: 3000000, external: 0, arrayBuffers: 0 },
      port: 42888,
      version: "0.1.0",
    });
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "My Project" });
    mockListProjects.mockResolvedValue([
      { id: "proj-1", name: "Project 1", path: "/p1", extensionCount: 0, mountedExtensions: [] },
      { id: "proj-2", name: "Project 2", path: "/p2", extensionCount: 0, mountedExtensions: [] },
    ]);

    await runStatus("--json", "--project", "proj-2");

    const output = consoleSpy.mock.calls[0]?.[0];
    const parsed = JSON.parse(output);
    // Current project should be cleared since it doesn't match filter
    expect(parsed.currentProject).toBeNull();
    expect(parsed.activeProjects).toHaveLength(1);
    expect(parsed.activeProjects[0].id).toBe("proj-2");
  });

  it("shows full status output (non-short, non-json)", async () => {
    mockReadPid.mockReturnValue(null);
    mockIsPidAlive.mockReturnValue(false);
    mockReadServerState.mockReturnValue(null);
    mockListProjects.mockResolvedValue([]);
    mockFindProjectDir.mockReturnValue(null);

    await runStatus();

    // Full status prints multiple lines including "RenRe Kit Status"
    const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("RenRe Kit Status");
    expect(allOutput).toContain("not running");
  });
});
