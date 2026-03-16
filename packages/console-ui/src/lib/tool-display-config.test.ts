import { describe, it, expect } from "vitest";
import { getToolDisplayConfig } from "./tool-display-config";
import type { ToolResult } from "../types/chat";

function makeResult(content: string, detailedContent?: string): ToolResult {
  const result: ToolResult = { content };
  if (detailedContent !== undefined) result.detailedContent = detailedContent;
  return result;
}

describe("tool-display-config", () => {
  describe("getToolDisplayConfig", () => {
    it("returns config for Read tool", () => {
      const config = getToolDisplayConfig("Read");
      expect(config.keyArgs).toEqual(["file_path"]);
      expect(config.resultSummary(makeResult("line1\nline2\nline3"))).toBe("3 lines read");
    });

    it("returns config for Bash tool", () => {
      const config = getToolDisplayConfig("Bash");
      expect(config.keyArgs).toEqual(["command"]);
      expect(config.resultSummary(makeResult("output here"))).toBe("output here");
    });

    it("returns config for Edit tool", () => {
      const config = getToolDisplayConfig("Edit");
      expect(config.keyArgs).toEqual(["file_path"]);
      expect(config.resultSummary(makeResult("✓ Applied"))).toBe("Edit applied");
    });

    it("returns config for Grep tool", () => {
      const config = getToolDisplayConfig("Grep");
      expect(config.keyArgs).toEqual(["pattern", "path"]);
    });

    it("returns fallback config for unknown tools", () => {
      const config = getToolDisplayConfig("unknownTool");
      expect(config.keyArgs).toEqual([]);
      const result = config.resultSummary(makeResult("first line\nsecond line"));
      expect(result).toBe("first line");
    });

    it("truncates long result summaries in fallback", () => {
      const config = getToolDisplayConfig("unknownTool");
      const longLine = "a".repeat(100);
      const result = config.resultSummary(makeResult(longLine));
      expect(result.length).toBeLessThanOrEqual(80);
      expect(result.endsWith("...")).toBe(true);
    });
  });
});
