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
  text: vi.fn(),
  isCancel: vi.fn(() => false),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
  cancel: vi.fn(),
}));

// Mock paths to use deterministic dirs
vi.mock("../utils/paths.js", () => ({
  globalDir: () => "/home/test/.renre-kit",
  globalPaths: () => ({
    globalDir: "/home/test/.renre-kit",
    configFile: "/home/test/.renre-kit/config.json",
    dataDb: "/home/test/.renre-kit/data.db",
    extensionsDir: "/home/test/.renre-kit/extensions",
    scriptsDir: "/home/test/.renre-kit/scripts",
    logsDir: "/home/test/.renre-kit/logs",
    backupsDir: "/home/test/.renre-kit/backups",
    projectsDir: "/home/test/.renre-kit/projects",
    migrationsDir: "/home/test/.renre-kit/migrations",
  }),
  projectPaths: (dir: string) => ({
    renreKitDir: `${dir}/.renre-kit`,
    projectJson: `${dir}/.renre-kit/project.json`,
    extensionsJson: `${dir}/.renre-kit/extensions.json`,
    hooksDir: `${dir}/.github/hooks`,
    hooksJson: `${dir}/.github/hooks/renre-kit.json`,
    skillsDir: `${dir}/.github/skills`,
    scriptsDir: `${dir}/.renre-kit/scripts`,
    gitignore: `${dir}/.gitignore`,
  }),
  findProjectDir: vi.fn(() => null),
}));

// Stable UUID for testing
vi.stubGlobal("crypto", {
  ...crypto,
  randomUUID: () => "00000000-0000-0000-0000-000000000001",
});

describe("init command", () => {
  let originalCwd: typeof process.cwd;
  let originalIsTTY: boolean | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vol.reset();
    // Create the base directories
    vol.mkdirSync("/test-project", { recursive: true });
    vol.mkdirSync("/home/test/.renre-kit", { recursive: true });

    originalCwd = process.cwd;
    process.cwd = () => "/test-project";
    originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = false as any; // non-interactive mode

    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
  });

  afterEach(() => {
    process.cwd = originalCwd;
    process.stdout.isTTY = originalIsTTY as any;
    exitSpy.mockRestore();
    vol.reset();
    vi.restoreAllMocks();
  });

  async function runInit(...args: string[]) {
    // Re-import to get fresh module with mocked deps
    const { registerInitCommand } = await import("./init.js");
    const program = new Command();
    program.exitOverride();
    registerInitCommand(program);
    return program.parseAsync(["node", "test", "init", ...args]);
  }

  it("creates .renre-kit/project.json with correct structure", async () => {
    await runInit("--yes");

    const projectJson = JSON.parse(
      vol.readFileSync("/test-project/.renre-kit/project.json", "utf8") as string,
    );
    expect(projectJson.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(projectJson.name).toBe("test-project");
    expect(projectJson.$schema).toContain("project.json");
  });

  it("creates extensions.json with empty extensions array", async () => {
    await runInit("--yes");

    const extJson = JSON.parse(
      vol.readFileSync("/test-project/.renre-kit/extensions.json", "utf8") as string,
    );
    expect(extJson.extensions).toEqual([]);
    expect(extJson.$schema).toContain("extensions.json");
  });

  it("creates .github/hooks/renre-kit.json", async () => {
    await runInit("--yes");

    expect(vol.existsSync("/test-project/.github/hooks/renre-kit.json")).toBe(true);
    const hookFile = JSON.parse(
      vol.readFileSync("/test-project/.github/hooks/renre-kit.json", "utf8") as string,
    );
    expect(hookFile.hooks).toBeDefined();
    expect(typeof hookFile.hooks).toBe("object");
  });

  it("creates .github/skills directory and installs learn skill", async () => {
    await runInit("--yes");

    expect(vol.existsSync("/test-project/.github/skills")).toBe(true);
    expect(vol.existsSync("/test-project/.github/skills/learn/SKILL.md")).toBe(true);
  });

  it("uses --name flag for project name", async () => {
    await runInit("--yes", "--name", "my-custom-project");

    const projectJson = JSON.parse(
      vol.readFileSync("/test-project/.renre-kit/project.json", "utf8") as string,
    );
    expect(projectJson.name).toBe("my-custom-project");
  });

  it("--yes flag skips prompts and uses directory basename", async () => {
    // Already non-interactive, --yes ensures no prompts
    await runInit("--yes");

    const projectJson = JSON.parse(
      vol.readFileSync("/test-project/.renre-kit/project.json", "utf8") as string,
    );
    // basename of /test-project is "test-project"
    expect(projectJson.name).toBe("test-project");
  });

  it("refuses re-init when .renre-kit already exists", async () => {
    vol.mkdirSync("/test-project/.renre-kit", { recursive: true });

    await expect(runInit("--yes")).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("creates .gitignore with .renre-kit/ entry when none exists", async () => {
    await runInit("--yes");

    const gitignore = vol.readFileSync("/test-project/.gitignore", "utf8") as string;
    expect(gitignore).toContain(".renre-kit/");
  });

  it("appends to existing .gitignore without duplicating", async () => {
    vol.writeFileSync("/test-project/.gitignore", "node_modules/\n");
    await runInit("--yes");

    const gitignore = vol.readFileSync("/test-project/.gitignore", "utf8") as string;
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain(".renre-kit/");
  });

  it("does not add duplicate .renre-kit/ to .gitignore", async () => {
    vol.writeFileSync("/test-project/.gitignore", ".renre-kit/\n");
    await runInit("--yes");

    const gitignore = vol.readFileSync("/test-project/.gitignore", "utf8") as string;
    const count = (gitignore.match(/\.renre-kit\//g) || []).length;
    expect(count).toBe(1);
  });

  it("creates global directories", async () => {
    await runInit("--yes");

    expect(vol.existsSync("/home/test/.renre-kit")).toBe(true);
    expect(vol.existsSync("/home/test/.renre-kit/backups")).toBe(true);
    expect(vol.existsSync("/home/test/.renre-kit/projects")).toBe(true);
    expect(vol.existsSync("/home/test/.renre-kit/scripts")).toBe(true);
  });

  it("writes global project metadata", async () => {
    await runInit("--yes");

    const metaFile = "/home/test/.renre-kit/projects/00000000-0000-0000-0000-000000000001.json";
    expect(vol.existsSync(metaFile)).toBe(true);
    const meta = JSON.parse(vol.readFileSync(metaFile, "utf8") as string);
    expect(meta.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(meta.name).toBe("test-project");
    expect(meta.path).toBe("/test-project");
    expect(meta.createdAt).toBeDefined();
  });
});
