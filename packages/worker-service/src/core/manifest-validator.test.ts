import { describe, it, expect } from "vitest";
import { validateManifest } from "./manifest-validator.js";

const validManifest = {
  name: "test-extension",
  version: "1.0.0",
  displayName: "Test Extension",
  description: "A test extension",
  author: "Test Author",
};

describe("validateManifest", () => {
  // 1. Not an object
  describe("non-object inputs", () => {
    it("rejects null", () => {
      const result = validateManifest(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Manifest must be a JSON object");
    });

    it("rejects undefined", () => {
      const result = validateManifest(undefined);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Manifest must be a JSON object");
    });

    it("rejects a string", () => {
      const result = validateManifest("not an object");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Manifest must be a JSON object");
    });

    it("rejects a number", () => {
      const result = validateManifest(42);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Manifest must be a JSON object");
    });

    it("rejects an array (treated as object but missing all required fields)", () => {
      const result = validateManifest([1, 2, 3]);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: name");
    });
  });

  // 2. Missing required fields
  describe("required fields", () => {
    it("reports all missing required fields for empty object", () => {
      const result = validateManifest({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: name");
      expect(result.errors).toContain("Missing required field: version");
      expect(result.errors).toContain("Missing required field: displayName");
      expect(result.errors).toContain("Missing required field: description");
      expect(result.errors).toContain("Missing required field: author");
    });

    it("reports a single missing field", () => {
      const { author: __author, ...noAuthor } = validManifest;
      const result = validateManifest(noAuthor);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: author");
      expect(result.errors).not.toContain("Missing required field: name");
    });
  });

  // 3. Invalid name format
  describe("name validation", () => {
    it("rejects uppercase in name", () => {
      const result = validateManifest({ ...validManifest, name: "TestExt" });
      expect(result.errors).toContain("Invalid name format: must match /^[a-z0-9-]+$/");
    });

    it("rejects special characters in name", () => {
      const result = validateManifest({ ...validManifest, name: "test_ext" });
      expect(result.errors).toContain("Invalid name format: must match /^[a-z0-9-]+$/");
    });

    it("rejects name starting with __", () => {
      const result = validateManifest({ ...validManifest, name: "__reserved" });
      expect(result.errors).toContain("Name cannot start with __ (reserved for core)");
    });

    it("accepts valid name with hyphens and numbers", () => {
      const result = validateManifest({ ...validManifest, name: "my-ext-123" });
      expect(result.errors).not.toContain("Invalid name format: must match /^[a-z0-9-]+$/");
    });
  });

  // 4. Invalid version
  describe("version validation", () => {
    it("rejects non-semver version", () => {
      const result = validateManifest({ ...validManifest, version: "abc" });
      expect(result.errors).toContain("Invalid version: must be valid semver (e.g. 1.2.3)");
    });

    it("rejects incomplete semver", () => {
      const result = validateManifest({ ...validManifest, version: "1.0" });
      expect(result.errors).toContain("Invalid version: must be valid semver (e.g. 1.2.3)");
    });

    it("accepts semver with prerelease", () => {
      const result = validateManifest({ ...validManifest, version: "1.0.0-beta.1" });
      expect(result.errors).not.toContain("Invalid version: must be valid semver (e.g. 1.2.3)");
    });
  });

  // 5. minSdkVersion
  describe("minSdkVersion validation", () => {
    it("errors on invalid semver minSdkVersion", () => {
      const result = validateManifest({ ...validManifest, minSdkVersion: "not-semver" });
      expect(result.errors).toContain("minSdkVersion must be a valid semver string");
    });

    it("errors on non-string minSdkVersion", () => {
      const result = validateManifest({ ...validManifest, minSdkVersion: 123 });
      expect(result.errors).toContain("minSdkVersion must be a valid semver string");
    });

    it("marks incompatible when minSdkVersion > current SDK (0.1.0)", () => {
      const result = validateManifest({ ...validManifest, minSdkVersion: "1.0.0" });
      expect(result.valid).toBe(false);
      expect(result.incompatible).toBe(true);
      expect(result.errors).toContain(
        "Extension requires SDK >= 1.0.0 but current SDK is 0.1.0",
      );
    });

    it("marks incompatible on higher minor version", () => {
      const result = validateManifest({ ...validManifest, minSdkVersion: "0.2.0" });
      expect(result.valid).toBe(false);
      expect(result.incompatible).toBe(true);
    });

    it("marks incompatible on higher patch version", () => {
      const result = validateManifest({ ...validManifest, minSdkVersion: "0.1.1" });
      expect(result.valid).toBe(false);
      expect(result.incompatible).toBe(true);
    });

    it("accepts equal minSdkVersion", () => {
      const result = validateManifest({ ...validManifest, minSdkVersion: "0.1.0" });
      expect(result.valid).toBe(true);
      expect(result.incompatible).toBeUndefined();
    });

    it("does not warn when minSdkVersion is close to current", () => {
      // Current is 0.1.0; 0.0.0 is only 1 minor behind → no warning
      const result = validateManifest({ ...validManifest, minSdkVersion: "0.0.0" });
      expect(result.warnings).toHaveLength(0);
    });

    it("does not produce behind-warning when major differs", () => {
      // The behind-warning only fires when major versions match and minor diff > 2
      // With current 0.1.0, a minSdkVersion of 0.0.0 has minor diff = 1, no warning
      const result = validateManifest({ ...validManifest, minSdkVersion: "0.0.0" });
      expect(result.warnings.some((w) => w.includes("behind"))).toBe(false);
    });
  });

  // 6. Backend validation
  describe("backend validation", () => {
    it("errors on missing entrypoint", () => {
      const result = validateManifest({ ...validManifest, backend: {} });
      expect(result.errors).toContain("backend.entrypoint must be a non-empty string");
    });

    it("errors on non-string entrypoint", () => {
      const result = validateManifest({ ...validManifest, backend: { entrypoint: 42 } });
      expect(result.errors).toContain("backend.entrypoint must be a non-empty string");
    });

    it("errors on action missing name", () => {
      const result = validateManifest({
        ...validManifest,
        backend: {
          entrypoint: "index.js",
          actions: [{ description: "desc", method: "GET" }],
        },
      });
      expect(result.errors).toContain("backend.actions[0]: missing name");
    });

    it("errors on action missing description", () => {
      const result = validateManifest({
        ...validManifest,
        backend: {
          entrypoint: "index.js",
          actions: [{ name: "act", method: "GET" }],
        },
      });
      expect(result.errors).toContain("backend.actions[0]: missing description");
    });

    it("errors on action with invalid method", () => {
      const result = validateManifest({
        ...validManifest,
        backend: {
          entrypoint: "index.js",
          actions: [{ name: "act", description: "desc", method: "INVALID" }],
        },
      });
      expect(result.errors).toContain(
        "backend.actions[0]: method must be one of GET, POST, PUT, DELETE, PATCH",
      );
    });

    it("errors on action with missing method", () => {
      const result = validateManifest({
        ...validManifest,
        backend: {
          entrypoint: "index.js",
          actions: [{ name: "act", description: "desc" }],
        },
      });
      expect(result.errors).toContain(
        "backend.actions[0]: method must be one of GET, POST, PUT, DELETE, PATCH",
      );
    });

    it("accepts valid backend with actions", () => {
      const result = validateManifest({
        ...validManifest,
        backend: {
          entrypoint: "index.js",
          actions: [{ name: "act", description: "desc", method: "POST" }],
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts valid backend without actions", () => {
      const result = validateManifest({
        ...validManifest,
        backend: { entrypoint: "index.js" },
      });
      expect(result.valid).toBe(true);
    });
  });

  // 7. UI validation
  describe("ui validation", () => {
    it("errors on missing bundle", () => {
      const result = validateManifest({ ...validManifest, ui: {} });
      expect(result.errors).toContain("ui.bundle must be a non-empty string");
    });

    it("errors on non-string bundle", () => {
      const result = validateManifest({ ...validManifest, ui: { bundle: 42 } });
      expect(result.errors).toContain("ui.bundle must be a non-empty string");
    });

    it("errors on page missing id", () => {
      const result = validateManifest({
        ...validManifest,
        ui: { bundle: "ui.js", pages: [{ label: "Page", path: "/page" }] },
      });
      expect(result.errors).toContain("ui.pages[0]: missing id");
    });

    it("errors on page missing label", () => {
      const result = validateManifest({
        ...validManifest,
        ui: { bundle: "ui.js", pages: [{ id: "p1", path: "/page" }] },
      });
      expect(result.errors).toContain("ui.pages[0]: missing label");
    });

    it("errors on page missing path", () => {
      const result = validateManifest({
        ...validManifest,
        ui: { bundle: "ui.js", pages: [{ id: "p1", label: "Page" }] },
      });
      expect(result.errors).toContain("ui.pages[0]: missing path");
    });

    it("errors on duplicate page paths", () => {
      const result = validateManifest({
        ...validManifest,
        ui: {
          bundle: "ui.js",
          pages: [
            { id: "p1", label: "Page 1", path: "/page" },
            { id: "p2", label: "Page 2", path: "/page" },
          ],
        },
      });
      expect(result.errors).toContain('ui.pages[1]: duplicate path "/page"');
    });

    it("accepts valid ui with pages", () => {
      const result = validateManifest({
        ...validManifest,
        ui: {
          bundle: "ui.js",
          pages: [
            { id: "p1", label: "Page 1", path: "/page1" },
            { id: "p2", label: "Page 2", path: "/page2" },
          ],
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  // 8. MCP validation
  describe("mcp validation", () => {
    it("errors on invalid transport", () => {
      const result = validateManifest({ ...validManifest, mcp: { transport: "websocket" } });
      expect(result.errors).toContain('mcp.transport must be "stdio" or "sse"');
    });

    it("errors on missing transport", () => {
      const result = validateManifest({ ...validManifest, mcp: {} });
      expect(result.errors).toContain('mcp.transport must be "stdio" or "sse"');
    });

    describe("stdio transport", () => {
      it("errors on missing command", () => {
        const result = validateManifest({
          ...validManifest,
          mcp: { transport: "stdio", args: [] },
        });
        expect(result.errors).toContain("mcp.command is required for stdio transport");
      });

      it("errors on command not in allowlist", () => {
        const result = validateManifest({
          ...validManifest,
          mcp: { transport: "stdio", command: "bash", args: [] },
        });
        expect(result.errors).toContain(
          'mcp.command "bash" not in allowlist: node, npx, python, python3, deno, bun, uvx, docker',
        );
      });

      it("errors when args is not an array", () => {
        const result = validateManifest({
          ...validManifest,
          mcp: { transport: "stdio", command: "node", args: "not-an-array" },
        });
        expect(result.errors).toContain("mcp.args must be an array for stdio transport");
      });

      it("errors on shell metacharacters in args", () => {
        const result = validateManifest({
          ...validManifest,
          mcp: { transport: "stdio", command: "node", args: ["safe", "$(evil)"] },
        });
        expect(result.errors).toContain(
          'mcp.args contains shell metacharacter in: "$(evil)"',
        );
      });

      it("errors on semicolon in args", () => {
        const result = validateManifest({
          ...validManifest,
          mcp: { transport: "stdio", command: "node", args: ["arg; rm -rf /"] },
        });
        expect(result.errors.some((e) => e.includes("shell metacharacter"))).toBe(true);
      });

      it("accepts valid stdio mcp config", () => {
        const result = validateManifest({
          ...validManifest,
          mcp: { transport: "stdio", command: "node", args: ["server.js", "--port", "3000"] },
        });
        expect(result.errors.filter((e) => e.includes("mcp"))).toHaveLength(0);
      });

      it("accepts all allowlisted commands", () => {
        for (const cmd of ["node", "npx", "python", "python3", "deno", "bun", "uvx", "docker"]) {
          const result = validateManifest({
            ...validManifest,
            mcp: { transport: "stdio", command: cmd, args: [] },
          });
          expect(result.errors.filter((e) => e.includes("allowlist"))).toHaveLength(0);
        }
      });
    });

    describe("sse transport", () => {
      it("errors on missing url", () => {
        const result = validateManifest({
          ...validManifest,
          mcp: { transport: "sse" },
        });
        expect(result.errors).toContain("mcp.url is required for sse transport");
      });

      it("errors on non-string url", () => {
        const result = validateManifest({
          ...validManifest,
          mcp: { transport: "sse", url: 42 },
        });
        expect(result.errors).toContain("mcp.url is required for sse transport");
      });

      it("accepts valid sse mcp config", () => {
        const result = validateManifest({
          ...validManifest,
          mcp: { transport: "sse", url: "http://localhost:3000/sse" },
        });
        expect(result.errors.filter((e) => e.includes("mcp"))).toHaveLength(0);
      });
    });
  });

  // 9. Permissions
  describe("permissions validation", () => {
    it("warns on unknown permission key", () => {
      const result = validateManifest({
        ...validManifest,
        permissions: { unknown_perm: true },
      });
      expect(result.warnings).toContain('Unknown permission key: "unknown_perm"');
    });

    it("warns on network permission", () => {
      const result = validateManifest({
        ...validManifest,
        permissions: { network: true },
      });
      expect(result.warnings).toContain(
        "network permission is advisory — network access is not enforced",
      );
    });

    it("warns on filesystem permission", () => {
      const result = validateManifest({
        ...validManifest,
        permissions: { filesystem: true },
      });
      expect(result.warnings).toContain(
        "filesystem permission is advisory — filesystem access is not enforced",
      );
    });

    it("does not warn on known permissions without advisory", () => {
      const result = validateManifest({
        ...validManifest,
        permissions: { database: true, mcp: true, hooks: true, vault: true, llm: true, scheduler: true },
      });
      expect(result.warnings).toHaveLength(0);
    });
  });

  // 10. Settings
  describe("settings validation", () => {
    it("errors on missing key in schema entry", () => {
      const result = validateManifest({
        ...validManifest,
        settings: { schema: [{ type: "string" }] },
      });
      expect(result.errors).toContain("settings.schema[0]: missing key");
    });

    it("errors on invalid type in schema entry", () => {
      const result = validateManifest({
        ...validManifest,
        settings: { schema: [{ key: "foo", type: "invalid" }] },
      });
      expect(result.errors).toContain(
        'settings.schema[0]: invalid type "invalid" (must be string, vault, number, boolean, or select)',
      );
    });

    it("errors on select without options array", () => {
      const result = validateManifest({
        ...validManifest,
        settings: { schema: [{ key: "foo", type: "select" }] },
      });
      expect(result.errors).toContain("settings.schema[0]: select type requires an options array");
    });

    it("accepts select with options array", () => {
      const result = validateManifest({
        ...validManifest,
        settings: { schema: [{ key: "foo", type: "select", options: ["a", "b"] }] },
      });
      expect(result.errors).toHaveLength(0);
    });

    it("accepts all valid setting types", () => {
      for (const type of ["string", "vault", "number", "boolean", "select"]) {
        const entry: Record<string, unknown> = { key: `k-${type}`, type };
        if (type === "select") entry["options"] = ["a"];
        const result = validateManifest({
          ...validManifest,
          settings: { schema: [entry] },
        });
        expect(result.errors.filter((e) => e.includes("invalid type"))).toHaveLength(0);
      }
    });

    it("skips validation when schema is not an array", () => {
      const result = validateManifest({
        ...validManifest,
        settings: { schema: "not-an-array" },
      });
      expect(result.errors.filter((e) => e.includes("settings"))).toHaveLength(0);
    });
  });

  // 11. Hooks
  describe("hooks validation", () => {
    it("errors on unknown hook event", () => {
      const result = validateManifest({
        ...validManifest,
        hooks: { events: ["unknownEvent"] },
      });
      expect(result.errors).toContain('hooks.events: unknown event "unknownEvent"');
    });

    it("accepts all valid hook events", () => {
      const validEvents = [
        "sessionStart",
        "sessionEnd",
        "userPromptSubmitted",
        "preToolUse",
        "postToolUse",
        "errorOccurred",
        "preCompact",
        "subagentStart",
        "subagentStop",
      ];
      const result = validateManifest({
        ...validManifest,
        hooks: { events: validEvents },
      });
      expect(result.errors.filter((e) => e.includes("hooks"))).toHaveLength(0);
    });

    it("skips validation when events is not an array", () => {
      const result = validateManifest({
        ...validManifest,
        hooks: { events: "not-an-array" },
      });
      expect(result.errors.filter((e) => e.includes("hooks"))).toHaveLength(0);
    });
  });

  // 12. Skills
  describe("skills validation", () => {
    it("errors on missing name", () => {
      const result = validateManifest({
        ...validManifest,
        skills: [{ description: "desc", file: "SKILL.md" }],
      });
      expect(result.errors).toContain("skills[0]: missing name");
    });

    it("errors on missing description", () => {
      const result = validateManifest({
        ...validManifest,
        skills: [{ name: "skill1", file: "SKILL.md" }],
      });
      expect(result.errors).toContain("skills[0]: missing description");
    });

    it("errors on missing file", () => {
      const result = validateManifest({
        ...validManifest,
        skills: [{ name: "skill1", description: "desc" }],
      });
      expect(result.errors).toContain("skills[0]: missing file");
    });

    it("warns when skill file does not exist in extensionDir", () => {
      const result = validateManifest(
        {
          ...validManifest,
          skills: [{ name: "skill1", description: "desc", file: "nonexistent.md" }],
        },
        "/tmp/fake-extension-dir-12345",
      );
      expect(result.warnings.some((w) => w.includes("not found at"))).toBe(true);
    });

    it("accepts valid skills", () => {
      const result = validateManifest({
        ...validManifest,
        skills: [{ name: "skill1", description: "A skill", file: "SKILL.md" }],
      });
      expect(result.errors.filter((e) => e.includes("skills"))).toHaveLength(0);
    });
  });

  // 13. Chat tools (ADR-047)
  describe("chatTools validation", () => {
    it("errors on missing name", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [{ description: "d", parameters: {}, endpoint: "POST /foo" }],
      });
      expect(result.errors).toContain("chatTools[0]: missing name");
    });

    it("errors on invalid name format", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [{ name: "123bad", description: "d", parameters: {}, endpoint: "POST /foo" }],
      });
      expect(result.errors).toContain("chatTools[0]: name must be alphanumeric + hyphens");
    });

    it("errors on name with underscores", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [{ name: "bad_name", description: "d", parameters: {}, endpoint: "POST /foo" }],
      });
      expect(result.errors).toContain("chatTools[0]: name must be alphanumeric + hyphens");
    });

    it("errors on duplicate tool name", () => {
      const tool = { name: "myTool", description: "d", parameters: {}, endpoint: "POST /foo" };
      const result = validateManifest({
        ...validManifest,
        chatTools: [tool, { ...tool }],
      });
      expect(result.errors).toContain('chatTools[1]: duplicate tool name "myTool"');
    });

    it("errors on missing description", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [{ name: "myTool", parameters: {}, endpoint: "POST /foo" }],
      });
      expect(result.errors).toContain("chatTools[0]: missing description");
    });

    it("errors when parameters is not an object", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [{ name: "myTool", description: "d", parameters: "bad", endpoint: "POST /foo" }],
      });
      expect(result.errors).toContain("chatTools[0]: parameters must be a JSON Schema object");
    });

    it("errors when parameters is null", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [{ name: "myTool", description: "d", parameters: null, endpoint: "POST /foo" }],
      });
      expect(result.errors).toContain("chatTools[0]: parameters must be a JSON Schema object");
    });

    it("errors on missing endpoint", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [{ name: "myTool", description: "d", parameters: {} }],
      });
      expect(result.errors).toContain("chatTools[0]: missing endpoint");
    });

    it("errors on invalid endpoint format", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [{ name: "myTool", description: "d", parameters: {}, endpoint: "foo/bar" }],
      });
      expect(result.errors).toContain('chatTools[0]: endpoint must match "METHOD /path" format');
    });

    it("accepts valid chatTools", () => {
      const result = validateManifest({
        ...validManifest,
        permissions: { llm: true },
        chatTools: [
          { name: "myTool", description: "A tool", parameters: { type: "object" }, endpoint: "POST /do-thing" },
        ],
      });
      expect(result.errors).toHaveLength(0);
    });
  });

  // 14. Chat agents
  describe("chatAgents validation", () => {
    const baseTool = { name: "myTool", description: "d", parameters: {}, endpoint: "POST /foo" };

    it("errors on missing name", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [baseTool],
        chatAgents: [{ displayName: "A", description: "d", prompt: "p", tools: ["myTool"] }],
      });
      expect(result.errors).toContain("chatAgents[0]: missing name");
    });

    it("errors on invalid name format", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [baseTool],
        chatAgents: [{ name: "123bad", displayName: "A", description: "d", prompt: "p", tools: ["myTool"] }],
      });
      expect(result.errors).toContain("chatAgents[0]: name must be alphanumeric + hyphens");
    });

    it("errors on duplicate agent name", () => {
      const agent = { name: "myAgent", displayName: "A", description: "d", prompt: "p", tools: ["myTool"] };
      const result = validateManifest({
        ...validManifest,
        chatTools: [baseTool],
        chatAgents: [agent, { ...agent }],
      });
      expect(result.errors).toContain('chatAgents[1]: duplicate agent name "myAgent"');
    });

    it("errors on missing displayName", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [baseTool],
        chatAgents: [{ name: "myAgent", description: "d", prompt: "p", tools: ["myTool"] }],
      });
      expect(result.errors).toContain("chatAgents[0]: missing displayName");
    });

    it("errors on missing description", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [baseTool],
        chatAgents: [{ name: "myAgent", displayName: "A", prompt: "p", tools: ["myTool"] }],
      });
      expect(result.errors).toContain("chatAgents[0]: missing description");
    });

    it("errors on missing prompt", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [baseTool],
        chatAgents: [{ name: "myAgent", displayName: "A", description: "d", tools: ["myTool"] }],
      });
      expect(result.errors).toContain("chatAgents[0]: missing prompt");
    });

    it("errors when tools is not an array", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [baseTool],
        chatAgents: [{ name: "myAgent", displayName: "A", description: "d", prompt: "p", tools: "notarray" }],
      });
      expect(result.errors).toContain("chatAgents[0]: tools must be an array");
    });

    it("errors when tool reference not found in chatTools", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [baseTool],
        chatAgents: [{ name: "myAgent", displayName: "A", description: "d", prompt: "p", tools: ["nonexistent"] }],
      });
      expect(result.errors).toContain('chatAgents[0]: tool "nonexistent" not found in chatTools');
    });

    it("accepts valid chatAgents referencing declared chatTools", () => {
      const result = validateManifest({
        ...validManifest,
        permissions: { llm: true },
        chatTools: [baseTool],
        chatAgents: [{ name: "myAgent", displayName: "Agent", description: "desc", prompt: "do things", tools: ["myTool"] }],
      });
      expect(result.errors).toHaveLength(0);
    });
  });

  // 15. chatTools/chatAgents without llm permission
  describe("llm permission warning", () => {
    it("warns when chatTools declared without llm permission", () => {
      const result = validateManifest({
        ...validManifest,
        chatTools: [{ name: "myTool", description: "d", parameters: {}, endpoint: "POST /foo" }],
      });
      expect(result.warnings).toContain("chatTools/chatAgents declared but permissions.llm is not true");
    });

    it("warns when chatAgents declared without llm permission", () => {
      const result = validateManifest({
        ...validManifest,
        chatAgents: [{ name: "myAgent", displayName: "A", description: "d", prompt: "p", tools: [] }],
      });
      expect(result.warnings).toContain("chatTools/chatAgents declared but permissions.llm is not true");
    });

    it("does not warn when llm permission is set", () => {
      const result = validateManifest({
        ...validManifest,
        permissions: { llm: true },
        chatTools: [{ name: "myTool", description: "d", parameters: {}, endpoint: "POST /foo" }],
      });
      expect(result.warnings).not.toContain("chatTools/chatAgents declared but permissions.llm is not true");
    });
  });

  // 16. Context provider
  describe("contextProvider validation", () => {
    it("errors on missing entrypoint", () => {
      const result = validateManifest({
        ...validManifest,
        backend: { entrypoint: "index.js" },
        contextProvider: {},
      });
      expect(result.errors).toContain("contextProvider.entrypoint must be a non-empty string");
    });

    it("errors on non-string entrypoint", () => {
      const result = validateManifest({
        ...validManifest,
        backend: { entrypoint: "index.js" },
        contextProvider: { entrypoint: 42 },
      });
      expect(result.errors).toContain("contextProvider.entrypoint must be a non-empty string");
    });

    it("errors when backend is not declared", () => {
      const result = validateManifest({
        ...validManifest,
        contextProvider: { entrypoint: "ctx.js" },
      });
      expect(result.errors).toContain("contextProvider requires backend to be declared");
    });

    it("warns when hooks.events does not include sessionStart", () => {
      const result = validateManifest({
        ...validManifest,
        backend: { entrypoint: "index.js" },
        contextProvider: { entrypoint: "ctx.js" },
      });
      expect(result.warnings).toContain(
        "contextProvider: recommend adding 'sessionStart' to hooks.events",
      );
    });

    it("warns when hooks exist but events missing sessionStart", () => {
      const result = validateManifest({
        ...validManifest,
        backend: { entrypoint: "index.js" },
        hooks: { events: ["sessionEnd"] },
        contextProvider: { entrypoint: "ctx.js" },
      });
      expect(result.warnings).toContain(
        "contextProvider: recommend adding 'sessionStart' to hooks.events",
      );
    });

    it("does not warn when hooks.events includes sessionStart", () => {
      const result = validateManifest({
        ...validManifest,
        backend: { entrypoint: "index.js" },
        hooks: { events: ["sessionStart"] },
        contextProvider: { entrypoint: "ctx.js" },
      });
      expect(result.warnings).not.toContain(
        "contextProvider: recommend adding 'sessionStart' to hooks.events",
      );
    });

    it("accepts valid contextProvider with backend and sessionStart hook", () => {
      const result = validateManifest({
        ...validManifest,
        backend: { entrypoint: "index.js" },
        hooks: { events: ["sessionStart"] },
        contextProvider: { entrypoint: "ctx.js" },
      });
      expect(result.valid).toBe(true);
    });
  });

  // 17. Valid manifest
  describe("valid manifest", () => {
    it("returns valid: true with no errors for minimal valid manifest", () => {
      const result = validateManifest(validManifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.incompatible).toBeUndefined();
    });

    it("returns valid: true for a fully-featured manifest", () => {
      const result = validateManifest({
        ...validManifest,
        minSdkVersion: "0.1.0",
        backend: {
          entrypoint: "index.js",
          actions: [{ name: "doStuff", description: "Does stuff", method: "POST" }],
        },
        ui: {
          bundle: "ui.js",
          pages: [{ id: "main", label: "Main", path: "/main" }],
        },
        mcp: { transport: "stdio", command: "node", args: ["server.js"] },
        permissions: { database: true, llm: true },
        settings: { schema: [{ key: "apiKey", type: "vault" }] },
        hooks: { events: ["sessionStart", "postToolUse"] },
        skills: [{ name: "my-skill", description: "A skill", file: "SKILL.md" }],
        chatTools: [
          { name: "search", description: "Search", parameters: { type: "object" }, endpoint: "POST /search" },
        ],
        chatAgents: [
          { name: "helper", displayName: "Helper", description: "Helps", prompt: "You help", tools: ["search"] },
        ],
        contextProvider: { entrypoint: "ctx.js" },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
