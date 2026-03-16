import { describe, it, expect } from "vitest";
import { getToolIntent, humanize, truncate, shortenPath } from "./tool-intent";

describe("tool-intent", () => {
  describe("getToolIntent", () => {
    it("returns intent for Read tool", () => {
      expect(getToolIntent("Read", { file_path: "src/index.ts" })).toBe("Read .../index.ts");
    });

    it("returns intent for Bash tool", () => {
      expect(getToolIntent("Bash", { command: "npm test" })).toBe("Run `npm test`");
    });

    it("returns intent for Grep tool", () => {
      expect(getToolIntent("Grep", { pattern: "TODO" })).toBe('Search for "TODO"');
    });

    it("returns intent for Glob tool", () => {
      expect(getToolIntent("Glob", { pattern: "**/*.ts" })).toBe("Find files matching **/*.ts");
    });

    it("returns intent for lowercase variants", () => {
      expect(getToolIntent("read_file", { file_path: "a/b/c.ts" })).toBe("Read .../c.ts");
    });

    it("falls back to humanized tool name for unknown tools", () => {
      expect(getToolIntent("createPullRequest", {})).toBe("Create pull request");
    });

    it("includes first arg in fallback", () => {
      expect(getToolIntent("customTool", { target: "deploy" })).toBe("Custom tool — deploy");
    });

    it("handles extension-namespaced tools in fallback", () => {
      expect(getToolIntent("myext__doStuff", {})).toBe("Do stuff");
    });
  });

  describe("humanize", () => {
    it("converts camelCase", () => {
      expect(humanize("createPullRequest")).toBe("Create pull request");
    });

    it("converts snake_case", () => {
      expect(humanize("read_file")).toBe("Read file");
    });

    it("strips extension namespace", () => {
      expect(humanize("myext__doStuff")).toBe("Do stuff");
    });
  });

  describe("truncate", () => {
    it("does not truncate short strings", () => {
      expect(truncate("hello", 10)).toBe("hello");
    });

    it("truncates long strings with ellipsis", () => {
      expect(truncate("a very long string indeed", 10)).toBe("a very...");
    });
  });

  describe("shortenPath", () => {
    it("returns short paths as-is", () => {
      expect(shortenPath("src/index.ts")).toBe("src/index.ts");
    });

    it("shortens long paths", () => {
      expect(shortenPath("packages/console-ui/src/stores/chat.ts")).toBe(".../stores/chat.ts");
    });

    it("handles empty string", () => {
      expect(shortenPath("")).toBe("");
    });
  });
});
