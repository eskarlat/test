import { create } from "zustand";
import { apiGet, apiPost, apiPut, apiDelete } from "../api/client";

export interface ToolRule {
  id: string;
  name: string;
  toolType: string;
  pattern: string;
  patternType: "regex" | "contains" | "glob";
  decision: "deny" | "ask" | "allow";
  reason?: string;
  priority: number;
  scope: "global" | "project";
  projectId?: string;
  enabled: boolean;
  isBuiltin: boolean;
  hitCount: number;
  lastHitAt?: string;
}

export interface AuditEntry {
  id: string;
  sessionId?: string;
  toolName: string;
  toolInput: string;
  decision: string;
  reason?: string;
  ruleId?: string;
  createdAt: string;
}

export interface ToolRulesStore {
  rules: ToolRule[];
  auditLog: AuditEntry[];
  loading: boolean;
  error: string | null;
  fetchRules(projectId: string): Promise<void>;
  fetchAuditLog(projectId: string): Promise<void>;
  createRule(projectId: string, data: Partial<ToolRule>): Promise<void>;
  updateRule(projectId: string, id: string, data: Partial<ToolRule>): Promise<void>;
  deleteRule(projectId: string, id: string): Promise<void>;
  reset(): void;
}

export const useToolRulesStore = create<ToolRulesStore>((set) => ({
  rules: [],
  auditLog: [],
  loading: false,
  error: null,

  fetchRules: async (projectId) => {
    set({ loading: true, error: null });
    const result = await apiGet<ToolRule[]>(`/api/${projectId}/tool-rules`);
    if (result.data !== null) {
      set({ rules: result.data, loading: false });
    } else {
      set({ error: result.error, loading: false });
    }
  },

  fetchAuditLog: async (projectId) => {
    const result = await apiGet<AuditEntry[]>(`/api/${projectId}/tool-rules/audit`);
    if (result.data !== null) {
      set({ auditLog: result.data });
    }
  },

  createRule: async (projectId, data) => {
    const result = await apiPost<ToolRule>(`/api/${projectId}/tool-rules`, data);
    if (result.data !== null) {
      set((state) => ({ rules: [...state.rules, result.data!] }));
    }
  },

  updateRule: async (projectId, id, data) => {
    const result = await apiPut<ToolRule>(`/api/${projectId}/tool-rules/${id}`, data);
    if (result.data !== null) {
      set((state) => ({
        rules: state.rules.map((r) => (r.id === id ? result.data! : r)),
      }));
    }
  },

  deleteRule: async (projectId, id) => {
    await apiDelete(`/api/${projectId}/tool-rules/${id}`);
    set((state) => ({ rules: state.rules.filter((r) => r.id !== id) }));
  },

  reset: () => set({ rules: [], auditLog: [], loading: false, error: null }),
}));
