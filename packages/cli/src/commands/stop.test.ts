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
  deletePid: vi.fn(),
  deleteServerState: vi.fn(),
  isPidAlive: vi.fn(),
}));

// Mock server-client
vi.mock("../services/server-client.js", () => ({
  unregisterProject: vi.fn(),
  listProjects: vi.fn(),
}));

import { findProjectDir } from "../utils/paths.js";
import { readProjectJson } from "../services/project-manager.js";
import { readPid, deletePid, deleteServerState, isPidAlive } from "../utils/pid.js";
import { unregisterProject, listProjects } from "../services/server-client.js";

const mockFindProjectDir = vi.mocked(findProjectDir);
const mockReadProjectJson = vi.mocked(readProjectJson);
const mockReadPid = vi.mocked(readPid);
const mockDeletePid = vi.mocked(deletePid);
const mockDeleteServerState = vi.mocked(deleteServerState);
const mockIsPidAlive = vi.mocked(isPidAlive);
const mockUnregisterProject = vi.mocked(unregisterProject);
const mockListProjects = vi.mocked(listProjects);

describe("stop command", () => {
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

  async function runStop(...args: string[]) {
    const { registerStopCommand } = await import("./stop.js");
    const program = new Command();
    program.exitOverride();
    registerStopCommand(program);
    return program.parseAsync(["node", "test", "stop", ...args]);
  }

  it("unregisters current project and stops server when no other projects remain", async () => {
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "Test" });
    mockUnregisterProject.mockResolvedValue(true);
    mockListProjects.mockResolvedValue([]);
    mockReadPid.mockReturnValue(1234);
    mockIsPidAlive.mockReturnValue(true);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    await runStop();

    expect(mockUnregisterProject).toHaveBeenCalledWith("proj-1");
    expect(mockDeletePid).toHaveBeenCalled();
    expect(mockDeleteServerState).toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it("keeps server running when other projects are still active", async () => {
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "Test" });
    mockUnregisterProject.mockResolvedValue(true);
    mockListProjects.mockResolvedValue([
      { id: "proj-2", name: "Other", path: "/other", extensionCount: 0, mountedExtensions: [] },
    ]);

    await runStop();

    expect(mockUnregisterProject).toHaveBeenCalledWith("proj-1");
    // Server should NOT be stopped
    expect(mockDeletePid).not.toHaveBeenCalled();
    expect(mockDeleteServerState).not.toHaveBeenCalled();
  });

  it("handles server not running during unregister", async () => {
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "Test" });
    mockUnregisterProject.mockResolvedValue(false);
    mockListProjects.mockResolvedValue([]);
    mockReadPid.mockReturnValue(null);
    mockIsPidAlive.mockReturnValue(false);

    await runStop();

    // Should still clean up PID files
    expect(mockDeletePid).toHaveBeenCalled();
    expect(mockDeleteServerState).toHaveBeenCalled();
  });

  it("force stop kills server regardless of active projects", async () => {
    mockFindProjectDir.mockReturnValue("/test-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "Test" });
    mockReadPid.mockReturnValue(5555);
    mockIsPidAlive.mockReturnValue(true);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    await runStop("--force");

    expect(killSpy).toHaveBeenCalledWith(5555, "SIGTERM");
    expect(mockDeletePid).toHaveBeenCalled();
    expect(mockDeleteServerState).toHaveBeenCalled();
    // Should NOT try to unregister or list projects
    expect(mockUnregisterProject).not.toHaveBeenCalled();
    expect(mockListProjects).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it("force stop succeeds even when no PID exists", async () => {
    mockFindProjectDir.mockReturnValue(null);
    mockReadPid.mockReturnValue(null);
    mockIsPidAlive.mockReturnValue(false);

    await runStop("--force");

    expect(mockDeletePid).toHaveBeenCalled();
    expect(mockDeleteServerState).toHaveBeenCalled();
  });

  it("handles being outside a project directory", async () => {
    mockFindProjectDir.mockReturnValue(null);
    mockListProjects.mockResolvedValue([]);
    mockReadPid.mockReturnValue(1234);
    mockIsPidAlive.mockReturnValue(true);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    await runStop();

    // No project to unregister, but should still stop server
    expect(mockUnregisterProject).not.toHaveBeenCalled();
    expect(mockDeletePid).toHaveBeenCalled();

    killSpy.mockRestore();
  });
});
