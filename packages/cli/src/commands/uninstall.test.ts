import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";
import { Command } from "commander";

// Mock node:fs with memfs
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  intro: vi.fn(),
  outro: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

// Mock paths
vi.mock("../utils/paths.js", () => ({
  findProjectDir: vi.fn(),
  globalPaths: vi.fn(() => ({
    globalDir: "/home/user/.renre-kit",
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
  readProjectJson: vi.fn(),
}));

// Mock pid
vi.mock("../utils/pid.js", () => ({
  isServerRunning: vi.fn(),
}));

// Mock server-client
vi.mock("../services/server-client.js", () => ({
  unregisterProject: vi.fn(),
}));

// Mock logger
vi.mock("../utils/logger.js", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  cancel: vi.fn((_msg: string) => {
    // The real cancel calls process.exit(1) — we keep the mock simple
  }),
  spinner: vi.fn(() => ({
    stop: vi.fn(),
    message: vi.fn(),
  })),
  isInteractive: vi.fn(() => false),
}));

import { findProjectDir } from "../utils/paths.js";
import { readProjectJson } from "../services/project-manager.js";
import { isServerRunning } from "../utils/pid.js";
import { unregisterProject } from "../services/server-client.js";

const mockFindProjectDir = vi.mocked(findProjectDir);
const mockReadProjectJson = vi.mocked(readProjectJson);
const mockIsServerRunning = vi.mocked(isServerRunning);
const mockUnregisterProject = vi.mocked(unregisterProject);

describe("uninstall command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vol.reset();
    vi.restoreAllMocks();
  });

  async function runUninstall(...args: string[]) {
    const { registerUninstallCommand } = await import("./uninstall.js");
    const program = new Command();
    program.exitOverride();
    registerUninstallCommand(program);
    return program.parseAsync(["node", "test", "uninstall", ...args]);
  }

  it("exits if not in a project", async () => {
    mockFindProjectDir.mockReturnValue(null);

    await expect(runUninstall("--yes")).rejects.toThrow("process.exit called");
  });

  it("exits if project.json cannot be read", async () => {
    mockFindProjectDir.mockReturnValue("/my-project");
    mockReadProjectJson.mockReturnValue(null);

    await expect(runUninstall("--yes")).rejects.toThrow("process.exit called");
  });

  it("removes .renre-kit directory", async () => {
    mockFindProjectDir.mockReturnValue("/my-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "My Project" });
    mockIsServerRunning.mockReturnValue(false);

    vol.mkdirSync("/my-project/.renre-kit", { recursive: true });
    vol.writeFileSync("/my-project/.renre-kit/project.json", "{}");

    await runUninstall("--yes");

    expect(vol.existsSync("/my-project/.renre-kit")).toBe(false);
  });

  it("removes hooks file", async () => {
    mockFindProjectDir.mockReturnValue("/my-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "My Project" });
    mockIsServerRunning.mockReturnValue(false);

    vol.mkdirSync("/my-project/.renre-kit", { recursive: true });
    vol.mkdirSync("/my-project/.github/hooks", { recursive: true });
    vol.writeFileSync("/my-project/.github/hooks/renre-kit.json", "{}");

    await runUninstall("--yes");

    expect(vol.existsSync("/my-project/.github/hooks/renre-kit.json")).toBe(false);
  });

  it("removes skills directory", async () => {
    mockFindProjectDir.mockReturnValue("/my-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "My Project" });
    mockIsServerRunning.mockReturnValue(false);

    vol.mkdirSync("/my-project/.renre-kit", { recursive: true });
    vol.mkdirSync("/my-project/.github/skills/my-skill", { recursive: true });
    vol.writeFileSync("/my-project/.github/skills/my-skill/SKILL.md", "# Skill");

    await runUninstall("--yes");

    expect(vol.existsSync("/my-project/.github/skills")).toBe(false);
  });

  it("removes global project metadata without --keep-data", async () => {
    mockFindProjectDir.mockReturnValue("/my-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "My Project" });
    mockIsServerRunning.mockReturnValue(false);

    vol.mkdirSync("/my-project/.renre-kit", { recursive: true });
    vol.mkdirSync("/home/user/.renre-kit/projects", { recursive: true });
    vol.writeFileSync("/home/user/.renre-kit/projects/proj-1.json", "{}");

    await runUninstall("--yes");

    expect(vol.existsSync("/home/user/.renre-kit/projects/proj-1.json")).toBe(false);
  });

  it("preserves global project metadata with --keep-data", async () => {
    mockFindProjectDir.mockReturnValue("/my-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "My Project" });
    mockIsServerRunning.mockReturnValue(false);

    vol.mkdirSync("/my-project/.renre-kit", { recursive: true });
    vol.mkdirSync("/home/user/.renre-kit/projects", { recursive: true });
    vol.writeFileSync("/home/user/.renre-kit/projects/proj-1.json", "{}");

    await runUninstall("--yes", "--keep-data");

    expect(vol.existsSync("/home/user/.renre-kit/projects/proj-1.json")).toBe(true);
  });

  it("unregisters from server when server is running", async () => {
    mockFindProjectDir.mockReturnValue("/my-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "My Project" });
    mockIsServerRunning.mockReturnValue(true);
    mockUnregisterProject.mockResolvedValue(true);

    vol.mkdirSync("/my-project/.renre-kit", { recursive: true });

    await runUninstall("--yes");

    expect(mockUnregisterProject).toHaveBeenCalledWith("proj-1");
  });

  it("does not unregister from server when server is not running", async () => {
    mockFindProjectDir.mockReturnValue("/my-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "My Project" });
    mockIsServerRunning.mockReturnValue(false);

    vol.mkdirSync("/my-project/.renre-kit", { recursive: true });

    await runUninstall("--yes");

    expect(mockUnregisterProject).not.toHaveBeenCalled();
  });

  it("prints uninstall message to console in non-interactive mode", async () => {
    mockFindProjectDir.mockReturnValue("/my-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "My Project" });
    mockIsServerRunning.mockReturnValue(false);

    vol.mkdirSync("/my-project/.renre-kit", { recursive: true });

    await runUninstall("--yes");

    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("Uninstalled: My Project");
  });
});
