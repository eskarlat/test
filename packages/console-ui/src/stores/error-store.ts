import { create } from "zustand";
import { apiGet, apiPut } from "../api/client";

export interface ErrorPattern {
  id: string;
  projectId: string;
  fingerprint: string;
  messageTemplate: string;
  occurrenceCount: number;
  sessionCount: number;
  status: "active" | "resolved" | "ignored";
  resolutionNote?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  toolName?: string;
}

export interface ErrorStore {
  patterns: ErrorPattern[];
  trends: Array<{ date: string; count: number }>;
  loading: boolean;
  error: string | null;
  fetchPatterns(projectId: string): Promise<void>;
  fetchTrends(projectId: string): Promise<void>;
  updatePattern(
    projectId: string,
    id: string,
    data: Partial<ErrorPattern>
  ): Promise<void>;
  reset(): void;
}

export const useErrorStore = create<ErrorStore>((set) => ({
  patterns: [],
  trends: [],
  loading: false,
  error: null,

  fetchPatterns: async (projectId) => {
    set({ loading: true, error: null });
    const result = await apiGet<ErrorPattern[]>(`/api/${projectId}/errors`);
    if (result.data !== null) {
      set({ patterns: result.data, loading: false });
    } else {
      set({ error: result.error, loading: false });
    }
  },

  fetchTrends: async (projectId) => {
    const result = await apiGet<Array<{ date: string; count: number }>>(
      `/api/${projectId}/errors/trends`
    );
    if (result.data !== null) {
      set({ trends: result.data });
    }
  },

  updatePattern: async (projectId, id, data) => {
    const result = await apiPut<ErrorPattern>(`/api/${projectId}/errors/${id}`, data);
    if (result.data !== null) {
      set((state) => ({
        patterns: state.patterns.map((p) => (p.id === id ? result.data! : p)),
      }));
    }
  },

  reset: () => set({ patterns: [], trends: [], loading: false, error: null }),
}));
