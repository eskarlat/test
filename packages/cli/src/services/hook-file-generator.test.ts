import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

// Mock node:fs with memfs
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

// Mock paths to use predictable values
vi.mock("../utils/paths.js", () => ({
  globalPaths: () => ({
    globalDir: "/home/test/.renre-kit",
    configFile: "/home/test/.renre-kit/config.json",
    dataFile: "/home/test/.renre-kit/data.db",
    extensionsDir: "/home/test/.renre-kit/extensions",
    scriptsDir: "/home/test/.renre-kit/scripts",
    logsDir: "/home/test/.renre-kit/logs",
  }),
}));

describe("CLI hook-file-generator", () => {
  beforeEach(() => {
    vol.reset();
    // Create required directories
    vol.mkdirSync("/home/test/.renre-kit/scripts", { recursive: true });
    vol.mkdirSync("/test-project/.github/hooks", { recursive: true });
  });

  afterEach(() => {
    vol.reset();
  });

  it("generates core hook commands with event before feature ID", async () => {
    const { generateCoreHookFile } = await import("./hook-file-generator.js");
    generateCoreHookFile("/test-project");

    const content = vol.readFileSync(
      "/test-project/.github/hooks/renre-kit.json",
      "utf8",
    ) as string;
    const parsed = JSON.parse(content);

    // SessionStart should have context-inject command with event arg
    const sessionStartHooks = parsed.hooks["SessionStart"];
    expect(sessionStartHooks).toBeDefined();
    expect(sessionStartHooks.length).toBeGreaterThan(0);

    const cmd = sessionStartHooks[0].command;
    expect(cmd).toContain("hook agent sessionStart context-inject");
  });

  it("uses correct PascalCase keys in output file", async () => {
    const { generateCoreHookFile } = await import("./hook-file-generator.js");
    generateCoreHookFile("/test-project");

    const content = vol.readFileSync(
      "/test-project/.github/hooks/renre-kit.json",
      "utf8",
    ) as string;
    const parsed = JSON.parse(content);
    const hookKeys = Object.keys(parsed.hooks);

    expect(hookKeys).toContain("SessionStart");
    expect(hookKeys).toContain("Stop");
    expect(hookKeys).toContain("UserPromptSubmit");
    expect(hookKeys).toContain("PreToolUse");
    expect(hookKeys).toContain("PostToolUse");
    expect(hookKeys).toContain("ErrorOccurred");
    expect(hookKeys).toContain("PreCompact");
    expect(hookKeys).toContain("SubagentStart");
    expect(hookKeys).toContain("SubagentStop");
  });

  it("adds extension hooks with event arg in command", async () => {
    const { generateCoreHookFile, addExtensionHooks } = await import(
      "./hook-file-generator.js"
    );

    generateCoreHookFile("/test-project");
    addExtensionHooks("/test-project", "jira", ["sessionStart"], "session-init");

    const content = vol.readFileSync(
      "/test-project/.github/hooks/renre-kit.json",
      "utf8",
    ) as string;
    const parsed = JSON.parse(content);

    const sessionStartHooks = parsed.hooks["SessionStart"];
    const extCmd = sessionStartHooks.find(
      (h: { command: string }) => h.command.includes("jira:session-init"),
    );
    expect(extCmd).toBeDefined();
    expect(extCmd.command).toContain("hook agent sessionStart jira:session-init");
  });

  it("all 9 core features map to correct events in commands", async () => {
    const { generateCoreHookFile } = await import("./hook-file-generator.js");
    generateCoreHookFile("/test-project");

    const content = vol.readFileSync(
      "/test-project/.github/hooks/renre-kit.json",
      "utf8",
    ) as string;
    const parsed = JSON.parse(content);

    // Flatten all commands
    const allCommands: string[] = Object.values(parsed.hooks)
      .flat()
      .map((h: unknown) => (h as { command: string }).command);

    const expected = [
      "sessionStart context-inject",
      "sessionEnd session-capture",
      "userPromptSubmitted prompt-journal",
      "preToolUse tool-governance",
      "postToolUse tool-analytics",
      "errorOccurred error-intelligence",
      "preCompact session-checkpoint",
      "subagentStart subagent-track",
      "subagentStop subagent-complete",
    ];

    for (const pair of expected) {
      const found = allCommands.some((cmd) => cmd.includes(`hook agent ${pair}`));
      expect(found, `Expected command containing "hook agent ${pair}"`).toBe(true);
    }
  });
});
