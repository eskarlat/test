import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

// Mock node:fs with memfs
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

// Mock paths
vi.mock("../core/paths.js", () => ({
  globalPaths: () => ({
    globalDir: "/home/test/.renre-kit",
    configFile: "/home/test/.renre-kit/config.json",
    dataFile: "/home/test/.renre-kit/data.db",
    extensionsDir: "/home/test/.renre-kit/extensions",
    scriptsDir: "/home/test/.renre-kit/scripts",
    logsDir: "/home/test/.renre-kit/logs",
  }),
}));

describe("worker-service hook-file-generator", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync("/home/test/.renre-kit/scripts", { recursive: true });
    vol.mkdirSync("/test-project/.github/hooks", { recursive: true });
  });

  afterEach(() => {
    vol.reset();
  });

  it("generates hook file with event arg in commands", async () => {
    const { generateHookFile } = await import("./hook-file-generator.js");

    const features = [
      { id: "context-inject", event: "sessionStart", source: "core" as const, handler: vi.fn() },
      { id: "tool-governance", event: "preToolUse", source: "core" as const, handler: vi.fn() },
    ];

    generateHookFile("/test-project", features);

    const content = vol.readFileSync(
      "/test-project/.github/hooks/renre-kit.json",
      "utf8",
    ) as string;
    const parsed = JSON.parse(content);

    // Verify SessionStart hook
    const sessionStart = parsed.hooks["SessionStart"];
    expect(sessionStart).toBeDefined();
    expect(sessionStart[0].command).toContain("hook agent sessionStart context-inject");

    // Verify PreToolUse hook
    const preToolUse = parsed.hooks["PreToolUse"];
    expect(preToolUse).toBeDefined();
    expect(preToolUse[0].command).toContain("hook agent preToolUse tool-governance");
  });

  it("uses PascalCase keys in output file matching Copilot schema", async () => {
    const { generateHookFile } = await import("./hook-file-generator.js");

    const features = [
      { id: "context-inject", event: "sessionStart", source: "core" as const, handler: vi.fn() },
      { id: "session-capture", event: "sessionEnd", source: "core" as const, handler: vi.fn() },
      { id: "prompt-journal", event: "userPromptSubmitted", source: "core" as const, handler: vi.fn() },
    ];

    generateHookFile("/test-project", features);

    const content = vol.readFileSync(
      "/test-project/.github/hooks/renre-kit.json",
      "utf8",
    ) as string;
    const parsed = JSON.parse(content);

    expect(parsed.hooks["SessionStart"]).toBeDefined();
    expect(parsed.hooks["Stop"]).toBeDefined();
    expect(parsed.hooks["UserPromptSubmit"]).toBeDefined();
  });

  it("handles extension features with colon in ID", async () => {
    const { generateHookFile } = await import("./hook-file-generator.js");

    const features = [
      { id: "jira:session-init", event: "sessionStart", source: "extension" as const, handler: vi.fn() },
    ];

    generateHookFile("/test-project", features);

    const content = vol.readFileSync(
      "/test-project/.github/hooks/renre-kit.json",
      "utf8",
    ) as string;
    const parsed = JSON.parse(content);

    const cmd = parsed.hooks["SessionStart"][0].command;
    expect(cmd).toContain("hook agent sessionStart jira:session-init");
  });
});
