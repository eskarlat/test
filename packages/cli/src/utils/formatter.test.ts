import { describe, it, expect } from "vitest";
import { formatJson, formatTable, formatExtensionDetail, symbols } from "./formatter.js";

describe("formatter", () => {
  describe("symbols", () => {
    it("exports symbol set", () => {
      expect(symbols).toHaveProperty("check");
      expect(symbols).toHaveProperty("cross");
      expect(symbols).toHaveProperty("arrow");
      expect(symbols).toHaveProperty("bullet");
    });
  });

  describe("formatJson", () => {
    it("formats objects as pretty JSON", () => {
      const result = formatJson({ name: "test", value: 42 });
      expect(result).toBe(JSON.stringify({ name: "test", value: 42 }, null, 2));
    });

    it("formats arrays", () => {
      const result = formatJson([1, 2, 3]);
      expect(result).toContain("[");
    });

    it("formats null", () => {
      expect(formatJson(null)).toBe("null");
    });
  });

  describe("formatTable", () => {
    it("creates a table with headers and rows", () => {
      const result = formatTable(["Name", "Status"], [["ext-a", "mounted"], ["ext-b", "failed"]]);
      expect(result).toContain("Name");
      expect(result).toContain("Status");
      expect(result).toContain("ext-a");
      expect(result).toContain("mounted");
      expect(result).toContain("ext-b");
      expect(result).toContain("failed");
    });

    it("handles empty rows", () => {
      const result = formatTable(["Name"], []);
      expect(result).toContain("Name");
    });
  });

  describe("formatExtensionDetail", () => {
    it("shows route count for mounted extension", () => {
      const result = formatExtensionDetail({ status: "mounted", routeCount: 5 });
      expect(result).toBe("5 routes");
    });

    it("includes MCP transport for mounted extension with MCP", () => {
      const result = formatExtensionDetail({
        status: "mounted",
        routeCount: 3,
        mcpTransport: "stdio",
      });
      expect(result).toBe("3 routes, MCP: stdio");
    });

    it("shows error for failed extension", () => {
      const result = formatExtensionDetail({
        status: "failed",
        routeCount: 0,
        error: "Module not found",
      });
      expect(result).toBe("Module not found");
    });

    it("shows 'failed' when no error message", () => {
      const result = formatExtensionDetail({
        status: "failed",
        routeCount: 0,
      });
      expect(result).toBe("failed");
    });

    it("shows error for suspended extension", () => {
      const result = formatExtensionDetail({
        status: "suspended",
        routeCount: 2,
        error: "Circuit breaker open",
      });
      expect(result).toBe("Circuit breaker open");
    });
  });
});
