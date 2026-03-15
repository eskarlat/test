import { describe, it, expect, vi, beforeEach } from "vitest";
import { useToolRulesStore } from "./tool-rules-store";
import type { ToolRule, AuditEntry } from "./tool-rules-store";

// Mock the API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  BASE_URL: "http://localhost:42888",
}));

// Mock the socket store
vi.mock("../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ socket: { emit: vi.fn() } }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

import { apiGet, apiPost, apiPut, apiDelete } from "../api/client";

const mockApiGet = vi.mocked(apiGet);
const mockApiPost = vi.mocked(apiPost);
const mockApiPut = vi.mocked(apiPut);
const mockApiDelete = vi.mocked(apiDelete);

function makeRule(overrides: Partial<ToolRule> = {}): ToolRule {
  return {
    id: "rule-1",
    name: "Block rm -rf",
    toolType: "bash",
    pattern: "rm -rf",
    patternType: "contains",
    decision: "deny",
    reason: "Dangerous command",
    priority: 100,
    scope: "global",
    enabled: true,
    isBuiltin: false,
    hitCount: 3,
    ...overrides,
  };
}

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "audit-1",
    sessionId: "sess-1",
    toolName: "bash",
    toolInput: "rm -rf /tmp",
    decision: "denied",
    reason: "Matches deny rule",
    ruleId: "rule-1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("tool-rules-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolRulesStore.setState({
      rules: [],
      auditLog: [],
      loading: false,
      error: null,
    });
  });

  describe("fetchRules", () => {
    it("sets rules from API response", async () => {
      const rules = [makeRule(), makeRule({ id: "rule-2", name: "Allow read" })];
      mockApiGet.mockResolvedValueOnce({ data: rules, error: null, status: 200 });

      await useToolRulesStore.getState().fetchRules("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/tool-rules");
      expect(useToolRulesStore.getState().rules).toEqual(rules);
      expect(useToolRulesStore.getState().loading).toBe(false);
      expect(useToolRulesStore.getState().error).toBeNull();
    });

    it("sets error when API fails", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Server error", status: 500 });

      await useToolRulesStore.getState().fetchRules("proj-1");

      expect(useToolRulesStore.getState().rules).toEqual([]);
      expect(useToolRulesStore.getState().error).toBe("Server error");
      expect(useToolRulesStore.getState().loading).toBe(false);
    });
  });

  describe("fetchAuditLog", () => {
    it("sets audit log from API response", async () => {
      const entries = [makeAuditEntry(), makeAuditEntry({ id: "audit-2" })];
      mockApiGet.mockResolvedValueOnce({ data: entries, error: null, status: 200 });

      await useToolRulesStore.getState().fetchAuditLog("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/tool-rules/audit");
      expect(useToolRulesStore.getState().auditLog).toEqual(entries);
    });

    it("does not update audit log on API failure", async () => {
      useToolRulesStore.setState({ auditLog: [makeAuditEntry()] });
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Not found", status: 404 });

      await useToolRulesStore.getState().fetchAuditLog("proj-1");

      expect(useToolRulesStore.getState().auditLog).toHaveLength(1);
    });
  });

  describe("createRule", () => {
    it("appends new rule to the list", async () => {
      useToolRulesStore.setState({ rules: [makeRule({ id: "rule-1" })] });
      const newRule = makeRule({ id: "rule-new", name: "New Rule" });
      mockApiPost.mockResolvedValueOnce({ data: newRule, error: null, status: 201 });

      await useToolRulesStore.getState().createRule("proj-1", { name: "New Rule" });

      expect(mockApiPost).toHaveBeenCalledWith("/api/proj-1/tool-rules", { name: "New Rule" });
      expect(useToolRulesStore.getState().rules).toHaveLength(2);
      expect(useToolRulesStore.getState().rules[1]!.id).toBe("rule-new");
    });

    it("does not append on API failure", async () => {
      useToolRulesStore.setState({ rules: [makeRule()] });
      mockApiPost.mockResolvedValueOnce({ data: null, error: "Validation failed", status: 400 });

      await useToolRulesStore.getState().createRule("proj-1", { name: "Bad" });

      expect(useToolRulesStore.getState().rules).toHaveLength(1);
    });
  });

  describe("updateRule", () => {
    it("replaces the rule in the list", async () => {
      useToolRulesStore.setState({ rules: [makeRule({ id: "rule-1", name: "Old Name" })] });
      const updated = makeRule({ id: "rule-1", name: "Updated Name" });
      mockApiPut.mockResolvedValueOnce({ data: updated, error: null, status: 200 });

      await useToolRulesStore.getState().updateRule("proj-1", "rule-1", { name: "Updated Name" });

      expect(mockApiPut).toHaveBeenCalledWith("/api/proj-1/tool-rules/rule-1", { name: "Updated Name" });
      expect(useToolRulesStore.getState().rules[0]!.name).toBe("Updated Name");
    });

    it("does not update on API failure", async () => {
      useToolRulesStore.setState({ rules: [makeRule({ id: "rule-1", name: "Original" })] });
      mockApiPut.mockResolvedValueOnce({ data: null, error: "Not found", status: 404 });

      await useToolRulesStore.getState().updateRule("proj-1", "rule-1", { name: "Changed" });

      expect(useToolRulesStore.getState().rules[0]!.name).toBe("Original");
    });
  });

  describe("deleteRule", () => {
    it("removes the rule from the list", async () => {
      useToolRulesStore.setState({
        rules: [makeRule({ id: "rule-1" }), makeRule({ id: "rule-2" })],
      });
      mockApiDelete.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 204 });

      await useToolRulesStore.getState().deleteRule("proj-1", "rule-1");

      expect(mockApiDelete).toHaveBeenCalledWith("/api/proj-1/tool-rules/rule-1");
      expect(useToolRulesStore.getState().rules).toHaveLength(1);
      expect(useToolRulesStore.getState().rules[0]!.id).toBe("rule-2");
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      useToolRulesStore.setState({
        rules: [makeRule()],
        auditLog: [makeAuditEntry()],
        loading: true,
        error: "some error",
      });

      useToolRulesStore.getState().reset();

      const state = useToolRulesStore.getState();
      expect(state.rules).toEqual([]);
      expect(state.auditLog).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
