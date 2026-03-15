import { describe, it, expect, beforeEach, vi } from "vitest";

const mockListRules = vi.fn();
const mockAddRule = vi.fn();
const mockUpdateRule = vi.fn();
const mockDeleteRule = vi.fn();
const mockToggleRule = vi.fn();
const mockTestPattern = vi.fn();
const mockGetStats = vi.fn();
const mockListAuditLog = vi.fn();

vi.mock("../core/tool-governance.js", () => ({
  listRules: (...args: unknown[]) => mockListRules(...args),
  addRule: (...args: unknown[]) => mockAddRule(...args),
  updateRule: (...args: unknown[]) => mockUpdateRule(...args),
  deleteRule: (...args: unknown[]) => mockDeleteRule(...args),
  toggleRule: (...args: unknown[]) => mockToggleRule(...args),
  testPattern: (...args: unknown[]) => mockTestPattern(...args),
  getStats: (...args: unknown[]) => mockGetStats(...args),
  listAuditLog: (...args: unknown[]) => mockListAuditLog(...args),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./tool-rules.js";

describe("tool-rules routes", () => {
  let app: ReturnType<typeof createTestApp>;

  const sampleRule = {
    id: "rule-1",
    pattern: "file_edit",
    decision: "deny",
    scope: "global",
    enabled: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockListRules.mockReturnValue([sampleRule]);
    mockAddRule.mockReturnValue(sampleRule);
    mockUpdateRule.mockReturnValue(true);
    mockDeleteRule.mockReturnValue(true);
    mockToggleRule.mockReturnValue(true);
    mockTestPattern.mockReturnValue(true);
    mockGetStats.mockReturnValue({ total: 10, allowed: 7, denied: 3 });
    mockListAuditLog.mockReturnValue([]);
    app = createTestApp(router);
  });

  describe("GET /api/tool-rules", () => {
    it("returns global rules", async () => {
      const res = await request(app, "GET", "/api/tool-rules");
      expect(res.status).toBe(200);
      expect(mockListRules).toHaveBeenCalledWith("global");
    });
  });

  describe("GET /api/:projectId/tool-rules", () => {
    it("returns project-scoped rules", async () => {
      const res = await request(app, "GET", "/api/proj-1/tool-rules");
      expect(res.status).toBe(200);
      expect(mockListRules).toHaveBeenCalledWith("project", "proj-1");
    });
  });

  describe("POST /api/tool-rules", () => {
    it("creates rule with valid pattern", async () => {
      const res = await request(app, "POST", "/api/tool-rules", {
        pattern: "file_edit",
        decision: "deny",
      });
      expect(res.status).toBe(201);
      expect(mockAddRule).toHaveBeenCalled();
    });

    it("returns 400 when pattern is missing", async () => {
      const res = await request(app, "POST", "/api/tool-rules", {
        decision: "deny",
      });
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain(
        "pattern",
      );
    });

    it("defaults decision to deny", async () => {
      await request(app, "POST", "/api/tool-rules", {
        pattern: "file_edit",
      });
      expect(mockAddRule).toHaveBeenCalledWith(
        null,
        "file_edit",
        "deny",
        null,
        null,
        "global",
      );
    });

    it("passes project scope when specified", async () => {
      await request(app, "POST", "/api/tool-rules", {
        pattern: "file_edit",
        decision: "allow",
        scope: "project",
        projectId: "proj-1",
      });
      expect(mockAddRule).toHaveBeenCalledWith(
        "proj-1",
        "file_edit",
        "allow",
        null,
        null,
        "project",
      );
    });
  });

  describe("PUT /api/tool-rules/:id", () => {
    it("updates rule", async () => {
      const res = await request(app, "PUT", "/api/tool-rules/rule-1", {
        pattern: "new_pattern",
      });
      expect(res.status).toBe(200);
      expect(mockUpdateRule).toHaveBeenCalledWith("rule-1", {
        pattern: "new_pattern",
      });
    });

    it("returns 404 when rule not found", async () => {
      mockUpdateRule.mockReturnValue(false);
      const res = await request(app, "PUT", "/api/tool-rules/missing", {
        pattern: "x",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/tool-rules/:id", () => {
    it("deletes rule", async () => {
      const res = await request(app, "DELETE", "/api/tool-rules/rule-1");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["ok"]).toBe(true);
    });

    it("returns 404 when rule not found", async () => {
      mockDeleteRule.mockReturnValue(false);
      const res = await request(app, "DELETE", "/api/tool-rules/missing");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/tool-rules/:id/toggle", () => {
    it("toggles rule", async () => {
      const res = await request(app, "POST", "/api/tool-rules/rule-1/toggle");
      expect(res.status).toBe(200);
      expect(mockToggleRule).toHaveBeenCalledWith("rule-1");
    });

    it("returns 404 when rule not found", async () => {
      mockToggleRule.mockReturnValue(false);
      const res = await request(
        app,
        "POST",
        "/api/tool-rules/missing/toggle",
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/tool-rules/test", () => {
    it("tests pattern match", async () => {
      const res = await request(app, "POST", "/api/tool-rules/test", {
        pattern: "file_*",
        toolType: "file_edit",
        toolInput: "src/index.ts",
      });
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["matched"]).toBe(true);
    });

    it("returns 400 when pattern is missing", async () => {
      const res = await request(app, "POST", "/api/tool-rules/test", {
        toolType: "file_edit",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/:projectId/tool-audit", () => {
    it("returns audit log", async () => {
      const res = await request(app, "GET", "/api/proj-1/tool-audit");
      expect(res.status).toBe(200);
      expect(mockListAuditLog).toHaveBeenCalledWith("proj-1", 50, 0);
    });

    it("passes limit and offset parameters", async () => {
      await request(
        app,
        "GET",
        "/api/proj-1/tool-audit?limit=10&offset=5",
      );
      expect(mockListAuditLog).toHaveBeenCalledWith("proj-1", 10, 5);
    });
  });

  describe("GET /api/tool-rules/stats", () => {
    it("returns rule stats", async () => {
      const res = await request(app, "GET", "/api/tool-rules/stats");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["total"]).toBe(10);
    });
  });
});
