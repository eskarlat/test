import { create } from "zustand";
import { apiGet, apiDelete } from "../api/client";

export interface Prompt {
  id: string;
  projectId: string;
  sessionId?: string;
  agent: string;
  intent: string;
  promptPreview: string;
  tokenCount: number;
  createdAt: string;
}

export interface PromptStats {
  total: number;
  byIntent: Record<string, number>;
  byAgent: Record<string, number>;
}

export interface PromptFilter {
  intent: string | undefined;
  agent: string | undefined;
  dateFrom: string | undefined;
  dateTo: string | undefined;
  search: string | undefined;
}

export interface PromptStore {
  prompts: Prompt[];
  stats: PromptStats | null;
  loading: boolean;
  error: string | null;
  filter: PromptFilter;
  fetchPrompts(projectId: string): Promise<void>;
  fetchStats(projectId: string): Promise<void>;
  deletePrompt(projectId: string, id: string): Promise<void>;
  setFilter(filter: Partial<PromptFilter>): void;
  reset(): void;
}

export const usePromptStore = create<PromptStore>((set) => ({
  prompts: [],
  stats: null,
  loading: false,
  error: null,
  filter: { intent: undefined, agent: undefined, dateFrom: undefined, dateTo: undefined, search: undefined },

  fetchPrompts: async (projectId) => {
    set({ loading: true, error: null });
    const result = await apiGet<Prompt[]>(`/api/${projectId}/prompts`);
    if (result.data !== null) {
      set({ prompts: result.data, loading: false });
    } else {
      set({ error: result.error, loading: false });
    }
  },

  fetchStats: async (projectId) => {
    const result = await apiGet<PromptStats>(`/api/${projectId}/prompts/stats`);
    if (result.data !== null) {
      set({ stats: result.data });
    }
  },

  deletePrompt: async (projectId, id) => {
    await apiDelete(`/api/${projectId}/prompts/${id}`);
    set((state) => ({ prompts: state.prompts.filter((p) => p.id !== id) }));
  },

  setFilter: (filter) =>
    set((state) => ({ filter: { ...state.filter, ...filter } })),

  reset: () =>
    set({
      prompts: [],
      stats: null,
      loading: false,
      error: null,
      filter: { intent: undefined, agent: undefined, dateFrom: undefined, dateTo: undefined, search: undefined },
    }),
}));
