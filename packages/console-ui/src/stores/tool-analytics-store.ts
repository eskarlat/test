import { create } from "zustand";
import { apiGet } from "../api/client";

export interface ToolAnalytics {
  byTool: Record<string, number>;
  successRate: number;
  fileHotspots: Array<{ filePath: string; count: number }>;
  totalCount: number;
  mostTouchedFiles: Array<{ filePath: string; count: number }>;
}

export interface ToolWarning {
  type: string;
  sessionId: string;
  detail: string;
  createdAt: string;
}

export interface ToolAnalyticsStore {
  analytics: ToolAnalytics | null;
  warnings: ToolWarning[];
  loading: boolean;
  error: string | null;
  fetchAnalytics(projectId: string): Promise<void>;
  fetchWarnings(projectId: string): Promise<void>;
  reset(): void;
}

export const useToolAnalyticsStore = create<ToolAnalyticsStore>((set) => ({
  analytics: null,
  warnings: [],
  loading: false,
  error: null,

  fetchAnalytics: async (projectId) => {
    set({ loading: true, error: null });
    const result = await apiGet<ToolAnalytics>(`/api/${projectId}/tools/analytics`);
    if (result.data !== null) {
      set({ analytics: result.data, loading: false });
    } else {
      set({ error: result.error, loading: false });
    }
  },

  fetchWarnings: async (projectId) => {
    const result = await apiGet<ToolWarning[]>(`/api/${projectId}/tools/warnings`);
    if (result.data !== null) {
      set({ warnings: result.data });
    }
  },

  reset: () => set({ analytics: null, warnings: [], loading: false, error: null }),
}));
