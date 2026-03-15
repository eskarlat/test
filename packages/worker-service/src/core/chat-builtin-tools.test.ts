import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── hoisted mock functions ─────────────────────────────────────────── */
const mocks = vi.hoisted(() => ({
  // projects
  getProjectRegistry: vi.fn(() => new Map()),
  // session-manager
  listActiveSessions: vi.fn(() => []),
  // observations
  observationsList: vi.fn(() => []),
  // tool-governance
  listRules: vi.fn(() => []),
  // prompt-journal
  promptSearch: vi.fn(() => []),
  promptList: vi.fn(() => []),
  // error-intelligence
  getActiveWarnings: vi.fn(() => []),
  listPatterns: vi.fn(() => []),
  // tool-analytics
  getSessionAnalytics: vi.fn(() => ({})),
  getAnalytics: vi.fn(() => ({})),
  // context-recipe-engine
  getRecipe: vi.fn(() => null),
  getRegisteredProviders: vi.fn(() => []),
  // fts-search-service
  searchAll: vi.fn(() => []),
  searchPrompts: vi.fn(() => []),
  searchObservations: vi.fn(() => []),
  searchErrors: vi.fn(() => []),
  searchSessions: vi.fn(() => []),
  // subagent-tracking
  subagentGetTree: vi.fn(() => []),
  subagentList: vi.fn(() => []),
  // extension-registry
  listMounted: vi.fn(() => []),
}));

/* ── vi.mock calls ──────────────────────────────────────────────────── */

vi.mock("../routes/projects.js", () => ({
  getRegistry: mocks.getProjectRegistry,
}));

vi.mock("./session-manager.js", () => ({
  listActiveSessions: mocks.listActiveSessions,
}));

vi.mock("./observations-service.js", () => ({
  list: mocks.observationsList,
}));

vi.mock("./tool-governance.js", () => ({
  listRules: mocks.listRules,
}));

vi.mock("./prompt-journal.js", () => ({
  search: mocks.promptSearch,
  list: mocks.promptList,
}));

vi.mock("./error-intelligence.js", () => ({
  getActiveWarnings: mocks.getActiveWarnings,
  listPatterns: mocks.listPatterns,
}));

vi.mock("./tool-analytics.js", () => ({
  getSessionAnalytics: mocks.getSessionAnalytics,
  getAnalytics: mocks.getAnalytics,
}));

vi.mock("./context-recipe-engine.js", () => ({
  getRecipe: mocks.getRecipe,
  getRegisteredProviders: mocks.getRegisteredProviders,
}));

vi.mock("./fts-search-service.js", () => ({
  searchAll: mocks.searchAll,
  searchPrompts: mocks.searchPrompts,
  searchObservations: mocks.searchObservations,
  searchErrors: mocks.searchErrors,
  searchSessions: mocks.searchSessions,
}));

vi.mock("./subagent-tracking.js", () => ({
  getTree: mocks.subagentGetTree,
  list: mocks.subagentList,
}));

vi.mock("./extension-registry.js", () => ({
  listMounted: mocks.listMounted,
}));

/* ── import module under test ───────────────────────────────────────── */

import { registerBuiltinTools, getBuiltinTools } from "./chat-builtin-tools.js";

const PROJECT_ID = "test-project-123";

