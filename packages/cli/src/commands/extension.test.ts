import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";
import { Command } from "commander";

// Mock node:fs with memfs
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

describe("extension command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vol.reset();
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

  async function runExtension(...args: string[]) {
    const { registerExtensionCommand } = await import("./extension.js");
    const program = new Command();
    program.exitOverride();
    registerExtensionCommand(program);
    return program.parseAsync(["node", "test", "extension", ...args]);
  }

  describe("validate subcommand", () => {
    it("validates a correct manifest.json", async () => {
      const manifest = {
        name: "my-extension",
        version: "1.0.0",
        displayName: "My Extension",
        description: "A test extension",
        author: "Test Author",
      };
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      await runExtension("validate", "/ext");

      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("is valid");
    });

    it("fails when manifest.json is missing", async () => {
      vol.mkdirSync("/ext", { recursive: true });

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allErrors = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allErrors).toContain("manifest.json not found");
    });

    it("fails on invalid JSON", async () => {
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", "not json{{{");

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allErrors = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allErrors).toContain("Failed to parse manifest.json");
    });

    it("reports missing required fields", async () => {
      const manifest = { name: "my-ext" }; // missing version, displayName, description, author
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("Missing required field: version");
      expect(allOutput).toContain("Missing required field: displayName");
      expect(allOutput).toContain("Missing required field: description");
      expect(allOutput).toContain("Missing required field: author");
    });

    it("rejects invalid name format", async () => {
      const manifest = {
        name: "Invalid_Name!",
        version: "1.0.0",
        displayName: "Test",
        description: "Test",
        author: "Test",
      };
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("Invalid name format");
    });

    it("rejects names starting with __", async () => {
      const manifest = {
        name: "__reserved",
        version: "1.0.0",
        displayName: "Test",
        description: "Test",
        author: "Test",
      };
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("reserved for core");
    });

    it("rejects invalid semver version", async () => {
      const manifest = {
        name: "my-ext",
        version: "not-semver",
        displayName: "Test",
        description: "Test",
        author: "Test",
      };
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("Invalid version");
    });

    it("validates backend section", async () => {
      const manifest = {
        name: "my-ext",
        version: "1.0.0",
        displayName: "Test",
        description: "Test",
        author: "Test",
        backend: {
          // missing entrypoint
          actions: [
            { name: "do-thing", description: "Does a thing", method: "GET" },
          ],
        },
      };
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("backend.entrypoint is required");
    });

    it("validates MCP stdio transport", async () => {
      const manifest = {
        name: "my-ext",
        version: "1.0.0",
        displayName: "Test",
        description: "Test",
        author: "Test",
        mcp: {
          transport: "stdio",
          command: "dangerous-binary",
          args: ["--flag"],
        },
      };
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("not in allowlist");
    });

    it("rejects shell metacharacters in MCP args", async () => {
      const manifest = {
        name: "my-ext",
        version: "1.0.0",
        displayName: "Test",
        description: "Test",
        author: "Test",
        mcp: {
          transport: "stdio",
          command: "node",
          args: ["--flag", "$(whoami)"],
        },
      };
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("shell metacharacter");
    });

    it("validates hooks events", async () => {
      const manifest = {
        name: "my-ext",
        version: "1.0.0",
        displayName: "Test",
        description: "Test",
        author: "Test",
        hooks: {
          events: ["sessionStart", "unknownEvent"],
        },
      };
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("unknown event");
    });

    it("validates settings schema", async () => {
      const manifest = {
        name: "my-ext",
        version: "1.0.0",
        displayName: "Test",
        description: "Test",
        author: "Test",
        settings: {
          schema: [
            { key: "api-key", type: "vault" },
            { key: "mode", type: "invalid-type" },
          ],
        },
      };
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain('invalid type "invalid-type"');
    });

    it("shows warnings for unknown permission keys", async () => {
      const manifest = {
        name: "my-ext",
        version: "1.0.0",
        displayName: "Test",
        description: "Test",
        author: "Test",
        permissions: {
          database: true,
          customThing: true,
        },
      };
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      // Valid manifest (permissions are warnings not errors)
      await runExtension("validate", "/ext");

      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("is valid");
      expect(allOutput).toContain('Unknown permission key: "customThing"');
    });

    it("validates skills section", async () => {
      const manifest = {
        name: "my-ext",
        version: "1.0.0",
        displayName: "Test",
        description: "Test",
        author: "Test",
        skills: [
          { name: "my-skill", description: "Does stuff" },
          // missing file
        ],
      };
      vol.mkdirSync("/ext", { recursive: true });
      vol.writeFileSync("/ext/manifest.json", JSON.stringify(manifest));

      await expect(runExtension("validate", "/ext")).rejects.toThrow(
        "process.exit called",
      );
      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("missing file");
    });
  });
});
