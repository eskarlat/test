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
  globalPaths: () => ({
    globalDir: "/home/test/.renre-kit",
    configFile: "/home/test/.renre-kit/config.json",
    serverPid: "/home/test/.renre-kit/server.pid",
    serverJson: "/home/test/.renre-kit/server.json",
    extensionsDir: "/home/test/.renre-kit/extensions",
    logsDir: "/home/test/.renre-kit/logs",
    scriptsDir: "/home/test/.renre-kit/scripts",
    backupsDir: "/home/test/.renre-kit/backups",
    projectsDir: "/home/test/.renre-kit/projects",
    migrationsDir: "/home/test/.renre-kit/migrations",
  }),
}));

// Mock project-manager
vi.mock("../services/project-manager.js", () => ({
  readProjectJson: vi.fn(),
  readExtensionsJson: vi.fn(() => null),
}));

// Mock pid utilities
vi.mock("../utils/pid.js", () => ({
  readPid: vi.fn(),
  writePid: vi.fn(),
  writeServerState: vi.fn(),
  isPidAlive: vi.fn(),
  readServerState: vi.fn(),
}));

// Mock server-client
vi.mock("../services/server-client.js", () => ({
  checkHealth: vi.fn(),
  isRenreKitServer: vi.fn(),
  registerProject: vi.fn(),
}));

// Mock formatter
vi.mock("../utils/formatter.js", () => ({
  formatExtensionDetail: vi.fn(() => "detail"),
}));

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Mock node:fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

import { findProjectDir } from "../utils/paths.js";
import { readProjectJson } from "../services/project-manager.js";
import { readPid, writePid, writeServerState, isPidAlive, readServerState } from "../utils/pid.js";
import { checkHealth, isRenreKitServer, registerProject } from "../services/server-client.js";
import { spawn } from "node:child_process";

const mockFindProjectDir = vi.mocked(findProjectDir);
const mockReadProjectJson = vi.mocked(readProjectJson);
const mockReadPid = vi.mocked(readPid);
const mockWritePid = vi.mocked(writePid);
const mockWriteServerState = vi.mocked(writeServerState);
const mockIsPidAlive = vi.mocked(isPidAlive);
const mockReadServerState = vi.mocked(readServerState);
const mockCheckHealth = vi.mocked(checkHealth);
const mockIsRenreKitServer = vi.mocked(isRenreKitServer);
const mockRegisterProject = vi.mocked(registerProject);
const mockSpawn = vi.mocked(spawn);

describe("start command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.stdout.isTTY = false as any;

    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  async function runStart(...args: string[]) {
    const { registerStartCommand } = await import("./start.js");
    const program = new Command();
    program.exitOverride();
    registerStartCommand(program);
    return program.parseAsync(["node", "test", "start", ...args]);
  }

  it("exits if not in a project directory", async () => {
    mockFindProjectDir.mockReturnValue(null);

    await expect(runStart()).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits if project.json cannot be read", async () => {
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue(null);

    await expect(runStart()).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("registers with existing server if already running", async () => {
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "Test" });
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
      memoryUsage: { heapUsed: 1000, heapTotal: 2000, rss: 3000, external: 0, arrayBuffers: 0 },
      port: 42888,
      version: "0.1.0",
    });
    mockRegisterProject.mockResolvedValue({
      success: true,
      projectId: "proj-1",
      extensions: [],
    });

    await runStart();

    // Should register project but not spawn
    expect(mockRegisterProject).toHaveBeenCalledWith("proj-1", "Test", "/test-project");
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockWritePid).not.toHaveBeenCalled();
  });

  it("spawns worker process when not already running", async () => {
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "Test" });
    mockReadPid.mockReturnValue(null);
    mockIsRenreKitServer.mockResolvedValue(false);

    // Port not listening - mock net.createServer
    const mockChild = {
      pid: 5678,
      unref: vi.fn(),
      on: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild as any);

    // checkHealth: first call returns null (port check), then returns health on wait
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      uptime: 1,
      memoryUsage: { heapUsed: 1000, heapTotal: 2000, rss: 3000, external: 0, arrayBuffers: 0 },
      port: 42888,
      version: "0.1.0",
    });

    mockRegisterProject.mockResolvedValue({
      success: true,
      projectId: "proj-1",
      extensions: [],
    });

    await runStart();

    expect(mockSpawn).toHaveBeenCalled();
    expect(mockWritePid).toHaveBeenCalledWith(5678);
    expect(mockWriteServerState).toHaveBeenCalledWith(
      expect.objectContaining({
        pid: 5678,
        port: 42888,
      }),
    );
  });

  it("writes PID file on successful start", async () => {
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "Test" });
    mockReadPid.mockReturnValue(null);
    mockIsRenreKitServer.mockResolvedValue(false);

    const mockChild = { pid: 9999, unref: vi.fn(), on: vi.fn() };
    mockSpawn.mockReturnValue(mockChild as any);

    mockCheckHealth.mockResolvedValue({
      status: "ok",
      uptime: 0,
      memoryUsage: { heapUsed: 0, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0 },
      port: 42888,
      version: "0.1.0",
    });

    mockRegisterProject.mockResolvedValue({
      success: true,
      projectId: "proj-1",
      extensions: [],
    });

    await runStart();

    expect(mockWritePid).toHaveBeenCalledWith(9999);
    expect(mockWriteServerState).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 9999 }),
    );
  });

  it("cleans up stale PID and starts fresh", async () => {
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "Test" });

    // Stale PID: alive but health check fails
    mockReadPid.mockReturnValue(9876);
    mockIsPidAlive.mockReturnValue(true);
    mockReadServerState.mockReturnValue({
      pid: 9876,
      port: 42888,
      startedAt: "2026-01-01T00:00:00Z",
      activeProjects: [],
    });
    // Health check fails = stale
    mockCheckHealth.mockResolvedValueOnce(null);

    // Kill spy
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    mockIsRenreKitServer.mockResolvedValue(false);

    const mockChild = { pid: 1111, unref: vi.fn(), on: vi.fn() };
    mockSpawn.mockReturnValue(mockChild as any);

    // After launch, health returns ok
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      uptime: 0,
      memoryUsage: { heapUsed: 0, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0 },
      port: 42888,
      version: "0.1.0",
    });

    mockRegisterProject.mockResolvedValue({
      success: true,
      projectId: "proj-1",
      extensions: [],
    });

    await runStart();

    expect(killSpy).toHaveBeenCalledWith(9876, "SIGTERM");
    expect(mockWritePid).toHaveBeenCalledWith(1111);

    killSpy.mockRestore();
  });
});