function findTool(name: string) {
  const tools = registerBuiltinTools(PROJECT_ID);
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

describe("chat-builtin-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("registerBuiltinTools", () => {
    it("returns exactly 11 tools", () => {
      const tools = registerBuiltinTools(PROJECT_ID);
      expect(tools).toHaveLength(11);
    });

    it("each tool has name, description, parameters, and handler", () => {
      const tools = registerBuiltinTools(PROJECT_ID);
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.handler).toBe("function");
      }
    });

    it("tool names are unique", () => {
      const tools = registerBuiltinTools(PROJECT_ID);
      const names = tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it("expected tool names are present", () => {
      const tools = registerBuiltinTools(PROJECT_ID);
      const names = tools.map((t) => t.name);
      expect(names).toContain("get_project");
      expect(names).toContain("get_sessions");
      expect(names).toContain("get_observations");
      expect(names).toContain("get_tool_rules");
      expect(names).toContain("get_prompts");
      expect(names).toContain("get_errors");
      expect(names).toContain("get_tool_analytics");
      expect(names).toContain("get_context_recipes");
      expect(names).toContain("search");
      expect(names).toContain("get_subagents");
      expect(names).toContain("get_extension_status");
    });
  });

  describe("getBuiltinTools alias", () => {
    it("is the same function as registerBuiltinTools", () => {
      expect(getBuiltinTools).toBe(registerBuiltinTools);
    });
  });

  /* ── get_project ──────────────────────────────────────────────────── */
  describe("get_project", () => {
    it("returns project info when project exists", async () => {
      const project = {
        id: PROJECT_ID,
        name: "Test Project",
        path: "/home/user/project",
        extensionCount: 3,
        registeredAt: "2024-01-01T00:00:00Z",
        lastActiveAt: "2024-01-02T00:00:00Z",
        mountedExtensions: [
          { name: "ext-a", version: "1.0.0", status: "mounted", extra: "ignored" },
        ],
      };
      mocks.getProjectRegistry.mockReturnValue(new Map([[PROJECT_ID, project]]));

      const tool = findTool("get_project");
      const result = await tool.handler({});
      expect(result).toMatchObject({
        id: PROJECT_ID,
        name: "Test Project",
        path: "/home/user/project",
        extensionCount: 3,
      });
      // mountedExtensions should only include name, version, status
      expect(result.mountedExtensions[0]).toEqual({
        name: "ext-a",
        version: "1.0.0",
        status: "mounted",
      });
      expect(result.mountedExtensions[0]).not.toHaveProperty("extra");
    });

    it("returns error when project is not in registry", async () => {
      mocks.getProjectRegistry.mockReturnValue(new Map());
      const tool = findTool("get_project");
      const result = await tool.handler({});
      expect(result).toHaveProperty("error");
      expect(result.error).toContain("not found");
    });

    it("catches exceptions and returns error message", async () => {
      mocks.getProjectRegistry.mockImplementation(() => {
        throw new Error("registry crashed");
      });
      const tool = findTool("get_project");
      const result = await tool.handler({});
      expect(result.error).toContain("registry crashed");
    });
  });

  /* ── get_sessions ─────────────────────────────────────────────────── */
  describe("get_sessions", () => {
    it("returns sessions with default limit of 20", async () => {
      const sessions = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}` }));
      mocks.listActiveSessions.mockReturnValue(sessions);

      const tool = findTool("get_sessions");
      const result = await tool.handler({});
      expect(result.sessions).toHaveLength(20);
      expect(result.count).toBe(20);
      expect(mocks.listActiveSessions).toHaveBeenCalledWith(PROJECT_ID);
    });

    it("respects custom limit", async () => {
      const sessions = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}` }));
      mocks.listActiveSessions.mockReturnValue(sessions);

      const tool = findTool("get_sessions");
      const result = await tool.handler({ limit: 5 });
      expect(result.sessions).toHaveLength(5);
      expect(result.count).toBe(5);
    });

    it("returns error on exception", async () => {
      mocks.listActiveSessions.mockImplementation(() => {
        throw new Error("db unavailable");
      });
      const tool = findTool("get_sessions");
      const result = await tool.handler({});
      expect(result.error).toContain("db unavailable");
    });
  });

  /* ── get_observations ─────────────────────────────────────────────── */
  describe("get_observations", () => {
    it("defaults to activeOnly=true", async () => {
      mocks.observationsList.mockReturnValue([{ id: 1, text: "obs" }]);

      const tool = findTool("get_observations");
      const result = await tool.handler({});
      expect(mocks.observationsList).toHaveBeenCalledWith(PROJECT_ID, true);
      expect(result.count).toBe(1);
    });

    it("passes activeOnly=false when specified", async () => {
      mocks.observationsList.mockReturnValue([]);
      const tool = findTool("get_observations");
      await tool.handler({ activeOnly: false });
      expect(mocks.observationsList).toHaveBeenCalledWith(PROJECT_ID, false);
    });

    it("returns error on exception", async () => {
      mocks.observationsList.mockImplementation(() => { throw new Error("fail"); });
      const tool = findTool("get_observations");
      const result = await tool.handler({});
      expect(result.error).toContain("fail");
    });
  });

  /* ── get_tool_rules ───────────────────────────────────────────────── */
  describe("get_tool_rules", () => {
    it("passes scope and projectId to listRules", async () => {
      mocks.listRules.mockReturnValue([{ id: "r1", action: "deny" }]);
      const tool = findTool("get_tool_rules");
      const result = await tool.handler({ scope: "project" });
      expect(mocks.listRules).toHaveBeenCalledWith("project", PROJECT_ID);
      expect(result.rules).toHaveLength(1);
      expect(result.count).toBe(1);
    });

    it("passes undefined scope when not specified", async () => {
      mocks.listRules.mockReturnValue([]);
      const tool = findTool("get_tool_rules");
      await tool.handler({});
      expect(mocks.listRules).toHaveBeenCalledWith(undefined, PROJECT_ID);
    });

    it("returns error on exception", async () => {
      mocks.listRules.mockImplementation(() => { throw new Error("boom"); });
      const tool = findTool("get_tool_rules");
      const result = await tool.handler({});
      expect(result.error).toContain("boom");
    });
  });

  /* ── get_prompts ──────────────────────────────────────────────────── */
  describe("get_prompts", () => {
    it("uses search when query is provided", async () => {
      mocks.promptSearch.mockReturnValue([{ id: "p1" }, { id: "p2" }]);
      const tool = findTool("get_prompts");
      const result = await tool.handler({ query: "test query" });
      expect(mocks.promptSearch).toHaveBeenCalledWith(PROJECT_ID, "test query");
      expect(result.prompts).toHaveLength(2);
    });

    it("uses list when no query is provided", async () => {
      mocks.promptList.mockReturnValue([{ id: "p1" }]);
      const tool = findTool("get_prompts");
      const result = await tool.handler({});
      expect(mocks.promptList).toHaveBeenCalledWith(PROJECT_ID, 20);
      expect(mocks.promptSearch).not.toHaveBeenCalled();
      expect(result.count).toBe(1);
    });

    it("respects limit when using search", async () => {
      const results = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }));
      mocks.promptSearch.mockReturnValue(results);
      const tool = findTool("get_prompts");
      const result = await tool.handler({ query: "x", limit: 3 });
      expect(result.prompts).toHaveLength(3);
      expect(result.count).toBe(3);
    });

    it("passes custom limit to list", async () => {
      mocks.promptList.mockReturnValue([]);
      const tool = findTool("get_prompts");
      await tool.handler({ limit: 5 });
      expect(mocks.promptList).toHaveBeenCalledWith(PROJECT_ID, 5);
    });

    it("returns error on exception", async () => {
      mocks.promptSearch.mockImplementation(() => { throw new Error("search fail"); });
      const tool = findTool("get_prompts");
      const result = await tool.handler({ query: "x" });
      expect(result.error).toContain("search fail");
    });
  });

  /* ── get_errors ───────────────────────────────────────────────────── */
  describe("get_errors", () => {
    it("returns active warnings by default", async () => {
      mocks.getActiveWarnings.mockReturnValue([{ fingerprint: "abc" }]);
      const tool = findTool("get_errors");
      const result = await tool.handler({});
      expect(mocks.getActiveWarnings).toHaveBeenCalledWith(PROJECT_ID);
      expect(mocks.listPatterns).not.toHaveBeenCalled();
      expect(result.patterns).toHaveLength(1);
    });

    it("returns all patterns when activeOnly=false", async () => {
      mocks.listPatterns.mockReturnValue([{ fp: "a" }, { fp: "b" }]);
      const tool = findTool("get_errors");
      const result = await tool.handler({ activeOnly: false });
      expect(mocks.listPatterns).toHaveBeenCalledWith(PROJECT_ID);
      expect(mocks.getActiveWarnings).not.toHaveBeenCalled();
      expect(result.count).toBe(2);
    });

    it("returns error on exception", async () => {
      mocks.getActiveWarnings.mockImplementation(() => { throw new Error("err"); });
      const tool = findTool("get_errors");
      const result = await tool.handler({});
      expect(result.error).toContain("err");
    });
  });

  /* ── get_tool_analytics ───────────────────────────────────────────── */
  describe("get_tool_analytics", () => {
    it("returns session-scoped analytics when sessionId provided", async () => {
      mocks.getSessionAnalytics.mockReturnValue({ tools: [] });
      const tool = findTool("get_tool_analytics");
      const result = await tool.handler({ sessionId: "sess-1" });
      expect(mocks.getSessionAnalytics).toHaveBeenCalledWith(PROJECT_ID, "sess-1");
      expect(mocks.getAnalytics).not.toHaveBeenCalled();
      expect(result).toEqual({ tools: [] });
    });

    it("returns project-wide analytics when no sessionId", async () => {
      mocks.getAnalytics.mockReturnValue({ totalCalls: 42 });
      const tool = findTool("get_tool_analytics");
      const result = await tool.handler({});
      expect(mocks.getAnalytics).toHaveBeenCalledWith(PROJECT_ID);
      expect(result).toEqual({ totalCalls: 42 });
    });

    it("returns error on exception", async () => {
      mocks.getAnalytics.mockImplementation(() => { throw new Error("analytics fail"); });
      const tool = findTool("get_tool_analytics");
      const result = await tool.handler({});
      expect(result.error).toContain("analytics fail");
    });
  });

  /* ── get_context_recipes ──────────────────────────────────────────── */
  describe("get_context_recipes", () => {
    it("returns recipe and registered providers", async () => {
      mocks.getRecipe.mockReturnValue({ name: "default", entries: [] });
      mocks.getRegisteredProviders.mockReturnValue([
        { id: "p1", name: "Provider 1", description: "desc", extraField: true },
      ]);

      const tool = findTool("get_context_recipes");
      const result = await tool.handler({});
      expect(result.recipe).toEqual({ name: "default", entries: [] });
      expect(result.registeredProviders).toHaveLength(1);
      // Only id, name, description should be included
      expect(result.registeredProviders[0]).toEqual({
        id: "p1",
        name: "Provider 1",
        description: "desc",
      });
    });

    it("returns error on exception", async () => {
      mocks.getRecipe.mockImplementation(() => { throw new Error("recipe fail"); });
      const tool = findTool("get_context_recipes");
      const result = await tool.handler({});
      expect(result.error).toContain("recipe fail");
    });
  });

  /* ── search ───────────────────────────────────────────────────────── */
  describe("search", () => {
    it("returns empty results for empty query", async () => {
      const tool = findTool("search");
      const result = await tool.handler({ query: "" });
      expect(result).toEqual({ results: [], count: 0 });
      expect(mocks.searchAll).not.toHaveBeenCalled();
    });

    it("returns empty results for whitespace-only query", async () => {
      const tool = findTool("search");
      const result = await tool.handler({ query: "   " });
      expect(result).toEqual({ results: [], count: 0 });
    });

    it("calls searchAll when no tables specified", async () => {
      mocks.searchAll.mockReturnValue([{ table: "prompts", id: "1" }]);
      const tool = findTool("search");
      const result = await tool.handler({ query: "test" });
      expect(mocks.searchAll).toHaveBeenCalledWith(PROJECT_ID, "test", 20);
      expect(result.count).toBe(1);
    });

    it("searches specific tables when tables array is provided", async () => {
      mocks.searchPrompts.mockReturnValue([{ id: "p1" }]);
      mocks.searchErrors.mockReturnValue([{ id: "e1" }]);
      const tool = findTool("search");
      const result = await tool.handler({ query: "bug", tables: ["prompts", "errors"] });
      expect(mocks.searchPrompts).toHaveBeenCalled();
      expect(mocks.searchErrors).toHaveBeenCalled();
      expect(mocks.searchAll).not.toHaveBeenCalled();
      expect(result.count).toBe(2);
    });

    it("respects limit parameter", async () => {
      mocks.searchAll.mockReturnValue([{ id: "1" }, { id: "2" }, { id: "3" }]);
      const tool = findTool("search");
      const result = await tool.handler({ query: "test", limit: 5 });
      expect(mocks.searchAll).toHaveBeenCalledWith(PROJECT_ID, "test", 5);
    });

    it("trims whitespace from query", async () => {
      mocks.searchAll.mockReturnValue([]);
      const tool = findTool("search");
      await tool.handler({ query: "  hello world  " });
      expect(mocks.searchAll).toHaveBeenCalledWith(PROJECT_ID, "hello world", 20);
    });

    it("distributes limit across tables evenly (ceil)", async () => {
      // 3 tables with limit=5 => perTableLimit = ceil(5/3) = 2
      mocks.searchPrompts.mockReturnValue([{ id: "p1" }]);
      mocks.searchObservations.mockReturnValue([{ id: "o1" }]);
      mocks.searchErrors.mockReturnValue([{ id: "e1" }]);

      const tool = findTool("search");
      const result = await tool.handler({
        query: "x",
        tables: ["prompts", "observations", "errors"],
        limit: 5,
      });
      // perTableLimit = ceil(5/3) = 2
      expect(mocks.searchPrompts).toHaveBeenCalledWith(PROJECT_ID, "x", 2);
      expect(mocks.searchObservations).toHaveBeenCalledWith(PROJECT_ID, "x", 2);
      expect(mocks.searchErrors).toHaveBeenCalledWith(PROJECT_ID, "x", 2);
    });

    it("ignores unknown table names gracefully", async () => {
      const tool = findTool("search");
      const result = await tool.handler({ query: "x", tables: ["unknown_table"] });
      expect(result.count).toBe(0);
    });

    it("returns error on exception", async () => {
      mocks.searchAll.mockImplementation(() => { throw new Error("fts fail"); });
      const tool = findTool("search");
      const result = await tool.handler({ query: "crash" });
      expect(result.error).toContain("fts fail");
    });
  });

  /* ── get_subagents ────────────────────────────────────────────────── */
  describe("get_subagents", () => {
    it("returns tree for a specific session", async () => {
      mocks.subagentGetTree.mockReturnValue([{ id: "sa1", type: "worker" }]);
      const tool = findTool("get_subagents");
      const result = await tool.handler({ sessionId: "sess-1" });
      expect(mocks.subagentGetTree).toHaveBeenCalledWith(PROJECT_ID, "sess-1");
      expect(result.sessionId).toBe("sess-1");
      expect(result.tree).toHaveLength(1);
      expect(result.count).toBe(1);
    });

    it("lists recent events when no sessionId", async () => {
      mocks.subagentList.mockReturnValue([{ id: "e1" }, { id: "e2" }]);
      const tool = findTool("get_subagents");
      const result = await tool.handler({});
      expect(mocks.subagentList).toHaveBeenCalledWith(PROJECT_ID, 20);
      expect(result.events).toHaveLength(2);
      expect(result.count).toBe(2);
    });

    it("respects custom limit", async () => {
      mocks.subagentList.mockReturnValue([{ id: "e1" }]);
      const tool = findTool("get_subagents");
      await tool.handler({ limit: 5 });
      expect(mocks.subagentList).toHaveBeenCalledWith(PROJECT_ID, 5);
    });

    it("returns error on exception", async () => {
      mocks.subagentGetTree.mockImplementation(() => { throw new Error("tree fail"); });
      const tool = findTool("get_subagents");
      const result = await tool.handler({ sessionId: "s1" });
      expect(result.error).toContain("tree fail");
    });
  });

  /* ── get_extension_status ─────────────────────────────────────────── */
  describe("get_extension_status", () => {
    it("returns extension counts by status", async () => {
      mocks.listMounted.mockReturnValue([
        { name: "ext-a", status: "mounted" },
        { name: "ext-b", status: "mounted" },
        { name: "ext-c", status: "failed" },
        { name: "ext-d", status: "suspended" },
      ]);

      const tool = findTool("get_extension_status");
      const result = await tool.handler({});
      expect(mocks.listMounted).toHaveBeenCalledWith(PROJECT_ID);
      expect(result.count).toBe(4);
      expect(result.healthyCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.suspendedCount).toBe(1);
    });

    it("returns zeros when no extensions mounted", async () => {
      mocks.listMounted.mockReturnValue([]);
      const tool = findTool("get_extension_status");
      const result = await tool.handler({});
      expect(result.count).toBe(0);
      expect(result.healthyCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.suspendedCount).toBe(0);
    });

    it("returns error on exception", async () => {
      mocks.listMounted.mockImplementation(() => { throw new Error("mount fail"); });
      const tool = findTool("get_extension_status");
      const result = await tool.handler({});
      expect(result.error).toContain("mount fail");
    });
  });

  /* ── error handling across all tools ──────────────────────────────── */
  describe("error handling", () => {
    it("all handlers return error objects instead of throwing (non-Error exceptions)", async () => {
      // Test with a non-Error throw (string)
      mocks.getProjectRegistry.mockImplementation(() => {
        throw "string error";  // eslint-disable-line no-throw-literal
      });
      const tool = findTool("get_project");
      const result = await tool.handler({});
      expect(result.error).toContain("string error");
    });
  });

  /* ── parameter schemas ────────────────────────────────────────────── */
  describe("parameter schemas", () => {
    it("search tool requires query parameter", () => {
      const tool = findTool("search");
      expect(tool.parameters.required).toContain("query");
    });

    it("get_project has no required parameters", () => {
      const tool = findTool("get_project");
      expect(tool.parameters.required).toBeUndefined();
    });

    it("all tools disable additionalProperties", () => {
      const tools = registerBuiltinTools(PROJECT_ID);
      for (const tool of tools) {
        expect(tool.parameters.additionalProperties).toBe(false);
      }
    });
  });
});
